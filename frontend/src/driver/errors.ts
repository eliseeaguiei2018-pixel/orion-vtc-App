/** Erreur métier lisible (message français renvoyé par le backend ou le moteur démo). */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
