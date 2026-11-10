import type { Container } from '../../container.js';
import { adminUsers } from '../admin/auth.js';

/**
 * DIRECTION GÉNÉRALE — poste de travail du PDG.
 *
 * Les chiffres d'ORION vivaient éclatés : les courses dans un module, le portefeuille
 * des chauffeurs dans un autre, les abonnements, les locations, les notes de frais,
 * les virements et les litiges chacun chez eux. Chaque session savait une partie, et
 * personne ne voyait le tout.
 *
 * Ce module ne stocke rien : il CONSOLIDE. Il parcourt les sources existantes et en
 * tire un GRAND LIVRE unique — chaque entrée et chaque sortie d'argent, avec sa
 * contrepartie et sa référence —, puis les agrégats qui en découlent. Aucune donnée
 * n'est recalculée « à peu près » : tout provient des mêmes enregistrements que les
 * autres sessions, afin que le PDG et le CFO ne lisent jamais deux vérités.
 */

export type Sens = 'entree' | 'sortie';

export type CategorieMouvement =
  | 'course' | 'livraison' | 'abonnement' | 'location' | 'entreprise'
  | 'reversement_chauffeur' | 'note_de_frais' | 'virement' | 'remboursement'
  | 'assurance';

/** Une ligne du grand livre consolidé. */
export interface Mouvement {
  id: string;
  at: string;
  sens: Sens;
  categorie: CategorieMouvement;
  libelle: string;
  /** Toujours positif : le sens porte le signe. */
  montant: number;
  /** Identifiant d'origine (course, facture, dossier, virement). */
  reference?: string;
  /** Qui est en face : client, chauffeur, société, employé. */
  contrepartie?: string;
  /** État au moment de la lecture (payée, en attente, approuvé…). */
  statut?: string;
  /**
   * L'argent a-t-il réellement transité par la caisse ORION ?
   *
   * Une course payée EN ESPÈCES est encaissée en main propre par le chauffeur : ORION
   * ne reçoit rien, le chauffeur lui doit la commission. Compter ces montants comme
   * des entrées gonflerait la trésorerie d'un argent qui n'est jamais arrivé.
   */
  enCaisse: boolean;
}

export interface ConsolidationFinanciere {
  currency: 'XOF';
  /** Volume d'affaires brut encaissé auprès des clients. */
  gmv: number;
  /** Ce qui revient réellement à ORION (commissions + frais + locations + abonnements). */
  revenu: number;
  entrees: number;
  sorties: number;
  /** Entrées moins sorties sur la période. */
  solde: number;
  /** Détail par catégorie, dans les deux sens. */
  parCategorie: Record<string, { entrees: number; sorties: number; nombre: number }>;
  /** Revenu récurrent mensuel des abonnements actifs. */
  mrr: number;
  /** TVA collectée pour l'État (à reverser — ce n'est pas du revenu). */
  tvaCollectee: number;
  /** Argent dû aux chauffeurs et pas encore versé. */
  dusChauffeurs: number;
  /** Encaissé en main propre par les chauffeurs (espèces) — jamais passé en caisse. */
  especesChauffeurs: number;
  /** Commissions que les chauffeurs doivent à ORION sur ces espèces. */
  dettesEspeces: number;
  /** Encours client des comptes entreprise (facturé, pas encore réglé). */
  encoursEntreprises: number;
  /** Factures d'abonnement émises et non réglées. */
  impayesAbonnements: number;
}

/** Ce qui attend une décision de la direction. */
export interface DecisionEnAttente {
  id: string;
  type: 'virement' | 'note_de_frais' | 'litige' | 'impaye' | 'tarif' | 'securite';
  libelle: string;
  montant?: number;
  /** Plus le nombre est petit, plus c'est urgent. */
  priorite: number;
  depuis: string;
  /** Section de la console où le traiter. */
  section: string;
  reference?: string;
}

/** Un signal qui demande l'attention du PDG. */
export interface AlerteDirection {
  id: string;
  gravite: 'critique' | 'attention' | 'info';
  titre: string;
  detail: string;
  section?: string;
}

const jour = (iso: string) => iso.slice(0, 10);
const debutDe = (jours: number) => Date.now() - jours * 86_400_000;

export class ExecutiveService {
  constructor(private readonly c: Container) {}

  /**
   * GRAND LIVRE : tous les mouvements d'argent de la plateforme, toutes sources
   * confondues, du plus récent au plus ancien.
   */
  grandLivre(options: { depuisJours?: number; sens?: Sens; categorie?: CategorieMouvement } = {}): Mouvement[] {
    const seuil = options.depuisJours ? debutDe(options.depuisJours) : 0;
    const m: Mouvement[] = [];

    /* --- ENTRÉES : ce que les clients paient --- */
    for (const r of this.c.rides.listAll()) {
      if (r.status !== 'paid' && r.status !== 'rated') continue;
      const paiement = r.events.find((e) => e.type === 'paid');
      const at = paiement?.at ?? r.createdAt;
      if (Date.parse(at) < seuil) continue;
      // Montant réellement encaissé : la part prise en charge par un abonnement ORION
      // n'entre pas en caisse, c'est un effort commercial.
      const prisEnCharge = (r.subscription?.montantCouvert ?? 0) + (r.subscription?.remise ?? 0);
      const encaisse = Math.max(0, r.quote.amount - prisEnCharge);
      if (encaisse > 0) {
        const especes = r.paymentMethod === 'cash';
        m.push({
          id: `ride-${r.id}`, at, sens: 'entree',
          categorie: r.serviceType === 'delivery' ? 'livraison' : 'course',
          libelle: especes
            ? (r.serviceType === 'delivery' ? 'Livraison payée en espèces (au coursier)' : 'Course payée en espèces (au chauffeur)')
            : (r.serviceType === 'delivery' ? 'Livraison payée' : 'Course payée'),
          montant: encaisse, reference: r.id, contrepartie: r.clientId,
          statut: r.paymentMethod ?? 'payée',
          enCaisse: !especes,
        });
      }
    }

    for (const f of this.c.subscriptions.factures('payee')) {
      if (Date.parse(f.payeeLe ?? f.emiseLe) < seuil) continue;
      m.push({
        id: `sub-${f.id}`, at: f.payeeLe ?? f.emiseLe, sens: 'entree', categorie: 'abonnement',
        libelle: `Abonnement ${f.plan} encaissé`, montant: f.amount,
        reference: f.id, contrepartie: f.userId, statut: f.method ?? 'réglée', enCaisse: true,
      });
    }

    for (const l of this.c.rental.list()) {
      if (l.status === 'annulee' || l.status === 'devis') continue;
      if (Date.parse(l.createdAt) < seuil) continue;
      m.push({
        id: `loc-${l.id}`, at: l.createdAt, sens: 'entree', categorie: 'location',
        libelle: `Location ${l.vehicle.name}`, montant: l.total,
        reference: l.id, contrepartie: l.societe?.nom ?? l.contact?.nom ?? l.userId,
        statut: l.status, enCaisse: true,
      });
    }

    /* --- SORTIES : ce qui quitte la caisse --- */
    for (const e of this.c.wallet.allEntries()) {
      if (Date.parse(e.at) < seuil) continue;
      const nom = this.c.drivers.get(e.driverId)?.name ?? e.driverId;
      if (e.type === 'payout') {
        m.push({
          id: `pay-${e.id}`, at: e.at, sens: 'sortie', categorie: 'reversement_chauffeur',
          libelle: 'Retrait chauffeur', montant: Math.abs(e.amount),
          reference: e.rideId, contrepartie: nom, statut: 'versé', enCaisse: true,
        });
      }
    }

    for (const t of this.c.treasury.list()) {
      if (t.status !== 'approved') continue;
      const at = t.executedAt ?? t.decidedAt ?? t.createdAt;
      if (Date.parse(at) < seuil) continue;
      m.push({
        id: `vir-${t.id}`, at, sens: 'sortie', categorie: 'virement',
        libelle: `Virement — ${t.reason}`, montant: t.amount,
        reference: t.id, contrepartie: t.destination, statut: `approuvé par ${t.decidedBy ?? '—'}`, enCaisse: true,
      });
    }

    for (const t of this.c.expenses.list()) {
      if (!t.cashOut) continue;
      if (Date.parse(t.cashOut.at) < seuil) continue;
      m.push({
        id: `ndf-${t.id}`, at: t.cashOut.at, sens: 'sortie', categorie: 'note_de_frais',
        libelle: `Note de frais — ${t.category}`, montant: t.cashOut.amount,
        reference: t.id, contrepartie: t.requesterName, statut: t.cashOut.channel, enCaisse: true,
      });
      // Le reliquat rendu revient en caisse : c'est une entrée, pas une sortie négative.
      if (t.refunded && t.refunded > 0) {
        m.push({
          id: `ndf-r-${t.id}`, at: t.cashOut.at, sens: 'entree', categorie: 'note_de_frais',
          libelle: 'Reliquat de note de frais rendu', montant: t.refunded,
          reference: t.id, contrepartie: t.requesterName, statut: 'rendu', enCaisse: true,
        });
      }
    }

    for (const d of this.c.disputes.list()) {
      if (d.status !== 'resolved' || !d.refund) continue;
      const at = d.decidedAt ?? d.createdAt;
      if (Date.parse(at) < seuil) continue;
      m.push({
        id: `lit-${d.id}`, at, sens: 'sortie', categorie: 'remboursement',
        libelle: `Remboursement litige — ${d.kind}`, montant: d.refund,
        reference: d.rideId, contrepartie: d.clientId, statut: `décidé par ${d.decidedBy ?? '—'}`, enCaisse: true,
      });
    }

    return m
      .filter((x) => (!options.sens || x.sens === options.sens) && (!options.categorie || x.categorie === options.categorie))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Agrégats financiers consolidés sur la période demandée. */
  consolidation(depuisJours = 30): ConsolidationFinanciere {
    const mouvements = this.grandLivre({ depuisJours });
    const parCategorie: ConsolidationFinanciere['parCategorie'] = {};
    let entrees = 0;
    let sorties = 0;
    let especesChauffeurs = 0;
    for (const x of mouvements) {
      const c = (parCategorie[x.categorie] ??= { entrees: 0, sorties: 0, nombre: 0 });
      c.nombre += 1;
      if (x.sens === 'entree') {
        c.entrees += x.montant;
        // Les espèces encaissées par le chauffeur ne sont jamais entrées en caisse.
        if (x.enCaisse) entrees += x.montant; else especesChauffeurs += x.montant;
      } else {
        sorties += x.montant; c.sorties += x.montant;
      }
    }

    // GMV et revenu plateforme : repris du module Finances pour qu'aucune session ne
    // montre un chiffre différent d'une autre.
    const seuil = debutDe(depuisJours);
    let gmv = 0;
    let tvaCollectee = 0;
    let commission = 0;
    for (const r of this.c.rides.listAll()) {
      if (r.status !== 'paid' && r.status !== 'rated') continue;
      if (Date.parse(r.createdAt) < seuil) continue;
      gmv += r.quote.amount;
      tvaCollectee += r.quote.breakdown.tva ?? 0;
      commission += r.quote.breakdown.fee ?? 0;
    }

    const caLocation = parCategorie['location']?.entrees ?? 0;
    const caAbonnement = parCategorie['abonnement']?.entrees ?? 0;
    const subStats = this.c.subscriptions.stats();

    // Dû aux chauffeurs : somme des soldes positifs non encore retirés.
    let dusChauffeurs = 0;
    let dettesEspeces = 0;
    for (const d of this.c.drivers.list()) {
      const solde = this.c.wallet.balance(d.id);
      if (solde > 0) dusChauffeurs += solde;
      else dettesEspeces += Math.abs(solde); // commission due sur les espèces encaissées
    }

    const encoursEntreprises = this.c.corporate.list().reduce((n, a) => n + a.balanceUsed, 0);

    return {
      currency: 'XOF',
      gmv,
      revenu: commission + caLocation + caAbonnement,
      entrees, sorties, solde: entrees - sorties,
      parCategorie,
      mrr: subStats.mrr,
      tvaCollectee,
      dusChauffeurs,
      especesChauffeurs,
      dettesEspeces,
      encoursEntreprises,
      impayesAbonnements: subStats.montantImpaye,
    };
  }

  /** Série quotidienne entrées / sorties — le pouls de la trésorerie. */
  serie(jours = 30): Array<{ date: string; entrees: number; sorties: number; solde: number }> {
    const parJour = new Map<string, { entrees: number; sorties: number }>();
    for (let i = jours - 1; i >= 0; i -= 1) {
      parJour.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), { entrees: 0, sorties: 0 });
    }
    for (const m of this.grandLivre({ depuisJours: jours })) {
      const d = parJour.get(jour(m.at));
      if (!d) continue;
      if (m.sens === 'entree') { if (m.enCaisse) d.entrees += m.montant; } else d.sorties += m.montant;
    }
    return [...parJour.entries()].map(([date, v]) => ({ date, ...v, solde: v.entrees - v.sorties }));
  }

  /**
   * CE QUI ATTEND UNE DÉCISION. Le PDG ouvre sa session et voit immédiatement ce qui
   * est bloqué sur lui, trié par urgence — pas une liste de chiffres à interpréter.
   */
  decisions(): DecisionEnAttente[] {
    const out: DecisionEnAttente[] = [];

    for (const t of this.c.treasury.list()) {
      if (t.status !== 'pending') continue;
      out.push({
        id: t.id, type: 'virement', priorite: 1,
        libelle: `Virement à approuver — ${t.reason} (demandé par ${t.requestedBy})`,
        montant: t.amount, depuis: t.createdAt, section: 'treasury', reference: t.id,
      });
    }

    for (const t of this.c.expenses.list()) {
      if (t.status !== 'pending') continue;
      out.push({
        id: t.id, type: 'note_de_frais', priorite: t.amount >= 200_000 ? 2 : 4,
        libelle: `Note de frais — ${t.requesterName} · ${t.category}`,
        montant: t.amount, depuis: t.createdAt, section: 'finance', reference: t.id,
      });
    }

    for (const d of this.c.disputes.list()) {
      if (d.status === 'resolved' || d.status === 'rejected') continue;
      if (!d.escalation) continue; // seules les escalades remontent à la direction
      out.push({
        id: d.id, type: 'litige', priorite: 2,
        libelle: `Litige escaladé — ${d.kind} (${d.escalation})`,
        montant: d.refund, depuis: d.createdAt, section: 'disputes', reference: d.id,
      });
    }

    const impayees = this.c.subscriptions.factures('echouee');
    if (impayees.length > 0) {
      out.push({
        id: 'impayes-abonnements', type: 'impaye', priorite: 3,
        libelle: `${impayees.length} facture(s) d’abonnement en échec de prélèvement`,
        montant: impayees.reduce((n, f) => n + f.amount, 0),
        depuis: impayees[impayees.length - 1]!.emiseLe, section: 'subscriptions',
      });
    }

    const attaques = this.c.security.list();
    if (attaques.length > 0) {
      out.push({
        id: 'securite', type: 'securite', priorite: 1,
        libelle: `${attaques.length} tentative(s) d’accès non autorisé à signaler`,
        depuis: attaques[0]!.at, section: 'security',
      });
    }

    return out.sort((a, b) => a.priorite - b.priorite || Date.parse(a.depuis) - Date.parse(b.depuis));
  }

  /** Signaux à surveiller — formulés en clair, avec la section où agir. */
  alertes(): AlerteDirection[] {
    const out: AlerteDirection[] = [];
    const cons = this.consolidation(30);

    if (cons.solde < 0) {
      out.push({
        id: 'solde-negatif', gravite: 'critique',
        titre: 'Les sorties dépassent les entrées sur 30 jours',
        detail: `Solde : ${cons.solde.toLocaleString('fr-FR')} F. Vérifier les reversements chauffeurs et les virements approuvés.`,
        section: 'treasury',
      });
    }

    if (cons.impayesAbonnements > 0) {
      out.push({
        id: 'impayes', gravite: 'attention',
        titre: 'Cotisations d’abonnement impayées',
        detail: `${cons.impayesAbonnements.toLocaleString('fr-FR')} F non encaissés. Relancer ou suspendre.`,
        section: 'subscriptions',
      });
    }

    if (cons.dusChauffeurs > cons.entrees && cons.entrees > 0) {
      out.push({
        id: 'dus-chauffeurs', gravite: 'critique',
        titre: 'Les sommes dues aux chauffeurs dépassent les entrées du mois',
        detail: `${cons.dusChauffeurs.toLocaleString('fr-FR')} F dus. La couverture des retraits doit être vérifiée.`,
        section: 'treasury',
      });
    }

    if (cons.encoursEntreprises > 0) {
      out.push({
        id: 'encours-b2b', gravite: 'info',
        titre: 'Encours des comptes entreprise',
        detail: `${cons.encoursEntreprises.toLocaleString('fr-FR')} F consommés et non encore réglés.`,
        section: 'b2b',
      });
    }

    const securite = this.c.security.count();
    if (securite > 0) {
      out.push({
        id: 'securite', gravite: 'attention',
        titre: 'Tentatives d’accès non autorisé',
        detail: `${securite} tentative(s) signalée(s) à la direction (DG, CFO, DAA).`,
        section: 'security',
      });
    }

    const ferme = !this.c.settings.getServices().open;
    if (ferme) {
      out.push({
        id: 'maintenance', gravite: 'critique',
        titre: 'ORION est actuellement FERMÉ',
        detail: 'Aucune commande n’est acceptée. Maintenance activée depuis la session Services & ville.',
        section: 'services',
      });
    }

    return out;
  }

  /** Décisions récentes des directeurs : qui a changé quoi (journal d'audit filtré). */
  decisionsRecentes(limit = 40): Array<{ at: string; actor: string; role: string; action: string; details?: Record<string, unknown> }> {
    const SENSIBLES = [
      'pricing', 'rental.tarifs', 'dispatch', 'zones', 'promos', 'services',
      'treasury', 'expense', 'subscription', 'driver.suspend', 'client.blacklist',
    ];
    return this.c.audit.list(300)
      .filter((e) => SENSIBLES.some((s) => e.action.startsWith(s)))
      .slice(0, limit)
      .map((e) => ({ at: e.at, actor: e.actor, role: e.role, action: e.action, details: e.details }));
  }

  /** Tableau de bord complet du PDG, en un seul appel. */
  tableauDeBord(jours = 30): {
    consolidation: ConsolidationFinanciere;
    serie: ReturnType<ExecutiveService['serie']>;
    decisions: DecisionEnAttente[];
    alertes: AlerteDirection[];
    recentes: ReturnType<ExecutiveService['decisionsRecentes']>;
    effectif: { employes: number; chauffeurs: number; chauffeursEnLigne: number; clients: number; abonnes: number };
    generatedAt: string;
  } {
    const drivers = this.c.drivers.list();
    // Effectif interne : les comptes de la console (employés ORION), pas les chauffeurs.
    const employes = adminUsers().length;
    return {
      consolidation: this.consolidation(jours),
      serie: this.serie(Math.min(jours, 90)),
      decisions: this.decisions(),
      alertes: this.alertes(),
      recentes: this.decisionsRecentes(),
      effectif: {
        employes,
        chauffeurs: drivers.length,
        chauffeursEnLigne: drivers.filter((d) => d.availability === 'online' || d.availability === 'on_trip').length,
        clients: this.c.clients.list().length,
        abonnes: this.c.subscriptions.stats().actifs,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
