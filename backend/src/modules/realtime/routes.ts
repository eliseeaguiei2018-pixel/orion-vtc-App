import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { Container } from '../../container.js';
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
