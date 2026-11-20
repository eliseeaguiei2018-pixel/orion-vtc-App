/**
 * SERVEUR LOCAL — l'app client ORION autonome (APK de démonstration, page partagée).
 *
 * Tant qu'aucun serveur ORION n'est hébergé, l'app répond elle-même aux routes du serveur
 * qu'elle utilise, avec les mêmes formats, et garde les données sur le téléphone :
 * compte et profil (numéro vérifié par un code affiché à l'écran), photo, historique,
 * alertes SOS, aide, abonnement, locations, messages ORION et dossier ORION Assurance.
 * Chaque bouton fait donc vraiment quelque chose.
 *
 * Ce qui reste simulé est dit à l'écran : aucun chauffeur réel, aucune alerte transmise
 * à une vraie supervision (le SOS propose alors d'appeler directement le 185, le 170 ou
 * le 180). Dès que VITE_API_URL désigne un serveur, ce module n'est plus utilisé.
 */
import type { SubInvoice, SubPlanInfo, SubState } from './types';
import { TIERS } from './data';

export interface ReponseLocale { status: number; data: unknown }

const PREFIXE = 'orion.local.';
const lire = <T,>(cle: string, defaut: T): T => {
  try { const v = localStorage.getItem(PREFIXE + cle); return v ? JSON.parse(v) as T : defaut; } catch { return defaut; }
};
const ecrire = (cle: string, v: unknown) => { try { localStorage.setItem(PREFIXE + cle, JSON.stringify(v)); } catch { /* stockage plein ou refusé */ } };
const effacer = (cle: string) => { try { localStorage.removeItem(PREFIXE + cle); } catch { /* ignore */ } };
const maintenant = () => new Date().toISOString();
const id = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const ok = (data: unknown): ReponseLocale => ({ status: 200, data });
const erreur = (status: number, message: string): ReponseLocale => ({ status, data: { error: { code: 'local', message } } });

/* ------------------------------ Compte et profil ------------------------------ */
interface Profil {
  id: string; name: string | null; phone: string | null; email: string | null; photo: string | null;
  phoneVerifiedAt: string | null; createdAt: string;
}
interface CourseLocale {
  id: string; createdAt: string; status: string; statutLabel: string; depart: string; arrivee: string;
  distanceKm: number; montant: number; categorie: string; breakdown: unknown;
  paiement: { moyen: string | null; regle: boolean; montant: number | null };
  chauffeur: { name: string; matricule: string; vehicule: string | null; plaque: string | null } | null;
  note: number | null; annulation: null; sos: Array<{ id: string; at: string; status: string }>;
}

const profilAvecStats = (p: Profil) => {
  const courses = lire<CourseLocale[]>('courses', []);
  const km = courses.reduce((s, c) => s + (c.distanceKm || 0), 0);
  return {
    ...p,
    stats: {
      courses: courses.filter((c) => c.status !== 'cancelled').length, commandes: courses.length, annulations: 0, avertissements: 0,
      // Véhicules 100 % électriques : environ 120 g de CO₂ évités par kilomètre.
      pointsCarbone: Math.round(km * 10), co2EconomiseKg: Math.round(km * 0.12 * 10) / 10,
    },
  };
};

/** Une course terminée dans l'app est ajoutée à l'historique du téléphone. */
export function enregistrerCourseLocale(c: Omit<CourseLocale, 'id' | 'createdAt' | 'annulation' | 'sos'>): void {
  const courses = lire<CourseLocale[]>('courses', []);
  const course = { ...c, id: id('course'), createdAt: maintenant(), annulation: null, sos: [] };
  courses.unshift(course);
  ecrire('courses', courses.slice(0, 100));
  // ORION Assurance cochée : la cotisation (2 % de la course) est comptée pour l'année.
  const assurance = Number((c.breakdown as { insurance?: number } | null)?.insurance ?? 0);
  if (assurance > 0) {
    ecrire('cotisations', [{ amount: assurance, year: new Date().getFullYear(), rideId: course.id, at: course.createdAt, refunded: false }, ...lire<unknown[]>('cotisations', [])]);
  }
}

/* ------------------------------ Portefeuille ------------------------------ */
interface Mouvement { id: string; type: string; amount: number; at: string; note?: string }
const soldePortefeuille = () => lire<Mouvement[]>('portefeuille', []).reduce((s, m) => s + m.amount, 0);
/** Note donnée à la dernière course. */
export function noterDerniereCourseLocale(note: number): void {
  const courses = lire<CourseLocale[]>('courses', []);
  if (courses[0]) { courses[0].note = note; ecrire('courses', courses); }
}

/* ------------------------------ Alertes SOS ------------------------------ */
interface SosLocal {
  id: string; kind: string; status: 'raised' | 'acknowledged' | 'resolved'; createdAt: string;
  location: { lat: number; lng: number }; zoneName?: string; rideId?: string;
  chat: Array<{ from: 'agent' | 'usager'; author?: string; text: string; at: string }>;
  clotureeA: string | null;
}
const AGENT = 'Supervision ORION (démonstration)';

/** L'alerte évolue avec le temps, comme si un agent la prenait en charge — sans jamais prétendre avoir prévenu des secours. */
const suiviSos = (a: SosLocal) => {
  const ecoule = Date.now() - Date.parse(a.createdAt);
  const chat = [...a.chat];
  if (ecoule >= 3000) {
    chat.push({ from: 'agent', author: AGENT, at: plus(a.createdAt, 3000),
      text: 'Démonstration : cette alerte n’a été transmise à aucun service. En cas de danger réel, appelez tout de suite le 185 (SAMU), le 170 (Police) ou le 180 (Pompiers) avec les boutons ci-dessous.' });
  }
  if (ecoule >= 7000) {
    chat.push({ from: 'agent', author: AGENT, at: plus(a.createdAt, 7000),
      text: 'Avec le serveur ORION en service, un agent de supervision vous répondrait ici, verrait votre position en direct et pourrait prévenir les secours.' });
  }
  chat.sort((x, y) => x.at.localeCompare(y.at));
  return {
    // Personne ne prend réellement l'alerte en charge : aucune « prise en charge » n'est affichée.
    id: a.id, kind: a.kind, status: a.clotureeA ? 'resolved' : 'raised',
    createdAt: a.createdAt, location: a.location, zoneName: a.zoneName,
    priseEnCharge: null,
    chat, secours: [], clotureeA: a.clotureeA,
  };
};

/** Démonstration : la personne met fin elle-même à son alerte (en service, c'est la supervision). */
export function cloreSosLocal(alerteId: string): void {
  const liste = lire<SosLocal[]>('sos', []);
  const a = liste.find((x) => x.id === alerteId);
  if (a && !a.clotureeA) { a.clotureeA = maintenant(); ecrire('sos', liste); }
}

/* ------------------------------ Abonnement ------------------------------ */
const PLANS: Record<string, SubPlanInfo> = {
  bronze: { id: 'bronze', label: 'Pack Bronze', ridesPerDay: 2, monthlyPrice: 25_000, perRideCap: 2_500, tiers: ['bronze', 'argent'], remiseHorsQuota: 0, remiseLocation: 0, priorite: 0, annulationGratuite: false,
    benefits: ['2 courses incluses / jour', 'Niveaux Bronze & Argent', 'Plafond 2 500 F par course incluse', 'Support standard'], accent: '#cd7f4d' },
  argent: { id: 'argent', label: 'Pack Argent', ridesPerDay: 3, monthlyPrice: 38_000, perRideCap: 3_500, tiers: ['bronze', 'argent', 'or'], remiseHorsQuota: 0.1, remiseLocation: 0.05, priorite: 1, annulationGratuite: false,
    benefits: ['3 courses incluses / jour', 'Niveaux jusqu’à Or', 'Plafond 3 500 F par course incluse', 'Priorité de mise en relation', '-10 % au-delà du quota', '-5 % sur les locations'], accent: '#c8d2dc' },
  gold: { id: 'gold', label: 'Pack Gold', ridesPerDay: 4, monthlyPrice: 55_000, perRideCap: 5_000, tiers: ['bronze', 'argent', 'or', 'diamant'], remiseHorsQuota: 0.15, remiseLocation: 0.1, priorite: 2, annulationGratuite: true,
    benefits: ['4 courses incluses / jour', 'Tous les niveaux (jusqu’à Diamant)', 'Plafond 5 000 F par course incluse', 'Priorité maximale', '-15 % au-delà du quota', '-10 % sur les locations', 'Annulation gratuite'], accent: '#f5c451' },
};
interface AbonnementLocal { sub: NonNullable<SubState['subscription']>; factures: SubInvoice[] }
const etatAbonnement = (userId: string): SubState => {
  const a = lire<AbonnementLocal | null>(`abonnement.${userId}`, null);
  if (!a) return { subscription: null, plan: null, echu: false, joursRestants: 0, restantesAujourdhui: 0, factureEnAttente: null, invoices: [] };
  const echu = Date.parse(a.sub.renewsAt) < Date.now();
  const enAttente = a.factures.find((f) => f.status === 'en_attente') ?? null;
  return {
    subscription: a.sub, plan: PLANS[a.sub.plan] ?? null, echu,
    joursRestants: Math.max(0, Math.ceil((Date.parse(a.sub.renewsAt) - Date.now()) / 86_400_000)),
    restantesAujourdhui: a.sub.active && !echu && !enAttente ? Math.max(0, a.sub.ridesPerDay - a.sub.usedToday) : 0,
    factureEnAttente: enAttente, invoices: a.factures,
  };
};

/* ------------------------------ Messages ORION ------------------------------ */
interface MessageLocal {
  id: string; type: 'info' | 'consigne' | 'controle'; titre: string; texte: string; auteur: string;
  reponses: Array<{ code: string; libelle: string; alerte?: boolean }>; reponse?: { code: string; libelle: string; le: string };
  envoyeLe: string; luLe?: string;
}
const messages = (): MessageLocal[] => {
  const liste = lire<MessageLocal[] | null>('messages', null);
  if (liste) return liste;
  const accueil: MessageLocal[] = [{
    id: id('msg'), type: 'info', titre: 'Bienvenue sur ORION', auteur: 'ORION',
    texte: 'Votre compte est prêt. Commandez une course ou une livraison, enregistrez votre domicile et votre bureau, et créez votre dossier ORION Assurance pour que les secours sachent vous aider.',
    reponses: [], envoyeLe: maintenant(),
  }];
  ecrire('messages', accueil);
  return accueil;
};

/* ------------------------------ Routeur ------------------------------ */
/**
 * Réponse locale à une route du serveur ORION ; `null` = route non traitée ici (l'app
 * garde alors son comportement sans serveur, par exemple la course simulée).
 */
export function repondreLocal(chemin: string, init: RequestInit = {}): ReponseLocale | null {
  const methode = (init.method ?? 'GET').toUpperCase();
  const [path] = chemin.split('?');
  const corps = (() => { try { return init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}; } catch { return {}; } })();
  const m = (re: RegExp) => path!.match(re);
  let r: RegExpMatchArray | null;

  // --- Compte : code « SMS » (affiché à l'écran : aucun SMS ne part sans serveur)
  if (methode === 'POST' && path === '/clients/auth/otp') {
    const phone = String(corps.phone ?? '').replace(/\D/g, '');
    if (phone.length < 8) return erreur(400, 'Numéro de téléphone invalide.');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    ecrire('otp', { phone, code, at: Date.now() });
    const existant = lire<Profil | null>('profil', null);
    return ok({ devCode: code, compteExistant: Boolean(existant && existant.phone === phone) });
  }
  if (methode === 'POST' && path === '/clients/auth/verify') {
    const attendu = lire<{ phone: string; code: string; at: number } | null>('otp', null);
    const phone = String(corps.phone ?? '').replace(/\D/g, '');
    if (!attendu || attendu.phone !== phone) return erreur(400, 'Demandez d’abord un code.');
    if (Date.now() - attendu.at > 10 * 60_000) return erreur(400, 'Code expiré : demandez-en un nouveau.');
    if (String(corps.code ?? '').trim() !== attendu.code) return erreur(400, 'Code incorrect.');
    effacer('otp');
    const ancien = lire<Profil | null>('profil', null);
    const retrouve = Boolean(ancien && ancien.phone === phone);
    const profil: Profil = retrouve ? { ...ancien!, name: (corps.name as string) || ancien!.name, email: (corps.email as string) || ancien!.email } : {
      id: String(corps.clientId ?? id('client')), name: (corps.name as string) || null, phone, email: (corps.email as string) || null,
      photo: null, phoneVerifiedAt: maintenant(), createdAt: maintenant(),
    };
    ecrire('profil', profil);
    return ok({ token: `local.${id('session')}`, client: profilAvecStats(profil), compteRetrouve: retrouve });
  }
  if ((r = m(/^\/clients\/([^/]+)\/profile$/))) {
    const p = lire<Profil | null>('profil', null);
    if (!p) return erreur(404, 'Aucun compte sur ce téléphone.');
    if (methode === 'PUT') {
      const maj = { ...p, ...(typeof corps.name === 'string' ? { name: corps.name.trim() || p.name } : {}), ...(typeof corps.email === 'string' ? { email: corps.email.trim() || null } : {}) };
      ecrire('profil', maj); return ok({ client: profilAvecStats(maj) });
    }
    return ok({ client: profilAvecStats(p) });
  }
  if ((r = m(/^\/clients\/([^/]+)\/photo$/))) {
    const p = lire<Profil | null>('profil', null);
    if (!p) return erreur(404, 'Aucun compte sur ce téléphone.');
    const maj = { ...p, photo: methode === 'DELETE' ? null : String(corps.photo ?? '') || null };
    ecrire('profil', maj); return ok({ client: profilAvecStats(maj) });
  }
  if (methode === 'DELETE' && (r = m(/^\/clients\/([^/]+)$/))) {
    for (const cle of ['profil', 'courses', 'sos', 'support', 'messages', 'assurance', 'locations', 'portefeuille', 'cotisations', 'mariages']) effacer(cle);
    try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIXE + 'abonnement.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
    return ok({ supprime: true });
  }
  if ((r = m(/^\/clients\/([^/]+)\/history$/))) {
    const courses = lire<CourseLocale[]>('courses', []);
    const terminees = courses.filter((c) => ['completed', 'paid', 'rated'].includes(c.status));
    return ok({
      courses,
      resume: { total: courses.length, terminees: terminees.length, annulees: 0, depense: terminees.reduce((s, c) => s + c.montant, 0), fraisAnnulation: 0, alertesSos: lire<SosLocal[]>('sos', []).length },
    });
  }
  if ((r = m(/^\/clients\/([^/]+)\/sos$/))) return ok({ alertes: lire<SosLocal[]>('sos', []).map(suiviSos) });

  // --- Portefeuille et cotisations ORION Assurance
  if ((r = m(/^\/clients\/([^/]+)\/wallet\/transfer$/)) && methode === 'POST') {
    const montant = Math.round(Number(corps.amount ?? 0));
    if (!(montant > 0)) return erreur(400, 'Montant de transfert invalide.');
    if (montant > soldePortefeuille()) return erreur(400, 'Solde insuffisant.');
    const mvt: Mouvement = { id: id('mvt'), type: 'payout', amount: -montant, at: maintenant(), note: `Transfert vers ${String(corps.method ?? 'mobile money')}` };
    ecrire('portefeuille', [mvt, ...lire<Mouvement[]>('portefeuille', [])]);
    return ok({ transfer: mvt, balance: soldePortefeuille() });
  }
  if ((r = m(/^\/clients\/([^/]+)\/wallet$/))) {
    return ok({ balance: soldePortefeuille(), currency: 'XOF', history: lire<Mouvement[]>('portefeuille', []) });
  }
  if ((r = m(/^\/clients\/([^/]+)\/insurance$/))) {
    const annee = new Date().getFullYear();
    const items = lire<Array<{ amount: number; year: number; refunded: boolean }>>('cotisations', []).filter((c) => c.year === annee);
    const total = items.reduce((s, c) => s + c.amount, 0);
    const remboursable = items.filter((c) => !c.refunded).reduce((s, c) => s + c.amount, 0);
    return ok({ summary: { count: items.length, total, year: annee, estimatedRefund: Math.round(remboursable * 0.5) } });
  }

  // --- SOS
  if (methode === 'POST' && path === '/safety/sos') {
    const a: SosLocal = {
      id: id('sos'), kind: 'sos', status: 'raised', createdAt: maintenant(),
      location: (corps.location as SosLocal['location']) ?? { lat: 5.3236, lng: -4.0217 },
      zoneName: typeof corps.zoneName === 'string' ? corps.zoneName : undefined,
      rideId: typeof corps.rideId === 'string' ? corps.rideId : undefined, chat: [], clotureeA: null,
    };
    ecrire('sos', [a, ...lire<SosLocal[]>('sos', [])].slice(0, 30));
    return ok({ alert: { id: a.id, status: 'raised' }, suivi: suiviSos(a) });
  }
  if ((r = m(/^\/safety\/sos\/([^/]+)\/message$/)) && methode === 'POST') {
    const liste = lire<SosLocal[]>('sos', []);
    const a = liste.find((x) => x.id === r![1]);
    if (!a) return erreur(404, 'Alerte introuvable.');
    a.chat.push({ from: 'usager', text: String(corps.text ?? '').slice(0, 500), at: maintenant() });
    a.chat.push({ from: 'agent', author: AGENT, at: plus(maintenant(), 1), text: 'Message reçu. Démonstration : personne ne le lit en ce moment. En cas de danger, appelez le 185, le 170 ou le 180.' });
    ecrire('sos', liste);
    return ok({ suivi: suiviSos(a) });
  }
  if ((r = m(/^\/safety\/sos\/([^/]+)$/))) {
    const a = lire<SosLocal[]>('sos', []).find((x) => x.id === r![1]);
    return a ? ok({ suivi: suiviSos(a) }) : erreur(404, 'Alerte introuvable.');
  }

  // --- Aide (support)
  if (methode === 'POST' && path === '/support/messages') {
    const convs = lire<Array<{ id: string; clientId: string; subject: string; status: string; messages: Array<{ id: string; from: 'client' | 'agent'; author?: string; text: string; at: string }>; createdAt: string; updatedAt: string }>>('support', []);
    let c = convs[0];
    if (!c) { c = { id: id('conv'), clientId: String(corps.clientId ?? ''), subject: String(corps.subject ?? 'Aide'), status: 'open', messages: [], createdAt: maintenant(), updatedAt: maintenant() }; convs.unshift(c); }
    c.messages.push({ id: id('m'), from: 'client', text: String(corps.text ?? '').slice(0, 2000), at: maintenant() });
    c.messages.push({ id: id('m'), from: 'agent', author: 'Support ORION', at: plus(maintenant(), 1),
      text: 'Message bien reçu. Cette version de démonstration n’est reliée à aucun agent : avec le serveur ORION en service, le support vous répondrait ici. Pour une urgence, utilisez le bouton SOS.' });
    c.updatedAt = maintenant();
    ecrire('support', convs);
    return ok({ conversation: c });
  }
  if ((r = m(/^\/clients\/([^/]+)\/support$/))) return ok({ conversations: lire('support', []) });
  if (path === '/announcements') return ok({ announcements: [] });

  // --- Abonnement
  if (path === '/subscriptions/plans') return ok({ plans: Object.values(PLANS) });
  if (methode === 'POST' && path === '/subscriptions') {
    const userId = String(corps.userId ?? ''); const plan = PLANS[String(corps.plan ?? '')];
    if (!plan) return erreur(400, 'Forfait inconnu.');
    const debut = maintenant(); const fin = plus(debut, 30 * 86_400_000);
    const facture: SubInvoice = { id: id('fact'), userId, plan: plan.id, amount: plan.monthlyPrice, periodeDebut: debut, periodeFin: fin, status: 'en_attente', emiseLe: debut };
    ecrire(`abonnement.${userId}`, {
      sub: { id: id('abo'), userId, plan: plan.id, startedAt: debut, renewsAt: fin, ridesPerDay: plan.ridesPerDay, usedToday: 0, active: true, autoRenew: true, totalCouvert: 0, coursesCouvertes: 0 },
      factures: [facture],
    } satisfies AbonnementLocal);
    return ok({ subscription: etatAbonnement(userId).subscription });
  }
  if ((r = m(/^\/subscriptions\/factures\/([^/]+)\/payer$/)) && methode === 'POST') {
    for (const k of Object.keys(localStorage).filter((x) => x.startsWith(PREFIXE + 'abonnement.'))) {
      const a = lire<AbonnementLocal | null>(k.slice(PREFIXE.length), null);
      const f = a?.factures.find((x) => x.id === r![1]);
      if (a && f) { f.status = 'payee'; f.method = String(corps.method ?? 'wave'); f.payeeLe = maintenant(); ecrire(k.slice(PREFIXE.length), a); return ok({ facture: f }); }
    }
    return erreur(404, 'Facture introuvable.');
  }
  if ((r = m(/^\/subscriptions\/([^/]+)\/cancel$/)) && methode === 'POST') {
    const a = lire<AbonnementLocal | null>(`abonnement.${decodeURIComponent(r[1]!)}`, null);
    if (!a) return erreur(404, 'Aucun abonnement.');
    a.sub.autoRenew = false; a.sub.cancelledAt = maintenant();
    ecrire(`abonnement.${decodeURIComponent(r[1]!)}`, a);
    return ok({ subscription: a.sub });
  }
  if ((r = m(/^\/subscriptions\/([^/]+)$/))) return ok(etatAbonnement(decodeURIComponent(r[1]!)));

  // --- Mariage : même calcul que le serveur (niveau × durée + décoration + cortège)
  if (methode === 'POST' && path === '/wedding/reserve') {
    const prixJour = Object.fromEntries(TIERS.map((x) => [x.id, x.weddingDayPrice])) as Record<string, number>;
    const facteur: Record<string, number> = { halfday: 0.6, fullday: 1, weekend: 1.8 };
    const niveau = String(corps.tier ?? ''); const duree = String(corps.duration ?? 'fullday');
    if (!prixJour[niveau] || !facteur[duree]) return erreur(400, 'Niveau ou durée inconnus.');
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(corps.date ?? '')) || String(corps.date) < maintenant().slice(0, 10)) return erreur(400, 'Choisissez une date à venir.');
    const opts = (corps.options ?? {}) as { decoration?: boolean; convoy?: number };
    const breakdown = { vehicle: Math.round(prixJour[niveau]! * facteur[duree]!), decoration: opts.decoration ? 35_000 : 0, convoy: Math.max(0, Number(opts.convoy ?? 0)) * 40_000 };
    const reservation = {
      id: id('mariage'), userId: String(corps.userId ?? ''), tier: niveau, date: String(corps.date), duration: duree,
      options: { decoration: Boolean(opts.decoration), convoy: Math.max(0, Number(opts.convoy ?? 0)), chauffeur: true },
      breakdown, total: breakdown.vehicle + breakdown.decoration + breakdown.convoy, currency: 'XOF', status: 'reserved', createdAt: maintenant(),
    };
    ecrire('mariages', [reservation, ...lire<unknown[]>('mariages', [])].slice(0, 30));
    return { status: 201, data: { reservation } };
  }
  if ((r = m(/^\/wedding\/([^/]+)$/))) return ok({ reservations: lire('mariages', []) });

  // --- Locations
  if ((r = m(/^\/rental\/mes-locations\/([^/]+)$/))) return ok({ reservations: lire('locations', []) });
  if ((r = m(/^\/rental\/reservation\/([^/]+)\/annuler$/)) && methode === 'POST') {
    const liste = lire<Array<{ id: string; status: string; debut?: string; events: Array<{ type: string; at: string; note?: string }>; updatedAt: string }>>('locations', []);
    const res = liste.find((x) => x.id === decodeURIComponent(r![1]!));
    if (!res) return erreur(404, 'Réservation introuvable.');
    res.status = 'annulee'; res.updatedAt = maintenant(); res.events.push({ type: 'annulee', at: maintenant(), note: String(corps.raison ?? '') || undefined });
    ecrire('locations', liste);
    return ok({ frais: 0, message: 'Réservation annulée sans frais.' });
  }

  // --- Messages ORION
  if ((r = m(/^\/clients\/([^/]+)\/messages$/))) {
    const liste = messages();
    return ok({ messages: liste, nonLus: liste.filter((x) => !x.luLe).length });
  }
  if ((r = m(/^\/clients\/([^/]+)\/messages\/([^/]+)\/lu$/))) {
    const liste = messages(); const msg = liste.find((x) => x.id === r![2]);
    if (msg && !msg.luLe) { msg.luLe = maintenant(); ecrire('messages', liste); }
    return ok({ nonLus: liste.filter((x) => !x.luLe).length });
  }
  if ((r = m(/^\/clients\/([^/]+)\/messages\/([^/]+)\/reponse$/))) {
    const liste = messages(); const msg = liste.find((x) => x.id === r![2]);
    const choix = msg?.reponses.find((x) => x.code === corps.code);
    if (!msg || !choix) return erreur(400, 'Réponse inconnue.');
    msg.reponse = { code: choix.code, libelle: choix.libelle, le: maintenant() }; msg.luLe ??= maintenant();
    ecrire('messages', liste);
    return ok({ message: msg, alerteId: null });
  }

  // --- ORION Assurance : le dossier reste sur le téléphone (stockage privé de l'app)
  if ((r = m(/^\/clients\/([^/]+)\/assurance\/dossier$/))) {
    if (methode === 'PUT') {
      const avant = lire<{ fiche: unknown; depuis: string } | null>('assurance', null);
      ecrire('assurance', { fiche: corps.fiche, depuis: avant?.depuis ?? maintenant(), majLe: maintenant() });
    }
    if (methode === 'DELETE') effacer('assurance');
    const d = lire<{ fiche: unknown; depuis: string; majLe: string } | null>('assurance', null);
    const statut = { disponible: true, inscrit: Boolean(d), depuis: d?.depuis ?? null, majLe: d?.majLe ?? null, consultations: [] };
    return ok(methode === 'GET' ? { fiche: d?.fiche ?? null, statut } : { statut });
  }
  if ((r = m(/^\/clients\/([^/]+)\/assurance$/))) {
    const d = lire<{ depuis: string; majLe: string } | null>('assurance', null);
    return ok({ statut: { disponible: true, inscrit: Boolean(d), depuis: d?.depuis ?? null, majLe: d?.majLe ?? null, consultations: [] } });
  }

  return null; // course, devis, itinéraire : l'app garde son mode simulé
}

/** Réservation de location enregistrée sur le téléphone (devis calculé par l'app). */
export function reserverLocationLocale<T extends object>(devis: T, extra: Record<string, unknown>): T & { id: string; status: string; events: Array<{ type: string; at: string }>; createdAt: string; updatedAt: string } {
  const r = { ...devis, ...extra, id: id('loc'), status: 'confirmee', events: [{ type: 'confirmee', at: maintenant() }], createdAt: maintenant(), updatedAt: maintenant() };
  ecrire('locations', [r, ...lire<unknown[]>('locations', [])].slice(0, 50));
  return r as T & { id: string; status: string; events: Array<{ type: string; at: string }>; createdAt: string; updatedAt: string };
}
