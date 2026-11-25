import { Capacitor } from '@capacitor/core';
import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech';

/**
 * VOIX D'ORION PRO : guidage GPS et accueil du client à bord.
 *
 * Dans l'application Android, la WebView n'a pas de synthèse vocale (speechSynthesis
 * n'existe pas) : la voix passe par le moteur vocal du téléphone (Google Text-to-Speech,
 * Samsung TTS…), comme Yango ou Waze. Dans un navigateur, on garde la synthèse du navigateur.
 *
 * VOIX DE BORD : pendant une course, la voix suit le client — féminine pour accueillir un
 * client, masculine pour une cliente. L'accueil est dit par la voix humaine du serveur (plus
 * bas) ; le guidage, instantané, garde la voix du téléphone : parmi les voix françaises
 * installées, celle du bon genre et de la meilleure qualité, sinon la voix réaccordée.
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

/* ------------------- Voix humaine (IA conversationnelle, serveur) ------------------- */

/**
 * VOIX HUMAINE : l'accueil n'est plus lu par le moteur vocal du téléphone. Le serveur ORION le
 * fait dire par une voix d'IA conversationnelle (celles de Gemini ou de ChatGPT : intonation,
 * respirations, sourire dans la voix) ; ORION Pro télécharge ce son pendant l'approche et le
 * joue dès que le code est validé. Pas de son (réseau coupé, voix non réglée) : la meilleure
 * voix du téléphone prend le relais, sans que le chauffeur ait rien à faire.
 */
let contexteAudio: AudioContext | null = null;
let lectureSon: AudioBufferSourceNode | null = null;
let lectureElement: HTMLAudioElement | null = null;

/** À appeler sur un toucher (code validé, bouton) : le son de l'accueil pourra partir ensuite. */
export function deverrouillerAudio(): void {
  // iPhone : sans cela, la voix se tait quand le bouton « silencieux » est activé (session
  // audio « ambiante » par défaut). En « lecture », elle parle comme le GPS d'une app de navigation.
  try { const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession; if (s) s.type = 'playback'; } catch { /* navigateur sans session audio */ }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    contexteAudio ??= new Ctx();
    void contexteAudio.resume().catch(() => undefined);
  } catch { /* pas de son web : la voix du téléphone parlera */ }
}

/** Lecture par un élément audio (si le contexte audio est bloqué). */
async function jouerElement(audio: ArrayBuffer, type: string, mon: number): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([audio], { type }));
  try {
    const el = new Audio(url);
    lectureElement = el;
    await el.play();
    if (jetonAccueil !== mon) { el.pause(); return true; }
    await new Promise<void>((ok) => {
      const fin = () => ok();
      el.onended = fin; el.onerror = fin; el.onpause = fin;
      // Filet : la durée connue + 3 s, au cas où « ended » ne viendrait jamais.
      window.setTimeout(fin, ((Number.isFinite(el.duration) ? el.duration : 120) + 3) * 1000);
    });
    return true;
  } catch { return false; } finally {
    lectureElement = null;
    URL.revokeObjectURL(url);
  }
}

/** Joue le son de la voix humaine ; renvoie false s'il n'a pas pu partir. */
async function jouer(audio: ArrayBuffer, type: string, mon: number): Promise<boolean> {
  deverrouillerAudio();
  const ctx = contexteAudio;
  if (ctx) {
    try {
      if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((ok) => window.setTimeout(ok, 600))]);
      if (ctx.state === 'running') {
        const tampon = await ctx.decodeAudioData(audio.slice(0));
        if (jetonAccueil !== mon) return true;
        const src = ctx.createBufferSource();
        src.buffer = tampon;
        src.connect(ctx.destination);
        lectureSon = src;
        await new Promise<void>((ok) => {
          const t = window.setTimeout(ok, (tampon.duration + 3) * 1000);
          src.onended = () => { window.clearTimeout(t); ok(); };
          src.start();
        });
        return true;
      }
    } catch { /* format refusé par le contexte : on tente l'élément audio */ } finally { lectureSon = null; }
  }
  return jouerElement(audio, type, mon);
}

/** Son fabriqué par le serveur (ou sa promesse, s'il est encore en route). */
export interface SonVoix { audio: ArrayBuffer; type: string; voix: string | null; empreinte: string | null }

/** Quelle voix a dit le dernier accueil (essai depuis l'app). */
export let derniereVoixAccueil: 'humaine' | 'telephone' | null = null;

/**
 * Accueil du client à bord, dit par ORION Pro : la voix humaine du serveur si son son est là
 * (attendu au plus `attenteMs`), sinon la meilleure voix du téléphone, phrase après phrase, du
 * genre voulu. Le guidage se tait le temps de l'accueil, puis reprend.
 */
export async function direAccueil(texte: string, genre: GenreVoix, langue = 'fr-FR', son?: SonVoix | Promise<SonVoix | null> | null, attenteMs = 8000): Promise<void> {
  const mon = ++jetonAccueil;
  accueilEnCours = true;
  try {
    const pret = son ? await Promise.race([Promise.resolve(son).catch(() => null), new Promise<null>((ok) => window.setTimeout(() => ok(null), attenteMs))]) : null;
    if (jetonAccueil !== mon) return;
    if (pret && await jouer(pret.audio, pret.type, mon)) { derniereVoixAccueil = 'humaine'; return; }
    if (jetonAccueil !== mon) return;
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

/** Ouvre l'installation des voix du téléphone (voix haute qualité de Google Text-to-Speech, Android). */
export function installerVoix(): void {
  if (natif()) void TextToSpeech.openInstall().catch(() => undefined);
}
/** L'installation de voix depuis l'app n'existe que sur Android (sur iPhone : Réglages › Accessibilité). */
export const installationVoixPossible = (): boolean => natif() && Capacitor.getPlatform() === 'android';

export function taire(): void {
  jetonAccueil += 1;
  accueilEnCours = false;
  try { lectureSon?.stop(); } catch { /* déjà fini */ }
  try { lectureElement?.pause(); } catch { /* déjà fini */ }
  if (natif()) void TextToSpeech.stop().catch(() => undefined);
  try { window.speechSynthesis?.cancel(); } catch { /* rien à couper */ }
}
