import { useState, type FormEvent } from 'react';
import { enqueue, flushQueue, localNow, localToIso } from './offline';
import { ProgressPhotos } from './ProgressPhotos';
import type { Measurement, MeasurementType, User } from './types';
import './progress.css';

const metrics = {
  WEIGHT: { label: 'Peso', unit: 'kg', apiUnit: 'KG', action: 'Registra peso' },
  ARM_CIRCUMFERENCE: { label: 'Circonferenza braccio', unit: 'cm', apiUnit: 'CM', action: 'Registra circonferenza braccio' },
  TORSO_CIRCUMFERENCE: { label: 'Circonferenza busto', unit: 'cm', apiUnit: 'CM', action: 'Registra circonferenza busto' },
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
}

function MeasurementForm({ user, online, authenticated }: Omit<ProgressProps, 'measurements'>) {
  const [type, setType] = useState<MeasurementType>('WEIGHT');
  const [time, setTime] = useState(localNow);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const metric = metrics[type];

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const timestamp = localToIso(time);
      const numericValue = Number(value);
      if (Date.parse(timestamp) > Date.now()) throw new Error('Non puoi registrare un momento futuro.');
      if (!Number.isFinite(numericValue) || numericValue <= 0) throw new Error('Inserisci un valore maggiore di zero.');
      await enqueue(user.id, 'progress', { timestamp, value: numericValue, type, unit: metric.apiUnit });
      setValue('');
      setNotice('Misurazione salvata sul dispositivo. Lo storico si aggiorna alla conferma del server.');
      if (online && authenticated) await flushQueue(user.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossibile salvare la misurazione.');
    } finally {
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
        <input required disabled={saving} type="number" inputMode="decimal" min="0" step="any" value={value} onChange={event => setValue(event.target.value)} />
      </label>
      <label>Data e ora
        <input required disabled={saving} type="datetime-local" step="1" value={time} onChange={event => setTime(event.target.value)} />
      </label>
    </div>
    <button disabled={saving}>{saving ? 'Registrazione…' : metric.action}</button>
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

export function ProgressPanel({ user, measurements, online, authenticated }: ProgressProps) {
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
          <thead><tr><th scope="col">Misurazione</th><th scope="col">Data e ora</th><th scope="col">Valore</th></tr></thead>
          <tbody>{measurements.map(measurement => <tr key={measurement.id}>
            <th scope="row">{measurementLabel(measurement.type)}</th>
            <td><time dateTime={new Date(measurement.timestamp).toISOString()}>{dateAndTime.format(measurement.timestamp)}</time></td>
            <td>{amount.format(measurement.value)} {measurementUnit(measurement.type)}</td>
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
