import { Capacitor } from '@capacitor/core';
import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech';
import { cleGoogle } from './carteGoogle';

/**
 * VOIX D'ORION PRO : guidage GPS et accueil du client à bord.
 *
 * Dans l'application Android, la WebView n'a pas de synthèse vocale (speechSynthesis
 * n'existe pas) : la voix passe par le moteur vocal du téléphone (Google Text-to-Speech,
 * Samsung TTS…), comme Yango ou Waze. Dans un navigateur, on garde la synthèse du navigateur.
 *
 * VOIX DE BORD : pendant une course, la voix suit le client — féminine pour accueillir un
 * client, masculine pour une cliente. On choisit parmi les voix françaises installées celle
 * du bon genre, de la meilleure qualité (voix « réseau », plus naturelles) ; à défaut, la voix
 * du téléphone est légèrement réaccordée (hauteur) pour s'en approcher.
 */
export type GenreVoix = 'feminine' | 'masculine';

const natif = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TextToSpeech');

export function voixDisponible(): boolean {
  return natif() || (typeof window !== 'undefined' && 'speechSynthesis' in window);
}

/* --------------------------- Genre d'une voix installée --------------------------- */

interface VoixConnue { index: number; nom: string; lang: string; reseau: boolean }

// Noms des voix des moteurs courants : Google (fr-fr-x-fra… : a, c, vlf féminines ; b, d masculines),
// Samsung (SMTf / SMTm), iOS et navigateurs (prénoms des voix).
const MASCULIN = /(-x-frb|-x-frd|-x-cab|-x-cad|smtm\d|male\b|homme|thomas|henri|paul\b|nicolas|daniel|jacques|antoine|claude|eloi|remy|rémy|jerome|jérôme|yves|alain|guillaume|fabrice|gilles|jean\b|olivier|pierre|vincent|\bm\d\d\b)/i;
const FEMININ = /(-x-fra|-x-frc|-x-vlf|-x-caa|-x-cac|smtf\d|female|femme|amelie|amélie|audrey|aurelie|aurélie|marie|julie|hortense|denise|celine|céline|virginie|eloise|éloïse|chantal|sylvie|charlotte|brigitte|coralie|jacqueline|vivienne|google français|\bf\d\d\b)/i;

/** Genre probable d'une voix d'après son nom (null : inconnu). */
export function genreDeVoix(nom: string): GenreVoix | null {
  if (MASCULIN.test(nom)) return 'masculine';
  if (FEMININ.test(nom)) return 'feminine';
  return null;
}

let voixNatives: Promise<VoixConnue[]> | null = null;
function listerVoixNatives(): Promise<VoixConnue[]> {
  voixNatives ??= TextToSpeech.getSupportedVoices()
    .then(({ voices }) => voices.map((v, index) => ({ index, nom: `${v.voiceURI ?? ''} ${v.name ?? ''}`, lang: v.lang ?? '', reseau: v.localService === false })))
    .catch(() => []);
  return voixNatives;
}

function voixNavigateur(): SpeechSynthesisVoice[] {
  try { return window.speechSynthesis?.getVoices() ?? []; } catch { return []; }
}

/** Meilleure voix du genre voulu dans la langue (français d'abord : fr-FR, puis tout fr-*). */
function choisir<T extends { nom: string; lang: string; reseau: boolean }>(voix: T[], genre: GenreVoix, langue: string): T | null {
  const base = langue.slice(0, 2).toLowerCase();
  const memeLangue = voix.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base));
  const candidates = memeLangue.filter((v) => genreDeVoix(v.nom) === genre);
  if (candidates.length === 0) return null;
  const note = (v: T) => (v.lang.toLowerCase().replace('_', '-') === langue.toLowerCase() ? 4 : 0) + (v.reseau ? 2 : 0) + (/neural|natural|wavenet|premium|enhanced/i.test(v.nom) ? 1 : 0);
  return [...candidates].sort((a, b) => note(b) - note(a))[0]!;
}

/* ------------------------------ Voix de bord ------------------------------ */

let genreDeBord: GenreVoix | null = null;
/** Pendant une course : la voix (guidage et accueil) suit le client ; null hors course. */
export function definirVoixDeBord(g: GenreVoix | null): void { genreDeBord = g; }

/** Accueil en cours : le guidage attend la fin (il ne coupe pas la parole au client). */
let accueilEnCours = false;
let jetonAccueil = 0;
export function voixOccupee(): boolean { return accueilEnCours; }

interface Reglage { voix?: number; voixNav?: SpeechSynthesisVoice; pitch: number; rate: number }

async function reglagePour(genre: GenreVoix | null, langue: string, accueil: boolean): Promise<Reglage> {
  // Accueil : un peu plus posé, chaleureux. Guidage : débit normal, net.
  const rate = accueil ? 0.92 : 1.0;
  if (!genre) return { pitch: 1.0, rate };
  if (natif()) {
    const v = choisir(await listerVoixNatives(), genre, langue);
    if (v) return { voix: v.index, pitch: genre === 'feminine' ? 1.03 : 0.96, rate };
  } else {
    const liste = voixNavigateur().map((v) => ({ v, nom: `${v.voiceURI} ${v.name}`, lang: v.lang, reseau: !v.localService }));
    const v = choisir(liste, genre, langue);
    if (v) return { voixNav: v.v, pitch: genre === 'feminine' ? 1.03 : 0.96, rate };
  }
  // Aucune voix du bon genre installée : la voix du téléphone, réaccordée.
  return { pitch: genre === 'feminine' ? 1.18 : 0.78, rate };
}

async function dire(phrase: string, langue: string, r: Reglage, file: boolean): Promise<void> {
  if (natif()) {
    try {
      if (!file) await TextToSpeech.stop().catch(() => undefined);
      const delai = Math.ceil((phrase.length / (10 * r.rate)) * 1000) + 4000;
      await Promise.race([
        TextToSpeech.speak({
          text: phrase, lang: langue, rate: r.rate, pitch: r.pitch, volume: 1.0, category: 'playback',
          ...(r.voix !== undefined ? { voice: r.voix } : {}),
          queueStrategy: file ? QueueStrategy.Add : QueueStrategy.Flush,
        }),
        new Promise<void>((ok) => window.setTimeout(ok, delai)),
      ]);
      return;
    } catch { /* moteur vocal absent ou langue non installée : on tente la voix du navigateur */ }
  }
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(phrase);
    u.lang = langue;
    u.pitch = r.pitch;
    u.rate = r.rate;
    if (r.voixNav) u.voice = r.voixNav;
    if (!file) window.speechSynthesis.cancel();
    // Filet : un moteur qui ne signale jamais la fin ne doit pas laisser le guidage muet.
    const delai = Math.ceil((phrase.length / (12 * r.rate)) * 1000) + 2500;
    await new Promise<void>((ok) => {
      const t = window.setTimeout(ok, delai);
      const fin = () => { window.clearTimeout(t); ok(); };
      u.onend = fin; u.onerror = fin;
      window.speechSynthesis.speak(u);
    });
  } catch { /* pas de voix : le bandeau suffit */ }
}

/** Dit la phrase de guidage tout de suite (coupe la précédente). `langue` : fr-FR, en-US… */
export async function parler(phrase: string, langue: string): Promise<void> {
  if (voixOccupee()) return;
  await dire(phrase, langue, await reglagePour(genreDeBord, langue, false), false);
}

/* --------------------- Voix neuronale Google (la plus humaine) --------------------- */

/**
 * VOIX « COMME UNE VRAIE PERSONNE » : quand le projet Google d'ORION autorise Cloud Text-to-Speech
 * pour la clé de l'application, l'accueil est dit par une voix neuronale Google (Chirp 3 HD,
 * sinon WaveNet) : intonation, respirations et rythme d'une vraie hôtesse ou d'un vrai hôte.
 * Sans cette autorisation (refus 403), on n'insiste plus et la meilleure voix du téléphone parle.
 */
const VOIX_GOOGLE: Record<GenreVoix, Array<{ name: string; rate?: number }>> = {
  feminine: [{ name: 'fr-FR-Chirp3-HD-Aoede' }, { name: 'fr-FR-Wavenet-F', rate: 0.94 }, { name: 'fr-FR-Wavenet-C', rate: 0.94 }],
  masculine: [{ name: 'fr-FR-Chirp3-HD-Charon' }, { name: 'fr-FR-Wavenet-D', rate: 0.94 }, { name: 'fr-FR-Wavenet-B', rate: 0.94 }],
};
let googleRefuse = false;
let contexteAudio: AudioContext | null = null;

/** À appeler sur un toucher (code validé, bouton) : le son de l'accueil pourra partir ensuite. */
export function deverrouillerAudio(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    contexteAudio ??= new Ctx();
    void contexteAudio.resume().catch(() => undefined);
  } catch { /* pas de son web : la voix du téléphone parlera */ }
}

async function syntheseGoogle(texte: string, genre: GenreVoix): Promise<ArrayBuffer | null> {
  const cle = cleGoogle();
  if (!cle || googleRefuse || typeof fetch === 'undefined') return null;
  for (const v of VOIX_GOOGLE[genre]) {
    try {
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(cle)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { text: texte },
          voice: { languageCode: 'fr-FR', name: v.name },
          audioConfig: { audioEncoding: 'MP3', ...(v.rate ? { speakingRate: v.rate } : {}) },
        }),
      });
      if (res.status === 401 || res.status === 403) { googleRefuse = true; return null; }
      if (!res.ok) continue; // voix inconnue de ce projet : la suivante
      const { audioContent } = await res.json() as { audioContent?: string };
      if (!audioContent) continue;
      const bin = atob(audioContent);
      const octets = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
      return octets.buffer;
    } catch { return null; }
  }
  return null;
}

/** Joue l'audio de Google ; renvoie false si le son web n'a pas pu partir. */
async function jouer(audio: ArrayBuffer, mon: number): Promise<boolean> {
  deverrouillerAudio();
  const ctx = contexteAudio;
  if (!ctx) return false;
  try {
    const tampon = await ctx.decodeAudioData(audio.slice(0));
    if (jetonAccueil !== mon) return true;
    const src = ctx.createBufferSource();
    src.buffer = tampon;
    src.connect(ctx.destination);
    lectureGoogle = src;
    await new Promise<void>((ok) => { src.onended = () => ok(); src.start(); });
    return true;
  } catch { return false; } finally { lectureGoogle = null; }
}
let lectureGoogle: AudioBufferSourceNode | null = null;

/** Quelle voix a dit le dernier accueil (essai depuis l'app). */
export let derniereVoixAccueil: 'google' | 'telephone' | null = null;

/**
 * Accueil du client à bord, dit par ORION Pro : voix neuronale Google si elle est autorisée,
 * sinon la meilleure voix du téléphone, phrase après phrase (pauses naturelles), du genre voulu.
 * Le guidage se tait le temps de l'accueil, puis reprend.
 */
export async function direAccueil(texte: string, genre: GenreVoix, langue = 'fr-FR'): Promise<void> {
  const mon = ++jetonAccueil;
  accueilEnCours = true;
  try {
    const audio = await syntheseGoogle(texte, genre);
    if (jetonAccueil !== mon) return;
    if (audio && await jouer(audio, mon)) { derniereVoixAccueil = 'google'; return; }
    derniereVoixAccueil = 'telephone';
    const phrases = texte.match(/[^.!?;:]+[.!?;:]?/g)?.map((p) => p.trim()).filter(Boolean) ?? [texte];
    const r = await reglagePour(genre, langue, true);
    for (let i = 0; i < phrases.length; i++) {
      if (jetonAccueil !== mon) return; // coupé par le chauffeur (bouton de la voix)
      await dire(phrases[i]!, langue, r, i > 0);
    }
  } finally {
    if (jetonAccueil === mon) accueilEnCours = false;
  }
}

/** Ouvre l'installation des voix du téléphone (voix haute qualité de Google Text-to-Speech). */
export function installerVoix(): void {
  if (natif()) void TextToSpeech.openInstall().catch(() => undefined);
}

export function taire(): void {
  jetonAccueil += 1;
  accueilEnCours = false;
  try { lectureGoogle?.stop(); } catch { /* déjà fini */ }
  if (natif()) void TextToSpeech.stop().catch(() => undefined);
  try { window.speechSynthesis?.cancel(); } catch { /* rien à couper */ }
}
