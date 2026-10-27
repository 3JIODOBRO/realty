export function redisConnection() {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    // ElastiCache with in-transit encryption uses rediss://
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null as null,
  };
}
