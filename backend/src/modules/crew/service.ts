import type { Container } from '../../container.js';
import { photoUrl } from '../driver-app/photo-url.js';
import { TYPE_LABEL, STATUT_LABEL, type RequeteChauffeur } from './requests.js';

/**
 * SESSION ÉQUIPAGES — le dossier des chauffeurs ORION, en un seul endroit.
 *
 * Les informations d'un chauffeur étaient éparpillées : son identité aux Chauffeurs,
 * ses courses aux Courses, son argent au Portefeuille, son véhicule à la Maintenance,
 * son équipe aux Équipes, ses litiges aux Litiges. Pour répondre à « combien a-t-il
 * gagné ce mois, et où en est sa demande de prêt ? », il fallait ouvrir six sessions
 * et faire l'addition de tête.
 *
 * Ici, un matricule suffit. Le dossier ne crée aucune donnée : il va la chercher
 * là où elle vit déjà, et affiche tout ce qui concerne l'homme — y compris ce qu'il
 * a demandé à l'entreprise et ce que l'entreprise lui a répondu.
 *
 * C'est aussi SA session : un chauffeur connecté n'y voit que son propre dossier et
 * n'y dépose que ses propres requêtes.
 */

const JOUR = 86_400_000;
const REVENUS = new Set(['completed', 'rated']);

export interface LigneEquipage {
  driverId: string;
  matricule: string;
  name: string;
  phone: string | null;
  category: string;
  kycStatus: string;
  availability: string;
  rating: number;
  teamId?: string;
  teamName?: string;
  /** Courses terminées sur la période consultée. */
  courses: number;
  /** Ce que le chauffeur a encaissé (sa part), pas le chiffre d'affaires. */
  revenus: number;
  solde: number;
  /** Prêts et avances non soldés. */
  resteDu: number;
  requetesOuvertes: number;
  /** Vrai si la personne a un accès à la console. */
  aUnAcces: boolean;
}

export interface DossierEquipage {
  identite: {
    driverId: string; matricule: string; name: string; phone: string | null;
    category: string; kycStatus: string; availability: string;
    rating: number; trips: number;
    licenseNo?: string; birthDate?: string; insuranceExpiry?: string;
    appLinkedAt?: string;
    /** Photo du chauffeur (adresse signée) et annulations faites par lui-même. */
    photoUrl?: string | null;
    annulationsChauffeur?: number;
  };
  vehicule: { model?: string; plate?: string; color?: string; engine: string; batteryPct?: number; batteryHealthPct?: number };
  equipe: { id: string; name: string; mission?: string; managerName?: string; managerUsername: string } | null;
  acces: { username: string; active: boolean; lastLoginAt?: string; mustChangePassword: boolean } | null;
  activite: {
    periodeJours: number;
    courses: number; coursesAnnulees: number;
    kilometres: number;
    revenus: number; commissionVersee: number;
    noteMoyenne: number; nbNotes: number;
    joursTravailles: number;
  };
  argent: {
    solde: number;
    /** Commission due sur les courses encaissées en espèces. */
    detteEspeces: number;
    resteDu: number;
    dernieresEcritures: Array<{ at: string; type: string; amount: number; note: string }>;
  };
  requetes: Array<RequeteChauffeur & { typeLabel: string; statutLabel: string }>;
  litiges: Array<{ id: string; kind: string; status: string; createdAt: string; description: string }>;
  maintenance: Array<{ id: string; kind: string; title: string; status: string; dueDate?: string }>;
  /** Points de vigilance propres à ce chauffeur (assurance, KYC, batterie, dette). */
  alertes: Array<{ severite: 'critique' | 'eleve' | 'moyen'; texte: string }>;
  genereA: string;
}

/** Un seul classement à la française, réutilisé (localeCompare en recrée un à chaque appel). */
const ORDRE = new Intl.Collator('fr');

export class CrewService {
  constructor(private readonly c: Container) {}

  private equipeDe(driverId: string) {
    return this.c.teams.list().find((t) => t.driverIds.includes(driverId));
  }

  /**
   * Dette espèces : la commission ORION sur les courses que le chauffeur a
   * encaissées en liquide. Cet argent est dans sa poche, pas dans la caisse.
   */
  private detteEspeces(driverId: string): number {
    let dette = 0;
    // Commissions du chauffeur indexées par course : une seule lecture de son historique.
    const commissions = new Map<string, number>();
    for (const e of this.c.wallet.ecritures(driverId)) if (e.type === 'commission' && e.rideId) commissions.set(e.rideId, e.amount);
    for (const r of this.c.rides.listByDriver(driverId)) {
      if (!REVENUS.has(r.status) || r.paymentMethod !== 'cash') continue;
      dette += Math.abs(commissions.get(r.id) ?? 0);
    }
    return Math.round(dette);
  }

  /** Liste de travail : une ligne par chauffeur, filtrable et cherchable au matricule. */
  liste(filtre: { q?: string; teamId?: string; kycStatus?: string; jours?: number } = {}): LigneEquipage[] {
    return this.page(filtre).lignes;
  }

  /**
   * Une page de la liste de travail, triée au matricule, avec le nombre total de lignes.
   *
   * VOLUME : le filtre et le tri ne lisent que la fiche des chauffeurs ; les chiffres
   * (courses, revenus, solde, requêtes) ne sont calculés que pour les lignes de la page,
   * chacun par lecture directe de l'historique du chauffeur. Avant, chaque ligne
   * reparcourait toutes les courses : 5 600 chauffeurs × 5 000 courses, 8,6 s de boucle
   * d'événements bloquée (mesuré au test de charge) ; puis 100 ms à 200 000 courses.
   */
  page(filtre: { q?: string; teamId?: string; kycStatus?: string; jours?: number; perimetre?: ReadonlySet<string>; limite?: number } = {}): {
    lignes: LigneEquipage[]; total: number;
  } {
    const jours = filtre.jours ?? 30;
    const depuis = Date.now() - jours * JOUR;
    const depuisIso = new Date(depuis).toISOString();
    const q = filtre.q?.toLowerCase().trim();

    const equipeDe = new Map<string, { id: string; name: string }>();
    for (const t of this.c.teams.list()) for (const id of t.driverIds) if (!equipeDe.has(id)) equipeDe.set(id, t);

    const retenus = this.c.drivers.list().filter((d) => {
      if (filtre.perimetre && !filtre.perimetre.has(d.id)) return false;
      if (filtre.kycStatus && d.kycStatus !== filtre.kycStatus) return false;
      if (filtre.teamId && equipeDe.get(d.id)?.id !== filtre.teamId) return false;
      if (!q) return true;
      // Le matricule est la clé d'entrée naturelle : c'est ce qui est écrit sur
      // le véhicule et ce que tout le monde cite au téléphone.
      return d.matricule.toLowerCase().includes(q)
        || d.name.toLowerCase().includes(q)
        || (d.phone ?? '').includes(q)
        || d.id.startsWith(q);
    });
    // Matricules ORION (« ORION-CI-104217 ») : le classement simple donne l'ordre attendu
    // et coûte dix fois moins que le classement linguistique.
    const ascii = retenus.every((d) => /^[\x20-\x7e]*$/.test(d.matricule));
    retenus.sort(ascii
      ? (a, b) => (a.matricule < b.matricule ? -1 : a.matricule > b.matricule ? 1 : 0)
      : (a, b) => ORDRE.compare(a.matricule, b.matricule));
    const page = filtre.limite === undefined ? retenus : retenus.slice(0, filtre.limite);

    const ouvertesDe = new Map<string, number>();
    for (const r of this.c.crewRequests.list()) {
      if (r.statut === 'cloturee' || r.statut === 'refusee') continue;
      ouvertesDe.set(r.driverId, (ouvertesDe.get(r.driverId) ?? 0) + 1);
    }

    const lignes = page.map((d) => {
      const equipe = equipeDe.get(d.id);
      // Courses de la période : l'index du chauffeur est rangé du plus récent au plus
      // ancien, la lecture s'arrête à la première course trop ancienne.
      let courses = 0;
      for (const r of this.c.rides.listByDriver(d.id)) {
        if (r.createdAt < depuisIso) break;
        if (REVENUS.has(r.status)) courses += 1;
      }
      let revenus = 0;
      // Dates ISO : comparaison directe, sans analyser chaque date.
      for (const e of this.c.wallet.ecritures(d.id)) if (e.type === 'ride_earning' && e.at >= depuisIso) revenus += e.amount;
      return {
        driverId: d.id,
        matricule: d.matricule,
        name: d.name,
        phone: d.phone ?? null,
        category: d.category,
        kycStatus: d.kycStatus,
        availability: d.availability,
        rating: d.ratingAvg,
        teamId: equipe?.id,
        teamName: equipe?.name,
        courses,
        revenus: Math.round(revenus),
        solde: this.c.wallet.balance(d.id),
        resteDu: this.c.crewRequests.resteDu(d.id),
        requetesOuvertes: ouvertesDe.get(d.id) ?? 0,
        aUnAcces: Boolean(this.c.accounts.parChauffeur(d.id)),
      };
    });
    return { lignes, total: retenus.length };
  }

  /** Le dossier complet d'un chauffeur, agrégé depuis tous les modules. */
  dossier(driverId: string, jours = 30): DossierEquipage | null {
    const d = this.c.drivers.get(driverId);
    if (!d) return null;
    const depuis = Date.now() - jours * JOUR;
    const equipe = this.equipeDe(d.id);
    const acces = this.c.accounts.parChauffeur(d.id);

    const sesCourses = this.c.rides.listByDriver(d.id);
    const periode = sesCourses.filter((r) => Date.parse(r.createdAt) >= depuis);
    const terminees = periode.filter((r) => REVENUS.has(r.status));
    const annulees = periode.filter((r) => r.status === 'cancelled' || r.status === 'no_driver');
    const kilometres = terminees.reduce((n, r) => n + (r.quote.distanceMeters ?? 0), 0) / 1000;
    const joursTravailles = new Set(terminees.map((r) => r.createdAt.slice(0, 10))).size;

    const ecritures = this.c.wallet.history(d.id);
    const surPeriode = ecritures.filter((e) => Date.parse(e.at) >= depuis);
    const revenus = surPeriode.filter((e) => e.type === 'ride_earning').reduce((n, e) => n + e.amount, 0);
    const commission = Math.abs(surPeriode.filter((e) => e.type === 'commission').reduce((n, e) => n + e.amount, 0));

    // La note n'est pas un champ de la course : elle est posée comme événement
    // `rated` au moment où le client note. On la relit là où elle est écrite.
    const etoilesDe = (r: { events?: Array<{ type: string; payload?: unknown }> }): number | undefined => {
      const e = r.events?.find((x) => x.type === 'rated');
      const stars = (e?.payload as { stars?: number } | undefined)?.stars;
      return typeof stars === 'number' ? stars : undefined;
    };
    const notes = terminees.map(etoilesDe).filter((n): n is number => n !== undefined);
    const noteMoyenne = notes.length
      ? Math.round((notes.reduce((n, v) => n + v, 0) / notes.length) * 10) / 10
      : d.ratingAvg;

    const detteEspeces = this.detteEspeces(d.id);
    const resteDu = this.c.crewRequests.resteDu(d.id);

    /* ------------------------- Points de vigilance ------------------------- */
    const alertes: DossierEquipage['alertes'] = [];
    if (d.insuranceExpiry && Date.parse(d.insuranceExpiry) < Date.now()) {
      alertes.push({ severite: 'critique', texte: `Assurance expirée depuis le ${d.insuranceExpiry} — le passager n’est pas couvert.` });
    }
    if (d.kycStatus !== 'active' && d.kycStatus !== 'approved' && d.availability !== 'offline') {
      alertes.push({ severite: 'eleve', texte: 'En service alors que son dossier KYC n’est pas validé.' });
    }
    const plafond = this.c.settings.getOps().cashDebtLimit ?? 0;
    if (plafond > 0 && detteEspeces > plafond) {
      alertes.push({ severite: 'eleve', texte: `Dette espèces de ${detteEspeces.toLocaleString('fr-FR')} F au-dessus du plafond (${plafond.toLocaleString('fr-FR')} F).` });
    }
    if (d.batteryPct !== undefined && d.batteryPct < 15 && d.availability !== 'offline') {
      alertes.push({ severite: 'moyen', texte: `Batterie à ${d.batteryPct} % alors qu’il est en service.` });
    }
    const retard = this.c.crewRequests.list({ driverId: d.id })
      .find((r) => r.plan?.some((e) => !e.payeeLe && Date.parse(e.dueDate) < Date.now()));
    if (retard) {
      alertes.push({ severite: 'moyen', texte: 'Échéance de prêt en retard — à régulariser avec la trésorerie.' });
    }

    return {
      identite: {
        driverId: d.id, matricule: d.matricule, name: d.name, phone: d.phone ?? null,
        category: d.category, kycStatus: d.kycStatus, availability: d.availability,
        rating: d.ratingAvg, trips: d.ratingCount,
        licenseNo: d.licenseNo, birthDate: d.birthDate, insuranceExpiry: d.insuranceExpiry,
        appLinkedAt: d.appLinkedAt,
        photoUrl: photoUrl(d), annulationsChauffeur: d.cancellations ?? 0,
      },
      vehicule: {
        model: d.vehicleModel, plate: d.vehiclePlate, color: d.vehicleColor,
        engine: d.engine ?? 'electric', batteryPct: d.batteryPct, batteryHealthPct: d.batteryHealthPct,
      },
      equipe: equipe
        ? { id: equipe.id, name: equipe.name, mission: equipe.mission, managerName: equipe.managerName, managerUsername: equipe.managerUsername }
        : null,
      acces: acces
        ? { username: acces.username, active: acces.active, lastLoginAt: acces.lastLoginAt, mustChangePassword: acces.mustChangePassword }
        : null,
      activite: {
        periodeJours: jours,
        courses: terminees.length,
        coursesAnnulees: annulees.length,
        kilometres: Math.round(kilometres),
        revenus: Math.round(revenus),
        commissionVersee: Math.round(commission),
        noteMoyenne,
        nbNotes: notes.length,
        joursTravailles,
      },
      argent: {
        solde: this.c.wallet.balance(d.id),
        detteEspeces,
        resteDu,
        dernieresEcritures: ecritures.slice(0, 15).map((e) => ({ at: e.at, type: e.type, amount: e.amount, note: e.note ?? '' })),
      },
      requetes: this.c.crewRequests.list({ driverId: d.id }).map((r) => ({
        ...r, typeLabel: TYPE_LABEL[r.type], statutLabel: STATUT_LABEL[r.statut],
      })),
      litiges: this.c.disputes.list()
        .filter((x) => sesCourses.some((r) => r.id === x.rideId))
        .map((x) => ({ id: x.id, kind: x.kind, status: x.status, createdAt: x.createdAt, description: x.description })),
      maintenance: this.c.staff.listTickets()
        .filter((t) => t.driverId === d.id)
        .map((t) => ({ id: t.id, kind: t.kind, title: t.title, status: t.status, dueDate: t.dueDate })),
      alertes,
      genereA: new Date().toISOString(),
    };
  }

  /** Tableau de bord de la session : volumes, requêtes en attente, points chauds. */
  tableau(jours = 30): {
    effectif: { total: number; enService: number; avecAcces: number; kycEnAttente: number };
    requetes: ReturnType<Container['crewRequests']['stats']>;
    attente: ReturnType<Container['crewRequests']['enAttente']>;
    encoursPrets: number;
    sansEquipe: number;
  } {
    const drivers = this.c.drivers.list();
    // Un ensemble des chauffeurs rattachés : une passe sur les équipes, pas une par chauffeur.
    const rattaches = new Set<string>();
    for (const t of this.c.teams.list()) for (const id of t.driverIds) rattaches.add(id);
    const sansEquipe = drivers.filter((d) => !rattaches.has(d.id)).length;
    const stats = this.c.crewRequests.stats();
    return {
      effectif: {
        total: drivers.length,
        enService: drivers.filter((d) => d.availability === 'online' || d.availability === 'on_trip').length,
        avecAcces: drivers.filter((d) => this.c.accounts.parChauffeur(d.id)).length,
        kycEnAttente: drivers.filter((d) => d.kycStatus !== 'active' && d.kycStatus !== 'approved' && d.kycStatus !== 'suspended').length,
      },
      requetes: stats,
      attente: this.c.crewRequests.enAttente(),
      encoursPrets: stats.encours,
      sansEquipe,
    };
  }
}
