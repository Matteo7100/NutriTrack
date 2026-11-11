/**
 * Interfaccia dei due ruoli, limitata agli use case concordati.
 * Le autorizzazioni sono sempre applicate dal server: nascondere un pulsante non basta.
 * Patient offline usa soltanto la propria cache e una coda persistente di nuove registrazioni.
 * Collega gli Observer del motore al ciclo di vita React; Command e Strategy sono
 * gestiti nel sottosistema sync/, così la schermata non decide il protocollo di retry.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, setCsrf } from './api';
import { enqueue, flushQueue, localNow, localToIso, queueStore, readSnapshot, retryAuthentication, saveSnapshot, setSyncAccount, syncEngine, type Queued } from './offline';
import { PatientDataRefresher, QueuePanelModel } from './sync/observers';
import type { Content, Entry, Invitation, Meal, Measurement, Snapshot, User, Version } from './types';
import { AccountAccess, type Session } from './AccountAccess';
import { PatientProfile } from './PatientProfile';
import { ProgressPanel, measurementLabel, measurementUnit } from './ProgressPanel';
import { Brand, Dashboard, Icon, SectionHeading, sectionFor } from './Workspace';

const ACTIVE = 'nutritrack-active-patient';
const readable = (time: number) => new Date(time).toLocaleString('it-IT');
const message = (error: unknown) => error instanceof Error ? error.message : 'Operazione non riuscita.';
const blankMeal = (): Meal => ({ name: '', options: [{ foods: [{ food: '', quantity: 1, unit: 'g' }] }] });
const emptyContent = (): Content => ({ meals: [blankMeal()] });

// Traduce i percorsi del ChangeSet senza mostrare la struttura tecnica dei DTO.
const describeChange = (path: string) => {
  const names: Record<string, string> = { content: '', meals: 'Pasto', options: 'Alternativa', foods: 'Alimento', name: 'Nome', food: 'Descrizione', quantity: 'Quantità', unit: 'Unità' };
  return path.split(/[./]/).filter(Boolean).map(part => /^\d+$/.test(part) ? String(Number(part) + 1) : names[part] ?? part).filter(Boolean).join(' › ');
};
const describeValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'assente';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `${value.length} elementi del piano`;
  return 'contenuto del piano';
};

function Plan({ version }: { version: Version | null }) {
  if (!version) return <p>Nessun piano valido.</p>;
  return <div className="plan"><p className="meta">Versione {version.versionNumber} · dal {readable(version.validFrom)}</p>
    {version.content.meals.map((meal, index) => <section className="meal" key={index}><h4>{meal.name}</h4>
      {meal.options.map((option, optionIndex) => <div key={optionIndex}><strong>Alternativa {optionIndex + 1}</strong>
        <ul>{option.foods.map((food, foodIndex) => <li key={foodIndex}>{food.food} · {food.quantity} {food.unit}</li>)}</ul>
      </div>)}
    </section>)}
  </div>;
}

function Editor({ initial, onPublish, disabled }: { initial: Version | null; onPublish: (content: Content) => Promise<void>; disabled: boolean }) {
  const [content, setContent] = useState<Content>(() => initial ? structuredClone(initial.content) : emptyContent());
  const [saving, setSaving] = useState(false);
  const change = (fn: (copy: Content) => void) => setContent(current => { const copy = structuredClone(current); fn(copy); return copy; });
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); try { await onPublish(content); } finally { setSaving(false); } };
  return <form onSubmit={submit} className="editor"><p>Pubblicare crea una nuova versione immutabile, attiva immediatamente.</p>
    {content.meals.map((meal, mi) => <fieldset key={mi}><legend>Pasto {mi + 1}</legend>
      <label>Nome del pasto<input required maxLength={100} value={meal.name} onChange={e => change(c => { c.meals[mi].name = e.target.value; })} /></label>
      {meal.options.map((option, oi) => <fieldset key={oi}><legend>Alternativa {oi + 1}</legend>
        {option.foods.map((food, fi) => <div className="food-row" key={fi}>
          <label>Alimento<input required maxLength={100} value={food.food} onChange={e => change(c => { c.meals[mi].options[oi].foods[fi].food = e.target.value; })} /></label>
          <label>Quantità<input required type="number" min="0.001" step="any" value={food.quantity} onChange={e => change(c => { c.meals[mi].options[oi].foods[fi].quantity = Number(e.target.value); })} /></label>
          <label>Unità<input required maxLength={20} value={food.unit} onChange={e => change(c => { c.meals[mi].options[oi].foods[fi].unit = e.target.value; })} /></label>
          {option.foods.length > 1 && <button type="button" className="quiet" onClick={() => change(c => { c.meals[mi].options[oi].foods.splice(fi, 1); })}>Rimuovi alimento</button>}
        </div>)}
        <button type="button" className="quiet" onClick={() => change(c => { c.meals[mi].options[oi].foods.push({ food: '', quantity: 1, unit: 'g' }); })}>Aggiungi alimento</button>
        {meal.options.length > 1 && <button type="button" className="quiet" onClick={() => change(c => { c.meals[mi].options.splice(oi, 1); })}>Rimuovi alternativa</button>}
      </fieldset>)}
      <button type="button" className="quiet" onClick={() => change(c => { c.meals[mi].options.push({ foods: [{ food: '', quantity: 1, unit: 'g' }] }); })}>Aggiungi alternativa</button>
      {content.meals.length > 1 && <button type="button" className="quiet" onClick={() => change(c => { c.meals.splice(mi, 1); })}>Rimuovi pasto</button>}
    </fieldset>)}
    <button type="button" className="quiet" onClick={() => change(c => { c.meals.push(blankMeal()); })}>Aggiungi pasto</button>
    <button disabled={disabled || saving}>{saving ? 'Pubblicazione…' : initial ? 'Pubblica nuova versione' : 'Crea primo piano'}</button>
  </form>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [authenticated, setAuthenticated] = useState(false);
  const [hash, setHash] = useState(window.location.hash);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [patients, setPatients] = useState<User[]>([]);
  const [nutritionists, setNutritionists] = useState<User[]>([]);
  const [patientId, setPatientId] = useState('');
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [active, setActive] = useState<Version | null>(null);
  const [history, setHistory] = useState<Version[]>([]);
  const [diary, setDiary] = useState<Entry[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [sharing, setSharing] = useState(false);
  const [diaryError, setDiaryError] = useState('');
  const [queue, setQueue] = useState<Queued[]>([]);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [consumption, setConsumption] = useState('');
  const [consumptionTime, setConsumptionTime] = useState(localNow);
  const main = useRef<HTMLElement>(null);
  const section = user ? sectionFor(hash, user.role) : null;
  const resetToken = new URLSearchParams(hash.slice(1)).get('resetToken') ?? undefined;
  const accessPage = !user || resetToken !== undefined || hash === '#recupero' || hash === '#accesso';
  // Le risposte di un account precedente non devono riempire il nuovo schermo.
  const currentAccount = useRef<string | null>(null);
  currentAccount.current = user?.id ?? null;
  const currentSelection = useRef('');
  currentSelection.current = patientId;
  const refreshRevision = useRef(0);

  const applySnapshot = (snapshot: Snapshot) => {
    setActive(snapshot.active); setHistory(snapshot.history); setDiary(snapshot.diary);
    setMeasurements(snapshot.measurements); setSharing(snapshot.sharing); setCachedAt(snapshot.cachedAt);
  };
  const clearData = () => {
    setActive(null); setHistory([]); setDiary([]); setMeasurements([]); setPatients([]);
    setQueue([]); setInvitations([]); setNutritionists([]); setPatientId(''); setCachedAt(null); setDiaryError('');
    setSharing(false); setInviteEmail(''); setConsumption(''); setConsumptionTime(localNow());
  };

  useEffect(() => {
    const navigate = () => { setHash(window.location.hash); setError(''); setNotice(''); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    if (section) main.current?.querySelector('h1')?.focus();
  }, [section]);

  const leaveReset = (next = '') => {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + next);
    setHash(next);
  };

  // Bootstrap: una cache non conferisce una sessione server. Il fallback è solo Patient.
  useEffect(() => {
    const start = async () => {
      try {
        const result = await api<{ user: User; csrfToken: string }>('/auth/me');
        setCsrf(result.csrfToken); setUser(result.user); setAuthenticated(true);
        if (result.user.role === 'PATIENT') localStorage.setItem(ACTIVE, result.user.id);
        else localStorage.removeItem(ACTIVE);
      } catch (reason) {
        const last = localStorage.getItem(ACTIVE);
        if (!(reason instanceof ApiError) && last) {
          try {
            const cached = await readSnapshot(last);
            if (cached?.user.role === 'PATIENT') { setUser(cached.user); applySnapshot(cached); }
          } catch { setError('Cache locale non disponibile. Il primo accesso richiede la rete.'); }
        }
      } finally { setLoading(false); }
    };
    void start();
    const connected = () => setOnline(true);
    const disconnected = () => { setOnline(false); };
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, []);

  const refresh = async (who: User, selected: string) => {
    if (!navigator.onLine || !selected) return;
    const revision = ++refreshRevision.current;
    const isCurrent = () => refreshRevision.current === revision && currentAccount.current === who.id && currentSelection.current === selected;
    const [plan, versions, progress] = await Promise.all([
      api<Version | null>(`/plans/${selected}`), api<Version[]>(`/plans/${selected}/history`), api<Measurement[]>(`/progress/${selected}`),
    ]);
    let entries: Entry[] = [];
    let diaryFailure = '';
    try { entries = await api<Entry[]>(`/diary/${selected}`); }
    catch (reason) {
      if (who.role === 'PATIENT' || !(reason instanceof ApiError) || reason.status !== 403) throw reason;
      diaryFailure = message(reason);
    }
    if (!isCurrent()) return;
    setDiaryError(diaryFailure);
    setActive(plan); setHistory(versions); setMeasurements(progress); setDiary(entries);
    if (who.role === 'PATIENT') {
      const [preference, invites] = await Promise.all([api<{ enabled: boolean }>('/sharing'), api<Invitation[]>('/patients/invitations')]);
      if (!isCurrent()) return;
      setSharing(preference.enabled); setInvitations(invites);
      const snapshot: Snapshot = { user: who, active: plan, history: versions, diary: entries, measurements: progress, sharing: preference.enabled, cachedAt: Date.now() };
      await saveSnapshot(snapshot);
      if (isCurrent()) setCachedAt(snapshot.cachedAt);
    }
  };

  // Aggiornamento della selezione e ripristino dati del solo account corrente.
  useEffect(() => {
    if (!user) return;
    if (user.role === 'PATIENT') {
      setPatientId(user.id);
      if (online) api<User[]>('/patients').then(list => { if (currentAccount.current === user.id) setNutritionists(list); }).catch(reason => setError(message(reason)));
    }
    else if (online) api<User[]>('/patients').then(list => { setPatients(list); setPatientId(current => list.some(p => p.id === current) ? current : list[0]?.id ?? ''); }).catch(reason => setError(message(reason)));
  }, [user, online]);
  useEffect(() => {
    if (user && patientId && online) void refresh(user, patientId).catch(reason => {
      if (reason instanceof ApiError && reason.status === 401) setAuthenticated(false);
      setError(message(reason));
    });
  }, [user, patientId, online]);

  // Dopo un riavvio offline, ottenere un CSRF aggiornato prima di inviare la coda.
  useEffect(() => {
    if (!user || !online || authenticated) return;
    api<{ user: User; csrfToken: string }>('/auth/me').then(result => {
      if (currentAccount.current !== user.id) return;
      if (result.user.id !== user.id) { setError('Accedi allo stesso account per sincronizzare le registrazioni locali.'); return; }
      setCsrf(result.csrfToken); setAuthenticated(true);
      void retryAuthentication(user.id);
    }).catch(() => { /* Il login esplicito conserva la coda e non modifica i dati server. */ });
  }, [user, online, authenticated]);

  // Observer GoF: React collega due osservatori concreti e li scollega al cleanup.
  // Il timer avvia il motore; sono i fatti notificati DOPO il commit ad aggiornare la UI.
  useEffect(() => {
    if (!user || user.role !== 'PATIENT') return;
    setSyncAccount(user.id);
    let alive = true;
    const isCurrent = () => alive && currentAccount.current === user.id;
    const panel = new QueuePanelModel(user.id, queueStore, pending => {
      setQueue(pending);
      if (pending.some(item => item.status === 'AUTH_REQUIRED')) setAuthenticated(false);
    }, isCurrent);
    const refresher = new PatientDataRefresher(user.id, async accountId => {
      try { if (navigator.onLine) await refresh(user, accountId); }
      catch (reason) { if (isCurrent()) setError(message(reason)); }
    }, isCurrent);
    const unsubscribePanel = syncEngine.subscribe(panel);
    const unsubscribeRefresh = syncEngine.subscribe(refresher);
    void panel.refresh().catch(reason => { if (isCurrent()) setError(message(reason)); });
    const tick = async () => {
      try {
        if (authenticated && navigator.onLine) await flushQueue(user.id);
      } catch (reason) { if (alive) setError(message(reason)); }
    };
    void tick(); const timer = setInterval(() => void tick(), 5000);
    return () => {
      alive = false; panel.dispose(); refresher.dispose();
      unsubscribePanel(); unsubscribeRefresh(); setSyncAccount(null); clearInterval(timer);
    };
  }, [user, online, authenticated]);

  const login = async (result: Session) => {
    setError(''); setNotice('');
    if (hash === '#recupero' || hash === '#accesso') leaveReset();
    setSyncAccount(null);
    clearData(); setCsrf(result.csrfToken); setUser(result.user); setAuthenticated(true);
    if (result.user.role === 'PATIENT') {
      localStorage.setItem(ACTIVE, result.user.id); setSyncAccount(result.user.id);
      try { await retryAuthentication(result.user.id); } catch (reason) { setError(message(reason)); }
    } else localStorage.removeItem(ACTIVE);
  };

  const clearSession = () => {
    setSyncAccount(null); localStorage.removeItem(ACTIVE); setCsrf(''); setUser(null); setAuthenticated(false);
    clearData(); setError(''); setNotice('');
  };

  const logout = async () => {
    if (queue.length && !confirm('Ci sono registrazioni non confermate. Vuoi uscire conservandole per il prossimo accesso allo stesso account?')) return;
    if (!online) { setError('Per revocare la sessione, esci quando la connessione è disponibile. Le registrazioni restano sul dispositivo.'); return; }
    try {
      await api('/auth/logout', 'POST');
      clearSession();
    } catch (reason) { setError(message(reason)); }
  };

  const recordMeal = async (event: FormEvent) => {
    event.preventDefault(); if (!user) return; setError('');
    try {
      const actualConsumption = consumption.trim();
      if (!actualConsumption) throw new Error('Descrivi ciò che hai mangiato.');
      if (new Date(consumptionTime).getTime() > Date.now()) throw new Error('Non puoi registrare un momento futuro.');
      await enqueue(user.id, 'diary', { consumptionTime: localToIso(consumptionTime), actualConsumption });
      if (currentAccount.current !== user.id) return;
      setConsumption('');
      setNotice('Registrazione salvata sul dispositivo. La conferma definitiva arriva dal server.');
      if (authenticated && online) await flushQueue(user.id);
    } catch (reason) { setError(message(reason)); }
  };

  const changeSharing = async () => {
    if (!user) return;
    const next = !sharing;
    if (next && !confirm('Condividere il diario rende visibili al tuo Nutritionist assegnato tutti i pasti, anche quelli precedenti. Vuoi attivare?')) return;
    try { await api('/sharing', 'PUT', { enabled: next }); await refresh(user, user.id); setNotice(next ? 'Diario condiviso.' : 'Condivisione disabilitata: i pasti restano nel tuo diario.'); }
    catch (reason) { setError(message(reason)); }
  };

  const endAssociation = async (selected: string) => {
    if (!user || !confirm('Vuoi terminare questa associazione? Il Nutritionist perderà l’accesso ai dati. La condivisione del diario sarà disabilitata; registrazioni e piani storici restano conservati.')) return;
    try {
      await api(`/patients/${selected}/end`, 'POST');
      setSharing(false); setNutritionists([]); setDiary([]); setActive(null); setHistory([]); setMeasurements([]);
      if (user.role === 'PATIENT') await refresh(user, user.id);
      else { const list = await api<User[]>('/patients'); setPatients(list); setPatientId(list[0]?.id ?? ''); }
      setNotice('Associazione terminata. Per un nuovo Nutritionist serve accettare un nuovo invito e scegliere nuovamente la condivisione.');
    } catch (reason) { setError(message(reason)); }
  };

  const selectPatient = (selected: string) => {
    if (selected === patientId) return;
    currentSelection.current = selected;
    setDiary([]); setActive(null); setHistory([]); setMeasurements([]); setDiaryError('');
    setPatientId(selected);
  };
  const reloadPatients = async () => {
    if (!user) return;
    try {
      const list = await api<User[]>('/patients');
      if (currentAccount.current !== user.id) return;
      setPatients(list);
      if (!list.some(patient => patient.id === currentSelection.current)) selectPatient(list[0]?.id ?? '');
    } catch (reason) { setError(message(reason)); }
  };
  const patientPicker = <label>Paziente associato<select value={patientId} onChange={event => selectPatient(event.target.value)}>
    <option value="">Seleziona</option>
    {patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name} · {patient.email}</option>)}
  </select></label>;
  const patientView = section === 'piano' || section === 'storico' || section === 'diario' || section === 'misurazioni';
  const isPatient = user?.role === 'PATIENT';

  if (loading) return <main><p role="status">Caricamento NutriTrack…</p></main>;
  return <>
    <header className="app-header">
      <div className="header-inner">
        <Brand />
        {user && !accessPage && <div className="account">
          <span className="account-name">{user.name}</span>
          {isPatient && <a className="profile-link" href="#profilo" aria-label="Profilo" aria-current={section === 'profilo' ? 'page' : undefined}><Icon name="profile" /> <span>Profilo</span></a>}
          <button className="quiet" onClick={() => void logout()}>Esci</button>
        </div>}
      </div>
    </header>
    <main ref={main} className="app-main">
      {!online && <p className="banner" role="status">{isPatient && !accessPage
        ? 'Sei offline. Puoi consultare l’ultima copia e registrare pasti, peso e circonferenze.'
        : 'Sei offline. Riconnettiti per accedere ai dati online.'}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {accessPage ? <AccountAccess online={online} resetToken={resetToken} initialRecovery={hash === '#recupero'} onLogin={login}
        onReset={() => { leaveReset(); clearSession(); }} onLeaveReset={requestAnother => leaveReset(requestAnother ? '#recupero' : '#accesso')} /> : <>
        {!authenticated && online && <AccountAccess online={online} reauthenticate onLogin={login} onReset={clearSession} />}
        {section === null ? <Dashboard user={user} pending={queue.length} /> : <SectionHeading section={section} user={user} />}
        {section === 'profilo' && <PatientProfile key={user.id} user={user} available={online && authenticated} onSaved={updated => {
          setUser(current => current?.id === updated.id ? updated : current);
        }} />}
        {section === 'pazienti' && <section className="card"><h2>Associazioni</h2>
          {!online ? <p>I dati dei pazienti non sono consultabili offline.</p> : <>
            <form className="inline-form" onSubmit={async event => {
              event.preventDefault();
              try { await api('/patients/invitations', 'POST', { email: inviteEmail }); setInviteEmail(''); setNotice('Invito inviato. Il Patient deve accettarlo.'); }
              catch (reason) { setError(message(reason)); }
            }}>
              <label>Email Patient<input type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} /></label>
              <button disabled={!authenticated}>Invita Patient</button>
            </form>
            {patientPicker}
            {!patients.length && <p>Nessun paziente associato. Dopo l’accettazione, aggiorna l’elenco.</p>}
            <button className="quiet" disabled={!authenticated} onClick={() => void reloadPatients()}>Aggiorna elenco</button>
            {patientId && <button className="quiet" disabled={!authenticated} onClick={() => void endAssociation(patientId)}>Termina associazione</button>}
          </>}
        </section>}
        {section === 'condivisione' && <section className="card">
          <h2>Il tuo diario, la tua scelta</h2>
          <p>Condivisione {sharing ? 'attiva' : 'disattivata'}. La preferenza riguarda tutto lo storico. Le misurazioni sono visibili al nutrizionista associato.</p>
          <button onClick={() => void changeSharing()} disabled={!online || !authenticated}>{sharing ? 'Disabilita condivisione' : 'Condividi il diario'}</button>
          {nutritionists.length > 0 && <p>Nutrizionista associato <strong>{nutritionists[0].name}</strong> <button className="quiet" disabled={!online || !authenticated} onClick={() => void endAssociation(user.id)}>Termina associazione</button></p>}
          {invitations.length > 0 && <div><h3>Inviti ricevuti</h3>{invitations.map(invite => <p key={invite.id}>{invite.nutritionistName ?? 'Nutrizionista'} <button disabled={!online || !authenticated} onClick={async () => {
            try {
              await api(`/patients/invitations/${invite.id}/accept`, 'POST'); await refresh(user, user.id);
              setNutritionists(await api<User[]>('/patients')); setNotice('Associazione accettata.');
            } catch (reason) { setError(message(reason)); }
          }}>Accetta associazione</button></p>)}</div>}
        </section>}
        {patientView && !isPatient && <section className="card patient-context">
          {!online ? <p>I dati dei pazienti non sono consultabili offline.</p> : patients.length ? patientPicker :
            <p>Nessun paziente associato. <a href="#pazienti">Gestisci i pazienti</a></p>}
        </section>}
        {patientView && patientId && (online || isPatient) && <>
          {cachedAt && !online && <p className="meta">Copia scaricata il {readable(cachedAt)}. Il piano attivo sul server potrebbe essere cambiato.</p>}
          {section === 'piano' && <>
            <section className="card"><div className="section-heading"><h2>{isPatient ? 'Il tuo piano' : 'Piano del paziente'}</h2>
              <button className="quiet" disabled={!online || !authenticated} onClick={() => void refresh(user, patientId).catch(reason => setError(message(reason)))}>Aggiorna</button>
            </div><Plan version={active} /></section>
            {!isPatient && <section className="card"><h2>{active ? 'Evolvi il piano' : 'Crea il piano'}</h2><Editor key={`${patientId}-${active?.id ?? 'new'}`} initial={active} disabled={!authenticated} onPublish={async content => {
              try { await api(`/plans/${patientId}`, 'POST', { baseVersionId: active?.id ?? null, content }); await refresh(user, patientId); setNotice('Nuova versione pubblicata. Lo storico è preservato.'); }
              catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? 'Il piano è cambiato: premi Aggiorna prima di riprovare. Le modifiche non sono state applicate.' : message(reason)); }
            }} /></section>}
          </>}
          {section === 'storico' && <section className="card"><h2>Versioni del piano</h2>
            {!history.length && <p>Nessuna versione.</p>}
            {history.map(version => <details key={version.id}><summary>Versione {version.versionNumber} · {readable(version.validFrom)} → {version.validUntil === null ? 'in corso' : readable(version.validUntil)}</summary><Plan version={version} />{version.changeSet?.length > 0 && <><h4>Differenze dalla versione precedente</h4><ul>{version.changeSet.map((change, i) => <li key={i}>{change.before === null && version.parentVersionId === null ? 'Prima versione del piano' : <><strong>{describeChange(change.path)}</strong>: {describeValue(change.before)} → {describeValue(change.after)}</>}</li>)}</ul></>}</details>)}
          </section>}
          {section === 'diario' && <section className="card"><h2>{isPatient ? 'Registra un pasto' : 'Pasti condivisi'}</h2>
            {isPatient && <form onSubmit={event => void recordMeal(event)}>
              <label>Quando hai consumato il pasto?<input type="datetime-local" step="1" required value={consumptionTime} onChange={event => setConsumptionTime(event.target.value)} /></label>
              <label>Cosa hai mangiato?<textarea required maxLength={4000} value={consumption} onChange={event => setConsumption(event.target.value)} /></label>
              <button>Registra pasto</button>
            </form>}
            {isPatient && <h2 className="records-heading">Pasti registrati</h2>}
            {diaryError ? <p className="error">{diaryError}</p> : diary.length ? <ul className="records">{diary.map(entry => <li key={entry.id}><strong>{readable(entry.consumptionTime)}</strong><p>{entry.actualConsumption}</p><span className="meta">{entry.mealPlanVersionId ? `Versione associata: ${history.find(v => v.id === entry.mealPlanVersionId)?.versionNumber ?? entry.mealPlanVersionId}` : 'Nessun piano valido al consumo (confermato dal server)'}</span></li>)}</ul> : <p>Nessun pasto confermato.</p>}
          </section>}
          {section === 'misurazioni' && <ProgressPanel key={`${user.id}-${patientId}`} user={user} measurements={measurements} online={online} authenticated={authenticated} />}
        </>}
        {section === 'sincronizzazione' && <section className="card"><h2>Registrazioni sul dispositivo</h2>
          <p>Le registrazioni vengono inviate automaticamente quando la rete e la sessione sono disponibili.</p>
          {queue.length ? <ul className="records">{queue.map(item => <li key={item.id}>
            <strong>{item.kind === 'diary' ? 'Pasto' : measurementLabel(item.payload.type)}</strong> · {item.status === 'PENDING' ? 'In attesa di sincronizzazione' : item.status === 'AUTH_REQUIRED' ? 'Accedi di nuovo per sincronizzare' : item.status === 'CONFLICT' ? 'Conflitto: dati server conservati' : 'Registrazione non valida'}
            <p>{item.kind === 'diary' ? String(item.payload.actualConsumption) : `${item.payload.value} ${measurementUnit(item.payload.type)}`}</p>
            {item.kind === 'diary' && <p className="meta">Il server assocerà il pasto alla versione del piano valida al momento del consumo.</p>}
            {item.error && <p className="error">{item.error}</p>}
          </li>)}</ul> : <p>Tutte le registrazioni sono confermate.</p>}
          <button className="quiet" disabled={!online || !authenticated} onClick={async () => {
            try { await retryAuthentication(user.id); await flushQueue(user.id); } catch (reason) { setError(message(reason)); }
          }}>Riprova sincronizzazione</button>
        </section>}
      </>}
    </main>
    <footer>NutriTrack <span aria-hidden="true">·</span> Il tuo percorso nutrizionale</footer>
  </>;
}
