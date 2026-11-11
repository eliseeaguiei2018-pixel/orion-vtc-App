import type { Repository } from '../../core/db/repository.js';

export type ClientStatus = 'active' | 'blocked';

/**
 * Fiche client (minimale tant que l'auth réelle n'est pas branchée).
 * Enregistrée automatiquement à la 1re course/SOS. Le support peut bloquer un client.
 */
export interface Client {
  id: string;
  name?: string;
  phone?: string;
  status: ClientStatus;
  rides: number;
  /** Annulations cumulées (détection d'abus). */
  cancellations?: number;
  /** Avertissements automatiques (annulations abusives : 1 par palier de 3). */
  warnings?: number;
  /** Points Carbone (fidélisation verte) : 1 point par km 100 % électrique payé. */
  greenPoints?: number;
  /* --- CRM passager (session Client S13) --- */
  email?: string;
  /** Palier VIP automatique (fréquence + dépenses). */
  vipTier?: 'standard' | 'gold' | 'platinum';
  /** Verrou VIP manuel : jamais de majoration (surge) + priorité dispatch. */
  noSurgeLock?: boolean;
  /** CO2 économisé (kg) cumulé (empreinte carbone individuelle). */
  co2SavedKg?: number;
  /** Frais de no-show dus (annulation après arrivée du chauffeur). */
  noShowFees?: number;
  /** Liste noire : appareil (IMEI), e-mail et téléphone bloqués à la réinscription. */
  blacklistedImei?: string;
  /** Moyens de paiement liés (numéros masqués). */
  paymentMethods?: { id: string; kind: string; masked: string }[];
  /*
   * --- Compte client ---
   * Le numéro n'est rattaché au compte qu'après vérification par code SMS : sans
   * cela, n'importe qui pouvait se déclarer sous le numéro d'un autre.
   */
  phoneVerifiedAt?: string;
  /**
   * Photo de profil (data URL JPEG/PNG/WebP, ≤ PHOTO_MAX_OCTETS). Elle sert à
   * reconnaître le passager : le chauffeur à la prise en charge, la supervision et
   * la police en cas d'alerte SOS. Jamais renvoyée dans les listes.
   */
  photo?: string;
  photoUpdatedAt?: string;
  /** Compte supprimé à la demande du client : identité effacée, courses conservées. */
  deletedAt?: string;
  createdAt: string;
  lastSeenAt: string;
}

export class ClientStore {
  private readonly clients = new Map<string, Client>();

  constructor(private readonly repo?: Repository<Client>) {
    for (const c of repo?.all() ?? []) this.clients.set(c.id, c);
  }

  /** Enregistre / met à jour un client vu dans le système (idempotent). */
  touch(id: string, info: { name?: string; phone?: string } = {}): Client {
    const now = new Date().toISOString();
    const existing = this.clients.get(id);
    const c: Client = existing
      ? { ...existing, name: info.name ?? existing.name, phone: info.phone ?? existing.phone, lastSeenAt: now }
      : { id, name: info.name, phone: info.phone, status: 'active', rides: 0, createdAt: now, lastSeenAt: now };
    this.clients.set(id, c);
    this.repo?.put(c);
    return c;
  }

  incrementRides(id: string): void {
    const c = this.touch(id);
    c.rides += 1;
    this.repo?.put(c);
  }

  /**
   * Compte une annulation ; tous les 3 cumuls, un avertissement automatique
   * est posé (anti-abus). Renvoie true si un avertissement vient d'être émis.
   */
  incrementCancellations(id: string): boolean {
    const c = this.touch(id);
    c.cancellations = (c.cancellations ?? 0) + 1;
    let warned = false;
    if (c.cancellations % 3 === 0) {
      c.warnings = (c.warnings ?? 0) + 1;
      warned = true;
    }
    this.repo?.put(c);
    return warned;
  }

  /** Crédite des Points Carbone (course 100 % électrique payée). */
  addGreenPoints(id: string, points: number): number {
    const c = this.touch(id);
    c.greenPoints = (c.greenPoints ?? 0) + Math.max(0, Math.round(points));
    this.repo?.put(c);
    return c.greenPoints;
  }

  /** Persiste l'état courant d'un client (write-through après mutation en place). */
  persist(id: string): void {
    const c = this.clients.get(id);
    if (c) this.repo?.put(c);
  }

  get(id: string): Client | undefined { return this.clients.get(id); }

  /** Le compte qui porte ce numéro VÉRIFIÉ (un numéro = un compte). */
  findByVerifiedPhone(phone: string): Client | undefined {
    for (const c of this.clients.values()) if (c.phone === phone && c.phoneVerifiedAt && !c.deletedAt) return c;
    return undefined;
  }

  /** Profil modifiable par le client lui-même. */
  updateProfile(id: string, patch: { name?: string; email?: string | null; phone?: string; phoneVerifiedAt?: string }): Client {
    const c = this.touch(id);
    if (patch.name !== undefined) c.name = patch.name;
    if (patch.email !== undefined) c.email = patch.email ?? undefined;
    if (patch.phone !== undefined) c.phone = patch.phone;
    if (patch.phoneVerifiedAt !== undefined) c.phoneVerifiedAt = patch.phoneVerifiedAt;
    delete c.deletedAt;
    this.repo?.put(c);
    return c;
  }

  setPhoto(id: string, photo: string | null): Client {
    const c = this.touch(id);
    if (photo) { c.photo = photo; c.photoUpdatedAt = new Date().toISOString(); } else { delete c.photo; delete c.photoUpdatedAt; }
    this.repo?.put(c);
    return c;
  }

  /**
   * Suppression du compte à la demande du client : nom, téléphone, e-mail et photo
   * sont effacés. Les courses restent (obligations comptables et litiges), rattachées
   * à un identifiant qui ne désigne plus personne.
   */
  anonymiser(id: string): Client | undefined {
    const c = this.clients.get(id);
    if (!c) return undefined;
    delete c.name; delete c.phone; delete c.email; delete c.photo; delete c.photoUpdatedAt; delete c.phoneVerifiedAt;
    c.deletedAt = new Date().toISOString();
    this.repo?.put(c);
    return c;
  }

  setStatus(id: string, status: ClientStatus): Client | undefined {
    const c = this.clients.get(id);
    if (!c) return undefined;
    c.status = status;
    this.repo?.put(c);
    return c;
  }

  list(): Client[] {
    return [...this.clients.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
}
