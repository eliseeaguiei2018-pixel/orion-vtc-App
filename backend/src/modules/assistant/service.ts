import type { Container } from '../../container.js';

/**
 * ASSISTANT ORION — interroge les données de la plateforme en français.
 *
 * Ce qui existait s'annonçait comme un « copilote génératif » et tenait en trois
 * expressions régulières : trois questions comprises, tout le reste renvoyé à un
 * « reformulez ». Une promesse non tenue affichée à des employés est pire qu'une
 * absence de fonctionnalité — on cesse d'essayer, puis on cesse d'y croire.
 *
 * Ce module est honnête sur ce qu'il est : un MOTEUR DE QUESTIONS déterministe sur
 * les données réelles. Il ne rédige rien d'inventé, ne devine pas, et quand il ne
 * comprend pas il dit exactement ce qu'il sait répondre. Aucun modèle de langage
 * n'intervient — brancher un vrai assistant conversationnel demanderait une clé
 * d'API externe, et se ferait derrière cette même interface.
 */

export interface Periode {
  /** Libellé affiché dans la réponse (« sur les 7 derniers jours »). */
  label: string;
  depuis: number;
  jours: number;
}

export interface ReponseAssistant {
  question: string;
  /** Réponse en français, chiffrée. */
  reponse: string;
  /** Données brutes pour un graphique ou un export. */
  data: unknown;
  /** Sessions de la console où creuser. */
  sources: string[];
  /** Vrai si la question n'a pas été comprise. */
  incompris?: boolean;
}

const JOUR = 86_400_000;
const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
const pct = (n: number) => `${Math.round(n * 100)} %`;

/**
 * Met la question à plat avant de la lire : minuscules, accents retirés, apostrophe
 * typographique ramenée à l'apostrophe simple, espaces normalisés.
 *
 * Sans cela, « électrique » tapé sans accent n'était pas reconnu, et « qu’est-ce »
 * (apostrophe du clavier français) ne correspondait pas à « qu'est-ce » écrit dans la
 * règle. Un employé pressé ne doit pas avoir à deviner l'orthographe attendue.
 */
export function normaliser(q: string): string {
  return q
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019\u02bc`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Repère la période demandée ; 30 jours par défaut. */
export function lirePeriode(q: string): Periode {
  const s = normaliser(q);
  if (/aujourd|ce jour|today/.test(s)) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return { label: 'aujourd’hui', depuis: d.getTime(), jours: 1 };
  }
  if (/hier/.test(s)) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return { label: 'hier', depuis: d.getTime() - JOUR, jours: 1 };
  }
  if (/semaine|\b7\b|sept jours/.test(s)) return { label: 'sur les 7 derniers jours', depuis: Date.now() - 7 * JOUR, jours: 7 };
  if (/trimestre|\b90\b/.test(s)) return { label: 'sur les 90 derniers jours', depuis: Date.now() - 90 * JOUR, jours: 90 };
  if (/\bannee\b|\ban\b|\b365\b|12 derniers mois/.test(s)) return { label: 'sur les 12 derniers mois', depuis: Date.now() - 365 * JOUR, jours: 365 };
  return { label: 'sur les 30 derniers jours', depuis: Date.now() - 30 * JOUR, jours: 30 };
}

/** Un sujet que l'assistant sait traiter. */
interface Sujet {
  id: string;
  /** Mots qui désignent ce sujet. Plus il y en a, plus le score est élevé. */
  mots: RegExp[];
  /** Mots qui EXCLUENT ce sujet (lève les ambiguïtés : « CA des locations »). */
  sauf?: RegExp[];
  exemple: string;
  repondre: (c: Container, p: Periode, q: string) => Promise<ReponseAssistant> | ReponseAssistant;
}

export class AssistantService {
  constructor(private readonly c: Container) {}

  /** Ce que l'assistant sait répondre — affiché quand il ne comprend pas. */
  sujets(): Array<{ id: string; exemple: string }> {
    return SUJETS.map((s) => ({ id: s.id, exemple: s.exemple }));
  }

  async repondre(question: string): Promise<ReponseAssistant> {
    const q = normaliser(question);
    const periode = lirePeriode(question);

    // Score par sujet : on choisit le mieux couvert, pas le premier qui matche.
    // Sans cela, « chiffre d'affaires des locations » partait vers les finances.
    let meilleur: { sujet: Sujet; score: number } | null = null;
    for (const sujet of SUJETS) {
      if (sujet.sauf?.some((r) => r.test(q))) continue;
      const score = sujet.mots.reduce((n, r) => n + (r.test(q) ? 1 : 0), 0);
      if (score > 0 && (!meilleur || score > meilleur.score)) meilleur = { sujet, score };
    }

    if (!meilleur) {
      return {
        question,
        reponse: 'Je n’ai pas compris la question. Voici ce que je sais répondre, avec les données réelles de la plateforme :',
        data: this.sujets(),
        sources: [],
        incompris: true,
      };
    }
    return meilleur.sujet.repondre(this.c, periode, q);
  }
}

/* ------------------------------- Les sujets ------------------------------- */

const SUJETS: Sujet[] = [
  {
    id: 'sante',
    mots: [
      /sant[ée]/, /probl[èe]me/, /faille/, /qui ne va pas/, /vigilance/, /anomalie/,
      /[ée]tat (du|de la) (syst|plate)/, /va[- ]t[- ]elle bien/, /va bien/, /tout roule/, /se porte/,
    ],
    exemple: 'La plateforme va-t-elle bien ?',
    async repondre(c, _p, question) {
      const s = await c.vigilance.sante();
      const critiques = s.constats.filter((x) => x.severite === 'critique');
      const phrase = s.constats.length === 0
        ? 'Aucun constat : la plateforme est saine.'
        : `${s.constats.length} constat(s) : ${s.parSeverite.critique} critique(s), ${s.parSeverite.eleve} élevé(s), ${s.parSeverite.moyen} moyen(s).`
          + (critiques.length ? ` Le plus grave : ${critiques[0]!.titre} — ${critiques[0]!.action}` : '');
      return {
        question,
        reponse: `État : ${s.etat}, score ${s.score}/100. ${phrase}`,
        data: s, sources: ['vigilance'],
      };
    },
  },
  {
    id: 'a_faire',
    mots: [/que dois.je/, /quoi faire/, /[àa] faire/, /ma journ[ée]e/, /mes dossiers/, /urgent/],
    exemple: 'Qu’est-ce qui est urgent aujourd’hui ?',
    async repondre(c, _p, question) {
      const decisions = c.executive.decisions();
      const sante = await c.vigilance.sante();
      const critiques = sante.constats.filter((x) => x.severite === 'critique');
      const lignes = [
        ...critiques.map((x) => `• ${x.titre} → ${x.action}`),
        ...decisions.slice(0, 5).map((d) => `• ${d.libelle}${d.montant ? ` (${fcfa(d.montant)})` : ''}`),
      ];
      return {
        question,
        reponse: lignes.length
          ? `${lignes.length} point(s) appellent une action :\n${lignes.join('\n')}`
          : 'Rien d’urgent : aucun constat critique et aucune décision en attente.',
        data: { critiques, decisions }, sources: ['vigilance', 'direction'],
      };
    },
  },
  {
    id: 'location',
    mots: [/location/, /louer/, /signature/, /mariage/, /maextro|yangwang|aito|zeekr|stelato|nio/],
    exemple: 'Combien ont rapporté les locations ce mois-ci ?',
    repondre(c, p, question) {
      const dossiers = c.rental.list().filter((r) => Date.parse(r.createdAt) >= p.depuis);
      const actifs = dossiers.filter((r) => r.status !== 'annulee');
      const ca = actifs.reduce((n, r) => n + r.total, 0);
      const parModele = new Map<string, number>();
      for (const r of actifs) parModele.set(r.vehicle.name, (parModele.get(r.vehicle.name) ?? 0) + 1);
      const top = [...parModele.entries()].sort((a, b) => b[1] - a[1])[0];
      const stats = c.rental.stats();
      return {
        question,
        reponse: `${actifs.length} location(s) ${p.label}, pour ${fcfa(ca)}.`
          + (top ? ` Modèle le plus demandé : ${top[0]} (${top[1]} dossier(s)).` : '')
          + ` Flotte Signature engagée à ${pct(stats.tauxOccupation)}.`,
        data: { dossiers: actifs.length, ca, parModele: Object.fromEntries(parModele), stats },
        sources: ['rental', 'rentalTarifs'],
      };
    },
  },
  {
    id: 'abonnement',
    mots: [/abonn/, /forfait/, /mrr|r[ée]current/, /cotisation/],
    exemple: 'Où en sont les abonnements ?',
    repondre(c, _p, question) {
      const s = c.subscriptions.stats();
      return {
        question,
        reponse: `${s.actifs} abonné(s) actif(s) sur ${s.total} compte(s), pour ${fcfa(s.mrr)} de revenu récurrent mensuel.`
          + ` ${s.coursesCouvertes} course(s) prise(s) en charge, soit ${fcfa(s.totalCouvert)} rendus aux clients.`
          + (s.impayees ? ` Attention : ${s.impayees} facture(s) impayée(s) pour ${fcfa(s.montantImpaye)}.` : ' Aucun impayé.'),
        data: s, sources: ['subscriptions'],
      };
    },
  },
  {
    id: 'tresorerie',
    mots: [/tr[ée]sorerie/, /caisse/, /entr[ée]es?/, /sorties?/, /solde/, /esp[èe]ces/, /d[ûu]s? aux chauffeurs/],
    sauf: [/location/, /abonn/],
    exemple: 'Quel est le solde de caisse sur 30 jours ?',
    repondre(c, p, question) {
      const k = c.executive.consolidation(p.jours);
      return {
        question,
        reponse: `${fcfa(k.entrees)} encaissés et ${fcfa(k.sorties)} sortis ${p.label}, soit un solde de ${fcfa(k.solde)}.`
          + ` ${fcfa(k.especesChauffeurs)} ont été encaissés en espèces par les chauffeurs — cet argent n’est jamais passé en caisse —`
          + ` et ${fcfa(k.dettesEspeces)} de commission leur restent dus.`
          + ` Sommes dues aux chauffeurs : ${fcfa(k.dusChauffeurs)}.`,
        data: k, sources: ['direction', 'treasury'],
      };
    },
  },
  {
    id: 'finance',
    mots: [/chiffre d.affaires|^ca\b|\bca\b/, /revenu/, /commission/, /gmv/, /tva/, /gagn/],
    sauf: [/location/, /abonn/],
    exemple: 'Quel chiffre d’affaires sur les 7 derniers jours ?',
    repondre(c, p, question) {
      const k = c.executive.consolidation(p.jours);
      return {
        question,
        reponse: `Volume d’affaires ${p.label} : ${fcfa(k.gmv)} (mobilité ${fcfa(k.gmvParActivite.mobilite)},`
          + ` location ${fcfa(k.gmvParActivite.location)}, abonnements ${fcfa(k.gmvParActivite.abonnement)}).`
          + ` Revenu ORION : ${fcfa(k.revenu)} — sur une course, l’essentiel revient au chauffeur.`
          + ` TVA collectée pour l’État : ${fcfa(k.tvaCollectee)}.`,
        data: k, sources: ['direction', 'finance'],
      };
    },
  },
  {
    id: 'flotte',
    mots: [/chauffeur/, /flotte/, /en ligne/, /\bkyc\b/, /conducteur/],
    sauf: [/d[ûu]s? aux chauffeurs/],
    exemple: 'Combien de chauffeurs sont en ligne ?',
    repondre(c, _p, question) {
      const d = c.drivers.list();
      const enLigne = d.filter((x) => x.availability === 'online');
      const enCourse = d.filter((x) => x.availability === 'on_trip');
      const aValider = d.filter((x) => x.kycStatus !== 'active' && x.kycStatus !== 'approved' && x.kycStatus !== 'suspended');
      const parGamme = new Map<string, number>();
      for (const x of enLigne) parGamme.set(x.category, (parGamme.get(x.category) ?? 0) + 1);
      return {
        question,
        reponse: `${d.length} chauffeur(s) enregistré(s) : ${enLigne.length} en ligne, ${enCourse.length} en course.`
          + (parGamme.size ? ` Répartition des disponibles : ${[...parGamme].map(([g, n]) => `${g} ${n}`).join(', ')}.` : '')
          + (aValider.length ? ` ${aValider.length} dossier(s) KYC à valider.` : ''),
        data: { total: d.length, enLigne: enLigne.length, enCourse: enCourse.length, aValider: aValider.length },
        sources: ['drivers', 'dispatch'],
      };
    },
  },
  {
    id: 'courses',
    mots: [/course/, /trajet/, /annul/, /sans chauffeur/, /livraison/, /demande/],
    sauf: [/location/, /[ée]lectri/, /thermi/, /hybrid/, /co2|carbone/, /batterie/],
    exemple: 'Combien de courses hier, et combien annulées ?',
    repondre(c, p, question) {
      const toutes = c.rides.listAll().filter((r) => Date.parse(r.createdAt) >= p.depuis);
      const parStatut = new Map<string, number>();
      for (const r of toutes) parStatut.set(r.status, (parStatut.get(r.status) ?? 0) + 1);
      const annulees = parStatut.get('cancelled') ?? 0;
      const sansChauffeur = parStatut.get('no_driver') ?? 0;
      const taux = toutes.length ? sansChauffeur / toutes.length : 0;
      return {
        question,
        reponse: `${toutes.length} commande(s) ${p.label} : ${annulees} annulée(s), ${sansChauffeur} sans chauffeur`
          + (toutes.length ? ` (${pct(taux)} des demandes)` : '') + '.'
          + (taux > 0.15 ? ' Ce taux est anormalement élevé — vérifiez le rayon de recherche et l’offre.' : ''),
        data: { total: toutes.length, parStatut: Object.fromEntries(parStatut) },
        sources: ['rides', 'dispatch'],
      };
    },
  },
  {
    id: 'vert',
    mots: [/[ée]lectri/, /thermi/, /hybrid/, /co2|carbone/, /vert/, /batterie/, /propre/, /[ée]cologi/],
    exemple: 'Quelle part des trajets est 100 % électrique ?',
    repondre(c, _p, question) {
      const g = c.drivers.list();
      const elec = g.filter((d) => (d.engine ?? 'electric') === 'electric');
      const faible = elec.filter((d) => d.batteryPct !== undefined && d.batteryPct < 20);
      return {
        question,
        reponse: `${elec.length} véhicule(s) 100 % électriques sur ${g.length} (${pct(g.length ? elec.length / g.length : 0)}).`
          + (faible.length ? ` ${faible.length} sous 20 % de batterie.` : ' Aucun sous 20 % de batterie.'),
        data: { electriques: elec.length, total: g.length, batterieFaible: faible.length },
        sources: ['green'],
      };
    },
  },
  {
    id: 'support',
    mots: [/support/, /ticket/, /r[ée]clamation/, /litige/, /remboursement/, /csat|satisfaction/],
    exemple: 'Combien de litiges sont en attente ?',
    repondre(c, _p, question) {
      const ouverts = c.disputes.list().filter((d) => d.status === 'open' || d.status === 'investigating');
      const rembourses = c.disputes.list().filter((d) => d.status === 'resolved' && d.refund);
      const total = rembourses.reduce((n, d) => n + (d.refund ?? 0), 0);
      const conv = c.support.list().filter((x) => x.status !== 'closed');
      return {
        question,
        reponse: `${ouverts.length} litige(s) non tranché(s) et ${conv.length} conversation(s) de support ouverte(s).`
          + ` ${rembourses.length} remboursement(s) accordé(s), pour ${fcfa(total)}.`,
        data: { litiges: ouverts.length, conversations: conv.length, rembourses: rembourses.length, montant: total },
        sources: ['disputes', 'support'],
      };
    },
  },
  {
    id: 'securite',
    mots: [/s[ée]curit[ée]/, /acc[èe]s/, /tentative/, /intrusion/, /non autoris/],
    exemple: 'Y a-t-il eu des tentatives d’accès non autorisé ?',
    repondre(c, _p, question) {
      const t = c.security.list();
      const parPersonne = new Map<string, number>();
      for (const x of t) parPersonne.set(x.name, (parPersonne.get(x.name) ?? 0) + 1);
      return {
        question,
        reponse: t.length === 0
          ? 'Aucune tentative d’accès non autorisé signalée.'
          : `${t.length} tentative(s) signalée(s) à la direction, par ${parPersonne.size} compte(s) : `
            + [...parPersonne].map(([n, k]) => `${n} (${k})`).join(', ') + '.',
        data: { total: t.length, parPersonne: Object.fromEntries(parPersonne) },
        sources: ['security', 'audit'],
      };
    },
  },
  {
    id: 'zones',
    mots: [/zone/, /quartier/, /cocody|plateau|yopougon|abobo|marcory|treichville|adjam[ée]|a[ée]roport/],
    exemple: 'Quelles zones manquent de véhicules ?',
    async repondre(c, _p, question) {
      const sante = await c.vigilance.sante();
      const vide = sante.constats.find((x) => x.id === 'zones-sans-offre');
      const zones = c.settings.getZones().filter((z) => z.active);
      return {
        question,
        reponse: `${zones.length} zone(s) active(s). `
          + (vide ? vide.constat : 'Chaque zone active compte au moins un véhicule présent.'),
        data: { zones: zones.map((z) => ({ id: z.id, name: z.name, factor: z.factor })) },
        sources: ['zones', 'dispatch'],
      };
    },
  },
];
