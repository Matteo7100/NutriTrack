/**
 * Verifica la risoluzione temporale con dati in memoria, senza UI o database.
 * Scenario: v3 termina alle 14:00 UTC e v4 inizia nello stesso istante.
 * Date.parse converte le date esplicite UTC (suffisso Z) in millisecondi.
 */
import { MealPlanVersionPeriod } from '../src/modules/meal-planning/domain/meal-plan-version-period';
import { MealPlanTimelineError, resolveVersionAt } from '../src/modules/meal-planning/domain/resolve-version-at';

const start = Date.parse('2026-10-01T00:00:00Z');
const changeTime = Date.parse('2026-10-05T14:00:00Z');
const versions: ReadonlyArray<MealPlanVersionPeriod> = [
  { id: 'v3', patientId: 'P1', validFrom: start, validUntil: changeTime },
  { id: 'v4', patientId: 'P1', validFrom: changeTime, validUntil: null },
];

describe('Risoluzione della versione al consumo', () => {
  it('usa v3 per un consumo precedente al cambio, anche se registrato più tardi', () => {
    // Creazione e sync non sono parametri: non possono spostare il riferimento.
    const result = resolveVersionAt(versions, 'P1', Date.parse('2026-10-05T12:00:00Z'));
    // ?. legge id se result non è null; altrimenti restituisce undefined.
    expect(result?.id).toBe('v3');
  });

  it('all’istante esatto del cambio sceglie v4, non v3', () => {
    expect(resolveVersionAt(versions, 'P1', changeTime)?.id).toBe('v4');
  });

  it('include l’inizio del primo intervallo', () => {
    expect(resolveVersionAt(versions, 'P1', start)?.id).toBe('v3');
  });

  it('restituisce null prima che esista un piano valido', () => {
    expect(resolveVersionAt(versions, 'P1', start - 1)).toBeNull();
  });

  it('non restituisce il piano di un altro Patient', () => {
    expect(resolveVersionAt(versions, 'P2', changeTime)).toBeNull();
  });

  it('non dipende dall’ordine delle versioni ricevute', () => {
    // [...versions] crea una copia: reverse non modifica i dati originali.
    expect(resolveVersionAt([...versions].reverse(), 'P1', changeTime)?.id).toBe('v4');
  });

  it('segnala due versioni contemporaneamente valide', () => {
    const overlap = { id: 'v5', patientId: 'P1', validFrom: changeTime, validUntil: null };
    // Per toThrow passiamo una funzione, così Jest intercetta l'errore sollevato.
    expect(() => resolveVersionAt([...versions, overlap], 'P1', changeTime))
      .toThrow(MealPlanTimelineError);
  });

  it('respinge intervalli vuoti e timestamp non validi', () => {
    const invalid = { id: 'invalid', patientId: 'P1', validFrom: start, validUntil: start };
    expect(() => resolveVersionAt([invalid], 'P1', start)).toThrow(MealPlanTimelineError);
    expect(() => resolveVersionAt(versions, 'P1', NaN)).toThrow(RangeError);
  });
});
