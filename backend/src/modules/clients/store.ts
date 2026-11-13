import { IndexChrono } from '../../core/chrono.js';
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

/**
 * VOLUME : des centaines de milliers, puis des millions de clients.
 *  - L'ordre d'insertion de la Map EST l'ordre d'activité (un client vu repasse en fin) :
 *    la liste « plus récents d'abord » ne trie plus rien.
 *  - Un index des numéros retrouve le compte d'un numéro vérifié sans parcourir la base
 *    (chaque connexion par code SMS en a besoin).
 *  - Un index des dates de création compte les nouveaux clients d'une période.
 */
export class ClientStore {
  private readonly clients = new Map<string, Client>();
  private readonly parTelephone = new Map<string, Set<string>>();
  private readonly creations = new IndexChrono<string>();
  /**
   * Clé de recherche de chaque fiche (identifiant, nom, téléphone, en minuscules, d'un
   * seul tenant) : la recherche libre fait UNE comparaison par client au lieu de trois
   * conversions et trois comparaisons. Recalculée d'elle-même si le nom ou le numéro
   * a changé, quel que soit le chemin qui l'a modifié.
   */
  private readonly clesRecherche = new Map<string, { id: string; name?: string; phone?: string; cle: string }>();

  constructor(private readonly repo?: Repository<Client>) {
    const tous = (repo?.all() ?? []).sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? -1 : a.lastSeenAt > b.lastSeenAt ? 1 : 0));
    for (const c of tous) {
      this.clients.set(c.id, c);
      this.indexerTelephone(c.id, undefined, c.phone);
      this.cleDe(c);
      this.creations.ajouter(Date.parse(c.createdAt), c.id);
    }
  }

  private indexerTelephone(id: string, ancien: string | undefined, nouveau: string | undefined): void {
    if (ancien === nouveau) return;
    if (ancien) {
      const ids = this.parTelephone.get(ancien);
      ids?.delete(id);
      if (ids && !ids.size) this.parTelephone.delete(ancien);
    }
    if (nouveau) {
      const ids = this.parTelephone.get(nouveau) ?? new Set<string>();
      ids.add(id);
      this.parTelephone.set(nouveau, ids);
    }
  }

  /** Enregistre / met à jour un client vu dans le système (idempotent). */
  touch(id: string, info: { name?: string; phone?: string } = {}): Client {
    const now = new Date().toISOString();
    const existing = this.clients.get(id);
    const c: Client = existing
      ? { ...existing, name: info.name ?? existing.name, phone: info.phone ?? existing.phone, lastSeenAt: now }
      : { id, name: info.name, phone: info.phone, status: 'active', rides: 0, createdAt: now, lastSeenAt: now };
    // Retirer puis remettre : le client passe en fin de Map, c'est-à-dire en tête d'activité.
    if (existing) this.clients.delete(id); else this.creations.ajouter(Date.parse(now), id);
    this.clients.set(id, c);
    this.indexerTelephone(id, existing?.phone, c.phone);
    this.cleDe(c);
    this.repo?.put(c);
    return c;
  }

  /** Clé de recherche d'une fiche, recalculée si son nom ou son numéro a changé. */
  private cleDe(c: Client): string {
    let k = this.clesRecherche.get(c.id);
    if (!k || k.name !== c.name || k.phone !== c.phone) {
      k = { id: c.id, name: c.name, phone: c.phone, cle: `${c.id}\u0001${c.name ?? ''}\u0001${c.phone ?? ''}`.toLowerCase() };
      this.clesRecherche.set(c.id, k);
    }
    return k.cle;
  }

  /** Nombre de clients (sans copie). */
  get nombre(): number {
    return this.clients.size;
  }

  /** Nombre de comptes créés depuis `t` (ms). */
  creesDepuis(t: number): number {
    return this.creations.compterDepuis(t);
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
    for (const id of this.parTelephone.get(phone) ?? []) {
      const c = this.clients.get(id);
      if (c && c.phone === phone && c.phoneVerifiedAt && !c.deletedAt) return c;
    }
    return undefined;
  }

  /** Profil modifiable par le client lui-même. */
  /**
   * Recherche libre (morceau d'identifiant, de nom ou de numéro), des fiches les plus
   * récentes aux plus anciennes. `arreter` est consulté régulièrement : il borne le temps.
   */
  rechercher(fragment: string, limite: number, arreter: () => boolean = () => false): Client[] {
    const needle = fragment.toLowerCase();
    const trouves: Client[] = [];
    // Les clés sont lues d'un bloc, des fiches les plus récentes aux plus anciennes : une
    // seule comparaison de texte par client, sans aller chercher sa fiche.
    const cles = [...this.clesRecherche.values()];
    for (let i = cles.length - 1; i >= 0 && trouves.length < limite; i -= 1) {
      if ((i & 4095) === 0 && arreter()) break;
      const k = cles[i]!;
      if (!k.cle.includes(needle)) continue;
      const c = this.clients.get(k.id);
      // Fiche modifiée depuis le calcul de sa clé : on revérifie sur la clé à jour.
      if (c && (k.name === c.name && k.phone === c.phone ? true : this.cleDe(c).includes(needle))) trouves.push(c);
    }
    return trouves;
  }

  updateProfile(id: string, patch: { name?: string; email?: string | null; phone?: string; phoneVerifiedAt?: string }): Client {
    const c = this.touch(id);
    if (patch.name !== undefined) c.name = patch.name;
    if (patch.email !== undefined) c.email = patch.email ?? undefined;
    if (patch.phone !== undefined) { this.indexerTelephone(id, c.phone, patch.phone); c.phone = patch.phone; }
    if (patch.phoneVerifiedAt !== undefined) c.phoneVerifiedAt = patch.phoneVerifiedAt;
    delete c.deletedAt;
    this.repo?.put(c);
    this.cleDe(c);
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
    this.indexerTelephone(id, c.phone, undefined);
    delete c.name; delete c.phone; delete c.email; delete c.photo; delete c.photoUpdatedAt; delete c.phoneVerifiedAt;
    c.deletedAt = new Date().toISOString();
    this.repo?.put(c);
    this.cleDe(c);
    return c;
  }

  setStatus(id: string, status: ClientStatus): Client | undefined {
    const c = this.clients.get(id);
    if (!c) return undefined;
    c.status = status;
    this.repo?.put(c);
    return c;
  }

  /** Tous les clients, vus le plus récemment d'abord (l'ordre de la Map suffit : aucun tri). */
  list(): Client[] {
    return [...this.clients.values()].reverse();
  }
}
