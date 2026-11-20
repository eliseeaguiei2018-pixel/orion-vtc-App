/**
 * Erreurs applicatives avec code HTTP et code métier stable.
 * Permet une gestion d'erreur homogène et des réponses prévisibles côté client.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Non authentifié') =>
  new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Accès refusé') =>
  new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Ressource introuvable') =>
  new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', msg, details);
export const unprocessable = (msg: string, details?: unknown) =>
  new AppError(422, 'UNPROCESSABLE', msg, details);
