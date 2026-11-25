/**
 * Magasin d'idempotence : neutralise les doublons dûs aux ré-essais réseau
 * (un double-tap "Confirmer" ou un retry mobile ne crée pas deux courses / deux paiements).
 *
 * En production : Redis avec TTL. Ici : Map en mémoire avec expiration, même contrat.
 */
interface StoredResult {
  value: unknown;
  expiresAt: number;
}

export class IdempotencyStore {
  private readonly store = new Map<string, StoredResult>();
  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000) {}

  /**
   * Exécute `fn` une seule fois par clé. Les appels suivants avec la même clé
   * renvoient le résultat mémorisé sans ré-exécuter l'effet de bord.
   */
  async run<T>(key: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!key) return fn();
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > now) {
      return existing.value as T;
    }
    const value = await fn();
    this.store.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }
}
