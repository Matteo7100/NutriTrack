import { useState, type FormEvent } from 'react';
import { api } from './api';
import type { User } from './types';

export type Session = { user: User; csrfToken: string };
type Mode = 'login' | 'register' | 'forgot' | 'reset';
const copy = {
  login: { title: 'Accedi a NutriTrack', description: 'Entra nella tua area personale.', submit: 'Accedi' },
  register: { title: 'Crea il tuo account', description: 'Scegli se accedere come paziente o come nutrizionista.', submit: 'Crea account' },
  forgot: { title: 'Recupera la password', description: 'Inserisci l’indirizzo email del tuo account per ricevere un link di recupero.', submit: 'Invia link di recupero' },
  reset: { title: 'Scegli una nuova password', description: 'Dopo averla salvata potrai accedere con la nuova password.', submit: 'Salva nuova password' },
};

export function AccountAccess({ online, resetToken, reauthenticate, initialRecovery, onLogin, onReset, onLeaveReset }: {
  online: boolean;
  resetToken?: string;
  reauthenticate?: boolean;
  initialRecovery?: boolean;
  onLogin: (session: Session) => Promise<void>;
  onReset: () => void;
  onLeaveReset?: (requestAnother: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialRecovery ? 'forgot' : 'login');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const view = resetToken === undefined ? mode : 'reset';
  const changeMode = (next: Mode) => {
    setError(''); setNotice(''); setMode(next);
    if (resetToken !== undefined) onLeaveReset?.(next === 'forgot');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!online || busy) return;
    setError(''); setNotice(''); setBusy(true);
    const fields = new FormData(event.currentTarget);
    const password = fields.get('password');
    try {
      if ((view === 'register' || view === 'reset') && password !== fields.get('confirmPassword')) {
        throw new Error('Le password inserite devono coincidere.');
      }
      switch (view) {
        case 'login':
          await onLogin(await api<Session>('/auth/login', 'POST', { email, password }));
          break;
        case 'register':
          await api('/auth/register', 'POST', { email, password, name: fields.get('name'), role: fields.get('role') });
          setMode('login');
          setNotice('Account creato. Accedi con l’email e la password che hai scelto.');
          break;
        case 'forgot':
          await api('/auth/forgot-password', 'POST', { email });
          setNotice('Se l’indirizzo è associato a un account, riceverai un’email con il link di recupero.');
          break;
        case 'reset':
          await api('/auth/reset-password', 'POST', { token: resetToken, password });
          setMode('login');
          onReset();
          setNotice('Password aggiornata. Accedi con la nuova password.');
          break;
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Operazione non riuscita.'); }
    finally { setBusy(false); }
  };

  const form = <>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    <form onSubmit={submit} className="login-form" key={view}>
      {view === 'register' && <label>Nome e cognome<input name="name" autoComplete="name" required maxLength={100} /></label>}
      {view !== 'reset' && <label>Email<input name="email" autoComplete={view === 'register' ? 'email' : 'username'} type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} required /></label>}
      {view === 'register' && <label>Tipo di account<select name="role" defaultValue="" required>
        <option value="" disabled>Scegli il tuo ruolo</option><option value="PATIENT">Paziente</option><option value="NUTRITIONIST">Nutrizionista</option>
      </select></label>}
      {view !== 'forgot' && <label>{view === 'reset' ? 'Nuova password' : 'Password'}
        <input name="password" autoComplete={view === 'login' ? 'current-password' : 'new-password'} type="password" required minLength={view === 'login' ? undefined : 10} maxLength={128} aria-describedby={view === 'login' ? undefined : 'password-hint'} />
      </label>}
      {(view === 'register' || view === 'reset') && <p id="password-hint" className="meta">Usa almeno 10 caratteri.</p>}
      {(view === 'register' || view === 'reset') && <label>Conferma password<input name="confirmPassword" autoComplete="new-password" type="password" required maxLength={128} /></label>}
      <button className="auth-submit" disabled={!online || busy}>{busy ? 'Attendi…' : copy[view].submit}</button>
    </form>
    <div className="auth-actions">
      {view === 'login' ? <>
        <button type="button" className="text-button" disabled={busy} onClick={() => changeMode('forgot')}>Password dimenticata?</button>
        {!reauthenticate && <button type="button" className="text-button" disabled={busy} onClick={() => changeMode('register')}>Crea un account</button>}
      </> : <>
        <button type="button" className="text-button" disabled={busy} onClick={() => changeMode('login')}>Torna al login</button>
        {view === 'reset' && <button type="button" className="text-button" disabled={busy} onClick={() => changeMode('forgot')}>Richiedi un nuovo link</button>}
      </>}
    </div>
  </>;

  if (reauthenticate) return <section className="card reauthenticate" aria-labelledby="reauth-title">
    <h2 id="reauth-title">{view === 'login' ? 'Conferma di nuovo l’accesso' : copy[view].title}</h2>
    <p>{view === 'login' ? 'Accedi per sincronizzare le registrazioni e aggiornare i dati online.' : copy[view].description}</p>
    {form}
  </section>;

  return <section className="access-layout" aria-labelledby="access-title">
    <div className="access-story" aria-hidden="true">
      <p className="eyebrow">NutriTrack</p>
      <p className="access-claim">Il tuo percorso alimentare, giorno dopo giorno.</p>
      <p>Un posto per il piano alimentare, i pasti e i progressi.</p>
    </div>
    <div className="card access-panel">
      <h1 id="access-title">{copy[view].title}</h1><p>{copy[view].description}</p>
      {form}
    </div>
  </section>;
}
