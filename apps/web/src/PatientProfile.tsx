import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import type { User } from './types';
import { Icon } from './Workspace';

interface Profile extends User { birthDate: string | null; heightCm: number | null }
const displayDate = (date: string) => date.split('-').reverse().join('/');
const dateLimit = (today: Date) => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

function ageOn(birthDate: string, today: Date) {
  const [year, month, day] = birthDate.split('-').map(Number);
  const monthNow = today.getMonth() + 1;
  const birthdayPassed = monthNow > month || (monthNow === month && today.getDate() >= day);
  return today.getFullYear() - year - (birthdayPassed ? 0 : 1);
}

export function PatientProfile({ user, available, onSaved }: { user: User; available: boolean; onSaved: (user: User) => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(available);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!available) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError('');
    api<Profile>('/profile').then(value => { if (active) setProfile(value); }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Profilo non disponibile.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [available, attempt]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!available || busy) return;
    const fields = new FormData(event.currentTarget);
    const height = fields.get('heightCm');
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await api<Profile>('/profile', 'PATCH', {
        name: fields.get('name'), email, birthDate: fields.get('birthDate') || null,
        heightCm: height ? Number(height) : null,
        ...(fields.has('currentPassword') && { currentPassword: fields.get('currentPassword') }),
      });
      setProfile(value); setEditing(false); setNotice('Profilo aggiornato.');
      onSaved({ id: value.id, email: value.email, name: value.name, role: value.role });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Salvataggio non riuscito.'); }
    finally { setBusy(false); }
  };

  const today = new Date();
  const name = profile?.name ?? user.name;
  const emailChanged = email.trim().toLowerCase() !== (profile?.email ?? user.email).toLowerCase();
  return <section className="card profile-card" aria-labelledby="profile-details">
    <div className="profile-heading">
      <span className="profile-avatar" aria-hidden="true">{name.trim().split(/\s+/).slice(0, 2).map(word => word.charAt(0)).join('').toUpperCase()}</span>
      <div><h2 id="profile-details">{name}</h2><p className="meta">Account paziente</p></div>
      {!editing && <button className="quiet icon-action" disabled={!available || !profile || loading} onClick={() => {
        setEmail(profile?.email ?? user.email); setEditing(true); setNotice(''); setError('');
      }}><Icon name="edit" /> Modifica profilo</button>}
    </div>
    {!available && <p className="meta">Accedi con una connessione per aggiornare i dati del profilo.</p>}
    {loading && <p className="meta" role="status">Caricamento profilo…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {error && !profile && available && <button className="quiet" onClick={() => setAttempt(attempt + 1)}>Ricarica profilo</button>}
    {notice && <p className="success" role="status">{notice}</p>}
    {editing && profile ? <form onSubmit={submit}>
      <div className="profile-grid">
        <label>Nome e cognome<input name="name" autoComplete="name" defaultValue={profile.name} required maxLength={100} /></label>
        <label>Email<input name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} /></label>
        <label>Data di nascita<input name="birthDate" type="date" autoComplete="bday" defaultValue={profile.birthDate ?? ''} min="1900-01-01" max={dateLimit(today)} /></label>
        <label>Altezza (cm)<input name="heightCm" type="number" defaultValue={profile.heightCm ?? ''} min={30} max={300} step="any" /></label>
      </div>
      {emailChanged && <label>Password attuale<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
        <span className="meta">Conferma la password per cambiare l’indirizzo di accesso.</span>
      </label>}
      <button disabled={!available || busy}>{busy ? 'Salvataggio…' : 'Salva profilo'}</button>
      <button className="quiet" type="button" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Annulla</button>
    </form> : <dl className="profile-grid profile-values">
      <div><dt>Email</dt><dd>{profile?.email ?? user.email}</dd></div>
      <div><dt>Data di nascita</dt><dd>{profile?.birthDate ? displayDate(profile.birthDate) : '—'}</dd></div>
      <div><dt>Età</dt><dd>{profile?.birthDate ? `${ageOn(profile.birthDate, today)} anni` : '—'}</dd></div>
      <div><dt>Altezza</dt><dd>{profile?.heightCm ? `${profile.heightCm.toLocaleString('it-IT')} cm` : '—'}</dd></div>
    </dl>}
  </section>;
}
