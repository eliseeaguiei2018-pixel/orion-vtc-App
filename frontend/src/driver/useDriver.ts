import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig, SosSuivi } from '../api';
import { ApiError, createBackend, type DriverBackend } from './backend';
import { DEMO_DRIVER_CONFIG } from './demo';
import type {
  LocationChauffeur, MotifAnnulationChauffeur, NouvelleRequete, EtapeLocation,
  ActiveRide, Announcement, DriverConfig, DriverEvent, DriverProfile, Finance, LatLng, LinkState, RideStatus,
} from './types';
import { tr } from './i18n';

/** Notification affichée dans l'app (console, système, annonces). */
export interface Notice { id: string; title: string; body: string; at: string; kind: 'notification' | 'announcement' | 'system' }

export interface ToastMsg { id: number; message: string; tone: 'info' | 'success' | 'danger' }

/** Course qui vient d'être payée : récapitulatif des gains affiché au chauffeur. */
export interface Settled { rideId: string; amount: number; method: string }

const DEFAULT_POS: LatLng = { lat: 5.336, lng: -4.026 }; // Plateau, Abidjan

const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : tr('Erreur inattendue'));

/** Normalise une config publique reçue (HTTP ou WS) — même logique que l'app cliente. */
function toAppConfig(c: Partial<AppConfig> | undefined): AppConfig | null {
  if (!c) return null;
  return { city: c.city ?? 'Abidjan', open: c.open ?? true, services: c.services ?? {}, gateways: c.gateways ?? {}, currency: c.currency ?? 'XOF' };
}

/**
 * État central de l'app Chauffeur, SYNCHRONISÉ avec le backend et la console :
 *  - au démarrage : GET /config (comme l'app cliente) + GET /drivers/config + fiche ;
 *  - en continu : canal `config` (maintenance, services, passerelles) + canal personnel
 *    (décisions console, réglages flotte, offres, paiements, annonces) ;
 *  - au retour au premier plan / reconnexion : resynchronisation complète.
 */
export function useDriver() {
  const backend: DriverBackend = useMemo(() => createBackend(), []);
  const [session, setSession] = useState(() => backend.session());
  const [booting, setBooting] = useState(true);
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [driverConfig, setDriverConfig] = useState<DriverConfig>(DEMO_DRIVER_CONFIG);
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [link, setLink] = useState<LinkState>('connecting');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  /** Locations Signature confiées au chauffeur (console → app, en direct). */
  const [rentals, setRentals] = useState<LocationChauffeur[]>([]);
  /** Incrémenté quand le poste bouge (requête, message du chef) : les écrans se rechargent. */
  const [posteVersion, setPosteVersion] = useState(0);
  /** Alerte SOS en cours de suivi (reprise après fermeture de l'app). */
  const [sosId, setSosId] = useState<string | null>(() => { try { return localStorage.getItem('orion.driver.sos'); } catch { return null; } });
  const [sosLive, setSosLive] = useState<SosSuivi | null>(null);
  const [sosOuvert, setSosOuvert] = useState(true);
  const [sosHorsLigne, setSosHorsLigne] = useState(false);
  const [position, setPosition] = useState<LatLng>(DEFAULT_POS);
  const [gps, setGps] = useState<'real' | 'simulated'>('simulated');
  const [busy, setBusy] = useState(false);
  const activeRef = useRef<ActiveRide | null>(null);
  activeRef.current = activeRide;
  const posRef = useRef(position);
  posRef.current = position;

  const showToast = useCallback((message: string, tone: ToastMsg['tone'] = 'info') => {
    const id = Date.now();
    setToast({ id, message, tone });
    window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3800);
  }, []);

  const pushNotice = useCallback((n: Omit<Notice, 'id' | 'at'> & { id?: string; at?: string }) => {
    setNotices((list) => [{ id: n.id ?? String(Date.now()), at: n.at ?? new Date().toISOString(), title: n.title, body: n.body, kind: n.kind }, ...list].slice(0, 50));
  }, []);

  /** Rafraîchit fiche + finances + course en cours (resynchronisation complète). */
  const refresh = useCallback(async () => {
    if (!backend.session()) return;
    try {
      const [me, ride] = await Promise.all([backend.me(), backend.activeRide()]);
      setDriver(me.driver);
      setFinance(me.finance);
      setActiveRide(ride);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        backend.logout();
        setSession(null);
      }
    }
  }, [backend]);

  /* ---------- Démarrage : config publique + config flotte + session ---------- */
  useEffect(() => {
    void backend.appConfig().then((c) => setAppConfig(c));
    void backend.driverConfig().then((c) => { if (c) setDriverConfig(c); });
    void backend.announcements().then(setAnnouncements);
    void (async () => {
      if (backend.session()) await refresh();
      setBooting(false);
    })();
  }, [backend, refresh]);

  /* ---------- Temps réel : application des événements console / serveur ---------- */
  const onEvent = useCallback((e: DriverEvent) => {
    const data = e.data as Record<string, unknown> | undefined;
    switch (e.type) {
      case 'connected': {
        // Canal public : porte `config`. Canal chauffeur : état complet (resynchro).
        if (e['config']) setAppConfig(toAppConfig(e['config'] as Partial<AppConfig>));
        if (e['driverConfig']) setDriverConfig(e['driverConfig'] as DriverConfig);
        if (e['driver']) setDriver(e['driver'] as DriverProfile);
        if (e['finance']) setFinance(e['finance'] as Finance);
        if ('activeRide' in e) setActiveRide((e['activeRide'] as ActiveRide | null) ?? null);
        break;
      }
      case 'config.update':
        setAppConfig(toAppConfig(data as Partial<AppConfig>));
        break;
      case 'driver-config.update':
        if (data) setDriverConfig(data as unknown as DriverConfig);
        break;
      case 'driver.update': {
        const d = (data as { driver?: DriverProfile } | undefined)?.driver;
        if (!d) break;
        setDriver((prev) => {
          if (prev && prev.kycStatus !== d.kycStatus) {
            if (d.kycStatus === 'suspended') showToast(tr('Compte suspendu : {0}', [d.suspensionReason ?? tr('contactez ORION')]), 'danger');
            else if (d.kycStatus === 'active' || d.kycStatus === 'approved') showToast(tr('Dossier validé par ORION ✅'), 'success');
          }
          if (prev && (d.warnings ?? 0) > (prev.warnings ?? 0)) {
            showToast(tr('Avertissement qualité reçu de la console'), 'danger');
          }
          if (prev && d.vip && !prev.vip) showToast(tr('Félicitations : statut Top Driver ⭐'), 'success');
          return d;
        });
        break;
      }
      case 'ride.assigned': {
        // L'offre arrive : on récupère la vue complète (client, secteur, compte à rebours).
        try { navigator.vibrate?.([300, 120, 300]); } catch { /* ignore */ }
        void backend.activeRide().then(setActiveRide).catch(() => undefined);
        break;
      }
      case 'ride.withdrawn': {
        const rideId = (data as { rideId?: string } | undefined)?.rideId;
        const reason = (data as { reason?: string } | undefined)?.reason;
        if (rideId && activeRef.current?.id === rideId) {
          setActiveRide(null);
          showToast(reason === 'expired' ? tr('Offre expirée — vous êtes en pause')
            : reason === 'console' ? tr('Course retirée par ORION')
              : reason === 'chauffeur_annule' ? tr('Course annulée — le passager est confié à un autre chauffeur')
                : tr('Offre transmise à un autre chauffeur'), reason === 'expired' ? 'danger' : 'info');
        }
        break;
      }
      case 'ride.status': {
        const rideId = (data as { rideId?: string } | undefined)?.rideId;
        const status = (data as { status?: RideStatus } | undefined)?.status;
        const cur = activeRef.current;
        if (!rideId || !status || !cur || cur.id !== rideId) break;
        if (status === 'cancelled') {
          setActiveRide(null);
          const reason = (data as { reason?: string } | undefined)?.reason;
          showToast(reason === 'console' ? tr('Course annulée par ORION') : tr('Course annulée par le client'), 'danger');
          void refresh();
        } else if (status === 'paid' || status === 'rated') {
          setActiveRide(null);
          void refresh();
        } else {
          setActiveRide({ ...cur, status });
        }
        break;
      }
      case 'payment.received': {
        const p = data as { rideId: string; amount: number; method: string } | undefined;
        if (p) {
          setSettled(p);
          showToast(tr('Paiement reçu : {0} F', [p.amount.toLocaleString('fr-FR')]), 'success');
        }
        void refresh();
        break;
      }
      case 'notification': {
        const n = data as { id?: string; title: string; body: string; at?: string } | undefined;
        if (n) {
          pushNotice({ ...n, kind: 'notification' });
          showToast(n.title);
        }
        break;
      }
      case 'announcement': {
        const a = data as Announcement | undefined;
        if (a) {
          setAnnouncements((list) => [a, ...list.filter((x) => x.id !== a.id)].slice(0, 20));
          pushNotice({ id: a.id, title: a.title, body: a.body, at: a.at, kind: 'announcement' });
          showToast(`📢 ${a.title}`);
        }
        break;
      }
      case 'ride.rated': {
        // La note du passager arrive en direct (étoiles et thèmes, jamais son texte).
        const n = data as { stars?: number; tags?: string[] } | undefined;
        if (n?.stars) {
          showToast(tr('Nouvelle note : {0}{1}{2}', ['★'.repeat(n.stars), '☆'.repeat(5 - n.stars), n.tags?.length ? ` · ${n.tags.join(' ')}` : '']), n.stars >= 4 ? 'success' : 'info');
          void refresh();
        }
        break;
      }
      case 'rental.assigned':
      case 'rental.update':
        try { if (e.type === 'rental.assigned') navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
        void backend.rentals().then(setRentals).catch(() => undefined);
        break;
      case 'rental.withdrawn': {
        const rid = (data as { id?: string } | undefined)?.id;
        setRentals((l) => l.filter((r) => r.id !== rid));
        break;
      }
      case 'crew.request':
      case 'poste.message':
        setPosteVersion((v) => v + 1);
        break;
      case 'error':
        if (e['code'] === 'UNAUTHORIZED') { backend.logout(); setSession(null); }
        break;
      default:
        break;
    }
  }, [backend, pushNotice, refresh, showToast]);

  useEffect(() => {
    const stop = backend.subscribe(onEvent, setLink);
    return stop;
    // Ré-abonnement à chaque changement de session (connexion / déconnexion).
  }, [backend, onEvent, session]);

  // Retour au premier plan : resynchronisation (réseau mobile instable).
  // Locations Signature : chargées à la connexion, puis tenues à jour par le canal temps réel.
  useEffect(() => {
    if (!session) { setRentals([]); return; }
    void backend.rentals().then(setRentals).catch(() => undefined);
  }, [backend, session]);

  // SOS : suivi en direct de SON alerte (comme le client) — prise en charge, agent, secours.
  useEffect(() => {
    if (!sosId || !session) return;
    void backend.sosSuivi(sosId).then((s) => { if (s) setSosLive(s); }).catch(() => undefined);
    return backend.sosSubscribe(sosId, setSosLive, (ok) => setSosHorsLigne(!ok));
  }, [backend, sosId, session]);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  /* ---------- GPS : position réelle, sinon GPS simulé (démo / ordinateur) ---------- */
  const tracking = driver?.availability === 'online' || driver?.availability === 'on_trip' || Boolean(activeRide);
  useEffect(() => {
    if (!tracking || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => { setGps('real'); setPosition({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => setGps('simulated'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking]);

  // GPS simulé : le véhicule progresse vers le point de prise en charge puis la destination.
  useEffect(() => {
    if (gps !== 'simulated' || !activeRide) return;
    const target = activeRide.status === 'in_progress' ? activeRide.destination
      : (activeRide.status === 'accepted' && !activeRide.offer) || activeRide.status === 'driver_en_route' ? activeRide.origin : null;
    if (!target) return;
    const id = window.setInterval(() => {
      setPosition((p) => {
        const dLat = target.lat - p.lat;
        const dLng = target.lng - p.lng;
        const step = 0.0009; // ~100 m par tick (démo accélérée)
        const dist = Math.hypot(dLat, dLng);
        if (dist < step) return target;
        return { lat: p.lat + (dLat / dist) * step, lng: p.lng + (dLng / dist) * step };
      });
    }, 1500);
    return () => window.clearInterval(id);
  }, [gps, activeRide]);

  // Heartbeat de position (présence + suivi client en direct) : toutes les 5 s en ligne,
  // toutes les 3 s en mission, et immédiatement à chaque étape de la course.
  const rideStep = activeRide ? `${activeRide.id}:${activeRide.status}` : null;
  useEffect(() => {
    if (!tracking || !session) return;
    const send = () => { void backend.sendLocation(posRef.current).catch(() => undefined); };
    send();
    const id = window.setInterval(send, rideStep ? 3000 : 5000);
    return () => window.clearInterval(id);
  }, [tracking, session, backend, rideStep]);

  /* ---------------------------------- Actions ---------------------------------- */
  /** Exécute une action serveur avec indicateur d'occupation et message d'erreur lisible. */
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) showToast(success, 'success');
      return r;
    } catch (e) {
      showToast(errMsg(e), 'danger');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const actions = {
    async requestOtp(phone: string) {
      try { return await backend.requestOtp(phone); } catch (e) { showToast(errMsg(e), 'danger'); return null; }
    },
    async verifyOtp(phone: string, code: string, name?: string, category?: string) {
      try {
        const r = await backend.verifyOtp(phone, code, name, category);
        setSession(backend.session());
        setDriver(r.driver);
        await refresh();
        showToast(r.created ? tr('Compte chauffeur créé — complétez votre dossier') : tr('Bon retour, {0} 👋', [r.driver.name.split(' ')[0]]), 'success');
        return true;
      } catch (e) {
        showToast(errMsg(e), 'danger');
        return false;
      }
    },
    async logout() {
      // On ne laisse pas un chauffeur « fantôme » en ligne après déconnexion.
      if (driver && (driver.availability === 'online' || driver.availability === 'paused')) {
        await backend.goOffline().catch(() => undefined);
      }
      backend.logout();
      setSession(null);
      setDriver(null);
      setFinance(null);
      setActiveRide(null);
    },
    goOnline: () => run(async () => { await backend.goOnline(posRef.current); await refresh(); }, tr('Vous êtes en ligne')),
    goOffline: () => run(async () => { await backend.goOffline(); await refresh(); }, tr('Vous êtes hors ligne')),
    accept: (rideId: string) => run(async () => { setActiveRide(await backend.acceptOffer(rideId)); },
      activeRide?.serviceType === 'delivery' ? tr('Livraison acceptée, cap sur le colis !') : tr('Course acceptée — en route !')),
    decline: (rideId: string, reason?: string) => run(async () => { await backend.declineOffer(rideId, reason); setActiveRide(null); await refresh(); }, tr('Offre refusée')),
    transition: (rideId: string, to: RideStatus) => run(async () => {
      await backend.transition(rideId, to);
      const cur = activeRef.current;
      if (to === 'cancelled') { setActiveRide(null); await refresh(); } else if (cur && cur.id === rideId) setActiveRide({ ...cur, status: to });
    }),
    /** Code du passager : renvoie le message d'erreur (mauvais code, essais restants) ou null. */
    async start(rideId: string, code: string): Promise<string | null> {
      setBusy(true);
      try {
        await backend.start(rideId, code);
        const cur = activeRef.current;
        if (cur && cur.id === rideId) setActiveRide({ ...cur, status: 'in_progress', codeRequis: false, codeVerifie: true });
        showToast(tr('Code vérifié : identité du passager confirmée'), 'success');
        return null;
      } catch (e) {
        return errMsg(e);
      } finally {
        setBusy(false);
      }
    },
    wait: (rideId: string, minutes: number) => run(async () => {
      const r = await backend.wait(rideId, minutes);
      const cur = activeRef.current;
      if (cur && cur.id === rideId) setActiveRide({ ...cur, waitMinutes: r.waitMinutes });
      showToast(r.billableMinutes > 0 ? tr('Attente : {0} min · {1} F facturés', [r.waitMinutes, r.waitFee.toLocaleString('fr-FR')]) : tr('Attente : {0} min (courtoisie : {1} min offertes)', [r.waitMinutes, r.freeMinutes]));
      return r;
    }),
    collectCash: (rideId: string) => run(async () => { await backend.collectCash(rideId); await refresh(); }),
    // SOS : l'alerte part, puis le chauffeur SUIT sa prise en charge (rien n'est annoncé d'avance).
    sos: (note?: string) => run(async () => {
      const id = await backend.sos(activeRef.current?.id ?? null, posRef.current, note);
      if (id) {
        try { localStorage.setItem('orion.driver.sos', id); } catch { /* ignore */ }
        setSosLive(null);
        setSosId(id);
        setSosOuvert(true);
      }
    }, tr('Alerte reçue par la supervision ORION')),
    sosRepondre: async (text: string) => {
      if (!sosId) return;
      const s = await backend.sosRepondre(sosId, text).catch(() => null);
      if (s) setSosLive(s); else showToast(tr('Message non envoyé — réessayez'), 'danger');
    },
    sosReduire: () => setSosOuvert(false),
    sosOuvrir: () => setSosOuvert(true),
    sosFermer: () => {
      try { localStorage.removeItem('orion.driver.sos'); } catch { /* ignore */ }
      setSosId(null); setSosLive(null);
    },
    /** Annulation motivée : renvoie true si elle a abouti. */
    cancelRide: (rideId: string, motif: MotifAnnulationChauffeur, details?: string) => run(async () => {
      const r = await backend.cancelRide(rideId, motif, details);
      setActiveRide(null);
      await refresh();
      showToast(r.reattribuee ? tr('Course annulée : le passager est confié à un autre chauffeur, sans frais pour lui')
        : motif === 'client_absent' ? (r.frais ? tr('Passager absent : course annulée (frais d’absence {0} F)', [r.frais.toLocaleString('fr-FR')]) : tr('Passager absent : course annulée')) : tr('Course annulée'), 'info');
      return true;
    }),
    /** Course couverte par l'abonnement : valider la fin (0 F à encaisser). */
    settleCovered: (rideId: string, method: string) => run(async () => { await backend.settleCovered(rideId, method); await refresh(); }),
    rentalStep: (rentalId: string, etape: EtapeLocation, note?: string) => run(async () => {
      const r = await backend.rentalStep(rentalId, etape, note);
      setRentals((l) => l.map((x) => (x.id === r.id ? r : x)));
      return r;
    }, tr('Étape enregistrée — la console ORION la voit')),
    deposerRequete: (r: NouvelleRequete) => run(async () => { const x = await backend.deposerRequete(r); setPosteVersion((v) => v + 1); return x; }, tr('Demande envoyée à votre chef d’équipe')),
    repondreMessage: (id: string, texte: string) => run(async () => { await backend.repondreMessage(id, texte); setPosteVersion((v) => v + 1); return true; }, tr('Réponse envoyée')),
    rendreRapport: (id: string, texte: string) => run(async () => { await backend.rendreRapport(id, texte); setPosteVersion((v) => v + 1); return true; }, tr('Rapport rendu')),
    lireMessage: async (id: string) => { await backend.lireMessage(id).catch(() => undefined); setPosteVersion((v) => v + 1); },
    setPhoto: (dataUrl: string) => run(async () => { await backend.setPhoto(dataUrl); await refresh(); return true; }, tr('Photo enregistrée — vos passagers vous reconnaîtront')),
    deletePhoto: () => run(async () => { await backend.deletePhoto(); await refresh(); }, tr('Photo retirée')),
    telemetry: (body: { engine?: 'electric' | 'hybrid'; batteryPct?: number; batteryHealthPct?: number }) => run(async () => { await backend.telemetry(body); await refresh(); }, tr('Télémétrie transmise')),
    updateProfile: (patch: Parameters<DriverBackend['updateProfile']>[0]) => run(async () => { await backend.updateProfile(patch); await refresh(); }, tr('Dossier enregistré')),
    submitKyc: () => run(async () => { setDriver(await backend.submitKyc()); }, tr('Dossier envoyé à ORION pour validation')),
    payout: (amount: number, method: string) => run(async () => { await backend.payout(amount, method); await refresh(); return true; }, tr('Demande de retrait envoyée')),
    dismissSettled: () => setSettled(null),
    refresh,
  };

  return {
    backend, live: backend.live, booting, session, driver, finance, appConfig, driverConfig, activeRide, link,
    notices, announcements, toast, settled, position, gps, busy, showToast, actions,
    rentals, posteVersion, sosLive, sosOuvert, sosHorsLigne,
  };
}

export type DriverApp = ReturnType<typeof useDriver>;
