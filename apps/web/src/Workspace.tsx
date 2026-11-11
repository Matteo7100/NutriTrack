import type { User } from './types';

type IconName = 'home' | 'plan' | 'history' | 'diary' | 'measure' | 'people' | 'privacy' | 'sync' | 'profile' | 'edit' | 'arrow' | 'back';

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-6h6v6"/></>,
  plan: <><path d="M6 3v6a3 3 0 0 0 6 0V3M9 3v18M18 3c-2 2-3 5-3 9h4M19 3v18"/></>,
  history: <><path d="M3 11a9 9 0 1 1 2 7M3 5v6h6"/><path d="M12 7v5l3 2"/></>,
  diary: <><path d="M5 19V5a2 2 0 0 1 2-2h12v18H7a2 2 0 0 1 0-4h12M9 7h6M9 11h6"/></>,
  measure: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 6v5m5-5v3m5-3v5"/></>,
  people: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-15a3 3 0 0 1 0 6m5 9v-2a4 4 0 0 0-3-4"/></>,
  privacy: <><path d="m12 3 7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="m9 12 2 2 4-4"/></>,
  sync: <><path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5m-4 5a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/></>,
  profile: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/></>,
  edit: <><path d="m13 6 5 5M4 20l4.5-1 11-11a2 2 0 0 0-3-3l-11 11z"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  back: <path d="M20 12H5m6-6-6 6 6 6"/>,
};

export function Icon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const sections = {
  piano: { title: 'Piano alimentare', description: 'Consulta il piano attivo e le alternative per ogni pasto.', icon: 'plan' },
  storico: { title: 'Storico del piano', description: 'Ritrova le versioni precedenti del piano alimentare.', icon: 'history' },
  diario: { title: 'Diario dei pasti', description: 'Annota ciò che hai mangiato e rileggi le tue registrazioni.', icon: 'diary' },
  misurazioni: { title: 'Misurazioni e progressi', description: 'Registra peso, circonferenze e foto dei tuoi progressi.', icon: 'measure' },
  condivisione: { title: 'Condivisione e inviti', description: 'Gestisci l’accesso al diario e gli inviti del nutrizionista.', icon: 'privacy' },
  sincronizzazione: { title: 'Sincronizzazione', description: 'Controlla le registrazioni salvate su questo dispositivo.', icon: 'sync' },
  pazienti: { title: 'I tuoi pazienti', description: 'Invita un paziente e gestisci le associazioni attive.', icon: 'people' },
  profilo: { title: 'Il tuo profilo', description: 'Consulta e modifica i tuoi dati personali.', icon: 'profile' },
} satisfies Record<string, { title: string; description: string; icon: IconName }>;

export type Section = keyof typeof sections;
const destinations: Record<User['role'], Section[]> = {
  PATIENT: ['piano', 'misurazioni', 'diario', 'storico', 'condivisione', 'sincronizzazione'],
  NUTRITIONIST: ['pazienti', 'piano', 'diario', 'misurazioni', 'storico'],
};
const nutritionistDescriptions: Partial<Record<Section, string>> = {
  piano: 'Consulta il piano del paziente e pubblica una nuova versione.',
  diario: 'Consulta i pasti che il paziente ha scelto di condividere.',
  misurazioni: 'Consulta peso e circonferenze del paziente selezionato.',
};

export function sectionFor(hash: string, role: User['role']): Section | null {
  const section = hash.slice(1) as Section;
  return destinations[role].includes(section) || (section === 'profilo' && role === 'PATIENT') ? section : null;
}

export function Brand() {
  return <a className="brand" href="#" aria-label="NutriTrack, panoramica">
    <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M7 23V9l9 10 9-10v14M12 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    <span>NutriTrack</span>
  </a>;
}

export function Dashboard({ user, pending }: { user: User; pending: number }) {
  const patient = user.role === 'PATIENT';
  return <>
    <section className="workspace-hero" aria-labelledby="workspace-title">
      <p className="eyebrow">{patient ? 'Area paziente' : 'Area nutrizionista'}</p>
      <h1 id="workspace-title">Ciao, {user.name.split(/\s+/)[0]}.</h1>
      <p>{patient ? 'Qui trovi il tuo piano alimentare, il diario e le misurazioni.' : 'Da qui puoi gestire i tuoi pazienti, aggiornare i piani e seguire i progressi.'}</p>
    </section>
    <nav className="workspace-sections" aria-labelledby="workspace-sections-title">
      <h2 id="workspace-sections-title">Le tue sezioni</h2>
      <div className="tile-grid">
        {destinations[user.role].map((section, index) => {
          const item = sections[section];
          return <a href={`#${section}`} className={`section-tile tile-${section}`} key={section}>
            <div className="tile-top"><span className="tile-icon"><Icon name={item.icon} /></span><span className="tile-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span></div>
            <h3>{item.title}</h3>
            <p>{!patient && nutritionistDescriptions[section] || item.description}</p>
            <div className="tile-end"><span>{section === 'sincronizzazione' && pending > 0 ? `${pending} da sincronizzare` : 'Apri sezione'}</span><Icon name="arrow" /></div>
          </a>;
        })}
      </div>
    </nav>
  </>;
}

export function SectionHeading({ section, user }: { section: Section; user: User }) {
  const item = sections[section];
  return <div className="section-intro">
    <a className="back-link" href="#"><Icon name="back" /> Panoramica</a>
    <h1 tabIndex={-1}>{item.title}</h1>
    <p>{user.role === 'NUTRITIONIST' && nutritionistDescriptions[section] || item.description}</p>
  </div>;
}
