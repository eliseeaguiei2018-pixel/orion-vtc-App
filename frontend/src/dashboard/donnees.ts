import { API, LIVE, clearSession, expKey, setCsrf } from '../admin/api';
import type { EntreeJournal, EtatTableau } from './types';

/**
 * Données du tableau de bord : même session que la console (cookie HttpOnly posé par
 * /admin/login), état complet par HTTP, et le direct par WebSocket (/ws/dashboard).
 */

export class NonConnecte extends Error {}

export async function lireEtat(): Promise<EtatTableau> {
  if (!LIVE) return etatDemo();
  const r = await fetch(`${API}/admin/dashboard`, { credentials: 'include' });
  if (r.status === 401 || r.status === 403) throw new NonConnecte();
  if (!r.ok) throw new Error(`Serveur ORION : ${r.status}`);
  return r.json() as Promise<EtatTableau>;
}

export async function seConnecter(username: string, password: string, code?: string): Promise<'ok' | 'code' | string> {
  const r = await fetch(`${API}/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ username, password, ...(code ? { code } : {}) }),
  });
  if (r.status === 429) return 'Compte temporairement verrouillé : réessayez plus tard.';
  if (!r.ok) return code ? 'Code invalide.' : 'Identifiants refusés. Accès réservé au personnel ORION.';
  const d = await r.json() as { mfaRequired?: boolean; csrfToken?: string; expiresAt?: string };
  if (d.mfaRequired) return 'code';
  if (d.csrfToken) setCsrf(d.csrfToken);
  localStorage.setItem(expKey, String(Date.parse(d.expiresAt ?? '') || Date.now() + 12 * 3600e3));
  return 'ok';
}

export function oublierSession() { clearSession(); }

/** Le direct : chaque ligne du journal arrive dès que le serveur la publie. */
export function ecouter(onEntree: (e: EntreeJournal) => void, onEtat: (connecte: boolean) => void): () => void {
  if (!LIVE) {
    // Démonstration sans serveur : un journal qui vit quand même.
    onEtat(true);
    const t = window.setInterval(() => onEntree(entreeDemo()), 6500);
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
        const m = JSON.parse(ev.data as string) as { type: string; data?: EntreeJournal };
        if (m.type === 'journal' && m.data) onEntree(m.data);
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
