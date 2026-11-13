import { API, H, LIVE, clearSession, expKey, logout, setCsrf } from '../admin/api';
import type { AnalysePeriode, AnalyseTableau, EntreeJournal, EtatTableau, JourCommandes, ObjectifsFinanciers, PointCommandes, PointCourbe } from './types';

/**
 * Données du tableau de bord : même session que la console (cookie HttpOnly posé par
 * /admin/login), état complet par HTTP, et le direct par WebSocket (/ws/dashboard).
 */

export class NonConnecte extends Error {}
/** Connecté, mais sans droit sur le tableau de bord (ni de droit, ni par habilitation). */
export class AccesRefuse extends Error {}

/**
 * Un 403 a deux causes très différentes : le rôle n'a pas droit au tableau de bord, ou
 * l'APPAREIL n'est plus de confiance (jamais enrôlé, ou révoqué). Dans le second cas,
 * afficher « accès réservé à la direction » à un directeur serait faux : on le ramène à
 * la connexion, qui lui propose d'enrôler l'appareil.
 */
async function appareilRefuse(r: Response): Promise<boolean> {
  if (r.status !== 403) return false;
  const corps = await r.clone().json().catch(() => null) as { error?: { code?: string } } | null;
  if (corps?.error?.code !== 'APPAREIL_NON_ENROLE') return false;
  clearSession();
  return true;
}

const verifier = async (r: Response) => {
  if (r.status === 401 || await appareilRefuse(r)) throw new NonConnecte();
  if (r.status === 403) throw new AccesRefuse();
  if (!r.ok) throw new Error(`Serveur ORION : ${r.status}`);
};

/** Habilitation d'un manager, telle que la renvoie le serveur. */
export interface HabilitationPublique {
  id: string; username: string; nom: string; role: string; roleLabel: string;
  statut: 'demandee' | 'transmise' | 'accordee' | 'refusee' | 'revoquee'; statutLabel: string; expiree: boolean;
  motif: string; expireLe?: string; demandeLe: string; demandePar: string;
  transmiseLe?: string; transmisePar?: string; decisionLe?: string; decisionPar?: string; raison?: string;
  historique: Array<{ at: string; par: string; action: string; detail?: string }>;
}
export interface MonAcces { nom: string; roleLabel: string; acces: boolean; habilitable: boolean; habilitation: HabilitationPublique | null }

/** Qui est connecté, et où en est sa demande d'accès (aucun droit particulier requis). */
export async function lireMonAcces(): Promise<MonAcces> {
  const [me, moi] = await Promise.all([
    fetch(`${API}/admin/me`, { credentials: 'include' }),
    fetch(`${API}/admin/habilitations/moi`, { credentials: 'include' }),
  ]);
  if (me.status === 401 || moi.status === 401 || await appareilRefuse(me) || await appareilRefuse(moi)) throw new NonConnecte();
  if (!me.ok || !moi.ok) throw new Error('Serveur ORION injoignable');
  const m = await me.json() as { name: string; roleLabel: string };
  const h = await moi.json() as Omit<MonAcces, 'nom'>;
  return { ...h, nom: m.name, roleLabel: m.roleLabel ?? h.roleLabel };
}

/** Le manager demande l'accès ; renvoie un message d'erreur, ou null si la demande est partie. */
export async function demanderAcces(motif: string): Promise<string | null> {
  const r = await fetch(`${API}/admin/habilitations/demande`, { method: 'POST', credentials: 'include', headers: H(), body: JSON.stringify({ motif }) });
  if (r.ok) return null;
  const d = await r.json().catch(() => ({})) as { error?: string; message?: string };
  return d.error ?? d.message ?? 'La demande n’a pas pu partir. Réessayez dans un instant.';
}

export async function changerDeCompte(): Promise<void> { await logout(); }

export async function lireEtat(): Promise<EtatTableau> {
  if (!LIVE) return etatDemo();
  const r = await fetch(`${API}/admin/dashboard`, { credentials: 'include' });
  await verifier(r);
  return r.json() as Promise<EtatTableau>;
}

/** Objectifs financiers et niveau des commandes (onglet « Objectifs et tendances »). */
export async function lireAnalyse(): Promise<AnalyseTableau> {
  if (!LIVE) return analyseDemo();
  const r = await fetch(`${API}/admin/dashboard/analyse`, { credentials: 'include' });
  await verifier(r);
  return r.json() as Promise<AnalyseTableau>;
}

export async function seConnecter(username: string, password: string, code?: string): Promise<'ok' | 'code' | string> {
  const r = await fetch(`${API}/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ username, password, ...(code ? { code } : {}) }),
  });
  if (r.status === 429) return 'Compte temporairement verrouillé : réessayez plus tard.';
  if (r.status === 403) {
    const corps = await r.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    // Appareil non enrôlé (ou révoqué) : l'écran passe à l'enrôlement.
    if (corps.error?.code === 'APPAREIL_NON_ENROLE') return 'appareil';
    return corps.error?.message ?? 'Accès refusé.';
  }
  if (!r.ok) return code ? 'Code invalide.' : 'Identifiants refusés. Accès réservé au personnel ORION.';
  const d = await r.json() as { mfaRequired?: boolean; csrfToken?: string; expiresAt?: string };
  if (d.mfaRequired) return 'code';
  if (d.csrfToken) setCsrf(d.csrfToken);
  localStorage.setItem(expKey, String(Date.parse(d.expiresAt ?? '') || Date.now() + 12 * 3600e3));
  return 'ok';
}

export function oublierSession() { clearSession(); }

/**
 * Le direct. Le serveur envoie le journal par LOTS (toutes les 250 ms au plus) : les
 * lignes les plus récentes, et le nombre exact d'événements depuis le lot précédent.
 * Sous forte charge, c'est ce qui permet à l'écran de suivre des milliers d'événements
 * par seconde sans décrocher. `recus` sert à afficher le débit.
 */
export function ecouter(onLot: (entrees: EntreeJournal[], recus: number) => void, onEtat: (connecte: boolean) => void, onObjectifs?: () => void): () => void {
  if (!LIVE) {
    // Démonstration sans serveur : un journal qui vit quand même.
    onEtat(true);
    const t = window.setInterval(() => onLot([entreeDemo()], 1), 6500);
    return () => window.clearInterval(t);
  }
  let ws: WebSocket | null = null;
  let ferme = false;
  let relance: number | undefined;
  const connecter = () => {
    let hote = window.location.host;
    let proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (API) { try { const u = new URL(API); hote = u.host; proto = u.protocol === 'https:' ? 'wss:' : 'ws:'; } catch { /* URL invalide */ } }
    ws = new WebSocket(`${proto}//${hote}/ws/dashboard`);
    ws.onopen = () => onEtat(true);
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string) as { type: string; data?: unknown };
        if (m.type === 'journal.lot' && m.data) {
          const lot = m.data as { entrees: EntreeJournal[]; recus: number };
          onLot(lot.entrees, lot.recus);
        } else if (m.type === 'journal' && m.data) onLot([m.data as EntreeJournal], 1);
        // Objectifs changés dans la console : les courbes se recalculent tout de suite.
        else if (m.type === 'objectifs') onObjectifs?.();
      } catch { /* message illisible : ignoré */ }
    };
    ws.onclose = () => { onEtat(false); if (!ferme) relance = window.setTimeout(connecter, 3000); };
  };
  connecter();
  return () => { ferme = true; window.clearTimeout(relance); ws?.close(); };
}

/* ------------------------------ Démonstration ------------------------------ */

const DEMO_FLOTTE = [
  { nom: 'Konan Yao', categorie: 'bronze', lat: 5.3258, lng: -4.0205 },
  { nom: 'Awa Diomandé', categorie: 'bronze', lat: 5.331, lng: -4.012 },
  { nom: 'Aïcha Touré', categorie: 'argent', lat: 5.3585, lng: -3.989 },
  { nom: 'Ismaël Cissé', categorie: 'argent', lat: 5.347, lng: -3.999 },
  { nom: 'Mamadou Bamba', categorie: 'or', lat: 5.3402, lng: -4.0095 },
  { nom: 'Grace Kouamé', categorie: 'or', lat: 5.353, lng: -3.995 },
  { nom: 'Fatou Koné', categorie: 'diamant', lat: 5.301, lng: -3.998 },
  { nom: 'Yacouba Ouattara', categorie: 'moto', lat: 5.3228, lng: -4.0168 },
  { nom: 'Bintou Coulibaly', categorie: 'moto', lat: 5.3492, lng: -3.9935 },
  { nom: 'Hervé Kouadio', categorie: 'moto', lat: 5.3049, lng: -3.9871 },
];
const DEMO_EVENEMENTS: Array<Omit<EntreeJournal, 'id' | 'at'>> = [
  { genre: 'commande', niveau: 'info', service: 'livraison', titre: 'Nouvelle livraison moto · Aya K.', detail: 'Plateau → Cocody · 1 450 F' },
  { genre: 'attribution', niveau: 'info', service: 'livraison', titre: 'Coursier attribué : Yacouba Ouattara', detail: 'Livraison de Aya K. · Plateau → Cocody' },
  { genre: 'commande', niveau: 'info', service: 'course', titre: 'Nouvelle course · Koffi A.', detail: 'Marcory → Port-Bouët · 3 200 F' },
  { genre: 'depart', niveau: 'info', service: 'livraison', titre: 'Colis récupéré, livraison en cours', detail: 'Plateau → Cocody' },
  { genre: 'terminee', niveau: 'succes', service: 'course', titre: 'Course terminée', detail: 'Treichville → Plateau · 2 600 F' },
  { genre: 'paiement', niveau: 'succes', service: 'course', titre: 'Paiement reçu · 2 600 F', detail: 'Wave · course de Mariam D.' },
  { genre: 'terminee', niveau: 'succes', service: 'livraison', titre: 'Colis livré', detail: 'Plateau → Cocody · 1 450 F' },
  { genre: 'message', niveau: 'info', titre: 'Contrôle de sécurité envoyé', detail: 'Votre course se passe-t-elle bien ?' },
];
let demoIndex = 0;
const entreeDemo = (): EntreeJournal => {
  const e = DEMO_EVENEMENTS[demoIndex++ % DEMO_EVENEMENTS.length]!;
  return { ...e, id: `demo-${Date.now()}`, at: new Date().toISOString() };
};

function etatDemo(): EtatTableau {
  const h = new Date().getHours();
  const bruit = (k: number) => Math.round(Math.abs(Math.sin(k * 1.7 + h)) * 6);
  const t = Date.now() / 60000;
  return {
    genereLe: new Date().toISOString(), devise: 'XOF',
    enDirect: { courses: 4, livraisons: 2, enRecherche: 0 },
    conducteurs: { enLigne: 10, enCourse: 6, coursiers: 3, total: 14 },
    aujourdhui: { commandes: 58, courses: 41, livraisons: 12, annulees: 3, chiffreAffaires: 168450, panierMoyen: 3180, noteMoyenne: 4.8, notes: 37, nouveauxClients: 6 },
    securite: { alertesOuvertes: 0, alertesDuJour: 1, controles: 23, reponsesOk: 21, reponsesAlerte: 1 },
    assurance: { inscrits: 128, coursesAssurees: 17 },
    parHeure: Array.from({ length: 24 }, (_, i) => (i > h ? { heure: i, courses: 0, livraisons: 0 } : { heure: i, courses: i < 6 ? 0 : bruit(i), livraisons: i < 7 ? 0 : Math.round(bruit(i + 3) / 2) })),
    paiements: { 'Orange Money': 61200, Wave: 48800, 'MTN MoMo': 29400, Espèces: 21050, Carte: 8000 },
    flotte: DEMO_FLOTTE.map((f, i) => ({ id: `d${i}`, nom: f.nom, categorie: f.categorie, moto: f.categorie === 'moto', enCourse: i % 2 === 0,
      lat: f.lat + Math.sin(t + i) * 0.004, lng: f.lng + Math.cos(t + i) * 0.004 })),
    coursesActives: [],
    journal: Array.from({ length: 6 }, (_, i) => ({ ...DEMO_EVENEMENTS[i]!, id: `demo-init-${i}`, at: new Date(Date.now() - (i + 1) * 95_000).toISOString() })),
  };
}

/* ------------------- Démonstration : objectifs et tendances ------------------- */

// Profil d'une journée à Abidjan (pointes du matin et du soir) et poids des jours (dim → sam).
const PROFIL = [0.3, 0.2, 0.15, 0.1, 0.15, 0.5, 1.6, 3.2, 3.6, 2.4, 1.8, 1.9, 2.4, 2.2, 1.7, 1.8, 2.3, 3.3, 3.8, 3.2, 2.4, 1.8, 1.2, 0.7];
const TOTAL_PROFIL = PROFIL.reduce((s, x) => s + x, 0);
const POIDS_JOUR = [0.8, 0.92, 0.95, 0.97, 1.0, 1.15, 1.18];
const PANIER = 3150;
const JOURS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const OBJECTIFS_DEMO: ObjectifsFinanciers = { jour: 450_000, semaine: 3_000_000, mois: 13_000_000, annee: 160_000_000 };
const JOUR_MS = 86_400_000;

/** Bruit déterministe autour de 1 : la même tranche donne toujours le même chiffre. */
const bruit = (k: number, amplitude = 0.24) => { const x = Math.sin(k * 12.9898) * 43758.5453; return 1 - amplitude / 2 + amplitude * (x - Math.floor(x)); };
const debut = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const decale = (d: Date, j: number) => { const x = new Date(d); x.setDate(x.getDate() + j); return x; };
const numero = (d: Date) => Math.round(+debut(d) / JOUR_MS);
const croissance = (d: Date, maintenant: Date) => 1 / (1 + 0.28 * ((+maintenant - +d) / JOUR_MS / 365));
const variationDe = (a: number | null, b: number) => (a === null || !b ? null : (a - b) / b);
const cumul = (xs: number[]) => { let s = 0; return xs.map((x) => (s += x)); };

/** Commandes d'une heure donnée ; `jusqua` limite l'heure entamée. */
function commandesHeure(jour: Date, h: number, maintenant: Date, fraction = 1): number {
  const volume = 150 * POIDS_JOUR[jour.getDay()]! * bruit(numero(jour), 0.28) * croissance(jour, maintenant);
  return Math.round(volume * (PROFIL[h]! / TOTAL_PROFIL) * bruit(numero(jour) * 24 + h, 0.5) * fraction);
}
/** Commandes d'une journée jusqu'à un instant (journée entière si l'instant est passé). */
function commandesJour(jour: Date, maintenant: Date, limite = maintenant): number {
  let n = 0;
  for (let h = 0; h < 24; h++) {
    const debutH = +debut(jour) + h * 3_600_000;
    if (debutH >= +limite) break;
    n += commandesHeure(jour, h, maintenant, Math.min(1, (+limite - debutH) / 3_600_000));
  }
  return n;
}
const ca = (commandes: number) => commandes * 0.93 * PANIER;

function periode(objectif: number, tranches: Array<{ libelle: string; courant: number | null; precedent: number; part: number }>, enCours: number, partAttendue: number, fraction: number, precedentMemeMoment: number): AnalysePeriode {
  const cc = cumul(tranches.map((t) => t.courant ?? 0));
  const cp = cumul(tranches.map((t) => t.precedent));
  const parts = cumul(tranches.map((t) => t.part));
  const realise = Math.round(cc[enCours]!);
  const rythme = objectif * partAttendue;
  const ratio = rythme > 0 ? realise / rythme : 1;
  const projection = partAttendue >= 0.06 ? Math.round(realise / partAttendue) : null;
  const courbe: PointCourbe[] = tranches.map((t, i) => ({
    libelle: t.libelle, courant: i <= enCours ? Math.round(cc[i]!) : null, precedent: Math.round(cp[i]!),
    objectif: Math.round(objectif * parts[i]!), montant: i <= enCours ? Math.round(t.courant ?? 0) : null, montantPrecedent: Math.round(t.precedent),
  }));
  return {
    objectif, realise, progression: realise / objectif, fractionEcoulee: fraction, rythmeAttendu: Math.round(rythme),
    statut: ratio >= 1.05 ? 'en_avance' : ratio >= 0.95 ? 'dans_les_temps' : 'en_retard',
    projection, projectionRatio: projection !== null ? projection / objectif : null,
    precedentMemeMoment: Math.round(precedentMemeMoment), precedentTotal: Math.round(cp[cp.length - 1]!),
    variation: variationDe(realise, precedentMemeMoment), reste: Math.max(0, objectif - realise), courbe,
  };
}

export function analyseDemo(maintenant = new Date()): AnalyseTableau {
  const auj = debut(maintenant);
  const H = maintenant.getHours();
  const fracH = maintenant.getMinutes() / 60;
  const hier = decale(auj, -1);

  // Journée : heure par heure, rythme attendu selon le profil de la journée.
  const heures = PROFIL.map((p, h) => ({
    libelle: `${h} h`, part: p / TOTAL_PROFIL,
    courant: h < H ? ca(commandesHeure(auj, h, maintenant)) : h === H ? ca(commandesHeure(auj, h, maintenant, fracH)) : null,
    precedent: ca(commandesHeure(hier, h, maintenant)),
  }));
  const partJour = cumul(heures.map((h) => h.part));
  const partAttJour = (H > 0 ? partJour[H - 1]! : 0) + heures[H]!.part * fracH;
  const hierMeme = heures.slice(0, H).reduce((s, h) => s + h.precedent, 0) + ca(commandesHeure(hier, H, maintenant, fracH));
  const jour = periode(OBJECTIFS_DEMO.jour, heures, H, partAttJour, (+maintenant - +auj) / JOUR_MS, hierMeme);

  // Semaine du lundi au dimanche.
  const iJour = (maintenant.getDay() + 6) % 7;
  const lundi = decale(auj, -iJour);
  const poids = JOURS.map((_, i) => POIDS_JOUR[(i + 1) % 7]!);
  const totalPoids = poids.reduce((s, x) => s + x, 0);
  const jours = JOURS.map((l, i) => {
    const d = decale(lundi, i);
    return { libelle: l, part: poids[i]! / totalPoids, courant: i <= iJour ? ca(commandesJour(d, maintenant)) : null, precedent: ca(commandesJour(decale(d, -7), maintenant)) };
  });
  const partSem = cumul(jours.map((j) => j.part));
  const partAttSem = (iJour > 0 ? partSem[iJour - 1]! : 0) + jours[iJour]!.part * partAttJour;
  const semPrecMeme = jours.slice(0, iJour).reduce((s, j) => s + j.precedent, 0) + ca(commandesJour(decale(auj, -7), maintenant, new Date(+maintenant - 7 * JOUR_MS)));
  const semaine = periode(OBJECTIFS_DEMO.semaine, jours, iJour, partAttSem, (+maintenant - +lundi) / (7 * JOUR_MS), semPrecMeme);

  // Mois, jour par jour.
  const premier = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
  const nbJours = new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0).getDate();
  const jdm = maintenant.getDate() - 1;
  const joursMois = Array.from({ length: nbJours }, (_, i) => {
    const d = decale(premier, i);
    return { libelle: `${i + 1}`, part: 1 / nbJours, courant: i <= jdm ? ca(commandesJour(d, maintenant)) : null, precedent: ca(commandesJour(new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()), maintenant)) };
  });
  const fracMois = (jdm + (+maintenant - +auj) / JOUR_MS) / nbJours;
  const moisPrecMeme = joursMois.slice(0, jdm).reduce((s, j) => s + j.precedent, 0) + joursMois[jdm]!.precedent * partAttJour;
  const mois = periode(OBJECTIFS_DEMO.mois, joursMois, jdm, fracMois, fracMois, moisPrecMeme);

  // Année, mois par mois (estimés à partir d'une journée type de chaque mois).
  const m = maintenant.getMonth();
  const caMois = (a: number, k: number) => {
    const nb = new Date(a, k + 1, 0).getDate();
    const milieu = new Date(a, k, 15);
    return 150 * 0.98 * nb * 0.93 * PANIER * croissance(milieu, maintenant) * bruit(a * 12 + k, 0.12);
  };
  const moisAn = MOIS.map((l, k) => ({ libelle: l, part: new Date(maintenant.getFullYear(), k + 1, 0).getDate() / 365, courant: k < m ? caMois(maintenant.getFullYear(), k) : k === m ? mois.realise : null, precedent: caMois(maintenant.getFullYear() - 1, k) }));
  const debutAn = new Date(maintenant.getFullYear(), 0, 1);
  const fracAn = (+maintenant - +debutAn) / (365 * JOUR_MS);
  const anPrecMeme = moisAn.slice(0, m).reduce((s, x) => s + x.precedent, 0) + moisAn[m]!.precedent * fracMois;
  const annee = periode(OBJECTIFS_DEMO.annee, moisAn, m, fracAn, fracAn, anPrecMeme);

  // Commandes.
  const parHeure: PointCommandes[] = PROFIL.map((_, h) => {
    const courant = h < H ? commandesHeure(auj, h, maintenant) : h === H ? commandesHeure(auj, h, maintenant, fracH) : null;
    const precedent = commandesHeure(hier, h, maintenant);
    const reference = h === H ? commandesHeure(hier, h, maintenant, fracH) : precedent;
    const moyenne = Math.round(([1, 2, 3, 4].reduce((s, k) => s + commandesHeure(decale(auj, -7 * k), h, maintenant), 0) / 4) * 10) / 10;
    return { libelle: `${h} h`, courant, precedent, moyenne, variation: variationDe(courant, reference), ...(h === H ? { enCours: true } : {}) };
  });
  const parJour: PointCommandes[] = JOURS.map((l, i) => {
    const d = decale(lundi, i);
    const courant = i <= iJour ? commandesJour(d, maintenant) : null;
    const precedent = commandesJour(decale(d, -7), maintenant);
    const reference = i === iJour ? commandesJour(decale(d, -7), maintenant, new Date(+maintenant - 7 * JOUR_MS)) : precedent;
    return { libelle: l, courant, precedent, variation: variationDe(courant, reference), ...(i === iJour ? { enCours: true } : {}) };
  });
  const quotidien = Array.from({ length: 37 }, (_, i) => commandesJour(decale(auj, i - 36), maintenant));
  const trenteJours: JourCommandes[] = Array.from({ length: 30 }, (_, k) => {
    const i = k + 7;
    const d = decale(auj, i - 36);
    const partiel = i === 36;
    const fen = partiel ? quotidien.slice(i - 7, i) : quotidien.slice(i - 6, i + 1);
    const reference = partiel ? commandesJour(decale(auj, -7), maintenant, new Date(+maintenant - 7 * JOUR_MS)) : quotidien[i - 7]!;
    return {
      libelle: `${d.getDate()}/${d.getMonth() + 1}`, jour: JOURS[(d.getDay() + 6) % 7]!, commandes: quotidien[i]!,
      moyenne7: Math.round((fen.reduce((s, x) => s + x, 0) / 7) * 10) / 10, semainePrecedente: quotidien[i - 7]!,
      variation: variationDe(quotidien[i]!, reference), ...(partiel ? { enCours: true } : {}),
    };
  });
  const parMois: PointCommandes[] = MOIS.map((l, k) => {
    const courant = k < m ? Math.round(caMois(maintenant.getFullYear(), k) / (0.93 * PANIER)) : k === m ? Math.round(mois.realise / (0.93 * PANIER)) : null;
    const precedent = Math.round(caMois(maintenant.getFullYear() - 1, k) / (0.93 * PANIER));
    return { libelle: l, courant, precedent, variation: variationDe(courant, k === m ? precedent * fracMois : precedent), ...(k === m ? { enCours: true } : {}) };
  });

  const f = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
  const pc = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))} %`;
  const pleines = parHeure.filter((h) => h.courant !== null && !h.enCours && h.variation !== null && Math.max(h.courant ?? 0, h.precedent) >= 4);
  const hausse = [...pleines].sort((a, b) => b.variation! - a.variation!)[0];
  const baisse = [...pleines].sort((a, b) => a.variation! - b.variation!)[0];
  const pic = parHeure.filter((h) => h.courant !== null).sort((a, b) => (b.courant ?? 0) - (a.courant ?? 0))[0];
  const sept = quotidien.slice(29, 36).reduce((s, x) => s + x, 0);
  const septAvant = quotidien.slice(22, 29).reduce((s, x) => s + x, 0);
  const aRetenir: AnalyseTableau['aRetenir'] = [
    { genre: jour.statut === 'en_retard' ? 'baisse' : 'objectif', texte: `Aujourd’hui : ${f(jour.realise)} encaissés sur un objectif de ${f(jour.objectif)}, soit ${Math.round(jour.progression * 100)} %${jour.projection ? `. Au rythme actuel : environ ${f(jour.projection)} en fin de journée.` : '.'}` },
    ...(mois.statut === 'dans_les_temps' ? [] : [{ genre: mois.statut === 'en_retard' ? 'baisse' as const : 'objectif' as const, texte: `Ce mois : ${Math.round(mois.progression * 100)} % de l’objectif atteints à ${Math.round(mois.fractionEcoulee * 100)} % du mois, ${mois.statut === 'en_retard' ? `en retard sur le rythme attendu. Reste ${f(mois.reste)} à réaliser.` : mois.statut === 'en_avance' ? 'en avance sur le rythme attendu.' : 'dans les temps.'}` }]),
    ...(pic && (pic.courant ?? 0) >= 3 ? [{ genre: 'pic' as const, texte: `Heure la plus chargée aujourd’hui : ${pic.libelle}, avec ${pic.courant} commandes.` }] : []),
    ...(hausse && hausse.variation! > 0.05 ? [{ genre: 'hausse' as const, texte: `Plus forte hausse : ${hausse.libelle}, ${pc(hausse.variation!)} par rapport à hier (${hausse.precedent} → ${hausse.courant} commandes).` }] : []),
    ...(baisse && baisse.variation! < -0.05 ? [{ genre: 'baisse' as const, texte: `Plus forte baisse : ${baisse.libelle}, ${pc(baisse.variation!)} par rapport à hier (${baisse.precedent} → ${baisse.courant} commandes).` }] : []),
    { genre: sept >= septAvant ? 'hausse' : 'baisse', texte: `Sur les 7 derniers jours : ${sept.toLocaleString('fr-FR')} commandes, ${pc((sept - septAvant) / septAvant)} par rapport aux 7 jours d’avant.` },
    { genre: 'info', texte: 'Le samedi est le jour le plus chargé de la semaine, devant le vendredi.' },
  ];

  return {
    genereLe: maintenant.toISOString(), devise: 'XOF', historiqueDemo: true, objectifs: OBJECTIFS_DEMO,
    finances: { jour, semaine, mois, annee },
    commandes: { parHeure, parJour, trenteJours, parMois, heureCourante: H, jourCourant: JOURS_LONGS[maintenant.getDay()]! },
    aRetenir,
  };
}
