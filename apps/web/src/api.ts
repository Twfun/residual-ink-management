export const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:39080/api';

export async function api<T>(path: string, options: RequestInit = {}, token?: string | null) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.message || '请求失败。');
  return value as T;
}