import { useAuth } from '@/store/auth';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = useAuth.getState().token;
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) useAuth.getState().logout();
    throw new ApiError(res.status, Array.isArray(data.message) ? data.message.join(', ') : data.message ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** presign → PUT straight to S3 → confirm */
export async function uploadAttachment(conversationId: string, file: File, onProgress?: (p: number) => void) {
  const { attachmentId, uploadUrl } = await api<{ attachmentId: string; uploadUrl: string }>('/attachments/presign', {
    method: 'POST',
    json: { conversationId, fileName: file.name, mimeType: file.type, sizeBytes: file.size },
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('content-type', file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });
  return api<{ id: string; status: string; kind: string; fileName: string; sizeBytes: number; mimeType: string }>(
    `/attachments/${attachmentId}/confirm`, { method: 'POST' },
  );
}
