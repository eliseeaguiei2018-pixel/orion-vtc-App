import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { Container } from '../../container.js';
import { config } from '../../config/index.js';
import { CONFIG_ROOM, DASHBOARD_ROOM, EMERGENCY_ROOM, rideRoom, sosRoom } from './hub.js';
import { accesPersonnel } from '../admin/acces-hors-console.js';

/**
 * Passerelle temps réel (WebSocket) pour un tracking précis et fluide.
 *
 *  - GET /ws/rides/:id   → flux d'une course (position chauffeur, transitions, alertes)
 *  - GET /ws/emergency   → flux du poste de supervision (alertes SOS / accidents → SAMU),
 *                          réservé au personnel habilité (`alerts:read`)
 *  - GET /ws/sos/:id     → suivi d'UNE alerte par la personne qui l'a déclenchée
 *                          (`?userId=` doit être le sien)
 *  - GET /ws/dashboard   → journal d'activité du tableau de bord (direction ou habilitation)
 *  - GET /ws/config      → config publique en temps réel (maintenance, services,
 *                          passerelles) : l'app cliente se met à jour sans redémarrer
 *
 * Heartbeat ping/pong pour détecter les connexions mortes ; nettoyage à la déconnexion.
 * Nœuds stateless : en multi-instances, le RealtimeHub est adossé à Redis Pub/Sub.
 */
export async function realtimeRoutes(app: FastifyInstance, container: Container): Promise<void> {
  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });

  app.register(async (scoped) => {
    // GARDE-FOU : nombre de canaux ouverts EN MÊME TEMPS depuis une même adresse. Large (une
    // adresse d'opérateur mobile regroupe beaucoup de téléphones), mais borné : une seule
    // machine ne peut pas épuiser la mémoire du serveur en ouvrant des canaux à l'infini.
    const parAdresse = new Map<string, number>();
    scoped.addHook('onRequest', async (req, reply) => {
      if ((parAdresse.get(req.ip) ?? 0) >= config.WS_MAX_PAR_ADRESSE) {
        await reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Trop de connexions temps réel depuis cette adresse' } });
      }
    });
    scoped.addHook('onRequest', async (req) => {
      if (String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket') return;
      // Socket réel seulement (les canaux simulés des tests n'ont pas d'événement « close »).
      const brut = req.raw.socket as { once?: (e: string, f: () => void) => unknown } | undefined;
      if (typeof brut?.once !== 'function') return;
      const ip = req.ip;
      parAdresse.set(ip, (parAdresse.get(ip) ?? 0) + 1);
      brut.once('close', () => {
        const n = (parAdresse.get(ip) ?? 1) - 1;
        if (n <= 0) parAdresse.delete(ip); else parAdresse.set(ip, n);
      });
    });

    scoped.get('/ws/rides/:id', { websocket: true }, async (socket, req) => {
      const { id } = req.params as { id: string };
      // Dernière position connue du chauffeur, envoyée dès la connexion : le passager voit
      // tout de suite où est sa voiture et dans combien de temps elle arrive.
      const ride = container.rides.get(id);
      const enApproche = ride?.driverId && ['accepted', 'driver_en_route', 'arrived', 'in_progress'].includes(ride.status);
      const positionChauffeur = enApproche ? await container.geo.position?.(ride.driverId!).catch(() => null) ?? null : null;
      attach(socket, container, rideRoom(id), { rideId: id, ...(positionChauffeur ? { positionChauffeur } : {}) });
    });

    // Supervision : positions et identités de personnes en détresse. Le contrôle se
    // fait AVANT la mise à niveau WebSocket — un refus est une simple réponse HTTP.
    scoped.get('/ws/emergency', {
      websocket: true,
      preValidation: async (req, reply) => {
        const acces = accesPersonnel(req, 'alerts:read');
        if (!acces.ok) await reply.code(acces.code).send({ error: acces.message });
      },
    }, (socket) => {
      attach(socket, container, EMERGENCY_ROOM, {});
    });

    // Tableau de bord ORION : le journal d'activité de tout l'écosystème, en direct.
    scoped.get('/ws/dashboard', {
      websocket: true,
      preValidation: async (req, reply) => {
        const acces = accesPersonnel(req, 'overview:read');
        if (!acces.ok) { await reply.code(acces.code).send({ error: acces.message }); return; }
        // Même règle que /admin/dashboard : de droit, ou manager habilité par la direction.
        if (!container.habilitations.peutVoirTableau(acces.compte)) {
          const c = acces.compte;
          container.security.record({ username: c.username, name: c.name, role: c.role, permission: 'dashboard:read', path: '/ws/dashboard', ip: req.ip });
          container.audit.log({ actor: c.name, role: c.role, action: 'access.denied', details: { permission: 'dashboard:read', path: '/ws/dashboard' } });
          await reply.code(403).send({ error: 'Tableau de bord réservé à la direction et aux comptes habilités.' });
        }
      },
    }, (socket) => {
      // Sous forte charge, des milliers de lignes par seconde : on les envoie par lots.
      attach(socket, container, DASHBOARD_ROOM, {}, { lot: 'journal', intervalleMs: 250, garder: 40 });
    });

    // Suivi usager : l'état courant à la connexion, puis chaque évolution.
    scoped.get('/ws/sos/:id', {
      websocket: true,
      preValidation: async (req, reply) => {
        const { id } = req.params as { id: string };
        const userId = (req.query as { userId?: string }).userId ?? '';
        const suivi = container.safety.suiviPour(id, userId);
        if (!suivi || suivi === 'interdit') await reply.code(404).send({ error: 'Alerte introuvable' });
      },
    }, (socket, req) => {
      const { id } = req.params as { id: string };
      const userId = (req.query as { userId?: string }).userId ?? '';
      attach(socket, container, sosRoom(id), { suivi: container.safety.suiviPour(id, userId) });
    });

    // CONSOLE EN TEMPS RÉEL : la console (navigateur ou application téléphone) est
    // prévenue dès qu'une course, un chauffeur, une alerte ou une inscription change, et
    // se met à jour aussitôt au lieu d'attendre son tour de rafraîchissement.
    scoped.get('/ws/console', {
      websocket: true,
      preValidation: async (req, reply) => {
        const acces = accesPersonnel(req, 'overview:read');
        if (!acces.ok) await reply.code(acces.code).send({ error: acces.message });
      },
    }, (socket) => {
      attacherConsole(socket, container);
    });

    // Config publique temps réel : l'app cliente reçoit l'état courant à la connexion
    // (message `connected` avec `config`), puis chaque changement (message `config.update`).
    scoped.get('/ws/config', { websocket: true }, (socket) => {
      const config = { ...container.settings.getServices(), currency: 'XOF' };
      attach(socket, container, CONFIG_ROOM, { config });
    });
  });
}

interface Regroupement {
  /** Type de message regroupé (les autres passent tels quels). */
  lot: string;
  intervalleMs: number;
  /** Nombre de messages les plus récents gardés dans un lot (les autres sont comptés). */
  garder: number;
}

function attach(
  socket: { send: (data: string) => void; on: (ev: string, cb: (...a: unknown[]) => void) => void; ping?: () => void; close: () => void },
  container: Container,
  room: string,
  hello: Record<string, unknown>,
  regroupement?: Regroupement,
): void {
  const mesures = container.mesures;
  const envoyer = (texte: string) => {
    try {
      socket.send(texte);
      mesures.noterEnvois(1);
    } catch {
      /* socket en cours de fermeture */
    }
  };
  mesures.connexionOuverte();
  envoyer(JSON.stringify({ type: 'connected', room, ...hello, at: new Date().toISOString() }));

  // REGROUPEMENT : un écran ne lit pas 3 000 lignes par seconde, et un navigateur qui
  // reçoit 3 000 messages par seconde ne fait plus que ça. Les messages du type regroupé
  // partent toutes les `intervalleMs` en un seul « lot » : les plus récents, et le compte
  // exact de tous ceux reçus depuis le lot précédent.
  let enAttente: unknown[] = [];
  let recus = 0;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const vider = () => {
    minuterie = undefined;
    if (!recus) return;
    const lot = enAttente.slice(-(regroupement?.garder ?? 40)).reverse();
    envoyer(JSON.stringify({ type: `${regroupement!.lot}.lot`, room, at: new Date().toISOString(), data: { entrees: lot, recus } }));
    enAttente = [];
    recus = 0;
  };

  const unsubscribe = container.realtime.subscribe(room, (msg) => {
    if (regroupement && msg.type === regroupement.lot) {
      enAttente.push(msg.data);
      if (enAttente.length > regroupement.garder * 4) enAttente.splice(0, enAttente.length - regroupement.garder);
      recus += 1;
      minuterie ??= setTimeout(vider, regroupement.intervalleMs);
      return;
    }
    envoyer(JSON.stringify(msg));
  });

  // Heartbeat : ferme les connexions silencieuses (back-pressure / ressources).
  const heartbeat = setInterval(() => {
    try {
      socket.ping?.();
    } catch {
      /* ignore */
    }
  }, 30_000);
  heartbeat.unref?.();

  socket.on('close', () => {
    clearInterval(heartbeat);
    if (minuterie) clearTimeout(minuterie);
    unsubscribe();
    mesures.connexionFermee();
  });
}

/** Domaine de la console concerné par un message temps réel (null : sans intérêt pour elle). */
export function domaineConsole(msg: { type: string; room: string }): string | null {
  if (msg.type === 'journal') return null;
  if (msg.room.startsWith('ride:')) return msg.type === 'driver.location' ? 'positions' : 'courses';
  if (msg.room.startsWith('driver:')) {
    if (msg.type === 'driver.location') return 'positions';
    return msg.type === 'driver.update' ? 'chauffeurs' : 'courses';
  }
  if (msg.room === EMERGENCY_ROOM || msg.room.startsWith('sos:')) return 'sos';
  if (msg.room === 'support' || msg.room.startsWith('client:')) return 'support';
  return null;
}

function attacherConsole(
  socket: { send: (data: string) => void; on: (ev: string, cb: (...a: unknown[]) => void) => void; ping?: () => void },
  container: Container,
): void {
  const mesures = container.mesures;
  const envoyer = (texte: string) => {
    try { socket.send(texte); mesures.noterEnvois(1); } catch { /* fermeture en cours */ }
  };
  mesures.connexionOuverte();
  envoyer(JSON.stringify({ type: 'connected', room: 'console', at: new Date().toISOString() }));
  // Regroupement : au plus un avis par seconde (les positions, au plus toutes les 4 s).
  const domaines = new Set<string>();
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  let dernierePosition = 0;
  const vider = () => {
    minuterie = undefined;
    if (!domaines.size) return;
    envoyer(JSON.stringify({ type: 'console.maj', room: 'console', at: new Date().toISOString(), data: { domaines: [...domaines] } }));
    domaines.clear();
  };
  const desabonner = container.realtime.subscribeAll((msg) => {
    const d = domaineConsole(msg);
    if (!d) return;
    if (d === 'positions') {
      const t = Date.now();
      if (t - dernierePosition < 4000) return;
      dernierePosition = t;
    }
    domaines.add(d);
    minuterie ??= setTimeout(vider, 1000);
  });
  const battement = setInterval(() => { try { socket.ping?.(); } catch { /* ignore */ } }, 30_000);
  battement.unref?.();
  socket.on('close', () => {
    clearInterval(battement);
    if (minuterie) clearTimeout(minuterie);
    desabonner();
    mesures.connexionFermee();
  });
}
