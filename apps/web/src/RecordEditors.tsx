/**
 * Correzione ed eliminazione online delle registrazioni confermate del Patient.
 * Le modifiche non passano dalla coda offline: il server le applica subito.
 */
import { useState, type FormEvent } from 'react';
import { api } from './api';
import { localToIso } from './offline';
import type { Entry, Measurement } from './types';

const toLocalInput = (time: number) => {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
};
const failure = (reason: unknown) => reason instanceof Error ? reason.message : 'Operazione non riuscita.';

interface EditorProps<T> { record: T; available: boolean; onChanged: () => Promise<void> }

function useRecordActions(onChanged: () => Promise<void>) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); setEditing(false); await onChanged(); }
    catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  };
  return { editing, setEditing, busy, error, run };
}

export function DiaryEntryActions({ record, available, onChanged }: EditorProps<Entry>) {
  const { editing, setEditing, busy, error, run } = useRecordActions(onChanged);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void run(() => api(`/diary/entries/${record.id}`, 'PATCH', {
      consumptionTime: localToIso(String(fields.get('consumptionTime'))), actualConsumption: fields.get('actualConsumption'),
    }));
  };
  const remove = () => {
    if (confirm('Eliminare questo pasto dal diario? Non sarà più visibile neanche al nutrizionista.')) void run(() => api(`/diary/entries/${record.id}`, 'DELETE'));
  };
  if (editing) return <form onSubmit={submit}>
    <label>Quando<input name="consumptionTime" type="datetime-local" step="1" min="2000-01-01T00:00:00" required defaultValue={toLocalInput(record.consumptionTime)} /></label>
    <label>Cosa hai mangiato<textarea name="actualConsumption" required maxLength={4000} defaultValue={record.actualConsumption} /></label>
    <button disabled={busy}>{busy ? 'Salvataggio…' : 'Salva correzione'}</button>
    <button type="button" className="quiet" disabled={busy} onClick={() => setEditing(false)}>Annulla</button>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
  return <div className="record-actions">
    <button type="button" className="quiet" disabled={!available || busy} onClick={() => setEditing(true)}>Modifica</button>
    <button type="button" className="quiet" disabled={!available || busy} onClick={remove}>Elimina</button>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

export function MeasurementActions({ record, available, onChanged, unit, min, max }: EditorProps<Measurement> & { unit: string; min: number; max: number }) {
  const { editing, setEditing, busy, error, run } = useRecordActions(onChanged);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void run(() => api(`/progress/measurements/${record.id}`, 'PATCH', {
      value: Number(fields.get('value')), timestamp: localToIso(String(fields.get('timestamp'))),
    }));
  };
  const remove = () => {
    if (confirm('Eliminare questa misurazione?')) void run(() => api(`/progress/measurements/${record.id}`, 'DELETE'));
  };
  if (editing) return <form onSubmit={submit}>
    <label>Valore ({unit})<input name="value" type="number" step="any" min={min} max={max} required defaultValue={record.value} /></label>
    <label>Data e ora<input name="timestamp" type="datetime-local" step="1" min="2000-01-01T00:00:00" required defaultValue={toLocalInput(record.timestamp)} /></label>
    <button disabled={busy}>{busy ? 'Salvataggio…' : 'Salva correzione'}</button>
    <button type="button" className="quiet" disabled={busy} onClick={() => setEditing(false)}>Annulla</button>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
  return <div className="record-actions">
    <button type="button" className="quiet" disabled={!available || busy} onClick={() => setEditing(true)} aria-label="Modifica misurazione">Modifica</button>
    <button type="button" className="quiet" disabled={!available || busy} onClick={remove} aria-label="Elimina misurazione">Elimina</button>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
