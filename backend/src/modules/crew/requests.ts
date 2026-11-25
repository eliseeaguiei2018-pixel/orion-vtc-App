import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * REQUÊTES CHAUFFEUR — ce qu'un chauffeur ORION demande à son entreprise.
 *
 * Un chauffeur a des besoins que personne d'autre ne peut formuler à sa place :
 * une avance avant la rentrée scolaire, un prêt pour une réparation, un jour de
 * congé, un pneu à remplacer, une contestation de commission. Jusqu'ici tout cela
 * se réglait par téléphone avec « quelqu'un qui connaît quelqu'un » : aucune trace,
 * aucune équité, et une demande oubliée n'existait tout simplement plus.
 *
 * CHAÎNE DE DÉCISION, volontairement courte mais tracée :
 *   déposée → instruite par le chef d'équipe (avis motivé)
 *           → décidée par la direction financière (accord / refus)
 *           → versée par la trésorerie (pour ce qui coûte de l'argent)
 *           → clôturée
 *
 * Un prêt n'est pas un don : il porte un échéancier, et le remboursement se prélève
 * sur les revenus du chauffeur. Le montant restant dû est suivi ici, pas dans la
 * tête du comptable.
 */

export type TypeRequete =
  | 'pret'          // prêt remboursable sur plusieurs échéances
  | 'avance'        // avance sur revenus, retenue en une fois
  | 'conge'         // jours de repos
  | 'materiel'      // équipement : chargeur, siège enfant, gilet, téléphone
  | 'reparation'    // panne ou entretien à la charge d'ORION
  | 'reclamation'   // contestation : commission, course, note, sanction
  | 'document';     // attestation de travail, relevé de revenus, contrat

export type StatutRequete =
  | 'deposee'
  | 'instruite'     // avis du chef d'équipe rendu
  | 'accordee'
  | 'refusee'
  | 'versee'        // argent effectivement remis (prêt, avance, réparation)
  | 'cloturee';

export interface EcheancePret {
  numero: number;
  montant: number;
  dueDate: string;
  payeeLe?: string;
}

export interface RequeteChauffeur {
  id: string;
  driverId: string;
  driverName: string;
  matricule: string;
  type: TypeRequete;
  /** Montant demandé (prêt, avance, réparation) ; absent pour un congé ou un document. */
  montant?: number;
  /** Nombre d'échéances souhaité pour un prêt. */
  echeances?: number;
  /** Dates demandées pour un congé. */
  du?: string;
  au?: string;
  motif: string;
  statut: StatutRequete;
  createdAt: string;
  /** Équipe du chauffeur au moment du dépôt — c'est son chef qui instruit. */
  teamId?: string;

  /* --- Instruction par le chef d'équipe --- */
  avis?: 'favorable' | 'defavorable';
  avisPar?: string;
  avisNote?: string;
  avisAt?: string;

  /* --- Décision financière --- */
  decidePar?: string;
  decisionNote?: string;
  decideAt?: string;
  /** Montant réellement accordé, parfois inférieur au montant demandé. */
  montantAccorde?: number;

  /* --- Versement par la trésorerie --- */
  verseLe?: string;
  versePar?: string;
  canalVersement?: string;

  /* --- Remboursement (prêt / avance) --- */
  plan?: EcheancePret[];
  rembourse?: number;

  clotureLe?: string;
}

/** Plafonds : au-delà, la direction générale doit trancher elle-même. */
export const PLAFOND_AVANCE = 150_000;
export const PLAFOND_PRET = 1_000_000;
export const MAX_ECHEANCES = 12;

export const TYPE_LABEL: Record<TypeRequete, string> = {
  pret: 'Prêt', avance: 'Avance sur revenus', conge: 'Congé', materiel: 'Matériel',
  reparation: 'Réparation', reclamation: 'Réclamation', document: 'Document administratif',
};

export const STATUT_LABEL: Record<StatutRequete, string> = {
  deposee: 'Déposée', instruite: 'Instruite par le chef d’équipe', accordee: 'Accordée',
  refusee: 'Refusée', versee: 'Versée', cloturee: 'Clôturée',
};

/** Une requête prête à l'affichage : les codes internes sont déjà traduits. */
export type RequeteAffichable = RequeteChauffeur & { typeLabel: string; statutLabel: string };

/** Types qui engagent de l'argent et passent donc par la trésorerie. */
export const TYPES_FINANCIERS: TypeRequete[] = ['pret', 'avance', 'reparation', 'materiel'];

/** Construit l'échéancier d'un prêt : parts égales, le reste sur la première. */
export function construirePlan(montant: number, nombre: number, debut = new Date()): EcheancePret[] {
  const n = Math.max(1, Math.min(MAX_ECHEANCES, Math.round(nombre)));
  const base = Math.floor(montant / n);
  const reste = montant - base * n;
  const plan: EcheancePret[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(debut);
    d.setMonth(d.getMonth() + i + 1);
    plan.push({
      numero: i + 1,
      montant: i === 0 ? base + reste : base,
      dueDate: d.toISOString().slice(0, 10),
    });
  }
  return plan;
}

export class CrewRequestService {
  private readonly requetes = new Map<string, RequeteChauffeur>();
  private readonly ecouteurs: Array<(r: RequeteChauffeur, evenement: string) => void> = [];

  constructor(private readonly repo?: Repository<RequeteChauffeur>) {
    for (const r of repo?.all() ?? []) this.requetes.set(r.id, r);
  }

  /** Branchement temps réel : chaque changement part vers les sessions concernées. */
  onChange(fn: (r: RequeteChauffeur, evenement: string) => void): void { this.ecouteurs.push(fn); }

  private sauver(r: RequeteChauffeur, evenement: string): RequeteChauffeur {
    this.requetes.set(r.id, r);
    this.repo?.put(r);
    for (const fn of this.ecouteurs) fn(r, evenement);
    return r;
  }

  deposer(input: {
    driverId: string; driverName: string; matricule: string; teamId?: string;
    type: TypeRequete; montant?: number; echeances?: number;
    du?: string; au?: string; motif: string;
  }): RequeteChauffeur | 'montant_requis' | 'plafond_depasse' | 'doublon' {
    const financiere = TYPES_FINANCIERS.includes(input.type);
    if (financiere && (!input.montant || input.montant <= 0)) return 'montant_requis';
    if (input.type === 'avance' && (input.montant ?? 0) > PLAFOND_AVANCE) return 'plafond_depasse';
    if (input.type === 'pret' && (input.montant ?? 0) > PLAFOND_PRET) return 'plafond_depasse';

    // Un chauffeur ne cumule pas deux prêts en cours : on ne prête pas à quelqu'un
    // pour qu'il rembourse le prêt précédent.
    if (input.type === 'pret' && this.pretEnCours(input.driverId)) return 'doublon';

    const r: RequeteChauffeur = {
      id: randomUUID().slice(0, 8),
      driverId: input.driverId,
      driverName: input.driverName,
      matricule: input.matricule,
      teamId: input.teamId,
      type: input.type,
      montant: input.montant ? Math.round(input.montant) : undefined,
      echeances: input.type === 'pret' ? Math.max(1, Math.min(MAX_ECHEANCES, input.echeances ?? 3)) : undefined,
      du: input.du,
      au: input.au,
      motif: input.motif,
      statut: 'deposee',
      createdAt: new Date().toISOString(),
    };
    return this.sauver(r, 'depot');
  }

  /** Avis motivé du chef d'équipe : il connaît l'homme, pas seulement le dossier. */
  instruire(id: string, avis: 'favorable' | 'defavorable', par: string, note?: string): RequeteChauffeur | 'deja_decidee' | null {
    const r = this.requetes.get(id);
    if (!r) return null;
    if (r.statut !== 'deposee' && r.statut !== 'instruite') return 'deja_decidee';
    r.avis = avis;
    r.avisPar = par;
    r.avisNote = note;
    r.avisAt = new Date().toISOString();
    r.statut = 'instruite';
    return this.sauver(r, 'instruction');
  }

  /**
   * Décision financière. Le montant accordé peut être inférieur au montant demandé :
   * refuser en bloc une demande de 300 000 F quand on peut en accorder 150 000 est
   * une réponse administrative, pas une décision.
   */
  decider(id: string, decision: 'accord' | 'refus', par: string, options: { note?: string; montantAccorde?: number } = {}):
  RequeteChauffeur | 'deja_versee' | null {
    const r = this.requetes.get(id);
    if (!r) return null;
    if (r.statut === 'versee' || r.statut === 'cloturee') return 'deja_versee';
    r.decidePar = par;
    r.decisionNote = options.note;
    r.decideAt = new Date().toISOString();
    if (decision === 'refus') {
      r.statut = 'refusee';
      return this.sauver(r, 'refus');
    }
    r.statut = 'accordee';
    r.montantAccorde = options.montantAccorde !== undefined
      ? Math.max(0, Math.round(options.montantAccorde))
      : r.montant;
    if (r.type === 'pret' && r.montantAccorde) {
      r.plan = construirePlan(r.montantAccorde, r.echeances ?? 3);
      r.rembourse = 0;
    }
    // Rien à verser (congé, document, réclamation) : le dossier se clôt tout seul.
    if (!TYPES_FINANCIERS.includes(r.type)) {
      r.statut = 'cloturee';
      r.clotureLe = r.decideAt;
    }
    return this.sauver(r, 'accord');
  }

  /** Versement effectif par la trésorerie — c'est là que l'argent sort vraiment. */
  verser(id: string, par: string, canal: string): RequeteChauffeur | 'non_accordee' | null {
    const r = this.requetes.get(id);
    if (!r) return null;
    if (r.statut !== 'accordee') return 'non_accordee';
    r.statut = 'versee';
    r.verseLe = new Date().toISOString();
    r.versePar = par;
    r.canalVersement = canal;
    return this.sauver(r, 'versement');
  }

  /** Remboursement : impute sur les échéances les plus anciennes d'abord. */
  rembourser(id: string, montant: number): RequeteChauffeur | null {
    const r = this.requetes.get(id);
    if (!r || !r.plan) return null;
    let reste = Math.max(0, Math.round(montant));
    const maintenant = new Date().toISOString();
    for (const e of r.plan) {
      if (e.payeeLe || reste <= 0) continue;
      if (reste >= e.montant) { e.payeeLe = maintenant; reste -= e.montant; }
    }
    r.rembourse = r.plan.filter((e) => e.payeeLe).reduce((n, e) => n + e.montant, 0);
    if (r.plan.every((e) => e.payeeLe)) {
      r.statut = 'cloturee';
      r.clotureLe = maintenant;
    }
    return this.sauver(r, 'remboursement');
  }

  cloturer(id: string): RequeteChauffeur | null {
    const r = this.requetes.get(id);
    if (!r) return null;
    r.statut = 'cloturee';
    r.clotureLe = new Date().toISOString();
    return this.sauver(r, 'cloture');
  }

  get(id: string): RequeteChauffeur | undefined { return this.requetes.get(id); }

  /** Un prêt non soldé bloque un nouveau prêt. */
  pretEnCours(driverId: string): RequeteChauffeur | undefined {
    for (const r of this.requetes.values()) {
      if (r.driverId !== driverId || r.type !== 'pret') continue;
      if (r.statut === 'accordee' || r.statut === 'versee') return r;
    }
    return undefined;
  }

  /** Reste dû par un chauffeur, tous prêts et avances confondus. */
  resteDu(driverId: string): number {
    let total = 0;
    for (const r of this.requetes.values()) {
      if (r.driverId !== driverId || r.statut !== 'versee') continue;
      const accorde = r.montantAccorde ?? r.montant ?? 0;
      total += Math.max(0, accorde - (r.rembourse ?? 0));
    }
    return total;
  }

  list(filtre: { driverId?: string; teamId?: string; statut?: StatutRequete; type?: TypeRequete } = {}): RequeteChauffeur[] {
    return [...this.requetes.values()]
      .filter((r) => (!filtre.driverId || r.driverId === filtre.driverId)
        && (!filtre.teamId || r.teamId === filtre.teamId)
        && (!filtre.statut || r.statut === filtre.statut)
        && (!filtre.type || r.type === filtre.type))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  /**
   * Ce qui attend un geste : le chef instruit, la finance décide, la caisse verse.
   * Les libellés sont joints : sans eux, la file de triage n'affiche pas le TYPE
   * de la demande, et l'on ne distingue plus un prêt d'une demande de congé.
   */
  enAttente(): {
    aInstruire: RequeteAffichable[]; aDecider: RequeteAffichable[]; aVerser: RequeteAffichable[];
  } {
    const habiller = (r: RequeteChauffeur): RequeteAffichable =>
      ({ ...r, typeLabel: TYPE_LABEL[r.type], statutLabel: STATUT_LABEL[r.statut] });
    return {
      aInstruire: this.list({ statut: 'deposee' }).map(habiller),
      aDecider: this.list({ statut: 'instruite' }).map(habiller),
      aVerser: this.list({ statut: 'accordee' }).filter((r) => TYPES_FINANCIERS.includes(r.type)).map(habiller),
    };
  }

  stats(): {
    total: number; parStatut: Record<string, number>; parType: Record<string, number>;
    encours: number; verseeCeMois: number; delaiMoyenHeures: number;
  } {
    const parStatut: Record<string, number> = {};
    const parType: Record<string, number> = {};
    let encours = 0;
    let verseeCeMois = 0;
    let sommeDelais = 0;
    let nbDecidees = 0;
    const debutMois = new Date();
    debutMois.setDate(1);
    debutMois.setHours(0, 0, 0, 0);

    for (const r of this.requetes.values()) {
      parStatut[r.statut] = (parStatut[r.statut] ?? 0) + 1;
      parType[r.type] = (parType[r.type] ?? 0) + 1;
      if (r.statut === 'versee') {
        encours += Math.max(0, (r.montantAccorde ?? r.montant ?? 0) - (r.rembourse ?? 0));
        if (r.verseLe && Date.parse(r.verseLe) >= debutMois.getTime()) {
          verseeCeMois += r.montantAccorde ?? r.montant ?? 0;
        }
      }
      if (r.decideAt) {
        sommeDelais += Date.parse(r.decideAt) - Date.parse(r.createdAt);
        nbDecidees += 1;
      }
    }
    return {
      total: this.requetes.size, parStatut, parType, encours, verseeCeMois,
      delaiMoyenHeures: nbDecidees ? Math.round(sommeDelais / nbDecidees / 3_600_000) : 0,
    };
  }
}
