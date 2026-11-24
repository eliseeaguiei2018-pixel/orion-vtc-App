import type { Quote } from '../services/types.js';
import type { LatLng } from '../../core/geo.js';
import type { RideStatus } from '../services/ride/stateMachine.js';
import type { Repository } from '../../core/db/repository.js';
import { IndexChrono } from '../../core/chrono.js';

export interface TrustedContact {
  name: string;
  phone: string;
}

export interface DetailsLivraison {
  destinataire: { nom: string; telephone: string };
  /** Ce que contient le colis (« documents », « gâteau », « téléphone »…). */
  description?: string;
  /** Consignes pour le livreur (étage, portail, appeler en arrivant…). */
  instructions?: string;
}

export interface Ride {
  id: string;
  clientId: string;
  driverId?: string;
  serviceType: string;
  status: RideStatus;
  origin: LatLng;
  destination: LatLng;
  quote: Quote;
  events: RideEvent[];
  /** Jeton public de partage de la course (contact de confiance). */
  shareToken?: string;
  /** Contact de confiance prévenu au départ — ORION peut le joindre en cas d'accident. */
  trustedContact?: TrustedContact;
  /**
   * Tracé GPS de la course (borné à 200 points, éclairci au-delà) — instruction des
   * litiges ; le dernier point est la position actuelle. Points horodatés (`t`, en ms) :
   * la vitesse se calcule sur le vrai intervalle.
   */
  trace?: Array<LatLng & { t?: number }>;
  /**
   * Plus grand saut entre deux points GPS consécutifs reçus (mètres), tenu à l'ajout de
   * chaque point : la détection de position falsifiée le lit sans recalculer le tracé.
   */
  sautMaxMetres?: number;
  /**
   * Indice du tracé où commence le trajet avec le client (prise en charge). Ce qui
   * précède est l'approche du chauffeur : elle ne compte pas dans la détection d'une
   * déviation d'itinéraire.
   */
  traceDepart?: number;
  /**
   * Tracé de la course recalé sur les routes (Google Roads) à son arrivée : distance réelle,
   * trajet propre pour le client et la console, écart GPS (un tracé loin des routes trahit un faux GPS).
   */
  recalage?: { points: LatLng[]; distanceM: number; distanceGpsM: number; ecartMedianM: number; ecartMaxM: number; at: string };
  /** Itinéraire routier prévu (tracé réel des routes, ponts empruntés). */
  itineraire?: { geometrie: LatLng[]; distanceMeters: number; durationSeconds: number; ponts: string[]; provider: string };
  /** Minutes d'attente facturables (pauses demandées par le client en course). */
  waitMinutes?: number;
  /** Compte Entreprise (B2B) : course imputée à la ligne de crédit société. */
  corporateId?: string;
  /** Moyen de paiement annoncé par le client à la commande (affiché au chauffeur). */
  paymentMethod?: string;
  /**
   * LIVRAISON À MOTO : le colis et la personne qui le reçoit. Le livreur les voit le temps de
   * la mission (comme le prénom d'un passager) ; le téléphone du destinataire sert à l'appeler.
   */
  livraison?: DetailsLivraison;
  /**
   * ABONNEMENT ORION appliqué à la course, figé à la commande.
   *
   * `montantCouvert` est pris en charge par ORION (le chauffeur, lui, est payé sur
   * le montant BRUT : l'abonnement est une remise commerciale, jamais une perte
   * pour le chauffeur). `remise` est la ristourne d'abonné hors quota.
   */
  subscription?: {
    plan: string;
    montantCouvert: number;
    remise: number;
    aPayer: number;
    raison: string;
  };
  createdAt: string;
}

export interface RideEvent {
  type: string;
  at: string;
  payload?: Record<string, unknown>;
}

/** Statuts d'une course en cours (non terminale). */
export const STATUTS_ACTIFS = new Set<string>(['searching', 'accepted', 'driver_en_route', 'arrived', 'in_progress']);
/** Statuts d'une course qui a rapporté (terminée, payée, notée). */
export const STATUTS_REVENU = new Set<string>(['completed', 'paid', 'rated']);
/** Événements datés indexés (fenêtres : terminées aujourd'hui, paiements du mois, notes…). */
const EVENEMENTS_INDEXES = ['completed', 'paid', 'rated', 'cancelled'] as const;
export type EvenementIndexe = (typeof EVENEMENTS_INDEXES)[number];

const HEURE = 3_600_000;

/** Ce que l'on sait du conducteur au moment d'indexer (gamme pour les finances, motorisation pour le bilan vert). */
export type ResolveurConducteur = (driverId: string) => { categorie?: string; moteur?: string } | undefined;

/** Part d'une course dans les cumuls : retirée puis remise à chaque écriture (différentiel). */
interface Contribution {
  status: string;
  jour: string;
  heure: number;
  montant: number;
  revenu: boolean;
  heureFin: number | null;
  tva: number;
  gamme: string;
  moteur: string;
  km: number;
  annulee: boolean;
  /** Paiement (courses payées ou notées) : jour du paiement et montants pour la trésorerie. */
  paiement: null | { jour: string; service: 'course' | 'livraison'; encaisse: number; especes: boolean; gmv: number; tva: number; commission: number };
}

/** Les paiements d'une journée, tels que la direction financière les consolide. */
export interface PaiementsJour {
  jour: string;
  course: { encaisse: number; especes: number; nombre: number };
  livraison: { encaisse: number; especes: number; nombre: number };
  gmv: number;
  tva: number;
  commission: number;
  commissionEspeces: number;
}

export interface CumulJour { jour: string; courses: number; revenu: number; annulees: number }

/**
 * CUMULS DES COURSES, tenus à jour à chaque écriture.
 *
 * Totaux, répartition par statut et par gamme, kilomètres par motorisation, et séries par
 * jour et par heure : la console et le tableau de bord les lisent en temps constant, quel
 * que soit le nombre de courses (des millions). Chaque écriture retire l'ancienne part de
 * la course et ajoute la nouvelle : un changement de statut se reflète exactement.
 */
export class CumulsCourses {
  total = 0;
  gmv = 0;
  revenu = 0;
  tva = 0;
  readonly parStatut: Record<string, number> = {};
  readonly parGamme: Record<string, { count: number; revenue: number }> = {};
  readonly km = { electric: 0, hybrid: 0 };
  readonly coursesParMoteur = { electric: 0, hybrid: 0 };
  /** Par jour UTC de création (tendances de la console). */
  readonly parJour = new Map<string, CumulJour>();
  /** Commandes par heure de création, revenus par heure de fin de course (courbes du tableau de bord). */
  readonly commandesParHeure = new Map<number, number>();
  readonly revenusParHeure = new Map<number, number>();
  /** Par jour UTC de paiement : la consolidation financière additionne des jours, jamais des courses. */
  readonly paiementsParJour = new Map<string, PaiementsJour>();

  appliquer(c: Contribution, signe: 1 | -1): void {
    this.total += signe;
    this.gmv += signe * c.montant;
    this.parStatut[c.status] = (this.parStatut[c.status] ?? 0) + signe;
    const g = (this.parGamme[c.gamme] ??= { count: 0, revenue: 0 });
    g.count += signe;
    const j = this.parJour.get(c.jour) ?? { jour: c.jour, courses: 0, revenu: 0, annulees: 0 };
    j.courses += signe;
    if (c.annulee) j.annulees += signe;
    this.parJour.set(c.jour, j);
    this.commandesParHeure.set(c.heure, (this.commandesParHeure.get(c.heure) ?? 0) + signe);
    if (c.revenu) {
      this.revenu += signe * c.montant;
      this.tva += signe * c.tva;
      g.revenue += signe * c.montant;
      j.revenu += signe * c.montant;
      const m = c.moteur === 'hybrid' ? 'hybrid' : 'electric';
      this.km[m] += signe * c.km;
      this.coursesParMoteur[m] += signe;
      if (c.heureFin !== null) this.revenusParHeure.set(c.heureFin, (this.revenusParHeure.get(c.heureFin) ?? 0) + signe * c.montant);
    }
    const p = c.paiement;
    if (p) {
      const j = this.paiementsParJour.get(p.jour) ?? {
        jour: p.jour, course: { encaisse: 0, especes: 0, nombre: 0 }, livraison: { encaisse: 0, especes: 0, nombre: 0 },
        gmv: 0, tva: 0, commission: 0, commissionEspeces: 0,
      };
      j.gmv += signe * p.gmv;
      j.tva += signe * p.tva;
      j.commission += signe * p.commission;
      if (p.especes) j.commissionEspeces += signe * p.commission;
      if (p.encaisse > 0) {
        const cat = j[p.service];
        cat.nombre += signe;
        if (p.especes) cat.especes += signe * p.encaisse; else cat.encaisse += signe * p.encaisse;
      }
      this.paiementsParJour.set(p.jour, j);
    }
  }

  /** Paiements cumulés des jours UTC [premierJour .. dernierJour] (format AAAA-MM-JJ). */
  paiementsEntre(premierJour: string, dernierJour: string): PaiementsJour {
    const total: PaiementsJour = {
      jour: `${premierJour}..${dernierJour}`, course: { encaisse: 0, especes: 0, nombre: 0 }, livraison: { encaisse: 0, especes: 0, nombre: 0 },
      gmv: 0, tva: 0, commission: 0, commissionEspeces: 0,
    };
    for (let t = Date.parse(`${premierJour}T00:00:00Z`), fin = Date.parse(`${dernierJour}T00:00:00Z`); t <= fin; t += 86_400_000) {
      const j = this.paiementsParJour.get(new Date(t).toISOString().slice(0, 10));
      if (!j) continue;
      total.gmv += j.gmv; total.tva += j.tva; total.commission += j.commission; total.commissionEspeces += j.commissionEspeces;
      for (const k of ['course', 'livraison'] as const) {
        total[k].encaisse += j[k].encaisse; total[k].especes += j[k].especes; total[k].nombre += j[k].nombre;
      }
    }
    return total;
  }
}

/**
 * Magasin des courses + devis verrouillés. En production : PostgreSQL.
 * Les devis sont conservés par lockId pour garantir le prix verrouillé
 * (le client ne peut pas créer une course à un prix différent de l'estimation).
 *
 * INDEX ET CUMULS (volume) : chaque écriture (`save`, `persist`) met à jour l'ordre
 * chronologique, les courses actives, les index par chauffeur, client, entreprise et
 * jeton de partage, les événements datés et les cumuls. Plus aucune lecture courante ne
 * trie ni ne parcourt tout l'historique : la position GPS d'un chauffeur, la liste des
 * courses de la console ou l'état du tableau de bord coûtent le même prix avec
 * 1 000 ou 1 000 000 de courses.
 */
export class RideStore {
  private readonly rides = new Map<string, Ride>();
  // Les devis sont transitoires (TTL) → mémoire uniquement.
  private readonly quotes = new Map<string, Quote>();

  private readonly chrono = new IndexChrono<Ride>();
  private readonly actives = new Set<Ride>();
  /** Courses terminées, pas encore payées : la libération des chauffeurs et la vigilance les suivent. */
  private readonly aPayer = new Set<Ride>();
  private readonly parChauffeur = new Map<string, Ride[]>();
  private readonly parClient = new Map<string, Ride[]>();
  private readonly parEntreprise = new Map<string, Ride[]>();
  private readonly parJeton = new Map<string, Ride>();
  private readonly evenements = new Map<EvenementIndexe, IndexChrono<Ride>>(EVENEMENTS_INDEXES.map((e) => [e, new IndexChrono<Ride>()]));
  /** Dernier état indexé de chaque course (pour savoir quoi déplacer à la prochaine écriture). */
  private readonly indexe = new Map<string, { driverId?: string; corporateId?: string; shareToken?: string; evenements: Set<string>; part: Contribution }>();
  private copieRecente: Ride[] | null = null;
  readonly cumuls = new CumulsCourses();
  private resoudre: ResolveurConducteur = () => undefined;

  constructor(private readonly repo: Repository<Ride>) {
    for (const r of repo.all()) this.indexer(r);
  }

  /** Branche la lecture des conducteurs (gamme, motorisation) puis recalcule les cumuls. */
  brancherConducteurs(resoudre: ResolveurConducteur): void {
    this.resoudre = resoudre;
    for (const r of this.rides.values()) this.indexer(r);
  }

  private contribution(r: Ride): Contribution {
    const t = Date.parse(r.createdAt);
    const revenu = STATUTS_REVENU.has(r.status);
    const fin = revenu ? (r.events.find((e) => e.type === 'completed')?.at ?? r.createdAt) : null;
    const conducteur = r.driverId ? this.resoudre(r.driverId) : undefined;
    return {
      status: r.status,
      jour: r.createdAt.slice(0, 10),
      heure: Math.floor(t / HEURE) * HEURE,
      montant: r.quote.amount,
      revenu,
      heureFin: fin ? Math.floor(Date.parse(fin) / HEURE) * HEURE : null,
      tva: r.quote.breakdown?.tva ?? 0,
      gamme: r.quote.serviceType === 'delivery' ? 'livraison' : (conducteur?.categorie ?? r.serviceType),
      moteur: conducteur?.moteur ?? 'electric',
      km: (r.quote.distanceMeters ?? 0) / 1000,
      annulee: r.status === 'cancelled' || r.status === 'no_driver',
      paiement: r.status === 'paid' || r.status === 'rated'
        ? {
          jour: (r.events.find((e) => e.type === 'paid')?.at ?? r.createdAt).slice(0, 10),
          service: r.serviceType === 'delivery' ? 'livraison' : 'course',
          // La part prise en charge par un abonnement ORION n'entre pas en caisse.
          encaisse: Math.max(0, r.quote.amount - (r.subscription?.montantCouvert ?? 0) - (r.subscription?.remise ?? 0)),
          especes: r.paymentMethod === 'cash',
          gmv: r.quote.amount,
          tva: r.quote.breakdown?.tva ?? 0,
          commission: r.quote.breakdown?.fee ?? 0,
        }
        : null,
    };
  }

  private static retirer(index: Map<string, Ride[]>, cle: string | undefined, r: Ride): void {
    if (!cle) return;
    const liste = index.get(cle);
    if (!liste) return;
    const i = liste.lastIndexOf(r);
    if (i >= 0) liste.splice(i, 1);
    if (!liste.length) index.delete(cle);
  }

  private static ajouter(index: Map<string, Ride[]>, cle: string | undefined, r: Ride): void {
    if (!cle) return;
    const liste = index.get(cle);
    if (!liste) { index.set(cle, [r]); return; }
    // Ordre chronologique : presque toujours un ajout en fin de liste.
    let i = liste.length;
    while (i > 0 && liste[i - 1]!.createdAt > r.createdAt) i -= 1;
    liste.splice(i, 0, r);
  }

  /** Met tous les index et cumuls en accord avec l'état actuel de la course. */
  private indexer(r: Ride): void {
    const avant = this.indexe.get(r.id);
    const nouvelle = !avant;
    if (nouvelle) {
      this.rides.set(r.id, r);
      this.chrono.ajouter(Date.parse(r.createdAt), r);
      this.copieRecente = null;
      RideStore.ajouter(this.parClient, r.clientId, r);
    } else {
      this.cumuls.appliquer(avant.part, -1);
    }
    if (avant?.driverId !== r.driverId) {
      RideStore.retirer(this.parChauffeur, avant?.driverId, r);
      RideStore.ajouter(this.parChauffeur, r.driverId, r);
    }
    if (avant?.corporateId !== r.corporateId) {
      RideStore.retirer(this.parEntreprise, avant?.corporateId, r);
      RideStore.ajouter(this.parEntreprise, r.corporateId, r);
    }
    if (avant?.shareToken !== r.shareToken) {
      if (avant?.shareToken) this.parJeton.delete(avant.shareToken);
      if (r.shareToken) this.parJeton.set(r.shareToken, r);
    }
    if (STATUTS_ACTIFS.has(r.status)) this.actives.add(r); else this.actives.delete(r);
    if (r.status === 'completed') this.aPayer.add(r); else this.aPayer.delete(r);
    const vus = avant?.evenements ?? new Set<string>();
    for (const e of r.events) {
      const index = this.evenements.get(e.type as EvenementIndexe);
      if (!index || vus.has(e.type)) continue;
      vus.add(e.type);
      index.ajouter(Date.parse(e.at), r);
    }
    const part = this.contribution(r);
    this.cumuls.appliquer(part, 1);
    this.indexe.set(r.id, { driverId: r.driverId, corporateId: r.corporateId, shareToken: r.shareToken, evenements: vus, part });
  }

  /** Persiste l'état courant d'une course (write-through après mutation en place). */
  persist(ride: Ride): void {
    this.indexer(ride);
    this.repo.put(ride);
  }

  saveQuote(quote: Quote): void {
    this.quotes.set(quote.lockId, quote);
  }

  getQuote(lockId: string): Quote | undefined {
    return this.quotes.get(lockId);
  }

  consumeQuote(lockId: string): Quote | undefined {
    const q = this.quotes.get(lockId);
    if (q) this.quotes.delete(lockId);
    return q;
  }

  save(ride: Ride): Ride {
    const existante = this.rides.get(ride.id);
    if (existante && existante !== ride) {
      // Remplacement d'objet (rare) : l'ancien sort des index avant le nouveau.
      this.retirerDesIndex(existante);
    }
    this.indexer(ride);
    this.repo.put(ride);
    return ride;
  }

  private retirerDesIndex(r: Ride): void {
    const avant = this.indexe.get(r.id);
    if (!avant) return;
    this.cumuls.appliquer(avant.part, -1);
    RideStore.retirer(this.parChauffeur, avant.driverId, r);
    RideStore.retirer(this.parClient, r.clientId, r);
    RideStore.retirer(this.parEntreprise, avant.corporateId, r);
    if (avant.shareToken) this.parJeton.delete(avant.shareToken);
    this.actives.delete(r);
    this.aPayer.delete(r);
    this.indexe.delete(r.id);
    this.rides.delete(r.id);
    this.copieRecente = null;
    // L'index chronologique garde l'ancien objet : les lectures le reconnaissent et l'ignorent.
  }

  get(id: string): Ride | undefined {
    return this.rides.get(id);
  }

  /** Nombre total de courses (sans copie). */
  get nombre(): number {
    return this.rides.size;
  }

  /** Course active (non terminale) d'un chauffeur, pour router sa position vers la room. */
  findActiveByDriver(driverId: string): Ride | undefined {
    const liste = this.parChauffeur.get(driverId);
    if (!liste) return undefined;
    // La course en cours est parmi les plus récentes du chauffeur : lecture depuis la fin.
    for (let i = liste.length - 1, vus = 0; i >= 0 && vus < 50; i -= 1, vus += 1) {
      if (STATUTS_ACTIFS.has(liste[i]!.status)) return liste[i];
    }
    return undefined;
  }

  findByShareToken(token: string): Ride | undefined {
    return this.parJeton.get(token);
  }

  /** Courses d'un chauffeur (historique app chauffeur), plus récentes d'abord. */
  listByDriver(driverId: string): Ride[] {
    return (this.parChauffeur.get(driverId) ?? []).slice().reverse();
  }

  listByClient(clientId: string): Ride[] {
    return (this.parClient.get(clientId) ?? []).slice().reverse();
  }

  /** Courses imputées à une entreprise (B2B), plus récentes d'abord. */
  listByCorporate(corporateId: string): Ride[] {
    return (this.parEntreprise.get(corporateId) ?? []).slice().reverse();
  }

  /** Courses en cours (recherche, attribuée, en approche, arrivée, en course). */
  listActives(): Ride[] {
    return [...this.actives];
  }

  /** Courses terminées en attente de paiement (sans parcourir l'historique). */
  listAwaitingPayment(): Ride[] {
    return [...this.aPayer];
  }

  get nombreActives(): number {
    return this.actives.size;
  }

  /** Courses créées depuis `t` (ms), plus récentes d'abord : fenêtres « 7 jours », « 30 jours »… */
  createdSince(t: number): Ride[] {
    return this.chrono.depuis(t).filter((r) => this.rides.get(r.id) === r).reverse();
  }

  /** Courses dont l'événement `type` (terminée, payée, notée, annulée) est daté de `t` ou après. */
  withEventSince(type: EvenementIndexe, t: number): Ride[] {
    return this.evenements.get(type)!.depuis(t).filter((r) => this.rides.get(r.id) === r);
  }

  /**
   * Mêmes courses que `withEventSince`, mais du plus récent au plus ancien et lues à la
   * demande : une page du grand livre ne lit que sa page, pas toute l'année.
   */
  *withEventSinceDesc(type: EvenementIndexe, t: number): Generator<Ride> {
    for (const r of this.evenements.get(type)!.recentsDepuis(t)) if (this.rides.get(r.id) === r) yield r;
  }

  /** Courses dont l'événement `type` est daté dans [debut, fin[ (ms). */
  withEventBetween(type: EvenementIndexe, debut: number, fin: number): Ride[] {
    return this.evenements.get(type)!.entre(debut, fin).filter((r) => this.rides.get(r.id) === r);
  }

  /** Les plus récentes, page par page (console), sans trier tout l'historique. */
  recent(limit: number, offset = 0): Ride[] {
    return this.chrono.recents(limit, offset).filter((r) => this.rides.get(r.id) === r);
  }

  /** Parcourt du plus récent au plus ancien ; `visiter` renvoie false pour s'arrêter. */
  scanRecent(visiter: (r: Ride) => boolean | void): void {
    this.chrono.parcourirRecents((r) => (this.rides.get(r.id) === r ? visiter(r) : undefined));
  }

  /**
   * Toutes les courses, plus récentes d'abord. Réservé aux exports et aux analyses de
   * fond : pour une fenêtre de temps, préférer `createdSince`, pour une page `recent`.
   * La copie est gardée tant qu'aucune course n'est créée (plus de tri à chaque appel).
   */
  listAll(): Ride[] {
    if (!this.copieRecente || this.copieRecente.length !== this.rides.size) {
      this.copieRecente = this.chrono.tous().filter((r) => this.rides.get(r.id) === r).reverse();
    }
    return this.copieRecente.slice();
  }
}
