import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { Container } from '../../container.js';
import { EMERGENCY_ROOM, rideRoom } from './hub.js';

/**
 * Passerelle temps réel (WebSocket) pour un tracking précis et fluide.
 *
 *  - GET /ws/rides/:id   → flux d'une course (position chauffeur, transitions, alertes)
 *  - GET /ws/emergency   → flux du poste de supervision (alertes SOS / accidents → SAMU)
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

    scoped.get('/ws/emergency', { websocket: true }, (socket) => {
      attach(socket, container, EMERGENCY_ROOM, {});
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
