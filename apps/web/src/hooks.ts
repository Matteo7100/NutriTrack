/**
 * Hook condivisi dai moduli di registrazione del Patient.
 * useNowField: data/ora che segue l'orologio finché il Patient non la modifica.
 * useOperationNotice: avviso legato all'ID dell'invio, aggiornato dagli eventi del motore.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { localNow, syncEngine } from './offline';
import type { SyncEvent } from './sync/types';

/**
 * Senza modifiche manuali il campo mostra l'ora corrente e la ricalcola all'invio:
 * un modulo aperto da ore non registra il pasto all'ora di apertura della pagina.
 */
export function useNowField() {
  const [edited, setEdited] = useState<string | null>(null);
  const [now, setNow] = useState(localNow);
  useEffect(() => {
    if (edited !== null) return;
    const timer = setInterval(() => setNow(localNow()), 15_000);
    return () => clearInterval(timer);
  }, [edited]);
  return {
    value: edited ?? now,
    edited: edited !== null,
    set: (value: string) => setEdited(value),
    /** Valore da inviare: ora corrente se il campo non è stato toccato. */
    resolve: () => edited ?? localNow(),
    reset: () => { setEdited(null); setNow(localNow()); },
  };
}

export type OperationNotice = { tone: 'success' | 'error'; text: string } | null;

/**
 * Collega l'avviso al singolo invio: salvato sul dispositivo → confermato dal server,
 * oppure errore. Più invii ravvicinati mostrano lo stato dell'ultimo.
 */
export function useOperationNotice(accountId: string, labels: { saved: string; confirmed: string }) {
  const [notice, setNotice] = useState<OperationNotice>(null);
  const tracked = useRef<string | null>(null);
  const savedLabel = useRef(labels.saved);
  savedLabel.current = labels.saved;
  const confirmedLabel = useRef(labels.confirmed);
  confirmedLabel.current = labels.confirmed;
  useEffect(() => {
    const observer = {
      onSyncEvent(event: SyncEvent) {
        if (event.accountId !== accountId || event.operationId !== tracked.current) return;
        if (event.type === 'confirmed') setNotice({ tone: 'success', text: confirmedLabel.current });
        else if (event.type === 'discarded') setNotice(null);
        else if (event.type === 'failed') setNotice(event.status === 'PENDING'
          ? { tone: 'success', text: `${savedLabel.current} Invio non ancora riuscito: nuovo tentativo automatico.` }
          : event.status === 'AUTH_REQUIRED'
            ? { tone: 'error', text: 'Registrazione salvata sul dispositivo: accedi di nuovo per inviarla.' }
            : { tone: 'error', text: `Il server non ha accettato la registrazione: ${event.error} Controlla la sezione Sincronizzazione.` });
      },
    };
    return syncEngine.subscribe(observer);
  }, [accountId]);
  const track = useCallback((operationId: string) => {
    tracked.current = operationId;
    setNotice({ tone: 'success', text: savedLabel.current });
  }, []);
  const clear = useCallback(() => { tracked.current = null; setNotice(null); }, []);
  return { notice, track, clear };
}
