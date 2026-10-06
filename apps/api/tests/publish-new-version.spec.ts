/**
 * Verifica la pubblicazione di una nuova versione, con dati in memoria.
 * Scenario base: v2 già chiusa, v3 aperta dal 1 ottobre; il Nutritionist
 * pubblica v4 il 5 ottobre alle 14:00 UTC partendo da v3.
 * Il caso delle due sessioni riproduce l'esempio di UC-09.
 */
import { MealPlanVersionPeriod } from '../src/modules/meal-planning/domain/meal-plan-version-period';
import {
  MealPlanVersionConflict,
  publishNewVersion,
} from '../src/modules/meal-planning/domain/publish-new-version';
import {
  MealPlanTimelineError,
  resolveVersionAt,
} from '../src/modules/meal-planning/domain/resolve-version-at';

const sep15 = Date.parse('2026-09-15T00:00:00Z');
const oct1 = Date.parse('2026-10-01T00:00:00Z');
const changeTime = Date.parse('2026-10-05T14:00:00Z');

const v2: MealPlanVersionPeriod = { id: 'v2', patientId: 'P1', validFrom: sep15, validUntil: oct1 };
const v3: MealPlanVersionPeriod = { id: 'v3', patientId: 'P1', validFrom: oct1, validUntil: null };
const timeline: ReadonlyArray<MealPlanVersionPeriod> = [v2, v3];

// Richiesta tipica: si parte da v3 e si pubblica v4 all'istante del cambio.
const fromV3 = { patientId: 'P1', baseVersionId: 'v3', newVersionId: 'v4', activationTime: changeTime };

// Esegue una funzione che deve fallire e restituisce l'errore, per esaminarne i campi.
// unknown è il tipo "qualsiasi valore, da verificare prima dell'uso".
function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('Era atteso un errore, ma la funzione è terminata normalmente.');
}

describe('Pubblicazione di una nuova versione', () => {
  it('chiude v3 e apre v4 allo stesso istante', () => {
    const result = publishNewVersion(timeline, fromV3);
    // toEqual confronta i contenuti dei campi, non l'identità degli oggetti.
    expect(result.closedVersion).toEqual({ ...v3, validUntil: changeTime });
    expect(result.newVersion).toEqual({ id: 'v4', patientId: 'P1', validFrom: changeTime, validUntil: null });
  });

  it('non modifica in place i dati ricevuti e conserva lo storico', () => {
    const result = publishNewVersion(timeline, fromV3);
    expect(v3.validUntil).toBeNull(); // L'oggetto originale non è stato toccato.
    // toBe verifica che sia proprio lo stesso oggetto: v2 non è stata ricostruita.
    expect(result.versions.find((version) => version.id === 'v2')).toBe(v2);
    expect(result.versions).toHaveLength(3);
  });

  it('la timeline risultante funziona con il resolver della fase 1', () => {
    const { versions } = publishNewVersion(timeline, fromV3);
    expect(resolveVersionAt(versions, 'P1', changeTime - 1)?.id).toBe('v3');
    expect(resolveVersionAt(versions, 'P1', changeTime)?.id).toBe('v4');
    expect(resolveVersionAt(versions, 'P1', oct1 - 1)?.id).toBe('v2');
  });

  it('due sessioni partono da v3: la seconda riceve un conflitto', () => {
    // Sessione A pubblica v4; la timeline salvata diventa quella risultante.
    const afterA = publishNewVersion(timeline, fromV3).versions;
    // Sessione B aveva caricato v3 prima e prova a pubblicare v5 un minuto dopo.
    const error = captureError(() =>
      publishNewVersion(afterA, { ...fromV3, newVersionId: 'v5', activationTime: changeTime + 60_000 }),
    );
    expect(error).toBeInstanceOf(MealPlanVersionConflict);
    // toMatchObject controlla solo i campi indicati.
    expect(error).toMatchObject({ baseVersionId: 'v3', currentVersionId: 'v4' });
  });

  it('crea la prima versione quando il Patient non ha ancora un piano', () => {
    const result = publishNewVersion([], {
      patientId: 'P1', baseVersionId: null, newVersionId: 'v1', activationTime: oct1,
    });
    expect(result.closedVersion).toBeNull();
    expect(result.versions).toEqual([{ id: 'v1', patientId: 'P1', validFrom: oct1, validUntil: null }]);
  });

  it('creazione iniziale con un piano già aperto è un conflitto', () => {
    const error = captureError(() =>
      publishNewVersion(timeline, { ...fromV3, baseVersionId: null }),
    );
    expect(error).toMatchObject({ name: 'MealPlanVersionConflict', currentVersionId: 'v3' });
  });

  it('ignora le versioni di altri Patient', () => {
    const otherPatient = { id: 'x1', patientId: 'P2', validFrom: oct1, validUntil: null };
    const result = publishNewVersion([...timeline, otherPatient], fromV3);
    expect(result.versions).not.toContain(otherPatient);
    expect(otherPatient.validUntil).toBeNull();
  });

  it('respinge attivazioni retroattive, istanti non validi e id già usati', () => {
    // Attivazione all'inizio di v3: v3 resterebbe con un intervallo vuoto.
    expect(() => publishNewVersion(timeline, { ...fromV3, activationTime: oct1 }))
      .toThrow(MealPlanTimelineError);
    // Attivazione dentro v2, già chiusa: riscriverebbe lo storico.
    expect(() => publishNewVersion(timeline, { ...fromV3, activationTime: sep15 + 1 }))
      .toThrow(MealPlanTimelineError);
    expect(() => publishNewVersion(timeline, { ...fromV3, activationTime: NaN }))
      .toThrow(RangeError);
    expect(() => publishNewVersion(timeline, { ...fromV3, newVersionId: 'v2' }))
      .toThrow(MealPlanTimelineError);
  });
});
