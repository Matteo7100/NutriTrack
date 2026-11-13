import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ApiError, api } from './api';
import { localToIso } from './offline';
import { useNowField } from './hooks';

interface ProgressPhoto {
  id: string;
  timestamp: number;
  createdAt: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

interface PhotoUpload {
  operationId: string;
  timestamp: string;
  dataUrl: string;
}

const photoTypes = ['image/jpeg', 'image/png', 'image/webp'];
const photoLimit = 50;
const uploadLimit = 2 * 1024 * 1024;
const formatDate = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
const byDate = (a: ProgressPhoto, b: ProgressPhoto) => b.timestamp - a.timestamp || b.createdAt - a.createdAt;
const failure = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;

// Quando si torna alla galleria, il nuovo elenco attende un invio già avviato.
const pendingChanges = new Map<string, Promise<void>>();
function changePhotos<T>(patientId: string, path: string, method: 'POST' | 'DELETE', body?: PhotoUpload): Promise<T> {
  const request = api<T>(path, method, body);
  const settled = request.then(() => undefined, () => undefined);
  pendingChanges.set(patientId, settled);
  void settled.then(() => {
    if (pendingChanges.get(patientId) === settled) pendingChanges.delete(patientId);
  });
  return request;
}

async function photoDataUrl(file: File): Promise<string> {
  const image = await createImageBitmap(file).catch(() => {
    throw new Error('Il file selezionato non è un’immagine leggibile.');
  });
  try {
    // Ridimensiona le foto da fotocamera e rimuove i metadati, inclusa la posizione.
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Impossibile elaborare la foto in questo browser.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    const prefix = 'data:image/jpeg;base64,';
    const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
    const bytes = (dataUrl.length - prefix.length) * 3 / 4 - padding;
    if (!dataUrl.startsWith(prefix) || bytes > uploadLimit) {
      throw new Error('La foto supera 2 MiB anche dopo la compressione. Scegli un’immagine più piccola.');
    }
    return dataUrl;
  } finally {
    image.close();
  }
}

export function ProgressPhotos({ patientId }: { patientId: string }) {
  const [photos, setPhotos] = useState<ProgressPhoto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState('');
  const time = useNowField();
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const prepared = useRef<PhotoUpload | null>(null);
  const busy = preparing || uploading || deleting !== null;
  const full = (photos?.length ?? 0) >= photoLimit;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    async function load() {
      try {
        const pending = pendingChanges.get(patientId);
        if (pending) await pending;
        if (!active) return;
        const items = await api<ProgressPhoto[]>('/progress/photos');
        if (active) setPhotos(items.sort(byDate));
      } catch (reason) {
        if (active) setLoadError(failure(reason, 'Impossibile caricare le foto.'));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [patientId, reload]);

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const field = event.currentTarget;
    const selected = field.files?.[0];
    setError('');
    setNotice('');
    setPreview('');
    prepared.current = null;
    if (!selected) return;
    setPreparing(true);
    try {
      if (!photoTypes.includes(selected.type)) throw new Error('Scegli una foto in formato JPEG, PNG o WebP.');
      setPreview(await photoDataUrl(selected));
    } catch (reason) {
      field.value = '';
      setError(failure(reason, 'Impossibile elaborare la foto.'));
    } finally {
      setPreparing(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || busy) return;
    setError('');
    setNotice('');
    setUploading(true);
    try {
      const timestamp = localToIso(time.resolve());
      if (Date.parse(timestamp) > Date.now()) throw new Error('Non puoi registrare un momento futuro.');
      // In caso di errore di rete, lo stesso file e la stessa data riusano l'operazione.
      // Con l'ora automatica il nuovo tentativo riusa anche l'istante del primo invio.
      const reusable = prepared.current?.dataUrl === preview && (!time.edited || prepared.current.timestamp === timestamp);
      const payload = reusable && prepared.current ? prepared.current : {
        operationId: crypto.randomUUID(), timestamp, dataUrl: preview,
      };
      prepared.current = payload;
      const photo = await changePhotos<ProgressPhoto>(patientId, '/progress/photos', 'POST', payload);
      setPhotos(items => [photo, ...(items ?? []).filter(item => item.id !== photo.id)].sort(byDate));
      setPreview('');
      if (input.current) input.current.value = '';
      prepared.current = null;
      time.reset();
      setNotice('Foto salvata.');
    } catch (reason) {
      setError(failure(reason, 'Impossibile caricare la foto.'));
    } finally {
      setUploading(false);
    }
  }

  async function remove(photo: ProgressPhoto) {
    if (busy || !confirm(`Eliminare la foto del ${formatDate.format(photo.timestamp)}?`)) return;
    setDeleting(photo.id);
    setError('');
    setNotice('');
    try {
      await changePhotos(patientId, `/progress/photos/${encodeURIComponent(photo.id)}`, 'DELETE').catch(reason => {
        if (!(reason instanceof ApiError && reason.code === 'PhotoNotFound')) throw reason;
      });
      setPhotos(items => items?.filter(item => item.id !== photo.id) ?? []);
      setNotice('Foto eliminata.');
    } catch (reason) {
      setError(failure(reason, 'Impossibile eliminare la foto.'));
    } finally {
      setDeleting(null);
    }
  }

  return <>
    {loading && <p className="progress-empty" role="status">Caricamento delle foto…</p>}
    {loadError && <div className="error" role="alert">{loadError} <button type="button" className="quiet" onClick={() => setReload(value => value + 1)}>Riprova</button></div>}
    {photos && <>
      <form className="progress-form" onSubmit={upload}>
        <h3>Aggiungi una foto</h3>
        <div className="progress-fields progress-photo-fields">
          <label>File della foto
            <input ref={input} type="file" accept={photoTypes.join(',')} required disabled={busy || full} onChange={choosePhoto} aria-describedby="progress-photo-format" />
          </label>
          <label>Data e ora della foto
            <input type="datetime-local" step="1" min="2000-01-01T00:00:00" required disabled={busy || full} value={time.value} onChange={event => time.set(event.target.value)} />
          </label>
        </div>
        <p className="meta" id="progress-photo-format">JPEG, PNG o WebP. La foto viene ridimensionata prima del caricamento.</p>
        {preparing && <p className="meta" role="status">Elaborazione della foto…</p>}
        {preview && <img className="progress-photo-preview" src={preview} alt="Anteprima della foto selezionata" />}
        {full && <p className="progress-empty">Hai raggiunto il limite di {photoLimit} foto. Elimina una foto per aggiungerne un’altra.</p>}
        <button disabled={!preview || busy || full}>{uploading ? 'Caricamento…' : 'Carica foto'}</button>
      </form>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {photos.length > 0 ? <ul className="progress-gallery" aria-label="Galleria dei progressi">
        {photos.map(photo => {
          const date = formatDate.format(photo.timestamp);
          return <li key={photo.id}>
            <figure>
              <img src={`/api/progress/photos/${encodeURIComponent(photo.id)}`} alt={`Foto dei progressi del ${date}`} loading="lazy" decoding="async" />
              <figcaption>
                <time dateTime={new Date(photo.timestamp).toISOString()}>{date}</time>
                <button type="button" className="quiet" disabled={busy} aria-label={`Elimina foto del ${date}`} onClick={() => void remove(photo)}>{deleting === photo.id ? 'Eliminazione…' : 'Elimina'}</button>
              </figcaption>
            </figure>
          </li>;
        })}
      </ul> : <p className="progress-empty">Nessuna foto salvata.</p>}
    </>}
  </>;
}
