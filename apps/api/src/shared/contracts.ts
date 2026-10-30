/** Contratti tecnici minimi condivisi: nessuna tabella o entity di dominio globale. */
export type Role = 'PATIENT' | 'NUTRITIONIST';
export interface Principal { id: string; email: string; name: string; role: Role }
export class AppError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message); this.name = code;
  }
}
/** Ogni modulo riceve esclusivamente il repository del proprio stato. */
export interface Repository<T> { get(): Promise<T>; save(state: T): Promise<void> }
export type Clock = () => number;
