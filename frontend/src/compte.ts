/**
 * DONNÉES DU COMPTE gardées sur le téléphone : contacts, groupes, famille, profil
 * professionnel, parrainage, mode simplifié, candidatures envoyées.
 *
 * Tout est en clair dans le stockage de l'application (rien de médical ni de bancaire ici).
 * Les envois vers ORION (candidature chauffeur, demande entreprise) passent par le support,
 * qui fonctionne avec ou sans serveur.
 */
export interface Contact { id: string; nom: string; telephone: string; confiance?: boolean }
export interface Groupe { id: string; nom: string; membres: string[] }
export type Tranche = 'ado' | 'adulte' | 'senior';
export interface Proche { id: string; nom: string; telephone: string; tranche: Tranche; lien?: string }
export interface ProfilPro { societe: string; email: string; nif?: string; motifObligatoire: boolean }
export interface CoursePro { id: string; le: string; trajet: string; montant: number; motif?: string }
export interface Demande { le: string; resume: string }

const lire = <T,>(cle: string, defaut: T): T => {
  try { const v = localStorage.getItem(cle); return v ? (JSON.parse(v) as T) : defaut; } catch { return defaut; }
};
const ecrire = (cle: string, v: unknown): void => { try { localStorage.setItem(cle, JSON.stringify(v)); } catch { /* stockage indisponible */ } };
const idNeuf = (p: string): string => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Numéro ivoirien ou international : 8 à 15 chiffres, « + » facultatif. */
export const telephoneValide = (t: string): boolean => /^\+?[0-9]{8,15}$/.test(t.replace(/[\s.-]/g, ''));
/** Numéro complet, indicatif +225 ajouté aux numéros locaux à dix chiffres. */
export function numeroComplet(t: string): string {
  const n = t.replace(/[\s.-]/g, '');
  return n.startsWith('+') ? n : /^0\d{9}$/.test(n) ? `+225${n}` : n;
}

/* ------------------------------- Contacts ------------------------------- */
export const contacts = (): Contact[] => lire<Contact[]>('orion.contacts', []);
export function enregistrerContact(c: Omit<Contact, 'id'> & { id?: string }): Contact[] {
  const liste = contacts();
  const neuf: Contact = { ...c, id: c.id ?? idNeuf('c'), telephone: numeroComplet(c.telephone), nom: c.nom.trim() };
  let suite = c.id ? liste.map((x) => (x.id === c.id ? neuf : x)) : [...liste, neuf];
  if (neuf.confiance) suite = suite.map((x) => (x.id === neuf.id ? x : { ...x, confiance: false }));   // un seul contact de confiance
  ecrire('orion.contacts', suite.slice(0, 20));
  return contacts();
}
export function retirerContact(id: string): Contact[] {
  ecrire('orion.contacts', contacts().filter((c) => c.id !== id));
  ecrire('orion.groupes', groupes().map((g) => ({ ...g, membres: g.membres.filter((m) => m !== id) })));
  return contacts();
}
/** Reprend le contact de confiance enregistré avant l'existence du carnet. */
export function reprendreContactDeConfiance(ancien: { name: string; phone: string } | null): void {
  if (!ancien?.name || !ancien.phone || contacts().length) return;
  enregistrerContact({ nom: ancien.name, telephone: ancien.phone, confiance: true });
}

/* ------------------------------- Groupes ------------------------------- */
export const groupes = (): Groupe[] => lire<Groupe[]>('orion.groupes', []);
export function enregistrerGroupe(g: Omit<Groupe, 'id'> & { id?: string }): Groupe[] {
  const liste = groupes();
  const neuf: Groupe = { id: g.id ?? idNeuf('g'), nom: g.nom.trim(), membres: [...new Set(g.membres)] };
  ecrire('orion.groupes', (g.id ? liste.map((x) => (x.id === g.id ? neuf : x)) : [...liste, neuf]).slice(0, 12));
  return groupes();
}
export function retirerGroupe(id: string): Groupe[] { ecrire('orion.groupes', groupes().filter((g) => g.id !== id)); return groupes(); }

/** Lien qui ouvre l'application de SMS du téléphone, destinataires et texte déjà remplis. */
export function lienSms(numeros: string[], texte: string): string {
  return `sms:${numeros.map(numeroComplet).join(',')}?body=${encodeURIComponent(texte)}`;
}

/* ------------------------------- Famille ------------------------------- */
export const famille = (): Proche[] => lire<Proche[]>('orion.famille', []);
export function enregistrerProche(p: Omit<Proche, 'id'> & { id?: string }): Proche[] {
  const liste = famille();
  const neuf: Proche = { ...p, id: p.id ?? idNeuf('f'), nom: p.nom.trim(), telephone: numeroComplet(p.telephone) };
  ecrire('orion.famille', (p.id ? liste.map((x) => (x.id === p.id ? neuf : x)) : [...liste, neuf]).slice(0, 10));
  return famille();
}
export function retirerProche(id: string): Proche[] { ecrire('orion.famille', famille().filter((p) => p.id !== id)); return famille(); }

/* --------------------------- Profil professionnel --------------------------- */
export const profilPro = (): ProfilPro | null => lire<ProfilPro | null>('orion.pro', null);
export function enregistrerProfilPro(p: ProfilPro | null): void {
  if (p) ecrire('orion.pro', { ...p, societe: p.societe.trim(), email: p.email.trim(), nif: p.nif?.trim() || undefined });
  else { try { localStorage.removeItem('orion.pro'); } catch { /* ignore */ } }
}
export const coursesPro = (): CoursePro[] => lire<CoursePro[]>('orion.pro.courses', []);
export function noterCoursePro(c: Omit<CoursePro, 'id' | 'le'>): void {
  ecrire('orion.pro.courses', [{ ...c, id: idNeuf('p'), le: new Date().toISOString() }, ...coursesPro()].slice(0, 200));
}
/** Relevé des courses professionnelles, en texte à colonnes (tableur, e-mail, comptabilité). */
export function relevePro(liste: CoursePro[]): string {
  const lignes = liste.map((c) => [new Date(c.le).toLocaleDateString('fr-FR'), c.trajet.replace(/;/g, ','), String(c.montant), (c.motif ?? '').replace(/;/g, ',')].join(';'));
  return ['Date;Trajet;Montant (F CFA);Motif', ...lignes].join('\n');
}

/* ------------------------------- Parrainage ------------------------------- */
/** Offre affichée : montants par défaut, à confirmer par ORION (réglables côté serveur plus tard). */
export const OFFRE_PARRAINAGE = { remise: 1000, courses: 3 };
/** Code de parrainage du client : stable, lisible, dérivé de son identifiant (sans le révéler). */
export function codeParrainage(clientId: string): string {
  let h = 2166136261;
  for (let i = 0; i < clientId.length; i++) { h ^= clientId.charCodeAt(i); h = Math.imul(h, 16777619); }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sans 0, O, 1, I : pas de confusion à la dictée
  let n = h >>> 0, s = '';
  for (let i = 0; i < 6; i++) { s += alphabet[n % 32]; n = Math.floor(n / 32) + (i === 2 ? clientId.length * 7 : 0); }
  return `ORION-${s}`;
}
export const formatCodeParrainage = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
export const codeParrainageValide = (v: string): boolean => /^ORION-[A-HJ-NP-Z2-9]{6}$/.test(v);
export const parrainSaisi = (): string | null => lire<string | null>('orion.parrain', null);
export const enregistrerParrain = (code: string): void => ecrire('orion.parrain', code);

/* ----------------------------- Mode simplifié ----------------------------- */
export const modeSimple = (): boolean => { try { return localStorage.getItem('orion.simple') === '1'; } catch { return false; } };
export const reglerModeSimple = (on: boolean): void => { try { localStorage.setItem('orion.simple', on ? '1' : '0'); } catch { /* ignore */ } };

/* -------------------- Demandes envoyées à ORION (suivi) -------------------- */
export const demande = (quoi: 'chauffeur' | 'entreprise'): Demande | null => lire<Demande | null>(`orion.demande.${quoi}`, null);
export const noterDemande = (quoi: 'chauffeur' | 'entreprise', resume: string): void => ecrire(`orion.demande.${quoi}`, { le: new Date().toISOString(), resume });
