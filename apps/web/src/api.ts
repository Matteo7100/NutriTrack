/** Adapter HTTP. Il cookie di sessione è HttpOnly; il token CSRF resta solo in memoria. */
export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
let csrfToken = '';
export const setCsrf = (value: string) => { csrfToken = value; };

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new ApiError(data?.code ?? 'HttpError', response.status, data?.message ?? 'Richiesta non riuscita.');
  return data as T;
}
