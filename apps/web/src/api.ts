/** Adapter HTTP. Il cookie di sessione è HttpOnly; il token CSRF resta solo in memoria. */
export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
let csrfToken = '';
export const setCsrf = (value: string) => { csrfToken = value; };

export const serviceUnavailableEvent = 'nutritrack:service-unavailable';
function signalUnavailable() {
  if (typeof window !== 'undefined' && navigator.onLine) window.dispatchEvent(new Event(serviceUnavailableEvent));
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).catch(error => { signalUnavailable(); throw error; });
  if (response.status >= 500) signalUnavailable();
  let data: any;
  try { data = response.status === 204 ? undefined : await response.json(); }
  catch {
    // Corpo non JSON (pagina di errore di un proxy, server in riavvio): errore HTTP leggibile.
    if (!response.ok) throw new ApiError('HttpError', response.status, response.status >= 500 ? 'Servizio temporaneamente non disponibile.' : 'Richiesta non riuscita.');
    throw new ApiError('InvalidResponse', 502, 'Risposta del server non valida.');
  }
  if (!response.ok) throw new ApiError(data?.code ?? 'HttpError', response.status, data?.message ?? 'Richiesta non riuscita.');
  return data as T;
}
