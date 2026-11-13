/**
 * Interfaccia dei due ruoli, limitata agli use case concordati.
 * Le autorizzazioni sono sempre applicate dal server: nascondere un pulsante non basta.
 * Patient offline usa soltanto la propria cache e una coda persistente di nuove registrazioni.
 * Collega gli Observer del motore al ciclo di vita React; Command e Strategy sono
 * gestiti nel sottosistema sync/, così la schermata non decide il protocollo di retry.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, serviceUnavailableEvent, setCsrf } from './api';
import { deleteSnapshot, discardItem, enqueueFor, readQueue, ensureOfflineIdentity, flushQueue, localToIso, queueStore, readSnapshot, retryAuthentication, retryItem, saveSnapshot, setSyncAccount, syncEngine, type Queued } from './offline';
import { PatientDataRefresher, QueuePanelModel } from './sync/observers';
import type { Content, Entry, Invitation, Meal, Measurement, Snapshot, User, Version } from './types';
import { AccountAccess, type Session } from './AccountAccess';
import { PatientProfile } from './PatientProfile';
import { ProgressPanel, measurementLabel, measurementUnit } from './ProgressPanel';
import { Brand, Dashboard, Icon, SectionHeading, sectionFor } from './Workspace';
import { useNowField, useOperationNotice } from './hooks';
import { AccountSettings } from './AccountSettings';
import { DiaryEntryActions } from './RecordEditors';

const ACTIVE = 'nutritrack-active-patient';
// Durata massima per cui una vista aperta può mostrare dati non più autorizzati o superati.
const REVALIDATE_MS = 30_000;
const readable = (time: number) => new Date(time).toLocaleString('it-IT');
const clock = (time: number) => new Date(time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const message = (error: unknown) => error instanceof Error ? error.message : 'Operazione non riuscita.';
const blankMeal = (): Meal => ({ name: '', options: [{ foods: [{ food: '', quantity: 1, unit: 'g' }] }] });
const emptyContent = (): Content => ({ meals: [blankMeal()] });
const revokedMessage = 'L’associazione con questo paziente non è più attiva: i suoi dati non sono più consultabili.';

/** Bozza del Nutritionist per paziente, con la versione da cui è partita. */
interface Draft { baseId: string | null; baseNumber: number | null; content: Content }
// Le bozze sopravvivono al ricaricamento della scheda (sessionStorage), non alla chiusura
// del browser, e sono legate all'account: al logout vengono cancellate.
const draftKey = (userId: string) => `nutritrack-drafts-${userId}`;
function loadDrafts(userId: string): Map<string, Draft> {
  try { return new Map(Object.entries(JSON.parse(sessionStorage.getItem(draftKey(userId)) ?? '{}') as Record<string, Draft>)); }
  catch { return new Map(); }
}
function storeDrafts(userId: string, drafts: Map<string, Draft>) {
  try {
    if (drafts.size) sessionStorage.setItem(draftKey(userId), JSON.stringify(Object.fromEntries(drafts)));
    else sessionStorage.removeItem(draftKey(userId));
  } catch { /* Quota o modalità privata: la bozza resta in memoria. */ }
}

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

function Plan({ version, empty = 'Nessun piano valido.' }: { version: Version | null; empty?: string }) {
  if (!version) return <p>{empty}</p>;
  return <div className="plan"><p className="meta">Versione {version.versionNumber} · dal {readable(version.validFrom)}</p>
    {version.content.meals.map((meal, index) => <section className="meal" key={index}><h4>{meal.name}</h4>
      {meal.options.map((option, optionIndex) => <div key={optionIndex}><strong>Alternativa {optionIndex + 1}</strong>
        <ul>{option.foods.map((food, foodIndex) => <li key={foodIndex}>{food.food} · {food.quantity} {food.unit}</li>)}</ul>
      </div>)}
    </section>)}
  </div>;
}

/**
 * La compilazione vive nella bozza del paziente: cambiare sezione o ricevere una
 * nuova versione di partenza non la cancella. L'abbandono è sempre esplicito.
 */
function Editor({ initial, draft, onDraft, onPublish, disabled }: {
  initial: Version | null; draft: Draft | undefined; onDraft: (content: Content | null) => void;
  onPublish: (content: Content) => Promise<boolean>; disabled: boolean;
}) {
  const base = () => initial ? structuredClone(initial.content) : emptyContent();
  const [content, setContent] = useState<Content>(() => draft ? structuredClone(draft.content) : base());
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(content) !== JSON.stringify(base());
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  useEffect(() => { onDraftRef.current(dirty ? content : null); }, [content, dirty]);
  const change = (fn: (copy: Content) => void) => setContent(current => { const copy = structuredClone(current); fn(copy); return copy; });
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (saving) return; setSaving(true);
    try { await onPublish(content); } finally { setSaving(false); }
  };
  const discard = () => { if (confirm('Vuoi scartare le modifiche non pubblicate?')) setContent(base()); };
  const stale = !!draft && dirty && draft.baseId !== (initial?.id ?? null);
  return <form onSubmit={submit} className="editor"><p>Pubblicare crea una nuova versione immutabile, attiva immediatamente.</p>
    {stale && <p className="error" role="alert">
      Questa bozza era partita {draft.baseNumber ? `dalla versione ${draft.baseNumber}` : 'da un paziente senza piano'}; ora è attiva {initial ? `la versione ${initial.versionNumber}` : 'nessuna versione'}.
      Confrontala con il piano qui sopra: pubblicando, la bozza sostituirà il piano attuale.
    </p>}
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
    {dirty && <button type="button" className="quiet" onClick={discard}>Scarta modifiche</button>}
    <button disabled={disabled || saving}>{saving ? 'Pubblicazione…' : initial ? 'Pubblica nuova versione' : 'Crea primo piano'}</button>
  </form>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [authenticated, setAuthenticated] = useState(false);
  // Server raggiungibile ma non operativo (es. database giù → 503): modalità degradata.
  const [serverDown, setServerDown] = useState(false);
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
  const [lastRead, setLastRead] = useState<number | null>(null);
  const [consumption, setConsumption] = useState('');
  const [recording, setRecording] = useState(false);
  const recordingMeal = useRef(false);
  const mealTime = useNowField();
  const mealNotice = useOperationNotice(user?.id ?? '', {
    saved: 'Pasto salvato sul dispositivo: in attesa di conferma dal server.',
    confirmed: 'Pasto confermato dal server.',
  });
  const drafts = useRef(new Map<string, Draft>());
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
  const revokedSelection = useRef(false);

  const applySnapshot = (snapshot: Snapshot) => {
    setActive(snapshot.active); setHistory(snapshot.history); setDiary(snapshot.diary);
    setMeasurements(snapshot.measurements); setSharing(snapshot.sharing); setCachedAt(snapshot.cachedAt);
  };
  const clearSelectionData = () => {
    setActive(null); setHistory([]); setDiary([]); setMeasurements([]); setDiaryError(''); setLastRead(null);
  };
  const clearData = () => {
    clearSelectionData(); setPatients([]);
    setQueue([]); setInvitations([]); setNutritionists([]); setPatientId(''); setCachedAt(null);
    setSharing(false); setInviteEmail(''); setConsumption(''); mealTime.reset(); mealNotice.clear();
    drafts.current.clear();
  };
  /** Revoca nota al client: la copia già caricata sparisce subito dallo schermo. */
  const revokeSelection = (selected: string) => {
    revokedSelection.current = true;
    drafts.current.delete(selected);
    if (currentAccount.current) storeDrafts(currentAccount.current, drafts.current);
    setPatients(list => list.filter(patient => patient.id !== selected));
    if (currentSelection.current === selected) {
      currentSelection.current = '';
      setPatientId('');
      clearSelectionData();
    }
  };
  /** Allinea l'elenco del Nutritionist: una selezione non più associata viene svuotata. */
  const syncPatients = (list: User[], manual: boolean) => {
    const assigned = new Set(list.map(patient => patient.id));
    for (const id of drafts.current.keys()) if (!assigned.has(id)) drafts.current.delete(id);
    if (currentAccount.current) storeDrafts(currentAccount.current, drafts.current);
    const removed = currentSelection.current !== '' && !list.some(patient => patient.id === currentSelection.current);
    if (removed) { revokeSelection(currentSelection.current); setError(revokedMessage); }
    if (manual) revokedSelection.current = false;
    setPatients(list);
    // Nessuna selezione automatica al posto di un paziente appena revocato:
    // la vista resta vuota finché la nutrizionista non sceglie o aggiorna l'elenco.
    if (!removed && !revokedSelection.current && currentSelection.current === '' && list.length) setPatientId(list[0].id);
  };

  useEffect(() => {
    const navigate = () => { setHash(window.location.hash); setError(''); setNotice(''); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    const unavailable = () => setServerDown(true);
    window.addEventListener(serviceUnavailableEvent, unavailable);
    return () => window.removeEventListener(serviceUnavailableEvent, unavailable);
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
        if (result.user.role === 'PATIENT') {
          localStorage.setItem(ACTIVE, result.user.id);
          void ensureOfflineIdentity(result.user).catch(() => undefined);
        } else localStorage.removeItem(ACTIVE);
      } catch (reason) {
        const last = localStorage.getItem(ACTIVE);
        // Sessione scaduta o revocata con rete disponibile: la copia locale non resta sul dispositivo.
        // La coda resta, per il prossimo accesso allo stesso account.
        if (reason instanceof ApiError && reason.status === 401 && last) {
          localStorage.removeItem(ACTIVE);
          void deleteSnapshot(last).catch(() => undefined);
        }
        // Rete assente o server non operativo (5xx): il Patient lavora sulla copia locale.
        const unavailable = !(reason instanceof ApiError) || reason.status >= 500;
        if (reason instanceof ApiError && reason.status >= 500) setServerDown(true);
        if (unavailable && last) {
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
    let plan: Version | null, versions: Version[], progress: Measurement[];
    try {
      [plan, versions, progress] = await Promise.all([
        api<Version | null>(`/plans/${selected}`), api<Version[]>(`/plans/${selected}/history`), api<Measurement[]>(`/progress/${selected}`),
      ]);
    } catch (reason) {
      // 403 per il Nutritionist = associazione terminata: non lasciare a schermo la copia precedente.
      if (who.role === 'NUTRITIONIST' && reason instanceof ApiError && reason.status === 403) {
        if (currentAccount.current === who.id) revokeSelection(selected);
        throw new ApiError(reason.code, 403, revokedMessage);
      }
      throw reason;
    }
    let entries: Entry[] = [];
    let diaryFailure = '';
    try { entries = await api<Entry[]>(`/diary/${selected}`); }
    catch (reason) {
      if (who.role === 'PATIENT' || !(reason instanceof ApiError) || reason.status !== 403) throw reason;
      if (reason.code !== 'DiaryNotShared') {
        if (currentAccount.current === who.id) revokeSelection(selected);
        throw new ApiError(reason.code, 403, revokedMessage);
      }
      diaryFailure = message(reason);
    }
    if (!isCurrent()) return;
    setDiaryError(diaryFailure);
    setActive(plan); setHistory(versions); setMeasurements(progress); setDiary(entries); setLastRead(Date.now());
    if (who.role === 'PATIENT') {
      const [preference, invites, associated] = await Promise.all([
        api<{ enabled: boolean }>('/sharing'), api<Invitation[]>('/patients/invitations'), api<User[]>('/patients'),
      ]);
      if (!isCurrent()) return;
      setSharing(preference.enabled); setInvitations(invites); setNutritionists(associated);
      const snapshot: Snapshot = { user: who, active: plan, history: versions, diary: entries, measurements: progress, sharing: preference.enabled, cachedAt: Date.now() };
      await saveSnapshot(snapshot);
      if (isCurrent()) setCachedAt(snapshot.cachedAt);
    }
  };
  const reportRefresh = (reason: unknown) => {
    if (reason instanceof ApiError && reason.status === 401) setAuthenticated(false);
    // Guasto del server: il banner basta, i dati a schermo restano quelli dell'ultima lettura.
    if (reason instanceof ApiError && reason.status >= 500) { setServerDown(true); return; }
    setError(message(reason));
  };

  const loadPatients = async (who: User, manual = false) => {
    const [list, sent] = await Promise.all([api<User[]>('/patients'), api<Invitation[]>('/patients/invitations')]);
    if (currentAccount.current !== who.id) return;
    syncPatients(list, manual); setInvitations(sent);
  };

  // Aggiornamento della selezione e ripristino dati del solo account corrente.
  useEffect(() => {
    if (user?.role === 'NUTRITIONIST') drafts.current = loadDrafts(user.id);
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    if (user.role === 'PATIENT') {
      setPatientId(user.id);
      if (online) api<User[]>('/patients').then(list => { if (currentAccount.current === user.id) setNutritionists(list); }).catch(reason => setError(message(reason)));
    }
    else if (online) loadPatients(user, true).catch(reason => setError(message(reason)));
  }, [user, online]);
  useEffect(() => {
    if (user && patientId && online) void refresh(user, patientId).catch(reportRefresh);
  }, [user, patientId, online]);

  // Rivalidazione: al ritorno in primo piano e periodicamente per una scheda sempre aperta.
  // Copre revoche, piani appena pubblicati e misure registrate dall'altro ruolo.
  useEffect(() => {
    if (!user || !online || !authenticated) return;
    const revalidate = () => {
      if (document.visibilityState !== 'visible') return;
      if (user.role === 'NUTRITIONIST') void loadPatients(user).catch(reportRefresh);
      if (currentSelection.current) void refresh(user, currentSelection.current).catch(reportRefresh);
    };
    const timer = setInterval(revalidate, REVALIDATE_MS);
    document.addEventListener('visibilitychange', revalidate);
    window.addEventListener('focus', revalidate);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', revalidate);
      window.removeEventListener('focus', revalidate);
    };
  }, [user, online, authenticated]);

  // Dopo un riavvio offline o un guasto del server, ottenere un CSRF aggiornato prima di inviare la coda.
  // Con il server non operativo il controllo si ripete ogni 15 s finché non torna disponibile.
  useEffect(() => {
    if (!user || !online || (authenticated && !serverDown)) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await api<Session>('/auth/me');
        if (!active || currentAccount.current !== user.id) return;
        setServerDown(false);
        if (result.user.id !== user.id) {
          setAuthenticated(false);
          setError('Accedi allo stesso account per sincronizzare le registrazioni locali.');
          return;
        }
        setCsrf(result.csrfToken); setAuthenticated(true);
        if (user.role === 'PATIENT') {
          await retryAuthentication(user.id);
          if (active && currentAccount.current === user.id) await flushQueue(user.id);
        }
      } catch (reason) {
        if (!active || currentAccount.current !== user.id) return;
        if (reason instanceof ApiError && reason.status === 401) {
          setServerDown(false);
          setAuthenticated(false);
          if (user.role === 'NUTRITIONIST') {
            drafts.current.clear(); storeDrafts(user.id, drafts.current);
            clearSelectionData(); setPatientId(''); setPatients([]); setInvitations([]);
          }
        }
      } finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [user, online, authenticated, serverDown]);

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
    setServerDown(false);
    if (hash === '#recupero' || hash === '#accesso') leaveReset();
    setSyncAccount(null);
    clearData(); setCsrf(result.csrfToken); setUser(result.user); setAuthenticated(true);
    if (result.user.role === 'PATIENT') {
      localStorage.setItem(ACTIVE, result.user.id); setSyncAccount(result.user.id);
      // Prima di qualsiasi altra lettura: il riavvio offline ritrova identità e coda.
      try { await ensureOfflineIdentity(result.user); } catch { /* La coda resta comunque salvata. */ }
      try { await retryAuthentication(result.user.id); } catch (reason) { setError(message(reason)); }
    } else localStorage.removeItem(ACTIVE);
  };

  const clearSession = () => {
    setServerDown(false);
    // La copia locale di piano, diario e misure non resta sul dispositivo dopo l'uscita.
    const accounts = new Set([user?.id, localStorage.getItem(ACTIVE)].filter((id): id is string => !!id));
    for (const id of accounts) void deleteSnapshot(id).catch(() => undefined);
    if (user) { try { sessionStorage.removeItem(draftKey(user.id)); } catch { /* niente da cancellare */ } }
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
    event.preventDefault(); if (!user) return;
    // Il ref blocca il secondo clic prima che il pulsante risulti disabilitato a schermo.
    if (recordingMeal.current) return;
    recordingMeal.current = true; setRecording(true); setError(''); mealNotice.clear();
    try {
      const actualConsumption = consumption.trim();
      if (!actualConsumption) throw new Error('Descrivi ciò che hai mangiato.');
      const consumptionTime = mealTime.resolve();
      if (new Date(consumptionTime).getTime() > Date.now()) throw new Error('Non puoi registrare un momento futuro.');
      const operationId = await enqueueFor(user, 'diary', { consumptionTime: localToIso(consumptionTime), actualConsumption });
      if (currentAccount.current !== user.id) return;
      setConsumption(''); mealTime.reset(); mealNotice.track(operationId);
      if (authenticated && online) await flushQueue(user.id);
    } catch (reason) { setError(message(reason)); }
    finally { recordingMeal.current = false; setRecording(false); }
  };

  const changeSharing = async () => {
    if (!user) return;
    const next = !sharing;
    if (next && !confirm('Condividere il diario rende visibili al tuo nutrizionista associato tutti i pasti, anche quelli precedenti. Vuoi attivare?')) return;
    try { await api('/sharing', 'PUT', { enabled: next }); await refresh(user, user.id); setNotice(next ? 'Diario condiviso.' : 'Condivisione disattivata: i pasti restano nel tuo diario.'); }
    catch (reason) { setError(message(reason)); }
  };

  const endAssociation = async (selected: string) => {
    if (!user || !confirm(user.role === 'PATIENT'
      ? 'Vuoi terminare questa associazione? Il nutrizionista perderà l’accesso ai tuoi dati e il piano attuale non sarà più attivo. La condivisione del diario sarà disattivata; registrazioni e piani storici restano conservati.'
      : 'Vuoi terminare questa associazione? Perderai l’accesso ai dati del paziente e il piano attuale non sarà più attivo.')) return;
    try {
      await api(`/patients/${selected}/end`, 'POST');
      setSharing(false); setNutritionists([]); clearSelectionData();
      if (user.role === 'PATIENT') {
        await refresh(user, user.id);
        setNotice('Associazione terminata. Il piano non è più attivo; per un nuovo nutrizionista serve accettare un nuovo invito e scegliere di nuovo la condivisione.');
      } else {
        drafts.current.delete(selected);
        storeDrafts(user.id, drafts.current);
        currentSelection.current = ''; setPatientId('');
        await loadPatients(user, true);
        setNotice('Associazione terminata.');
      }
    } catch (reason) { setError(message(reason)); }
  };

  const accountDeleted = async () => {
    if (!user) return;
    // Le registrazioni non confermate appartengono a un account che non esiste più.
    for (const item of await readQueue(user.id).catch(() => [] as Queued[])) await discardItem(user.id, item.id).catch(() => undefined);
    clearSession();
    setNotice('Account eliminato definitivamente.');
  };

  const answerInvitation = async (invite: Invitation, accept: boolean) => {
    if (!user) return;
    if (!accept && !confirm(user.role === 'PATIENT'
      ? `Vuoi rifiutare l’invito di ${invite.nutritionistName ?? 'questo nutrizionista'}?`
      : `Vuoi ritirare l’invito inviato a ${invite.patientEmail ?? 'questo paziente'}?`)) return;
    try {
      await api(`/patients/invitations/${invite.id}/${accept ? 'accept' : 'close'}`, 'POST');
      if (user.role === 'PATIENT') await refresh(user, user.id);
      else await loadPatients(user);
      setNotice(accept ? 'Associazione accettata.' : user.role === 'PATIENT' ? 'Invito rifiutato.' : 'Invito ritirato.');
    } catch (reason) { setError(message(reason)); }
  };

  const selectPatient = (selected: string) => {
    if (selected === patientId) return;
    revokedSelection.current = false;
    currentSelection.current = selected;
    clearSelectionData();
    setPatientId(selected);
  };
  const reloadPatients = async () => {
    if (!user) return;
    try { await loadPatients(user, true); } catch (reason) { setError(message(reason)); }
  };
  const updateDraft = (selected: string, content: Content | null) => {
    if (!content) drafts.current.delete(selected);
    else {
      const existing = drafts.current.get(selected);
      drafts.current.set(selected, existing ? { ...existing, content } : { baseId: active?.id ?? null, baseNumber: active?.versionNumber ?? null, content });
    }
    if (user?.role === 'NUTRITIONIST') storeDrafts(user.id, drafts.current);
  };
  const publishPlan = async (content: Content): Promise<boolean> => {
    if (!user) return false;
    const selected = patientId;
    try {
      await api(`/plans/${selected}`, 'POST', { baseVersionId: active?.id ?? null, content });
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'MealPlanVersionConflict') {
        // La bozza resta: il piano aggiornato compare sopra e l'editor segnala la nuova base.
        updateDraft(selected, content);
        setError('Nel frattempo è stata pubblicata un’altra versione. La tua bozza è conservata: confrontala con il piano aggiornato, poi pubblicala o scartala.');
        await refresh(user, selected).catch(reportRefresh);
      } else setError(message(reason));
      return false;
    }
    drafts.current.delete(selected);
    storeDrafts(user.id, drafts.current);
    setError(''); setNotice('Nuova versione pubblicata. Lo storico è preservato.');
    await refresh(user, selected).catch(reportRefresh);
    return true;
  };

  const patientPicker = <label>Paziente associato<select value={patientId} onChange={event => selectPatient(event.target.value)}>
    <option value="">Seleziona</option>
    {patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name} · {patient.email}</option>)}
  </select></label>;
  const patientView = section === 'piano' || section === 'storico' || section === 'diario' || section === 'misurazioni';
  const isPatient = user?.role === 'PATIENT';
  // Stato del Patient per spiegare perché manca un piano (invito, associazione, pubblicazione).
  const noPlanText = !isPatient ? 'Nessun piano attivo. Crea il primo piano qui sotto.'
    : !online ? 'Nessun piano nella copia salvata su questo dispositivo.'
    : nutritionists.length ? 'Il tuo nutrizionista non ha ancora pubblicato un piano. Comparirà qui appena pubblicato.'
    : invitations.length ? 'Hai un invito in attesa: accettalo nella sezione Condivisione e inviti per ricevere il piano.'
    : 'Non hai ancora un nutrizionista. Comunicagli l’email del tuo account: il suo invito comparirà nella sezione Condivisione e inviti.';
  const versionLabel = (versionId: string) => {
    const version = history.find(v => v.id === versionId);
    return version ? `Versione associata: ${version.versionNumber}` : 'Piano di un’associazione precedente';
  };

  if (loading) return <main><p role="status">Caricamento NutriTrack…</p></main>;
  return <>
    <header className="app-header">
      <div className="header-inner">
        <Brand />
        {user && !accessPage && <div className="account">
          <span className="account-name">{user.name}</span>
          {<a className="profile-link" href="#profilo" aria-label="Profilo" aria-current={section === 'profilo' ? 'page' : undefined}><Icon name="profile" /> <span>Profilo</span></a>}
          <button className="quiet" onClick={() => void logout()}>Esci</button>
        </div>}
      </div>
    </header>
    <main ref={main} className="app-main">
      {!online && <p className="banner" role="status">{isPatient && !accessPage
        ? 'Sei offline. Puoi consultare l’ultima copia e registrare pasti, peso e circonferenze.'
        : 'Sei offline. Riconnettiti per accedere ai dati online.'}</p>}
      {online && serverDown && <p className="banner" role="status">{isPatient
        ? 'Il servizio è temporaneamente non disponibile. Puoi continuare a registrare pasti e misure: verranno inviati appena torna disponibile.'
        : 'Il servizio è temporaneamente non disponibile. Riprova tra qualche istante.'}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {accessPage ? <AccountAccess online={online} resetToken={resetToken} initialRecovery={hash === '#recupero'} onLogin={login}
        onReset={() => { leaveReset(); clearSession(); }} onLeaveReset={requestAnother => leaveReset(requestAnother ? '#recupero' : '#accesso')} /> : <>
        {!authenticated && online && !serverDown && <AccountAccess online={online} reauthenticate onLogin={login} onReset={clearSession} />}
        {section === null ? <Dashboard user={user} pending={queue.length} /> : <SectionHeading section={section} user={user} />}
        {section === 'profilo' && <>
          {isPatient && <PatientProfile key={user.id} user={user} available={online && authenticated} onSaved={updated => {
            setUser(current => current?.id === updated.id ? updated : current);
          }} />}
          <AccountSettings key={`account-${user.id}`} user={user} available={online && authenticated} onDeleted={accountDeleted} />
        </>}
        {section === 'pazienti' && <section className="card"><h2>Associazioni</h2>
          {!online ? <p>I dati dei pazienti non sono consultabili offline.</p> : <>
            <form className="inline-form" onSubmit={async event => {
              event.preventDefault();
              try {
                const result = await api<{ message?: string }>('/patients/invitations', 'POST', { email: inviteEmail });
                setInviteEmail(''); setNotice(result.message ?? 'Invito registrato.');
                await loadPatients(user);
              } catch (reason) { setError(message(reason)); }
            }}>
              <label>Email del paziente<input type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} /></label>
              <button disabled={!authenticated}>Invita paziente</button>
            </form>
            <p className="meta">Il paziente vede l’invito nell’app, con il tuo nome e la tua email, e decide se accettarlo.</p>
            {patientPicker}
            {!patients.length && <p>Nessun paziente associato. L’elenco si aggiorna da solo quando un paziente accetta.</p>}
            <button className="quiet" disabled={!authenticated} onClick={() => void reloadPatients()}>Aggiorna elenco</button>
            {patientId && <button className="quiet" disabled={!authenticated} onClick={() => void endAssociation(patientId)}>Termina associazione</button>}
            <h3>Inviti in attesa</h3>
            {invitations.length ? <ul className="records">{invitations.map(invite => <li key={invite.id}>
              <strong>{invite.patientName ?? 'Paziente'}</strong> · {invite.patientEmail}
              <button className="quiet" disabled={!authenticated} onClick={() => void answerInvitation(invite, false)}>Ritira invito</button>
            </li>)}</ul> : <p>Nessun invito in attesa di risposta.</p>}
          </>}
        </section>}
        {section === 'condivisione' && <section className="card">
          <h2>Il tuo nutrizionista</h2>
          {!online ? <p>Associazioni e inviti si gestiscono quando sei online.</p> : <>
            {nutritionists.length > 0 ? <p>Nutrizionista associato <strong>{nutritionists[0].name}</strong> · {nutritionists[0].email} <button className="quiet" disabled={!authenticated} onClick={() => void endAssociation(user.id)}>Termina associazione</button></p>
              : <p>Nessun nutrizionista associato. Comunica al tuo nutrizionista l’email del tuo account (<strong>{user.email}</strong>): il suo invito comparirà qui sotto.</p>}
            <h3>Inviti ricevuti</h3>
            {invitations.length ? <ul className="records">{invitations.map(invite => <li key={invite.id}>
              <strong>{invite.nutritionistName ?? 'Nutrizionista'}</strong> · {invite.nutritionistEmail}
              <p className="meta">Controlla che l’email sia quella del tuo nutrizionista prima di accettare: avrà accesso a piano e misurazioni.</p>
              <button disabled={!authenticated} onClick={() => void answerInvitation(invite, true)}>Accetta associazione</button>
              <button className="quiet" disabled={!authenticated} onClick={() => void answerInvitation(invite, false)}>Rifiuta</button>
            </li>)}</ul> : <p>Nessun invito in attesa.</p>}
          </>}
          <h2>Il tuo diario, la tua scelta</h2>
          <p>Condivisione {sharing ? 'attiva' : 'disattivata'}. La preferenza riguarda tutto lo storico. Le misurazioni registrate durante l’associazione sono visibili al nutrizionista associato.</p>
          {!nutritionists.length && !sharing && online && <p className="meta">Potrai condividere il diario dopo aver accettato l’invito di un nutrizionista.</p>}
          <button onClick={() => void changeSharing()} disabled={!online || !authenticated || (!sharing && !nutritionists.length)}>{sharing ? 'Disattiva condivisione' : 'Condividi il diario'}</button>
        </section>}
        {patientView && !isPatient && <section className="card patient-context">
          {!online ? <p>I dati dei pazienti non sono consultabili offline.</p> : patients.length ? <>
            {patientPicker}
            {patientId && <p className="meta">{lastRead ? `Dati aggiornati alle ${clock(lastRead)}. ` : ''}
              <button className="quiet" disabled={!authenticated} onClick={() => void refresh(user, patientId).catch(reportRefresh)}>Aggiorna</button></p>}
          </> : <p>Nessun paziente associato. <a href="#pazienti">Gestisci i pazienti</a></p>}
        </section>}
        {patientView && patientId && (online || isPatient) && <>
          {isPatient && !online && (cachedAt
            ? <p className="meta">Copia scaricata il {readable(cachedAt)}. Il piano attivo sul server potrebbe essere cambiato.</p>
            : <p className="meta">Piano e storici non sono ancora stati scaricati su questo dispositivo. Le nuove registrazioni vengono comunque salvate.</p>)}
          {section === 'piano' && <>
            <section className="card"><div className="section-heading"><h2>{isPatient ? 'Il tuo piano' : 'Piano del paziente'}</h2>
              <button className="quiet" disabled={!online || !authenticated} onClick={() => void refresh(user, patientId).catch(reportRefresh)}>Aggiorna</button>
            </div><Plan version={active} empty={noPlanText} /></section>
            {!isPatient && <section className="card"><h2>{active ? 'Evolvi il piano' : 'Crea il piano'}</h2>
              <Editor key={`${patientId}-${active?.id ?? 'new'}`} initial={active} draft={drafts.current.get(patientId)} disabled={!authenticated}
                onDraft={content => updateDraft(patientId, content)} onPublish={publishPlan} /></section>}
          </>}
          {section === 'storico' && <section className="card"><h2>Versioni del piano</h2>
            {!history.length && <p>Nessuna versione.</p>}
            {history.map(version => <details key={version.id}><summary>Versione {version.versionNumber} · {readable(version.validFrom)} → {version.validUntil === null ? 'in corso' : readable(version.validUntil)}</summary><Plan version={version} />{version.changeSet?.length > 0 && <><h4>Differenze dalla versione precedente</h4><ul>{version.changeSet.map((change, i) => <li key={i}>{change.before === null && version.parentVersionId === null ? 'Prima versione del piano' : <><strong>{describeChange(change.path)}</strong>: {describeValue(change.before)} → {describeValue(change.after)}</>}</li>)}</ul></>}</details>)}
          </section>}
          {section === 'diario' && <section className="card"><h2>{isPatient ? 'Registra un pasto' : 'Pasti condivisi'}</h2>
            {isPatient && <form onSubmit={event => void recordMeal(event)}>
              <label>Quando hai consumato il pasto?<input type="datetime-local" step="1" min="2000-01-01T00:00:00" required value={mealTime.value} onChange={event => mealTime.set(event.target.value)} /></label>
              {!mealTime.edited && <p className="meta">Ora attuale, aggiornata automaticamente. Modificala se il pasto è di un altro momento.</p>}
              <label>Cosa hai mangiato?<textarea required maxLength={4000} value={consumption} onChange={event => setConsumption(event.target.value)} /></label>
              <button disabled={recording}>{recording ? 'Registrazione…' : 'Registra pasto'}</button>
              {mealNotice.notice && <p className={mealNotice.notice.tone} role={mealNotice.notice.tone === 'error' ? 'alert' : 'status'}>{mealNotice.notice.text}</p>}
            </form>}
            {isPatient && <h2 className="records-heading">Pasti registrati</h2>}
            {diaryError ? <p className="error">{diaryError}</p> : diary.length ? <ul className="records">{diary.map(entry => <li key={entry.id}><strong>{readable(entry.consumptionTime)}</strong><p>{entry.actualConsumption}</p><span className="meta">{entry.mealPlanVersionId ? versionLabel(entry.mealPlanVersionId) : 'Nessun piano valido al consumo (confermato dal server)'}{entry.updatedAt ? ` · corretto il ${readable(entry.updatedAt)}` : ''}</span>
              {isPatient && <DiaryEntryActions record={entry} available={online && authenticated} onChanged={() => refresh(user, user.id).catch(reportRefresh)} />}</li>)}</ul> : <p>Nessun pasto confermato.</p>}
          </section>}
          {section === 'misurazioni' && <ProgressPanel key={`${user.id}-${patientId}`} user={user} measurements={measurements} online={online} authenticated={authenticated}
            onChanged={() => refresh(user, patientId).catch(reportRefresh)} />}
        </>}
        {section === 'sincronizzazione' && <section className="card"><h2>Registrazioni sul dispositivo</h2>
          <p>Le registrazioni vengono inviate automaticamente quando la rete e la sessione sono disponibili.</p>
          <p className="meta">{cachedAt
            ? `Pronto per l’uso offline: copia di piano e storici aggiornata il ${readable(cachedAt)}.`
            : 'Copia offline in preparazione: piano e storici saranno consultabili offline dopo il primo aggiornamento online. Le nuove registrazioni sono già salvate sul dispositivo.'}</p>
          {queue.length ? <ul className="records">{queue.map(item => <li key={item.id}>
            <strong>{item.kind === 'diary' ? 'Pasto' : measurementLabel(item.payload.type)}</strong> · {item.status === 'PENDING' ? 'In attesa di sincronizzazione' : item.status === 'AUTH_REQUIRED' ? 'Accedi di nuovo per sincronizzare' : item.status === 'CONFLICT' ? 'Conflitto: dati server conservati' : 'Registrazione non accettata dal server'}
            <p>{item.kind === 'diary' ? String(item.payload.actualConsumption) : `${item.payload.value} ${measurementUnit(item.payload.type)}`}</p>
            {item.kind === 'diary' && <p className="meta">Il server assocerà il pasto alla versione del piano valida al momento del consumo.</p>}
            {item.error && <p className="error">{item.error}</p>}
            {(item.status === 'REJECTED' || item.status === 'CONFLICT') && <>
              <button className="quiet" disabled={!online || !authenticated} onClick={async () => {
                try { await retryItem(user.id, item.id); await flushQueue(user.id); } catch (reason) { setError(message(reason)); }
              }}>Riprova</button>
              <button className="quiet" onClick={async () => {
                if (!confirm('Eliminare questa registrazione dal dispositivo? Non è mai stata confermata dal server e andrà persa.')) return;
                try { await discardItem(user.id, item.id); } catch (reason) { setError(message(reason)); }
              }}>Elimina dal dispositivo</button>
            </>}
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
