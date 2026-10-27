/**
 * Synchronous rule engine (~1ms) that runs on every message before it is stored/delivered.
 * The async AI reviewer (ai-moderation.processor.ts) is a second pass for what regexes miss.
 */

export type Verdict = 'ALLOW' | 'WARN' | 'BLOCK';

export interface RuleResult {
  verdict: Verdict;
  flags: string[];
  /** Text with profanity masked — what recipients see */
  sanitized: string;
  /** Shown to the recipient on WARN */
  safetyTip?: string;
  /** Shown to the sender on BLOCK */
  senderNotice?: string;
}

const PROFANITY: RegExp[] = [
  /\bf+u+c+k+\w*/gi,
  /\bs+h+i+t+\w*/gi,
  /\bb+i+t+c+h+\w*/gi,
  /\ba+s+s+h+o+l+e+\w*/gi,
  /\bc+u+n+t+\w*/gi,
  // Russian roots (Cyrillic + common Latin look-alikes)
  /(?<![а-яё])[хx][уy][йиеёяю]\S*/gi,
  /(?<![а-яё])бл[яa]\S*/gi,
  /(?<![а-яё])пизд\S*/gi,
  /(?<![а-яё])[её]б[аауоы]\S*/gi,
  /(?<![а-яё])сук[аи](?![а-яё])/gi,
  /(?<![а-яё])мудак\S*/gi,
];

// Explicit scheme/www, or a bare domain with a TLD commonly seen in chat scams (incl. shortener TLDs like .ly .gl .gd)
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|ru|xyz|top|click|link|info|online|site|shop|app|biz|ge|io|me|co|ly|gl|gd|at|cc|to|pw|ws|su|tk)(?:\/[^\s<>"']*)?)(?![\w-])/gi;
const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'cutt.ly', 'is.gd', 'rb.gy', 'clck.ru', 'ow.ly', 'shorturl.at'];
const PHISH_WORDS = /(verify|confirm|secure|login|signin|payment|wallet|refund|account|support|update|bonus|prize|delivery)/i;
const SAFE_DOMAINS = (process.env.SAFE_LINK_DOMAINS ?? 'realty.example,google.com,maps.google.com,mapbox.com,stripe.com')
  .split(',').map((d) => d.trim().toLowerCase());
const BRAND = (process.env.BRAND_NAME ?? 'realty').toLowerCase();

const FRAUD_PATTERNS: Array<{ re: RegExp; flag: string; weight: number }> = [
  { re: /western\s*union|moneygram|золотая\s*корона|korona\s*pay/i, flag: 'offplatform_transfer', weight: 2 },
  { re: /\b(usdt|bitcoin|btc|crypto|крипт\w*|биткоин\w*|tether)\b/i, flag: 'crypto_payment', weight: 2 },
  { re: /gift\s*card|подарочн\w+\s+карт/i, flag: 'gift_card', weight: 2 },
  { re: /(deposit|prepay\w*|advance|предоплат\w*|задат\w*|аванс\w*).{0,40}(before|without|до|без).{0,20}(view\w*|see\w*|showing|просмотр\w*|осмотр\w*)/i, flag: 'prepay_before_viewing', weight: 2 },
  { re: /(i\s*am|i'm|я)\s*(abroad|out of the country|за\s*границ\w*|в\s*командировк\w*).{0,80}(keys?|ключ\w*)/i, flag: 'absent_owner_keys_by_mail', weight: 2 },
  { re: /(pay|transfer|send|переве\w*|оплат\w*|отправ\w*).{0,30}(outside|off|directly|напрямую|мимо|на\s*карт\w*)/i, flag: 'pay_outside_platform', weight: 1 },
  { re: /(whats\s*app|telegram|телеграм\w*|viber|signal|вотсап\w*|ватсап\w*)/i, flag: 'move_off_platform', weight: 1 },
  { re: /\b(cvv|cvc|sms[\s-]*code|код\s*из\s*смс|смс[\s-]*код\w*|one[\s-]*time\s*code)\b/i, flag: 'credential_request', weight: 3 },
  { re: /(urgent|срочно|today only|только сегодня|other (buyers|tenants) waiting|много желающих)/i, flag: 'pressure', weight: 1 },
];

function luhn(num: string) {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function hostOf(raw: string) {
  try {
    return new URL(raw.startsWith('http') ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function analyzeText(text: string): RuleResult {
  const flags = new Set<string>();
  let sanitized = text;
  let fraudScore = 0;
  let hardBlock = false;

  // 1. Profanity → mask + WARN
  for (const re of PROFANITY) {
    if (re.test(sanitized)) {
      flags.add('profanity');
      sanitized = sanitized.replace(re, (m) => m[0] + '*'.repeat(Math.max(m.length - 1, 2)));
    }
    re.lastIndex = 0;
  }

  // 2. Phishing links
  for (const m of text.matchAll(URL_RE)) {
    const host = hostOf(m[0]);
    if (!host || SAFE_DOMAINS.some((d) => host === d || host.endsWith('.' + d))) continue;
    if (SHORTENERS.includes(host)) { flags.add('phishing_shortener'); hardBlock = true; }
    else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) { flags.add('phishing_ip_url'); hardBlock = true; }
    else if (host.includes('xn--')) { flags.add('phishing_punycode'); hardBlock = true; }
    else if (host.includes(BRAND)) { flags.add('phishing_brand_lookalike'); hardBlock = true; }
    else if (PHISH_WORDS.test(m[0])) { flags.add('phishing_suspicious_link'); fraudScore += 2; }
    else flags.add('external_link');
  }

  // 3. Card numbers (Luhn-valid 13–19 digits) — never let them through
  for (const m of text.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      flags.add('card_number');
      hardBlock = true;
    }
  }

  // 4. Fraud scenarios typical for rentals/sales
  for (const p of FRAUD_PATTERNS) {
    if (p.re.test(text)) {
      flags.add(p.flag);
      fraudScore += p.weight;
    }
  }
  if (flags.has('credential_request')) hardBlock = true;

  let verdict: Verdict = 'ALLOW';
  if (hardBlock || fraudScore >= 4) verdict = 'BLOCK';
  else if (fraudScore >= 1 || flags.has('profanity') || flags.has('external_link')) verdict = 'WARN';

  return {
    verdict,
    flags: [...flags],
    sanitized,
    safetyTip: verdict === 'WARN' ? safetyTipFor(flags) : undefined,
    senderNotice: verdict === 'BLOCK'
      ? 'This message was not delivered: it contains a link, payment request or personal data that our safety rules do not allow. Use the built-in offer and secure deposit instead.'
      : undefined,
  };
}

function safetyTipFor(flags: Set<string>): string {
  if (flags.has('prepay_before_viewing') || flags.has('pay_outside_platform') || flags.has('offplatform_transfer') || flags.has('crypto_payment'))
    return 'Never pay a deposit before viewing or outside the platform. Use the secure reservation deposit — the money is held until you confirm the move-in.';
  if (flags.has('move_off_platform'))
    return 'Keep the conversation here: messages, documents and agreements in this chat are protected and can be reviewed by support if something goes wrong.';
  if (flags.has('phishing_suspicious_link') || flags.has('external_link'))
    return 'This message contains an external link. Do not enter passwords or card details on sites you reached from a chat.';
  if (flags.has('profanity')) return 'Some words were hidden by the moderation filter.';
  return 'Be careful: this message matches a known scam pattern.';
}
