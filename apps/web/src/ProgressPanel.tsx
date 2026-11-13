import { useRef, useState, type FormEvent } from 'react';
import { enqueueFor, flushQueue, localToIso } from './offline';
import { useNowField, useOperationNotice } from './hooks';
import { ProgressPhotos } from './ProgressPhotos';
import { MeasurementActions } from './RecordEditors';
import type { Measurement, MeasurementType, User } from './types';
import './progress.css';

// min/max coincidono con gli intervalli di plausibilità applicati dal server.
const metrics = {
  WEIGHT: { label: 'Peso', unit: 'kg', apiUnit: 'KG', action: 'Registra peso', min: 1, max: 500 },
  ARM_CIRCUMFERENCE: { label: 'Circonferenza braccio', unit: 'cm', apiUnit: 'CM', action: 'Registra circonferenza braccio', min: 5, max: 100 },
  TORSO_CIRCUMFERENCE: { label: 'Circonferenza busto', unit: 'cm', apiUnit: 'CM', action: 'Registra circonferenza busto', min: 20, max: 300 },
} as const;
const measurementTypes = Object.keys(metrics) as MeasurementType[];
const measurementType = (value: unknown): MeasurementType | undefined => (
  typeof value === 'string' && Object.hasOwn(metrics, value) ? value as MeasurementType : undefined
);

export const measurementLabel = (value: unknown) => metrics[measurementType(value) ?? 'WEIGHT'].label;
export const measurementUnit = (value: unknown) => metrics[measurementType(value) ?? 'WEIGHT'].unit;

const dateOnly = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' });
const dateAndTime = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
const amount = new Intl.NumberFormat('it-IT', { maximumSignificantDigits: 15 });

interface ProgressProps {
  user: User;
  measurements: Measurement[];
  online: boolean;
  authenticated: boolean;
  /** Rilettura dopo una correzione o un'eliminazione. */
  onChanged?: () => Promise<void>;
}

function MeasurementForm({ user, online, authenticated }: Omit<ProgressProps, 'measurements' | 'onChanged'>) {
  const [type, setType] = useState<MeasurementType>('WEIGHT');
  const time = useNowField();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState('');
  const { notice, track, clear } = useOperationNotice(user.id, {
    saved: 'Misurazione salvata sul dispositivo: in attesa di conferma dal server.',
    confirmed: 'Misurazione confermata dal server.',
  });
  const metric = metrics[type];

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Il ref blocca un secondo invio prima ancora che il pulsante risulti disabilitato.
    if (busy.current) return;
    busy.current = true;
    setError('');
    clear();
    setSaving(true);
    try {
      const timestamp = localToIso(time.resolve());
      const numericValue = Number(value);
      if (Date.parse(timestamp) > Date.now()) throw new Error('Non puoi registrare un momento futuro.');
      if (!Number.isFinite(numericValue) || numericValue < metric.min || numericValue > metric.max) throw new Error(`Inserisci un valore tra ${metric.min} e ${metric.max} ${metric.unit}.`);
      const operationId = await enqueueFor(user, 'progress', { timestamp, value: numericValue, type, unit: metric.apiUnit });
      setValue('');
      time.reset();
      track(operationId);
      if (online && authenticated) await flushQueue(user.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossibile salvare la misurazione.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return <form className="progress-form" onSubmit={record}>
    <h3>Nuova misurazione</h3>
    <div className="progress-fields">
      <label><span id="measurement-type-label">Misurazione</span>
        <select aria-labelledby="measurement-type-label" value={type} disabled={saving} onChange={event => { setType(event.target.value as MeasurementType); setValue(''); }}>
          {measurementTypes.map(kind => <option key={kind} value={kind}>{metrics[kind].label}</option>)}
        </select>
      </label>
      <label>{metric.label} ({metric.unit})
        <input required disabled={saving} type="number" inputMode="decimal" min={metric.min} max={metric.max} step="any" value={value} onChange={event => setValue(event.target.value)} />
      </label>
      <label>Data e ora
        <input required disabled={saving} type="datetime-local" step="1" min="2000-01-01T00:00:00" value={time.value} onChange={event => time.set(event.target.value)} />
      </label>
    </div>
    <button disabled={saving}>{saving ? 'Registrazione…' : metric.action}</button>
    {notice && <p className={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

export function ProgressPanel({ user, measurements, online, authenticated, onChanged = async () => undefined }: ProgressProps) {
  const isPatient = user.role === 'PATIENT';

  return <>
    <section className="card progress-panel" aria-labelledby="measurements-heading">
      <h2 id="measurements-heading">Misurazioni del corpo</h2>
      <p className="progress-intro">{isPatient ? 'Segui nel tempo il peso e le circonferenze di braccio e busto.' : 'Consulta le misurazioni registrate dal paziente selezionato.'}</p>
      <dl className="progress-metrics">
        {measurementTypes.map(type => {
          const latest = measurements.find(measurement => measurement.type === type);
          const metric = metrics[type];
          return <div className="progress-metric" key={type}>
            <dt>{metric.label}</dt>
            {latest ? <dd>
              <strong>{amount.format(latest.value)} <span>{metric.unit}</span></strong>
              <time dateTime={new Date(latest.timestamp).toISOString()}>{dateOnly.format(latest.timestamp)}</time>
            </dd> : <dd className="progress-metric-empty">Nessun dato</dd>}
          </div>;
        })}
      </dl>
      {isPatient && <MeasurementForm user={user} online={online} authenticated={authenticated} />}
      <div className="progress-history">
        <h3 id="measurements-history-heading">Storico delle misurazioni</h3>
        {measurements.length ? <table aria-labelledby="measurements-history-heading">
          <thead><tr><th scope="col">Misurazione</th><th scope="col">Data e ora</th><th scope="col">Valore</th>{isPatient && <th scope="col">Azioni</th>}</tr></thead>
          <tbody>{measurements.map(measurement => <tr key={measurement.id}>
            <th scope="row">{measurementLabel(measurement.type)}</th>
            <td><time dateTime={new Date(measurement.timestamp).toISOString()}>{dateAndTime.format(measurement.timestamp)}</time></td>
            <td>{amount.format(measurement.value)} {measurementUnit(measurement.type)}{measurement.updatedAt && <span className="meta"> · corretta il {dateAndTime.format(measurement.updatedAt)}</span>}</td>
            {isPatient && <td><MeasurementActions record={measurement} available={online && authenticated} onChanged={onChanged}
              unit={metrics[measurement.type].unit} min={metrics[measurement.type].min} max={metrics[measurement.type].max} /></td>}
          </tr>)}</tbody>
        </table> : <p className="progress-empty">Nessuna misurazione confermata.</p>}
      </div>
    </section>
    {isPatient && <section className="card progress-panel" aria-labelledby="progress-photos-heading">
      <h2 id="progress-photos-heading">Foto dei progressi</h2>
      <p className="progress-intro">Raccogli le foto del tuo percorso. Solo tu puoi consultarle.</p>
      {online && authenticated ? <ProgressPhotos patientId={user.id} /> : <p className="progress-empty">
        {online ? 'Accedi di nuovo per gestire le foto.' : 'Collegati a Internet per visualizzare, aggiungere o eliminare le foto.'}
      </p>}
    </section>}
  </>;
}
