/**
 * Sicurezza e dati dell'account, per entrambi i ruoli: cambio password,
 * esportazione dei dati personali ed eliminazione definitiva dell'account.
 * Tutte le operazioni richiedono la rete e una sessione valida.
 */
import { useState, type FormEvent } from 'react';
import { api } from './api';
import type { User } from './types';

const failure = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;

export function AccountSettings({ user, available, onDeleted }: { user: User; available: boolean; onDeleted: () => Promise<void> }) {
  const [busy, setBusy] = useState<'password' | 'export' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (fields.get('newPassword') !== fields.get('confirmPassword')) { setError('Le due nuove password non coincidono.'); return; }
    setBusy('password'); setError(''); setNotice('');
    try {
      await api('/account/password', 'PATCH', { currentPassword: fields.get('currentPassword'), newPassword: fields.get('newPassword') });
      form.reset();
      setNotice('Password aggiornata. Le altre sessioni aperte sono state chiuse.');
    } catch (reason) { setError(failure(reason, 'Cambio password non riuscito.')); }
    finally { setBusy(null); }
  };

  const exportData = async () => {
    if (busy) return;
    setBusy('export'); setError(''); setNotice('');
    try {
      const data = await api<unknown>('/account/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `nutritrack-dati-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      setNotice('Esportazione scaricata.');
    } catch (reason) { setError(failure(reason, 'Esportazione non riuscita.')); }
    finally { setBusy(null); }
  };

  const deleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    if (!confirm('Eliminare definitivamente l’account? L’operazione non si può annullare.')) return;
    setBusy('delete'); setError(''); setNotice('');
    try {
      await api('/account/delete', 'POST', { password: fields.get('password') });
      await onDeleted();
    } catch (reason) { setError(failure(reason, 'Eliminazione non riuscita.')); setBusy(null); }
  };

  const patient = user.role === 'PATIENT';
  return <section className="card" aria-labelledby="account-security">
    <h2 id="account-security">Account e sicurezza</h2>
    {!available && <p className="meta">Collegati e accedi per gestire password e dati dell’account.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    <form onSubmit={changePassword}>
      <h3>Cambia password</h3>
      <label>Password attuale<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} disabled={!available} /></label>
      <label>Nuova password<input name="newPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} disabled={!available} /></label>
      <label>Ripeti la nuova password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} disabled={!available} /></label>
      <button disabled={!available || busy !== null}>{busy === 'password' ? 'Aggiornamento…' : 'Aggiorna password'}</button>
    </form>
    <h3>I tuoi dati</h3>
    <p>{patient
      ? 'Scarica in formato JSON profilo, piani, diario, misurazioni, elenco delle foto, inviti e associazioni.'
      : 'Scarica in formato JSON il tuo profilo, inviti, associazioni e le versioni dei piani che hai pubblicato.'}</p>
    <button className="quiet" disabled={!available || busy !== null} onClick={() => void exportData()}>{busy === 'export' ? 'Preparazione…' : 'Scarica i miei dati'}</button>
    <form onSubmit={deleteAccount}>
      <h3>Elimina account</h3>
      <p>{patient
        ? 'Cancella definitivamente account, piani, diario, misurazioni, foto e associazioni. Le registrazioni non ancora sincronizzate su questo dispositivo vengono scartate.'
        : 'Cancella definitivamente il tuo account e chiude le associazioni attive: i pazienti conservano lo storico dei piani, ma il piano attuale non sarà più attivo.'}</p>
      <label>Conferma con la password<input name="password" type="password" autoComplete="current-password" required maxLength={128} disabled={!available} /></label>
      <button className="danger" disabled={!available || busy !== null}>{busy === 'delete' ? 'Eliminazione…' : 'Elimina definitivamente'}</button>
    </form>
  </section>;
}
