import { etatServeur } from './api';
import { baseTempsReel, enTetesPasserelle } from './securiteGoogle';

/**
 * LA COURSE EN DIRECT, partagée par l'app client et ORION Pro (chauffeurs et livreurs) :
 * arrêts facturés à la minute, chat, appels par internet (sans unités), espèces de secours.
 * Chaque app fournit son jeton (client ou chauffeur) ; le serveur vérifie qui parle.
 */
export type Auteur = 'client' | 'chauffeur';

export interface Arret {
  id: string; type: 'prevu' | 'demande'; index?: number; nom?: string;
  debut: string; fin?: string; minutes?: number; montant?: number;
}
/** Arrêt ajouté par le client après sa commande (détour facturé). */
export interface ArretAjoute { index: number; nom: string; lieu: { lat: number; lng: number }; supplement: number; at: string }
export interface ResumeArrets {
  tarifMin: number;
  arrets: Arret[];
  enCours: (Arret & { minutes: number; montant: number }) | null;
  minutes: number;
  /** Minutes d'arrêt facturées + détours des arrêts ajoutés. */
  montant: number;
  montantMinutes?: number;
  supplementTrajet?: number;
  ajoutes?: ArretAjoute[];
  prixCommande?: number;
  prixAvecDetours?: number;
  prevus: Array<{ index: number; nom: string; lat: number; lng: number; fait: boolean; ajoute?: boolean }>;
}
export interface ApercuArret { supplement: number; tarifMin: number; prixAvant: number; prixApres: number }
/** Accueil vocal du client à bord (composé par le serveur). */
export interface Bienvenue { texte: string; voix: 'feminine' | 'masculine'; civilite: 'M' | 'Mme' | null; moment: string; assure: boolean }
export interface MessageChat {
  id: string; de: Auteur | 'orion'; texte: string; rapide?: 'sors' | 'retard'; at: string;
}
export type EtatAppel = 'sonne' | 'en_cours' | 'fini';

export class ErreurCourse extends Error {
  constructor(readonly statut: number, message: string) { super(message); }
}

export function connexionCourse(jeton: () => string | null) {
  const base = () => etatServeur().url;
  async function appel<T>(chemin: string, init: RequestInit = {}): Promise<T> {
    const j = jeton();
    const res = await fetch(`${base()}${chemin}`, {
      ...init,
      headers: { ...enTetesPasserelle(), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(j ? { authorization: `Bearer ${j}` } : {}) },
    });
    const corps = await res.json().catch(() => null) as (T & { error?: { message?: string } | string }) | null;
    if (!res.ok) {
      const e = corps?.error;
      throw new ErreurCourse(res.status, typeof e === 'string' ? e : e?.message ?? 'Service indisponible');
    }
    return corps as T;
  }
  const post = <T>(chemin: string, corps: unknown = {}) => appel<T>(chemin, { method: 'POST', body: JSON.stringify(corps) });
  return {
    actif: () => Boolean(base()),
    arrets: (id: string) => appel<ResumeArrets>(`/rides/${id}/arrets`),
    debutArret: (id: string, type: 'prevu' | 'demande', index?: number, position?: { lat: number; lng: number } | null) =>
      post<ResumeArrets>(`/rides/${id}/arrets`, { type, ...(index !== undefined ? { index } : {}), ...(position ? { position } : {}) }),
    finArret: (id: string) => post<ResumeArrets>(`/rides/${id}/arrets/fin`),
    apercuArret: (id: string, position: { lat: number; lng: number }, nom?: string) => post<ApercuArret>(`/rides/${id}/arrets/apercu`, { position, ...(nom ? { nom } : {}) }),
    ajouterArret: (id: string, position: { lat: number; lng: number }, nom?: string) => post<ResumeArrets>(`/rides/${id}/arrets/ajout`, { position, ...(nom ? { nom: nom.slice(0, 80) } : {}) }),
    bienvenue: (id: string) => appel<Bienvenue>(`/rides/${id}/bienvenue`),
    chat: (id: string) => appel<{ messages: MessageChat[]; ouvert: boolean; moi: Auteur }>(`/rides/${id}/chat`),
    envoyer: (id: string, m: { texte?: string; rapide?: 'sors' | 'retard' }) => post<{ message: MessageChat }>(`/rides/${id}/chat`, m),
    appel: (id: string, action: 'appeler' | 'decrocher' | 'refuser' | 'raccrocher') => post<{ appelId: string; etat: EtatAppel }>(`/rides/${id}/appel`, { action }),
    especesAutoriser: (id: string) => post<unknown>(`/rides/${id}/especes/autoriser`),
    especesConfirmer: (id: string) => post<unknown>(`/rides/${id}/especes/confirmer`),
    urlVoix: (id: string) => {
      const ws = baseTempsReel(base());
      const j = jeton();
      return ws && j ? `${ws}/ws/appel/${id}?jeton=${encodeURIComponent(j)}` : null;
    },
  };
}
export type ConnexionCourse = ReturnType<typeof connexionCourse>;

/* ------------------------- Voix de l'appel (μ-law 8 kHz) ------------------------- */

const ECHANTILLONS = 8000;
const TRAME = 160; // 20 ms

function versMuLaw(x: number): number {
  const s = Math.max(-1, Math.min(1, x));
  let v = Math.round(Math.abs(s) * 32635);
  const signe = s < 0 ? 0x80 : 0;
  v += 0x84;
  let exposant = 7;
  for (let masque = 0x4000; (v & masque) === 0 && exposant > 0; masque >>= 1) exposant--;
  const mantisse = (v >> (exposant + 3)) & 0x0f;
  return ~(signe | (exposant << 4) | mantisse) & 0xff;
}
function depuisMuLaw(u: number): number {
  const v = ~u & 0xff;
  const signe = v & 0x80;
  const exposant = (v >> 4) & 0x07;
  const mantisse = v & 0x0f;
  const brut = (((mantisse << 3) + 0x84) << exposant) - 0x84;
  return (signe ? -brut : brut) / 32768;
}

/**
 * Liaison vocale par le serveur ORION : le micro est compressé (téléphonie μ-law, 8 kHz,
 * 64 kbit/s) et envoyé par trames de 20 ms ; la voix de l'autre est rejouée avec un petit
 * tampon (80 ms) pour absorber les à-coups du réseau mobile. Annulation d'écho du téléphone.
 */
export class LiaisonVocale {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private flux: MediaStream | null = null;
  private noeud: ScriptProcessorNode | null = null;
  private prochain = 0;
  private reste: number[] = [];
  private phase = 0;
  muet = false;

  constructor(private readonly url: string, private readonly surFin: (raison: 'micro' | 'reseau' | 'fin') => void) {}

  async demarrer(): Promise<void> {
    try {
      this.flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch {
      this.surFin('micro');
      throw new Error('micro');
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume().catch(() => undefined);
    const source = this.ctx.createMediaStreamSource(this.flux);
    this.noeud = this.ctx.createScriptProcessor(1024, 1, 1);
    const pas = this.ctx.sampleRate / ECHANTILLONS;
    this.noeud.onaudioprocess = (e) => {
      if (this.muet || !this.ws || this.ws.readyState !== 1) return;
      const entree = e.inputBuffer.getChannelData(0);
      // Rééchantillonnage vers 8 kHz (interpolation linéaire), puis trames de 20 ms.
      for (; this.phase < entree.length - 1; this.phase += pas) {
        const i = Math.floor(this.phase);
        const f = this.phase - i;
        this.reste.push(entree[i]! * (1 - f) + entree[i + 1]! * f);
      }
      this.phase -= entree.length;
      while (this.reste.length >= TRAME) {
        const trame = new Uint8Array(TRAME);
        for (let k = 0; k < TRAME; k++) trame[k] = versMuLaw(this.reste[k]!);
        this.reste.splice(0, TRAME);
        this.ws.send(trame);
      }
    };
    source.connect(this.noeud);
    // Le nœud doit être relié à la sortie pour tourner ; il n'émet que du silence.
    const zero = this.ctx.createGain();
    zero.gain.value = 0;
    this.noeud.connect(zero).connect(this.ctx.destination);

    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (ev) => { if (ev.data instanceof ArrayBuffer) this.jouer(new Uint8Array(ev.data)); };
    this.ws.onclose = () => { if (this.ctx) this.surFin('reseau'); };
  }

  private jouer(trame: Uint8Array): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const buf = ctx.createBuffer(1, trame.length, ECHANTILLONS);
    const canal = buf.getChannelData(0);
    for (let i = 0; i < trame.length; i++) canal[i] = depuisMuLaw(trame[i]!);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const maintenant = ctx.currentTime;
    // Retard trop grand (réseau qui a bloqué) : on repart près du direct.
    if (this.prochain < maintenant + 0.02 || this.prochain > maintenant + 0.4) this.prochain = maintenant + 0.08;
    src.start(this.prochain);
    this.prochain += buf.duration;
  }

  arreter(): void {
    const ctx = this.ctx;
    this.ctx = null;
    try { this.ws?.close(); } catch { /* fermé */ }
    this.ws = null;
    this.noeud?.disconnect();
    this.flux?.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => undefined);
  }
}

/** Le micro est-il utilisable ici (APK avec la permission, ou navigateur) ? */
export function microDisponible(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}
