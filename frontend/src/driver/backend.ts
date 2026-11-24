import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { baseTempsReel, enTeteRecaptcha, enTetesPasserelle } from '../securiteGoogle';
import { configSocketUrl, etatServeur, fetchAppConfig, isLiveBackend, sosRepondre, sosSocketUrl, sosSuivi, sosTerminer, type AppConfig, type MotifFinSos, type SosSuivi } from '../api';
import type { ActiviteMois, PrimeMois } from './salarie';
import type {
  EtapeLocation, LocationChauffeur, MessagesChef, MotifAnnulationChauffeur, NouvelleRequete, Poste, RequeteVue,
  ActiveRide, Announcement, CarteService, DemandCell, DriverConfig, DriverEvent, DriverProfile, Finance, LatLng, LinkState,
  ProfilePatch, QueueInfo, RideHistory, RideStatus, Session, Training, TrainingResult, WaitResult, Wallet,
} from './types';
import { createDemoBackend } from './demo';
import type { SonServeur } from '../courseLive';
import { ApiError } from './errors';
import { loadSession, saveSession } from './session';

export { ApiError };

/**
 * Contrat d'accès aux données de l'app Chauffeur. Deux implémentations :
 *  - LIVE : le backend ORION réel (HTTP + WebSocket), dès que VITE_API_URL est défini ;
 *  - DÉMO : moteur local qui simule la console et les clients (déploiement sans backend).
 * L'interface est identique : les écrans ne savent pas lequel est utilisé.
 */
export interface DriverBackend {
  readonly live: boolean;
  /** Session mémorisée sur l'appareil (null si déconnecté). */
  session(): Session | null;
  logout(): void;

  /** `canal` : 'whatsapp' pour recevoir le code sur WhatsApp (si le serveur l'annonce), SMS sinon. */
  requestOtp(phone: string, canal?: 'sms' | 'whatsapp'): Promise<{ phone: string; registered: boolean; devCode?: string }>;
  verifyOtp(phone: string, code: string, name?: string, category?: string): Promise<{ driver: DriverProfile; created: boolean }>;
  /** Écran de véhicule : échange le code d'appairage affiché sur le téléphone contre une session. */
  appairerEcran(code: string): Promise<{ driverId: string }>;
  /** Téléphone : demander un code à montrer, pour connecter un écran de véhicule. */
  codeEcranVehicule(): Promise<{ code: string; expireLe: string; dureeSecondes: number }>;
  annulerCodeEcranVehicule(): Promise<void>;
  me(): Promise<{ driver: DriverProfile; finance: Finance }>;

  /** Config publique (= app cliente) et config flotte (réglages console chauffeur). */
  appConfig(): Promise<AppConfig | null>;
  driverConfig(): Promise<DriverConfig | null>;
  /**
   * Abonnements temps réel : canal public `config` (comme l'app cliente) + canal personnel
   * du chauffeur une fois connecté. Reconnexion automatique. Renvoie la fonction d'arrêt.
   */
  subscribe(onEvent: (e: DriverEvent) => void, onLink: (s: LinkState) => void): () => void;

  goOnline(position: LatLng): Promise<void>;
  goOffline(): Promise<void>;
  sendLocation(position: LatLng): Promise<void>;
  queue(): Promise<QueueInfo | null>;
  telemetry(body: { engine?: 'electric' | 'hybrid'; batteryPct?: number; batteryHealthPct?: number }): Promise<void>;
  updateProfile(patch: ProfilePatch): Promise<void>;
  submitKyc(): Promise<DriverProfile>;

  history(): Promise<RideHistory>;
  activeRide(): Promise<ActiveRide | null>;
  acceptOffer(rideId: string): Promise<ActiveRide | null>;
  declineOffer(rideId: string, reason?: string): Promise<void>;
  transition(rideId: string, to: RideStatus): Promise<void>;
  /** Démarre la course avec le code à 4 chiffres donné par le passager. */
  start(rideId: string, code: string): Promise<void>;
  /** Remet le colis avec le code à 4 chiffres donné par le destinataire (livraison terminée). */
  livrer(rideId: string, code: string): Promise<void>;
  wait(rideId: string, minutes: number): Promise<WaitResult>;
  collectCash(rideId: string): Promise<void>;
  /** SOS : renvoie l'identifiant de l'alerte, pour en suivre la prise en charge. */
  sos(rideId: string | null, position: LatLng, note?: string): Promise<string | null>;
  /** Suivi de SON alerte (comme le client) : état, agent, secours, chat discret. */
  sosSuivi(alertId: string): Promise<SosSuivi | null>;
  sosRepondre(alertId: string, text: string): Promise<SosSuivi | null>;
  /** Mettre fin à son alerte et à la discussion avec l'agent (en sécurité, fausse alerte). */
  sosTerminer(alertId: string, motif: MotifFinSos): Promise<SosSuivi | null>;
  /** Abonnement temps réel au suivi de l'alerte. Renvoie la fonction d'arrêt. */
  sosSubscribe(alertId: string, onSuivi: (s: SosSuivi) => void, onLink: (ok: boolean) => void): () => void;
  /** Annulation motivée par le chauffeur (le passager garde sa course, sauf absence). */
  cancelRide(rideId: string, motif: MotifAnnulationChauffeur, details?: string): Promise<{ reattribuee: boolean; frais: number }>;
  /** Course entièrement couverte par l'abonnement du client : valider la fin sans encaisser. */
  settleCovered(rideId: string, method: string): Promise<void>;

  rentals(): Promise<LocationChauffeur[]>;
  rentalStep(rentalId: string, etape: EtapeLocation, note?: string): Promise<LocationChauffeur>;
  poste(): Promise<Poste>;
  deposerRequete(r: NouvelleRequete): Promise<RequeteVue>;
  messages(): Promise<MessagesChef>;
  lireMessage(id: string): Promise<void>;
  repondreMessage(id: string, texte: string): Promise<void>;
  rendreRapport(id: string, texte: string): Promise<void>;
  /** Le chauffeur choisit le mot de passe de son identifiant console (créé automatiquement). */
  definirMotDePasseConsole(motDePasse: string): Promise<{ identifiant: string }>;
  setPhoto(dataUrl: string): Promise<string | null>;
  deletePhoto(): Promise<void>;
  /** Adresse complète de la photo d'un chauffeur (null si aucune). */
  photoSrc(driver: { id: string; photoUpdatedAt?: string }): string | null;

  /** Chauffeur salarié : activité du mois (`AAAA-MM`, le mois en cours par défaut). */
  activite(mois?: string): Promise<ActiviteMois>;
  /** Chauffeur salarié : prime de performance du mois. */
  prime(mois?: string): Promise<PrimeMois>;
  wallet(): Promise<Wallet>;
  payout(amount: number, method: string): Promise<void>;
  training(): Promise<Training>;
  submitTraining(answers: number[]): Promise<TrainingResult>;
  announcements(): Promise<Announcement[]>;
  demand(): Promise<DemandCell[]>;
  /** Carte de service : zones à forte demande, zones habituelles, sièges ORION (null : indisponible). */
  carte(p: LatLng): Promise<CarteService | null>;
  /** Accueil vocal d'exemple (voix de bord), pour l'écouter avant la première course. */
  voixEssai(genre: 'feminine' | 'masculine'): Promise<{ texte: string; voix: 'feminine' | 'masculine' } | null>;
  /** Voix humaine (IA) réglée par la direction : en service ? quel fournisseur, quelles voix ? */
  voixHumaine(): Promise<EtatVoixHumaine | null>;
  /** Son d'essai de la voix humaine (null : pas en service ou injoignable). */
  voixHumaineEssai(genre: 'feminine' | 'masculine'): Promise<SonServeur | null>;
}

export interface EtatVoixHumaine { active: boolean; fournisseur: string | null; nom: string | null; voix: { feminine: string; masculine: string } | null }


// Le serveur ORION auquel l'app est reliée : réglé dans l'app (Serveur ORION), sinon fixé à la
// construction (VITE_API_URL) — la même règle que l'app cliente (voir ../api.ts).
const API = etatServeur().url;
function wsBase(): string | null {
  // Canaux temps réel : adresse de l'API, ou VITE_WS_URL quand l'API passe par API Gateway.
  return API ? baseTempsReel(API) : null;
}

/** Socket avec reconnexion automatique (4 s, comme l'app cliente). */
function resilientSocket(url: string, onMessage: (m: DriverEvent) => void, onLink?: (s: LinkState) => void): () => void {
  let ws: WebSocket | null = null;
  let retry: number | undefined;
  let closed = false;
  const connect = () => {
    onLink?.('connecting');
    try {
      ws = new WebSocket(url);
    } catch {
      retry = window.setTimeout(connect, 4000);
      return;
    }
    ws.onopen = () => onLink?.('online');
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(String(ev.data)) as DriverEvent);
      } catch {
        /* trame ignorée */
      }
    };
    ws.onclose = () => {
      onLink?.('offline');
      if (!closed) retry = window.setTimeout(connect, 4000);
    };
    ws.onerror = () => {
      try { ws?.close(); } catch { /* ignore */ }
    };
  };
  connect();
  return () => {
    closed = true;
    window.clearTimeout(retry);
    try { ws?.close(); } catch { /* ignore */ }
  };
}

/** Implémentation LIVE : backend ORION réel. */
function createLiveBackend(): DriverBackend {
  let current = loadSession();
  /** Adresse signée de la photo du chauffeur (remise par /drivers/me et à l'envoi). */
  let photoSignee: string | null = null;

  async function call<T>(path: string, init: RequestInit = {}, auth = true, accept: number[] = []): Promise<T> {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 10_000);
    // Clé de l'application pour API Gateway (si la passerelle est utilisée).
    const headers: Record<string, string> = { ...enTetesPasserelle(), ...(init.headers as Record<string, string> | undefined) };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (auth && current) headers['authorization'] = `Bearer ${current.token}`;
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, { ...init, headers, signal: ctrl.signal });
    } catch {
      throw new ApiError(0, 'Réseau indisponible — vérifiez votre connexion');
    } finally {
      window.clearTimeout(timer);
    }
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!res.ok && !accept.includes(res.status)) {
      const msg = (body as { error?: { message?: string } | string } | null)?.error;
      const message = typeof msg === 'string' ? msg : msg?.message ?? `Erreur ${res.status}`;
      if (res.status === 401 && auth && current) {
        current = null;
        saveSession(null);
      }
      throw new ApiError(res.status, message);
    }
    return body as T;
  }

  const id = () => {
    if (!current) throw new ApiError(401, 'Session chauffeur absente — reconnectez-vous');
    return current.driverId;
  };
  const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

  return {
    live: true,
    session: () => current,
    logout: () => { current = null; saveSession(null); },

    // reCAPTCHA Enterprise (si réglé) : le serveur n'envoie pas de SMS à un robot.
    requestOtp: async (phone, canal) => call('/drivers/auth/otp', { method: 'POST', body: JSON.stringify(canal === 'whatsapp' ? { phone, canal } : { phone }), headers: await enTeteRecaptcha('connexion_chauffeur') }, false),
    async verifyOtp(phone, code, name, category) {
      const r = await call<{ token: string; expiresAt: string; driver: DriverProfile; created: boolean }>(
        '/drivers/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code, name, category }) }, false);
      current = { token: r.token, expiresAt: r.expiresAt, driverId: r.driver.id };
      saveSession(current);
      return { driver: r.driver, created: r.created };
    },
    async appairerEcran(code) {
      const r = await call<{ token: string; expiresAt: string; driver: { id: string } }>(
        '/ecran-vehicule/session', { method: 'POST', body: JSON.stringify({ code }) }, false);
      current = { token: r.token, expiresAt: r.expiresAt, driverId: r.driver.id };
      saveSession(current);
      return { driverId: r.driver.id };
    },
    codeEcranVehicule: () => post(`/drivers/${id()}/ecran-vehicule/appairer`),
    annulerCodeEcranVehicule: async () => { await post(`/drivers/${id()}/ecran-vehicule/annuler`); },
    async me() {
      // L'adresse de SA photo est signée par le serveur (l'identifiant seul ne suffit plus).
      const r = await call<{ driver: DriverProfile; finance: Finance; photoUrl?: string | null }>('/drivers/me');
      photoSignee = r.photoUrl ?? null;
      return r;
    },

    // Même source que l'app cliente : GET /config.
    appConfig: () => fetchAppConfig(),
    async driverConfig() {
      try { return await call<DriverConfig>('/drivers/config', {}, false); } catch { return null; }
    },
    subscribe(onEvent, onLink) {
      const stops: Array<() => void> = [];
      // 1) Canal public `config` — strictement le modèle de l'app cliente.
      const cfgUrl = configSocketUrl();
      if (cfgUrl) stops.push(resilientSocket(cfgUrl, onEvent));
      // 2) Canal personnel du chauffeur (fiche, offres, paiements, réglages flotte).
      const base = wsBase();
      if (base && current) {
        stops.push(resilientSocket(`${base}/ws/drivers/${encodeURIComponent(current.driverId)}?token=${encodeURIComponent(current.token)}`, onEvent, onLink));
      } else {
        onLink('offline');
      }
      return () => stops.forEach((s) => s());
    },

    async goOnline(position) { await post(`/drivers/${id()}/online`, { position }); },
    async goOffline() { await post(`/drivers/${id()}/offline`); },
    async sendLocation(position) {
      // App installée : envoi par le réseau NATIF. Android freine les requêtes de la WebView
      // après 5 min en arrière-plan ; la position du chauffeur, elle, doit partir sans délai
      // (clients qui le voient approcher, dispatch, console).
      if (Capacitor.isNativePlatform() && current) {
        const r = await CapacitorHttp.post({
          url: `${API}/drivers/${id()}/location`,
          headers: { ...enTetesPasserelle(), 'content-type': 'application/json', authorization: `Bearer ${current.token}` },
          data: { position }, connectTimeout: 8000, readTimeout: 8000,
        });
        if (r.status >= 400) throw new ApiError(r.status, `Erreur ${r.status}`);
        return;
      }
      await post(`/drivers/${id()}/location`, { position });
    },
    async queue() {
      try { return await call<QueueInfo>(`/drivers/${id()}/queue`); } catch { return null; }
    },
    async telemetry(body) { await post(`/drivers/${id()}/telemetry`, body); },
    async updateProfile(patch) { await post(`/drivers/${id()}/profile`, patch); },
    async submitKyc() { return (await post<{ driver: DriverProfile }>(`/drivers/${id()}/kyc/submit`)).driver; },

    history: () => call(`/drivers/${id()}/rides`),
    async activeRide() { return (await call<{ ride: ActiveRide | null }>(`/drivers/${id()}/active-ride`)).ride; },
    async acceptOffer(rideId) { return (await post<{ ride: ActiveRide | null }>(`/drivers/${id()}/offers/${rideId}/accept`)).ride; },
    async declineOffer(rideId, reason) { await post(`/drivers/${id()}/offers/${rideId}/decline`, { reason }); },
    async transition(rideId, to) { await post(`/rides/${rideId}/transition`, { to }); },
    async start(rideId, code) { await post(`/rides/${rideId}/start`, { code }); },
    async livrer(rideId, code) { await post(`/rides/${rideId}/livrer`, { code }); },
    wait: (rideId, minutes) => post(`/rides/${rideId}/wait`, { minutes }),
    async collectCash(rideId) {
      await call(`/rides/${rideId}/pay`, {
        method: 'POST', body: JSON.stringify({ method: 'cash' }),
        headers: { 'idempotency-key': `cash-${rideId}` },
      });
    },
    async sos(rideId, position, note) {
      // La position la plus fraîche part avec l'alerte (le tracé suit aussi la course).
      try { await post(`/drivers/${id()}/location`, { position }); } catch { /* l'alerte prime */ }
      if (rideId) return (await post<{ alert: { id: string } }>(`/rides/${rideId}/sos`, { by: 'chauffeur', note })).alert.id;
      return (await post<{ alert: { id: string } }>('/safety/sos', { userId: id(), location: position, note })).alert.id;
    },
    sosSuivi: (alertId) => sosSuivi(alertId, id()),
    sosRepondre: (alertId, text) => sosRepondre(alertId, id(), text),
    sosTerminer: (alertId, motif) => sosTerminer(alertId, id(), motif),
    sosSubscribe(alertId, onSuivi, onLink) {
      const url = sosSocketUrl(alertId, id());
      if (!url) return () => undefined;
      return resilientSocket(url, (m) => {
        const sv = m.type === 'connected' ? (m['suivi'] as SosSuivi | undefined) : m.type === 'sos.suivi' ? (m.data as SosSuivi | undefined) : undefined;
        if (sv) onSuivi(sv);
      }, (l) => onLink(l === 'online'));
    },
    cancelRide: (rideId, motif, details) => post(`/drivers/${id()}/rides/${rideId}/cancel`, { motif, details }),
    async settleCovered(rideId, method) {
      await call(`/rides/${rideId}/pay`, {
        method: 'POST', body: JSON.stringify({ method }),
        headers: { 'idempotency-key': `couvert-${rideId}` },
      });
    },

    async rentals() { return (await call<{ rentals: LocationChauffeur[] }>(`/drivers/${id()}/rentals`)).rentals; },
    async rentalStep(rentalId, etape, note) { return (await post<{ rental: LocationChauffeur }>(`/drivers/${id()}/rentals/${rentalId}/etape`, { etape, note })).rental; },
    poste: () => call(`/drivers/${id()}/poste`),
    async deposerRequete(r) { return (await post<{ requete: RequeteVue }>(`/drivers/${id()}/requetes`, r)).requete; },
    messages: () => call(`/drivers/${id()}/messages`),
    async lireMessage(mid) { await post(`/drivers/${id()}/messages/${mid}/lu`); },
    async repondreMessage(mid, texte) { await post(`/drivers/${id()}/messages/${mid}/reponse`, { texte }); },
    async rendreRapport(rid, texte) { await post(`/drivers/${id()}/rapports/${rid}/rendre`, { texte }); },
    async definirMotDePasseConsole(motDePasse) { return post<{ identifiant: string }>(`/drivers/${id()}/console/mot-de-passe`, { motDePasse }); },
    async setPhoto(dataUrl) {
      const r = await call<{ photoUrl: string | null }>(`/drivers/${id()}/photo`, { method: 'PUT', body: JSON.stringify({ photo: dataUrl }) });
      photoSignee = r.photoUrl;
      return r.photoUrl ? `${API}${r.photoUrl}` : null;
    },
    async deletePhoto() { await call(`/drivers/${id()}/photo`, { method: 'DELETE' }); },
    photoSrc: (d) => (d.photoUpdatedAt && photoSignee ? `${API}${photoSignee}` : null),

    async activite(mois) { return (await call<{ activite: ActiviteMois }>(`/drivers/${id()}/activite${mois ? `?mois=${mois}` : ''}`)).activite; },
    async prime(mois) { return (await call<{ prime: PrimeMois }>(`/drivers/${id()}/prime${mois ? `?mois=${mois}` : ''}`)).prime; },
    wallet: () => call(`/drivers/${id()}/wallet`),
    async payout(amount, method) { await post(`/drivers/${id()}/payout`, { amount, method }); },
    async training() {
      const t = await call<Training>('/training/eco', {}, false);
      // Vidéo servie par le backend : chemin relatif → URL absolue de l'API.
      return { ...t, videoUrl: t.videoUrl.startsWith('/') ? `${API}${t.videoUrl}` : t.videoUrl };
    },
    // 400 = QCM non réussi : le corps porte quand même le score (affiché au chauffeur).
    submitTraining: (answers) => call<TrainingResult>(`/drivers/${id()}/training`, { method: 'POST', body: JSON.stringify({ answers }) }, true, [400]),
    async announcements() {
      try { return (await call<{ announcements: Announcement[] }>('/drivers/announcements', {}, false)).announcements; } catch { return []; }
    },
    async demand() {
      try { return (await call<{ cells: DemandCell[] }>('/drivers/demand', {}, false)).cells; } catch { return []; }
    },
    async voixEssai(genre) {
      try { return await call<{ texte: string; voix: 'feminine' | 'masculine' }>(`/drivers/${id()}/voix-bord/essai?genre=${genre}`); } catch { return null; }
    },
    async voixHumaine() {
      try { return await call<EtatVoixHumaine>(`/drivers/${id()}/voix-bord/humaine`); } catch { return null; }
    },
    async voixHumaineEssai(genre) {
      if (!current) return null;
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 45_000);
      try {
        const res = await fetch(`${API}/drivers/${id()}/voix-bord/essai/audio?genre=${genre}`, {
          headers: { ...enTetesPasserelle(), authorization: `Bearer ${current.token}` }, signal: ctrl.signal,
        });
        if (!res.ok) return null;
        return { audio: await res.arrayBuffer(), type: res.headers.get('content-type') ?? 'audio/mpeg', voix: res.headers.get('x-orion-voix'), empreinte: null };
      } catch { return null; } finally { window.clearTimeout(t); }
    },
    async carte(p) {
      try { return await call<CarteService>(`/drivers/${id()}/carte?lat=${p.lat.toFixed(5)}&lng=${p.lng.toFixed(5)}`); } catch { return null; }
    },
  };
}

/** Backend réel si VITE_API_URL est défini, sinon moteur de démonstration local. */
export function createBackend(): DriverBackend {
  return isLiveBackend() ? createLiveBackend() : createDemoBackend();
}
