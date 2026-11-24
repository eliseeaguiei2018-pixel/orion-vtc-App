import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import type { Container } from '../../container.js';
import { config } from '../../config/index.js';
import { createRepository, type Repository } from '../../core/db/repository.js';
import { AccesGoogle, compteServiceDe } from '../gcp/acces.js';

/**
 * VOIX HUMAINE D'ORION PRO : l'accueil du client à bord n'est plus lu par le moteur vocal du
 * téléphone, mais dit par une voix d'IA conversationnelle, celle des assistants vocaux
 * (Gemini, ChatGPT) : intonation, respirations, sourire dans la voix, rythme d'une vraie personne.
 *
 * Le SERVEUR fabrique le son ; ORION Pro le télécharge pendant que le chauffeur rejoint son
 * client et le joue dès que le code à 4 chiffres est validé. La clé du fournisseur reste sur le
 * serveur (jamais dans les applications) : la direction la saisit dans la console, où elle est
 * chiffrée, ou bien elle est donnée au serveur par une variable d'environnement.
 *
 * Fournisseurs :
 *  - google     : Google Cloud Text-to-Speech, voix Gemini (modèle Gemini-TTS, guidé par une
 *                 consigne de ton), à défaut les mêmes voix en Chirp 3 HD. MP3.
 *  - gemini     : API Gemini (clé Google AI Studio), mêmes voix, consigne de ton. WAV.
 *  - openai     : voix de ChatGPT (gpt-4o-mini-tts, consigne de ton). MP3.
 *  - elevenlabs : voix ElevenLabs choisies dans la bibliothèque du compte. MP3.
 *
 * Un même texte avec la même voix n'est fabriqué qu'une fois : le son est gardé en mémoire
 * quelques heures (l'aperçu pendant l'approche, puis la lecture à bord, ne coûtent qu'un appel).
 */

export type Fournisseur = 'google' | 'gemini' | 'openai' | 'elevenlabs';
export type GenreVoix = 'feminine' | 'masculine';
export const FOURNISSEURS: Fournisseur[] = ['google', 'gemini', 'openai', 'elevenlabs'];

export interface VoixCatalogue { id: string; nom: string; ton: string }
export interface FicheFournisseur {
  nom: string;
  /** Ce que la direction colle dans la console. */
  cle: string;
  /** Où obtenir la clé, en clair (la console l'affiche, sans lien cliquable obligatoire). */
  obtenir: string;
  feminines: VoixCatalogue[];
  masculines: VoixCatalogue[];
  /** true : identifiants de voix libres (bibliothèque du compte), pas de liste fixe. */
  voixLibres?: boolean;
  defaut: Record<GenreVoix, string>;
  modele: string;
  /** Coût indicatif d'un accueil (≈ 1 100 caractères, 75 secondes). */
  cout: string;
}

// Les 30 voix Gemini (mêmes noms en Gemini-TTS, Chirp 3 HD et API Gemini).
const GEMINI_F: VoixCatalogue[] = [
  { id: 'Sulafat', nom: 'Sulafat', ton: 'chaleureuse' },
  { id: 'Vindemiatrix', nom: 'Vindemiatrix', ton: 'douce' },
  { id: 'Achernar', nom: 'Achernar', ton: 'feutrée' },
  { id: 'Despina', nom: 'Despina', ton: 'veloutée' },
  { id: 'Aoede', nom: 'Aoede', ton: 'légère' },
  { id: 'Callirrhoe', nom: 'Callirrhoe', ton: 'détendue' },
  { id: 'Erinome', nom: 'Erinome', ton: 'claire' },
  { id: 'Kore', nom: 'Kore', ton: 'assurée' },
  { id: 'Leda', nom: 'Leda', ton: 'jeune' },
  { id: 'Zephyr', nom: 'Zephyr', ton: 'lumineuse' },
  { id: 'Laomedeia', nom: 'Laomedeia', ton: 'enjouée' },
  { id: 'Autonoe', nom: 'Autonoe', ton: 'vive' },
  { id: 'Gacrux', nom: 'Gacrux', ton: 'mûre' },
  { id: 'Pulcherrima', nom: 'Pulcherrima', ton: 'directe' },
];
const GEMINI_M: VoixCatalogue[] = [
  { id: 'Achird', nom: 'Achird', ton: 'amical' },
  { id: 'Algieba', nom: 'Algieba', ton: 'velouté' },
  { id: 'Umbriel', nom: 'Umbriel', ton: 'détendu' },
  { id: 'Charon', nom: 'Charon', ton: 'posé' },
  { id: 'Iapetus', nom: 'Iapetus', ton: 'clair' },
  { id: 'Schedar', nom: 'Schedar', ton: 'égal' },
  { id: 'Sadaltager', nom: 'Sadaltager', ton: 'cultivé' },
  { id: 'Zubenelgenubi', nom: 'Zubenelgenubi', ton: 'décontracté' },
  { id: 'Algenib', nom: 'Algenib', ton: 'grave' },
  { id: 'Orus', nom: 'Orus', ton: 'ferme' },
  { id: 'Rasalgethi', nom: 'Rasalgethi', ton: 'informé' },
  { id: 'Alnilam', nom: 'Alnilam', ton: 'solide' },
  { id: 'Puck', nom: 'Puck', ton: 'enjoué' },
  { id: 'Enceladus', nom: 'Enceladus', ton: 'soufflé' },
  { id: 'Sadachbia', nom: 'Sadachbia', ton: 'vif' },
  { id: 'Fenrir', nom: 'Fenrir', ton: 'animé' },
];

export const CATALOGUE: Record<Fournisseur, FicheFournisseur> = {
  google: {
    nom: 'Google : voix Gemini (Cloud Text-to-Speech)',
    cle: 'Clé API Google Cloud autorisée pour « Cloud Text-to-Speech API »',
    obtenir: 'console.cloud.google.com → API et services → Bibliothèque → « Cloud Text-to-Speech API » → Activer ; puis Identifiants → Créer une clé API, restreinte à Cloud Text-to-Speech API. Utilisez une clé distincte de celle de Google Maps (la clé Maps est dans les applications).',
    feminines: GEMINI_F, masculines: GEMINI_M,
    defaut: { feminine: 'Sulafat', masculine: 'Achird' },
    modele: 'gemini-2.5-flash-tts',
    cout: 'environ 10 à 20 F CFA par accueil',
  },
  gemini: {
    nom: 'Gemini (clé Google AI Studio)',
    cle: 'Clé API Gemini',
    obtenir: 'aistudio.google.com → Get API key → Créer une clé. Pour un usage quotidien, activez la facturation du projet (l’essai gratuit est limité à quelques accueils par jour).',
    feminines: GEMINI_F, masculines: GEMINI_M,
    defaut: { feminine: 'Sulafat', masculine: 'Achird' },
    modele: 'gemini-2.5-flash-preview-tts',
    cout: 'environ 10 à 20 F CFA par accueil',
  },
  openai: {
    nom: 'OpenAI : voix de ChatGPT',
    cle: 'Clé API OpenAI (sk-…)',
    obtenir: 'platform.openai.com → API keys → Create new secret key (crédit prépayé requis).',
    feminines: [
      { id: 'marin', nom: 'Marin', ton: 'naturelle' },
      { id: 'coral', nom: 'Coral', ton: 'chaleureuse' },
      { id: 'shimmer', nom: 'Shimmer', ton: 'douce' },
      { id: 'nova', nom: 'Nova', ton: 'vive' },
      { id: 'sage', nom: 'Sage', ton: 'posée' },
    ],
    masculines: [
      { id: 'cedar', nom: 'Cedar', ton: 'naturel' },
      { id: 'ash', nom: 'Ash', ton: 'chaleureux' },
      { id: 'ballad', nom: 'Ballad', ton: 'doux' },
      { id: 'verse', nom: 'Verse', ton: 'expressif' },
      { id: 'echo', nom: 'Echo', ton: 'posé' },
      { id: 'onyx', nom: 'Onyx', ton: 'grave' },
    ],
    defaut: { feminine: 'marin', masculine: 'cedar' },
    modele: 'gpt-4o-mini-tts',
    cout: 'environ 10 F CFA par accueil',
  },
  elevenlabs: {
    nom: 'ElevenLabs',
    cle: 'Clé API ElevenLabs',
    obtenir: 'elevenlabs.io → Profil → API Keys. Choisissez une voix française dans la bibliothèque (Voices) et copiez son identifiant (Voice ID).',
    feminines: [], masculines: [], voixLibres: true,
    defaut: { feminine: '', masculine: '' },
    modele: 'eleven_multilingual_v2',
    cout: 'selon l’abonnement ElevenLabs (le plus cher des quatre)',
  },
};

/** Consigne de ton donnée à la voix (Gemini-TTS, Gemini, OpenAI). */
export const STYLE_DEFAUT = 'Tu es la voix d’accueil d’Orion, une compagnie de VTC à Abidjan, en Côte d’Ivoire. '
  + 'Dis ce message en français comme une vraie personne de l’équipe d’accueil qui reçoit un passager avec plaisir : '
  + 'voix chaleureuse et souriante, ton bienveillant et rassurant, rythme calme et naturel, '
  + 'avec de petites respirations entre les phrases. Jamais de ton robotique, publicitaire ou récité.';

/** Texte tel qu'il doit être prononcé (sigles et symboles qu'une voix lit mal). */
export function texteAPrononcer(t: string): string {
  return t
    .replace(/\bORION\b/g, 'Orion')
    .replace(/(\d)\s*%/g, '$1 pour cent')
    .replace(/\bWi-?Fi\b/gi, 'wifi')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ------------------------------ Synthèse ------------------------------ */

export type Recuperer = (url: string, init?: RequestInit) => Promise<Response>;

export interface AudioVoix {
  octets: Buffer;
  type: string;
  fournisseur: Fournisseur;
  voix: string;
  modele: string;
}

export class ErreurVoix extends Error {
  constructor(readonly fournisseur: Fournisseur, readonly statut: number, message: string) {
    super(message);
    this.name = 'ErreurVoix';
  }
}

export interface DemandeSynthese {
  fournisseur: Fournisseur;
  /** Clé API ; pour Google, absente si le serveur a un compte de service. */
  cle: string | null;
  voix: string;
  style: string;
  texte: string;
  modele?: string;
  recuperer?: Recuperer;
  acces?: AccesGoogle | null;
}

const DELAI_MS = 60_000;

async function messageErreur(res: Response): Promise<string> {
  const brut = await res.text().catch(() => '');
  try {
    const j = JSON.parse(brut) as { error?: { message?: string } | string; detail?: { message?: string } | string };
    const e = typeof j.error === 'string' ? j.error : j.error?.message ?? (typeof j.detail === 'string' ? j.detail : j.detail?.message);
    if (e) return e.slice(0, 300);
  } catch { /* corps non JSON */ }
  return (brut || res.statusText).slice(0, 300);
}

/** En-tête WAV (PCM 16 bits mono) autour du son brut de l'API Gemini. */
export function enWav(pcm: Buffer, frequence = 24000, canaux = 1): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(canaux, 22);
  h.writeUInt32LE(frequence, 24); h.writeUInt32LE(frequence * canaux * 2, 28); h.writeUInt16LE(canaux * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function enteteGoogle(d: DemandeSynthese): Promise<Record<string, string>> {
  if (d.cle) return { 'x-goog-api-key': d.cle };
  if (d.acces) return { authorization: `Bearer ${await d.acces.jeton()}` };
  throw new ErreurVoix('google', 401, 'Aucune clé Google Cloud enregistrée');
}

async function syntheseGoogle(d: DemandeSynthese, r: Recuperer): Promise<AudioVoix> {
  const entete = { 'content-type': 'application/json', ...(await enteteGoogle(d)) };
  const modele = d.modele || CATALOGUE.google.modele;
  const essais = [
    // 1. Gemini-TTS : la voix suit la consigne de ton (chaleur, sourire, rythme).
    { modele, corps: { input: { prompt: d.style, text: d.texte }, voice: { languageCode: 'fr-FR', name: d.voix, modelName: modele }, audioConfig: { audioEncoding: 'MP3' } } },
    // 2. La même voix en Chirp 3 HD (sans consigne, très naturelle elle aussi).
    { modele: 'chirp3-hd', corps: { input: { text: d.texte }, voice: { languageCode: 'fr-FR', name: `fr-FR-Chirp3-HD-${d.voix}` }, audioConfig: { audioEncoding: 'MP3', speakingRate: 0.96 } } },
  ];
  const erreurs: string[] = [];
  let statut = 502;
  for (const e of essais) {
    const res = await r('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST', headers: entete, body: JSON.stringify(e.corps), signal: AbortSignal.timeout(DELAI_MS),
    });
    if (res.ok) {
      const j = (await res.json()) as { audioContent?: string };
      if (j.audioContent) return { octets: Buffer.from(j.audioContent, 'base64'), type: 'audio/mpeg', fournisseur: 'google', voix: d.voix, modele: e.modele };
      erreurs.push(`${e.modele} : réponse sans son`);
      continue;
    }
    statut = res.status;
    erreurs.push(`${e.modele} : ${res.status} ${await messageErreur(res)}`);
  }
  throw new ErreurVoix('google', statut, erreurs.join(' · '));
}

async function syntheseGemini(d: DemandeSynthese, r: Recuperer): Promise<AudioVoix> {
  if (!d.cle) throw new ErreurVoix('gemini', 401, 'Aucune clé Gemini enregistrée');
  const modeles = [...new Set([d.modele || CATALOGUE.gemini.modele, 'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'])];
  const erreurs: string[] = [];
  let statut = 502;
  for (const m of modeles) {
    const res = await r(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': d.cle },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${d.style}\n\n${d.texte}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: d.voix } } } },
      }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (res.ok) {
      const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
      const parts = j.candidates?.[0]?.content?.parts ?? [];
      const sons = parts.map((p) => p.inlineData).filter((x): x is { mimeType?: string; data: string } => Boolean(x?.data));
      if (sons.length === 0) { erreurs.push(`${m} : réponse sans son`); continue; }
      const type = sons[0]!.mimeType ?? '';
      const brut = Buffer.concat(sons.map((s) => Buffer.from(s.data, 'base64')));
      if (/wav|mpeg|mp3|ogg/i.test(type)) return { octets: brut, type: type.split(';')[0]!, fournisseur: 'gemini', voix: d.voix, modele: m };
      const frequence = Number(/rate=(\d+)/.exec(type)?.[1] ?? 24000);
      return { octets: enWav(brut, frequence), type: 'audio/wav', fournisseur: 'gemini', voix: d.voix, modele: m };
    }
    statut = res.status;
    erreurs.push(`${m} : ${res.status} ${await messageErreur(res)}`);
    // Modèle inconnu (renommé) : le suivant. Clé refusée ou quota : inutile d'insister.
    if (res.status !== 404 && res.status !== 400) break;
  }
  throw new ErreurVoix('gemini', statut, erreurs.join(' · '));
}

async function syntheseOpenAI(d: DemandeSynthese, r: Recuperer): Promise<AudioVoix> {
  if (!d.cle) throw new ErreurVoix('openai', 401, 'Aucune clé OpenAI enregistrée');
  const modele = d.modele || CATALOGUE.openai.modele;
  const res = await r('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${d.cle}` },
    body: JSON.stringify({ model: modele, voice: d.voix, input: d.texte, instructions: d.style, response_format: 'mp3' }),
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!res.ok) throw new ErreurVoix('openai', res.status, `${res.status} ${await messageErreur(res)}`);
  return { octets: Buffer.from(await res.arrayBuffer()), type: 'audio/mpeg', fournisseur: 'openai', voix: d.voix, modele };
}

async function syntheseElevenLabs(d: DemandeSynthese, r: Recuperer): Promise<AudioVoix> {
  if (!d.cle) throw new ErreurVoix('elevenlabs', 401, 'Aucune clé ElevenLabs enregistrée');
  if (!/^[A-Za-z0-9]{8,40}$/.test(d.voix)) throw new ErreurVoix('elevenlabs', 400, 'Identifiant de voix ElevenLabs manquant (Voice ID)');
  const modele = d.modele || CATALOGUE.elevenlabs.modele;
  const res = await r(`https://api.elevenlabs.io/v1/text-to-speech/${d.voix}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': d.cle, accept: 'audio/mpeg' },
    body: JSON.stringify({ text: d.texte, model_id: modele, voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } }),
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!res.ok) throw new ErreurVoix('elevenlabs', res.status, `${res.status} ${await messageErreur(res)}`);
  return { octets: Buffer.from(await res.arrayBuffer()), type: 'audio/mpeg', fournisseur: 'elevenlabs', voix: d.voix, modele };
}

export async function synthetiser(d: DemandeSynthese): Promise<AudioVoix> {
  const r = d.recuperer ?? ((url, init) => fetch(url, init));
  const demande = { ...d, texte: texteAPrononcer(d.texte) };
  switch (d.fournisseur) {
    case 'google': return syntheseGoogle(demande, r);
    case 'gemini': return syntheseGemini(demande, r);
    case 'openai': return syntheseOpenAI(demande, r);
    case 'elevenlabs': return syntheseElevenLabs(demande, r);
  }
}

/* ------------------------- Réglages et clés (console) ------------------------- */

interface CleChiffree { iv: string; tag: string; data: string; fin: string; majLe: string }
export interface ReglageVoix {
  /** 'aucun' : la voix du téléphone (comme avant). */
  fournisseur: Fournisseur | 'aucun';
  voix: Partial<Record<Fournisseur, Partial<Record<GenreVoix, string>>>>;
  style: string;
  modele: Partial<Record<Fournisseur, string>>;
}
interface EnregistrementVoix extends ReglageVoix { id: 'reglage'; cles: Partial<Record<Fournisseur, CleChiffree>>; majLe: string; majPar: string }

const VAR_CLE: Record<Fournisseur, string> = { google: 'GOOGLE_TTS_API_KEY', gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY' };

export interface EtatCle { enregistree: boolean; source: 'console' | 'serveur' | 'compte_service' | null; fin: string | null }
export interface DernierEssai { ok: boolean; at: string; fournisseur: Fournisseur; voix: string; modele?: string; erreur?: string; octets?: number }

export interface OptionsVoix { recuperer?: Recuperer; env?: Record<string, string | undefined>; maintenant?: () => number }

interface EntreeCache { audio: AudioVoix; at: number }
const CACHE_MAX_OCTETS = 80 * 1024 * 1024;
const CACHE_DUREE_MS = 4 * 3600_000;

export class VoixHumaine {
  private readonly depot: Repository<EnregistrementVoix> = createRepository<EnregistrementVoix>('voix_humaine');
  private readonly env: Record<string, string | undefined>;
  private readonly recuperer?: Recuperer;
  private readonly maintenant: () => number;
  private cleCoffre: Buffer | null = null;
  private readonly cache = new Map<string, EntreeCache>();
  private octetsEnCache = 0;
  private readonly enCours = new Map<string, Promise<AudioVoix>>();
  private acces: AccesGoogle | null | undefined;
  dernierEssai: DernierEssai | null = null;

  constructor(o: OptionsVoix = {}) {
    this.env = o.env ?? process.env;
    this.recuperer = o.recuperer;
    this.maintenant = o.maintenant ?? Date.now;
  }

  /* --- coffre des clés : AES-256-GCM, clé dérivée du secret du serveur (jamais en base) --- */
  private coffre(): Buffer {
    this.cleCoffre ??= scryptSync(`${config.ADMIN_JWT_SECRET}|${config.CLIENT_JWT_SECRET ?? ''}`, 'orion-voix-humaine-v1', 32);
    return this.cleCoffre;
  }
  private chiffrer(f: Fournisseur, cle: string): CleChiffree {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.coffre(), iv);
    c.setAAD(Buffer.from(`voix:${f}`));
    const data = Buffer.concat([c.update(cle, 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64'), fin: cle.slice(-4), majLe: new Date(this.maintenant()).toISOString() };
  }
  private dechiffrer(f: Fournisseur, e: CleChiffree): string | null {
    try {
      const d = createDecipheriv('aes-256-gcm', this.coffre(), Buffer.from(e.iv, 'base64'));
      d.setAAD(Buffer.from(`voix:${f}`));
      d.setAuthTag(Buffer.from(e.tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString('utf8');
    } catch { return null; } // secret du serveur changé : la clé est à ressaisir
  }

  private enregistrement(): EnregistrementVoix | undefined { return this.depot.get('reglage'); }

  /** Fournisseur par défaut : celui de la console, sinon VOIX_HUMAINE (variable), sinon le premier qui a une clé serveur. */
  reglage(): ReglageVoix {
    const e = this.enregistrement();
    if (e) return { fournisseur: e.fournisseur, voix: e.voix ?? {}, style: e.style || STYLE_DEFAUT, modele: e.modele ?? {} };
    const variable = this.env.VOIX_HUMAINE?.trim() as Fournisseur | 'aucun' | undefined;
    const auto = variable && (variable === 'aucun' || FOURNISSEURS.includes(variable))
      ? variable
      : FOURNISSEURS.find((f) => this.env[VAR_CLE[f]]?.trim()) ?? 'aucun';
    return { fournisseur: auto, voix: {}, style: STYLE_DEFAUT, modele: {} };
  }

  voixPour(f: Fournisseur, genre: GenreVoix, r = this.reglage()): string {
    return r.voix[f]?.[genre]?.trim() || CATALOGUE[f].defaut[genre];
  }

  private accesGoogle(): AccesGoogle | null {
    if (this.acces === undefined) {
      try { this.acces = compteServiceDe(this.env) ? new AccesGoogle({ env: this.env, recuperer: this.recuperer }) : null; } catch { this.acces = null; }
    }
    return this.acces;
  }

  cle(f: Fournisseur): string | null {
    const e = this.enregistrement()?.cles?.[f];
    if (e) { const v = this.dechiffrer(f, e); if (v) return v; }
    return this.env[VAR_CLE[f]]?.trim() || null;
  }

  etatCle(f: Fournisseur): EtatCle {
    const e = this.enregistrement()?.cles?.[f];
    if (e && this.dechiffrer(f, e)) return { enregistree: true, source: 'console', fin: e.fin };
    const v = this.env[VAR_CLE[f]]?.trim();
    if (v) return { enregistree: true, source: 'serveur', fin: v.slice(-4) };
    if (f === 'google' && this.accesGoogle()) return { enregistree: true, source: 'compte_service', fin: null };
    return { enregistree: false, source: null, fin: null };
  }

  /** La voix humaine peut-elle parler ? (fournisseur choisi et clé présente) */
  active(): boolean {
    const r = this.reglage();
    return r.fournisseur !== 'aucun' && this.etatCle(r.fournisseur).enregistree
      && (r.fournisseur !== 'elevenlabs' || Boolean(this.voixPour('elevenlabs', 'feminine', r) && this.voixPour('elevenlabs', 'masculine', r)));
  }

  enregistrer(maj: Partial<ReglageVoix> & { cle?: string | null; cleDe?: Fournisseur }, acteur: string): void {
    const avant = this.enregistrement();
    const r = this.reglage();
    const cles = { ...(avant?.cles ?? {}) };
    if (maj.cleDe && maj.cle !== undefined) {
      if (maj.cle) cles[maj.cleDe] = this.chiffrer(maj.cleDe, maj.cle.trim());
      else delete cles[maj.cleDe];
    }
    this.depot.put({
      id: 'reglage',
      fournisseur: maj.fournisseur ?? r.fournisseur,
      voix: { ...r.voix, ...(maj.voix ?? {}) },
      style: maj.style?.trim() || r.style,
      modele: { ...r.modele, ...(maj.modele ?? {}) },
      cles,
      majLe: new Date(this.maintenant()).toISOString(),
      majPar: acteur,
    });
    this.viderCache();
  }

  majLe(): { majLe: string | null; majPar: string | null } {
    const e = this.enregistrement();
    return { majLe: e?.majLe ?? null, majPar: e?.majPar ?? null };
  }

  /* --------------------------------- cache --------------------------------- */
  private viderCache(): void { this.cache.clear(); this.octetsEnCache = 0; }

  private ranger(cle: string, audio: AudioVoix): void {
    const ancien = this.cache.get(cle);
    if (ancien) { this.octetsEnCache -= ancien.audio.octets.length; this.cache.delete(cle); }
    this.cache.set(cle, { audio, at: this.maintenant() });
    this.octetsEnCache += audio.octets.length;
    for (const [k, v] of this.cache) {
      if (this.octetsEnCache <= CACHE_MAX_OCTETS && this.maintenant() - v.at < CACHE_DUREE_MS) break;
      this.cache.delete(k); this.octetsEnCache -= v.audio.octets.length;
    }
  }

  /** Empreinte d'un accueil : même texte, même voix, même ton → même son (le préchargé sert). */
  empreinte(texte: string, genre: GenreVoix, r = this.reglage()): string | null {
    if (r.fournisseur === 'aucun') return null;
    const f = r.fournisseur;
    return createHash('sha256').update(JSON.stringify([f, this.voixPour(f, genre, r), r.modele[f] ?? '', r.style, texte])).digest('hex').slice(0, 24);
  }

  enCache(empreinte: string): boolean {
    const e = this.cache.get(empreinte);
    return Boolean(e && this.maintenant() - e.at < CACHE_DUREE_MS);
  }

  /** Son de la voix humaine pour ce texte (fabriqué une fois, puis gardé). */
  async audio(texte: string, genre: GenreVoix): Promise<AudioVoix & { empreinte: string }> {
    const r = this.reglage();
    if (r.fournisseur === 'aucun') throw new ErreurVoix('google', 409, 'Voix humaine non configurée');
    const f = r.fournisseur;
    const emp = this.empreinte(texte, genre, r)!;
    const garde = this.cache.get(emp);
    if (garde && this.maintenant() - garde.at < CACHE_DUREE_MS) return { ...garde.audio, empreinte: emp };
    let p = this.enCours.get(emp);
    if (!p) {
      p = this.fabriquer({ fournisseur: f, voix: this.voixPour(f, genre, r), style: r.style, modele: r.modele[f], texte })
        .then((a) => { this.ranger(emp, a); return a; })
        .finally(() => this.enCours.delete(emp));
      this.enCours.set(emp, p);
    }
    return { ...(await p), empreinte: emp };
  }

  /** Essai depuis la console : réglages proposés (pas encore enregistrés) ou en vigueur. */
  async essai(o: { fournisseur: Fournisseur; voix: string; style?: string; modele?: string; cle?: string | null; texte: string }): Promise<AudioVoix> {
    return this.fabriquer({ ...o, style: o.style?.trim() || this.reglage().style }, o.cle ?? undefined);
  }

  private async fabriquer(o: { fournisseur: Fournisseur; voix: string; style: string; modele?: string; texte: string }, cleProposee?: string): Promise<AudioVoix> {
    const cle = cleProposee?.trim() || this.cle(o.fournisseur);
    try {
      const a = await synthetiser({ ...o, cle, recuperer: this.recuperer, acces: o.fournisseur === 'google' && !cle ? this.accesGoogle() : null });
      this.dernierEssai = { ok: true, at: new Date(this.maintenant()).toISOString(), fournisseur: o.fournisseur, voix: o.voix, modele: a.modele, octets: a.octets.length };
      return a;
    } catch (e) {
      const erreur = e instanceof ErreurVoix ? e : new ErreurVoix(o.fournisseur, 502, e instanceof Error ? e.message : 'erreur inconnue');
      // Jamais la clé dans un message : on la masque si un fournisseur la renvoie.
      const message = cle ? erreur.message.split(cle).join('••••') : erreur.message;
      this.dernierEssai = { ok: false, at: new Date(this.maintenant()).toISOString(), fournisseur: o.fournisseur, voix: o.voix, erreur: message };
      throw new ErreurVoix(erreur.fournisseur, erreur.statut, message);
    }
  }
}

const instances = new WeakMap<Container, VoixHumaine>();
/** Service de voix humaine d'un serveur (un par conteneur). */
export function voixHumaine(c: Container, o?: OptionsVoix): VoixHumaine {
  let v = instances.get(c);
  if (!v || o) { v = new VoixHumaine(o); instances.set(c, v); }
  return v;
}
