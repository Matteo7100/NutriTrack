/** Confine transazionale dell'application: adapter reale e fake hanno lo stesso contratto. */
export interface UnitOfWork { run<T>(operation: () => Promise<T>): Promise<T> }
