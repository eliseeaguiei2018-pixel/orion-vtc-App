import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { AppError, badRequest } from '../../core/errors.js';
import { latLng } from '../../core/validate.js';
import type { AdminAccount, Permission } from '../admin/roles.js';
import { SUPPLY_RADIUS_M } from '../rides/demand.js';
import { trafficInfo } from '../geo-ci/zones.js';
import { GAMMES_COURSE } from '../proches/service.js';
import { DUREE_MAX, DUREE_MIN, ErreurSimulation, GAMMES_SIMULEES, MAX_CHAUFFEURS, MAX_DEMANDE, RAYON_DEMANDE_M, type LieuSimulation } from './service.js';

type Exiger = (req: FastifyRequest, perm: Permission) => void;
type Journaliser = (req: FastifyRequest, action: string, target?: string, details?: Record<string, unknown>) => void;

const lieu = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), nom: z.string().max(120).default('Lieu choisi') });
const modifSchema = z.object({
  lieu: lieu.nullable().optional(),
  chauffeurs: z.array(z.object({
    id: z.string().max(24),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    gamme: z.enum(GAMMES_SIMULEES),
  })).max(MAX_CHAUFFEURS).optional(),
  demande: z.number().int().min(0).max(MAX_DEMANDE).optional(),
  dureeMin: z.number().int().min(DUREE_MIN).max(DUREE_MAX).optional(),
});

const qui = (req: FastifyRequest): string => {
  const a = (req as FastifyRequest & { admin: AdminAccount }).admin;
  return a.name ?? a.username ?? 'direction';
};

/**
 * Console « Simulateur » (PDG seul, droit simulateur:use) : le scénario, son effet mesuré au
 * lieu choisi (offre, demande, majoration, approche) et l'aperçu des prix avec et sans lui.
 */
export function simulateurAdminRoutes(scoped: FastifyInstance, container: Container, exiger: Exiger, journaliser: Journaliser): void {
  const sim = container.simulateur;

  /** Ce que le scénario change au lieu choisi, qu'il soit actif ou non (aperçu avant activation). */
  const mesures = async (l: LieuSimulation) => {
    const ops = container.settings.getOps();
    const manuel = container.settings.zoneForPoint(l)?.surgeManual ?? 1;
    const plafonner = (s: number) => (ops.surgeEnabled ? Math.min(Math.max(s, manuel), ops.surgeCapGreen) : Math.min(manuel, ops.surgeCapGreen));
    const facteur = trafficInfo(l, l).factor;
    const [marche, surgeAvec, surgeSans, approches] = await Promise.all([
      container.demand.marcheEn(l, { simulation: true, projet: true }),
      container.demand.surgeFor(l, { simulation: true, projet: true }),
      container.demand.surgeFor(l, { simulation: false }),
      Promise.all([...GAMMES_COURSE, 'moto'].map(async (g) => ({
        gamme: g,
        avec: await container.proches.approche(l, g, facteur, { simulation: true, projet: true }),
        sans: await container.proches.approche(l, g, facteur, { simulation: false }),
      }))),
    ]);
    return {
      ...marche,
      surgeAvec: plafonner(surgeAvec),
      surgeSans: plafonner(surgeSans),
      approches,
    };
  };

  const regles = () => {
    const ops = container.settings.getOps();
    const ap = container.settings.getPricing().approche;
    return {
      rayonOffreM: SUPPLY_RADIUS_M, rayonDemandeM: RAYON_DEMANDE_M, demandeMinimale: 3,
      surgeActif: ops.surgeEnabled, plafond: ops.surgeCapGreen,
      approche: ap ? { actif: ap.actif, offerteKm: ap.offerteKm, offerteMin: ap.offerteMin, parKm: ap.parKm, parMin: ap.parMin, plafond: ap.plafond } : null,
      maxChauffeurs: MAX_CHAUFFEURS, maxDemande: MAX_DEMANDE, dureeMin: DUREE_MIN, dureeMax: DUREE_MAX,
    };
  };

  const reponse = async () => {
    const s = sim.etat();
    return { simulation: s, mesures: s.lieu ? await mesures(s.lieu) : null, regles: regles() };
  };

  const traduire = (e: unknown): never => {
    if (e instanceof ErreurSimulation) throw new AppError(400, e.code, e.message);
    throw e;
  };

  scoped.get('/admin/simulateur', async (req) => {
    exiger(req, 'simulateur:use');
    return reponse();
  });

  scoped.put('/admin/simulateur', async (req) => {
    exiger(req, 'simulateur:use');
    const p = modifSchema.safeParse(req.body);
    if (!p.success) throw badRequest('Scénario invalide', { issues: p.error.issues.slice(0, 5) });
    try {
      const s = sim.modifier(p.data, qui(req));
      journaliser(req, 'simulateur.modifier', 'simulateur', { actif: s.actif, lieu: s.lieu?.nom ?? null, chauffeurs: s.chauffeurs.length, demande: s.demande });
    } catch (e) { traduire(e); }
    return reponse();
  });

  scoped.post('/admin/simulateur/activer', async (req) => {
    exiger(req, 'simulateur:use');
    const p = z.object({ dureeMin: z.number().int().min(DUREE_MIN).max(DUREE_MAX).optional() }).safeParse(req.body ?? {});
    if (!p.success) throw badRequest(`Durée entre ${DUREE_MIN} et ${DUREE_MAX} minutes`);
    try {
      const s = sim.activer(qui(req), p.data.dureeMin);
      journaliser(req, 'simulateur.activer', 'simulateur', { dureeMin: s.dureeMin, expireA: s.expireA, lieu: s.lieu?.nom ?? null, chauffeurs: s.chauffeurs.length, demande: s.demande });
    } catch (e) { traduire(e); }
    return reponse();
  });

  scoped.post('/admin/simulateur/couper', async (req) => {
    exiger(req, 'simulateur:use');
    const etaitActive = sim.etat().actif;
    sim.couper(qui(req));
    if (etaitActive) journaliser(req, 'simulateur.couper', 'simulateur', {});
    return reponse();
  });

  /** Prix d'une course depuis le lieu, par gamme : sans le simulateur, et avec son scénario. */
  scoped.post('/admin/simulateur/apercu', async (req) => {
    exiger(req, 'simulateur:use');
    const p = z.object({ destination: latLng }).safeParse(req.body);
    if (!p.success) throw badRequest('Destination invalide');
    const l = sim.etat().lieu;
    if (!l) throw badRequest('Choisissez d’abord le lieu de prise en charge');
    const service = container.registry.get('ride');
    const base = { origin: { lat: l.lat, lng: l.lng }, destination: p.data.destination, apercu: true } as const;
    // Le trajet par la route se calcule une fois ; les autres devis reprennent sa distance.
    const premier = await service.estimate({ ...base, category: 'argent', modeSimulation: 'sans' });
    const routeMeters = premier.distanceMeters;
    const gammes = await Promise.all(GAMMES_COURSE.map(async (g) => {
      const [sans, avec] = await Promise.all([
        g === 'argent' ? premier : service.estimate({ ...base, category: g, routeMeters, modeSimulation: 'sans' }),
        service.estimate({ ...base, category: g, routeMeters, modeSimulation: 'projet' }),
      ]);
      const resume = (q: typeof sans) => ({ montant: q.amount, surge: q.breakdown.surge, approche: q.breakdown.approche ?? 0, approcheMin: q.approche?.minutes ?? null, approcheKm: q.approche?.km ?? null });
      return { gamme: g, sans: resume(sans), avec: resume(avec) };
    }));
    return { distanceKm: Math.round(premier.distanceMeters / 100) / 10, trafic: premier.trafficLevel, gammes };
  });
}
