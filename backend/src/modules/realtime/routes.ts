import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { Container } from '../../container.js';
import { CONFIG_ROOM, EMERGENCY_ROOM, rideRoom, sosRoom } from './hub.js';
import { accesPersonnel } from '../admin/acces-hors-console.js';

/**
 * Passerelle temps réel (WebSocket) pour un tracking précis et fluide.
 *
 *  - GET /ws/rides/:id   → flux d'une course (position chauffeur, transitions, alertes)
 *  - GET /ws/emergency   → flux du poste de supervision (alertes SOS / accidents → SAMU),
 *                          réservé au personnel habilité (`alerts:read`)
 *  - GET /ws/sos/:id     → suivi d'UNE alerte par la personne qui l'a déclenchée
 *                          (`?userId=` doit être le sien)
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
    scoped.get('/ws/rides/:id', { websocket: true }, (socket, req) => {
      const { id } = req.params as { id: string };
      attach(socket, container, rideRoom(id), { rideId: id });
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

    // Config publique temps réel : l'app cliente reçoit l'état courant à la connexion
    // (message `connected` avec `config`), puis chaque changement (message `config.update`).
    scoped.get('/ws/config', { websocket: true }, (socket) => {
      const config = { ...container.settings.getServices(), currency: 'XOF' };
      attach(socket, container, CONFIG_ROOM, { config });
    });
  });
}

function attach(
  socket: { send: (data: string) => void; on: (ev: string, cb: (...a: unknown[]) => void) => void; ping?: () => void; close: () => void },
  container: Container,
  room: string,
  hello: Record<string, unknown>,
): void {
  socket.send(JSON.stringify({ type: 'connected', room, ...hello, at: new Date().toISOString() }));

  const unsubscribe = container.realtime.subscribe(room, (msg) => {
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      /* socket en cours de fermeture */
    }
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
    unsubscribe();
  });
}
