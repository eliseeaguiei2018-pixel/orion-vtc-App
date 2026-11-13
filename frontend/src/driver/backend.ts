import { configSocketUrl, fetchAppConfig, isLiveBackend, type AppConfig } from '../api';
import type {
  ActiveRide, Announcement, DemandCell, DriverConfig, DriverEvent, DriverProfile, Finance, LatLng, LinkState,
  ProfilePatch, QueueInfo, RideHistory, RideStatus, Session, Training, TrainingResult, WaitResult, Wallet,
} from './types';
import { createDemoBackend } from './demo';
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

  requestOtp(phone: string): Promise<{ phone: string; registered: boolean; devCode?: string }>;
  verifyOtp(phone: string, code: string, name?: string, category?: string): Promise<{ driver: DriverProfile; created: boolean }>;
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
  wait(rideId: string, minutes: number): Promise<WaitResult>;
  collectCash(rideId: string): Promise<void>;
  sos(rideId: string | null, position: LatLng, note?: string): Promise<void>;

  wallet(): Promise<Wallet>;
  payout(amount: number, method: string): Promise<void>;
  training(): Promise<Training>;
  submitTraining(answers: number[]): Promise<TrainingResult>;
  announcements(): Promise<Announcement[]>;
  demand(): Promise<DemandCell[]>;
}


const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
function wsBase(): string | null {
  if (!API) return null;
  try {
    const u = new URL(API);
    return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`;
  } catch {
    return null;
  }
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

  async function call<T>(path: string, init: RequestInit = {}, auth = true, accept: number[] = []): Promise<T> {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 10_000);
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
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

    requestOtp: (phone) => call('/drivers/auth/otp', { method: 'POST', body: JSON.stringify({ phone }) }, false),
    async verifyOtp(phone, code, name, category) {
      const r = await call<{ token: string; expiresAt: string; driver: DriverProfile; created: boolean }>(
        '/drivers/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code, name, category }) }, false);
      current = { token: r.token, expiresAt: r.expiresAt, driverId: r.driver.id };
      saveSession(current);
      return { driver: r.driver, created: r.created };
    },
    me: () => call('/drivers/me'),

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
    async sendLocation(position) { await post(`/drivers/${id()}/location`, { position }); },
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
    wait: (rideId, minutes) => post(`/rides/${rideId}/wait`, { minutes }),
    async collectCash(rideId) {
      await call(`/rides/${rideId}/pay`, {
        method: 'POST', body: JSON.stringify({ method: 'cash' }),
        headers: { 'idempotency-key': `cash-${rideId}` },
      });
    },
    async sos(rideId, position, note) {
      if (rideId) await post(`/rides/${rideId}/sos`, { by: 'chauffeur', note });
      else await post('/safety/sos', { userId: id(), location: position });
    },

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
  };
}

/** Backend réel si VITE_API_URL est défini, sinon moteur de démonstration local. */
export function createBackend(): DriverBackend {
  return isLiveBackend() ? createLiveBackend() : createDemoBackend();
}
