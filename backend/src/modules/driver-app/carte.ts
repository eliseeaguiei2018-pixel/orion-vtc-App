import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { createRepository, type Repository } from '../../core/db/repository.js';
import { haversineMeters, type LatLng } from '../../core/geo.js';
import { badRequest } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import type { Permission } from '../admin/roles.js';
import { communeDe, quartierProche } from '../maps/lieux.js';
import { multiplicateur, SUPPLY_RADIUS_M } from '../rides/demand.js';
import { RAYON_DEMANDE_M } from '../simulateur/service.js';
import { requireDriver } from './auth.js';

/**
 * LA CARTE DE SERVICE D'ORION PRO (chauffeurs et livreurs), hors course :
 *  - ZONES À FORTE DEMANDE en direct (demandes des 10 dernières minutes contre chauffeurs libres
 *    autour, simulateur du PDG compris quand il agit), avec leur niveau et la majoration en cours ;
 *  - ZONES PRÉVUES : là où les clients commandent d'habitude à cette heure-ci (4 dernières semaines) ;
 *  - SIÈGES ET AGENCES ORION, renseignés par la direction dans la console, et celui de la zone
 *    du chauffeur, pour y rentrer en un toucher.
 * L'app propose ensuite l'itinéraire guidé (voix comprise) vers le point choisi.
 */

export type NiveauZone = 'forte' | 'elevee' | 'moderee';

export interface ZoneDemande {
  id: string;
  lat: number;
  lng: number;
  niveau: NiveauZone;
  demande: number;
  offre: number;
  /** Majoration des prix en cours dans la zone (%, 0 si aucune). */
  majorationPct: number;
  nom: string;
  distanceMeters: number | null;
}

export interface ZonePrevue {
  id: string;
  lat: number;
  lng: number;
  /** Commandes attendues dans l'heure (moyenne des mêmes heures, 4 dernières semaines). */
  attendu: number;
  nom: string;
  distanceMeters: number | null;
}

export interface BaseOrion {
  id: string;
  nom: string;
  /** Adresse lisible (rue, repère) ; facultative. */
  adresse?: string;
  /** Commune ou secteur que la base dessert (le chauffeur de cette zone y est renvoyé). */
  zone?: string;
  lat: number;
  lng: number;
  telephone?: string;
  horaires?: string;
  /** Siège principal : proposé quand aucune base ne couvre la zone du chauffeur. */
  principale?: boolean;
}

interface EnregistrementBases { id: 'bases'; bases: BaseOrion[]; majLe: string; majPar: string }

/** Un seul dépôt par serveur : la console écrit, ORION Pro lit les mêmes sièges. */
const depots = new WeakMap<Container, Repository<EnregistrementBases>>();
function depotBases(c: Container): Repository<EnregistrementBases> {
  let d = depots.get(c);
  if (!d) { d = createRepository<EnregistrementBases>('bases_orion'); depots.set(c, d); }
  return d;
}

const point = z.object({ lat: z.number().min(4).max(11), lng: z.number().min(-9).max(-2) });
const schemaBase = point.extend({
  id: z.string().max(64).optional(),
  nom: z.string().trim().min(2).max(80),
  adresse: z.string().trim().max(160).optional(),
  zone: z.string().trim().max(60).optional(),
  telephone: z.string().trim().max(25).optional(),
  horaires: z.string().trim().max(80).optional(),
  principale: z.boolean().optional(),
});

/** Nom lisible d'un point : quartier proche, sinon commune, sinon coordonnées arrondies. */
function nomDuLieu(p: LatLng): string {
  const q = quartierProche(p);
  const c = communeDe(p);
  if (q && c && q.nom !== c) return `${q.nom} · ${c}`;
  return q?.nom ?? c ?? `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`;
}

/** Niveau d'une zone d'après la demande et l'offre (mêmes seuils que la majoration). */
export function niveauZone(demande: number, offre: number): NiveauZone | null {
  const m = demande >= 3 ? multiplicateur(demande, offre) : 1;
  if (m >= 1.5) return 'forte';
  if (m >= 1.3) return 'elevee';
  if (demande >= 2 && demande > offre) return 'moderee';
  return null;
}

/** Regroupe les cellules voisines (moins de 900 m) : une zone par quartier, pas une mosaïque. */
function regrouper(cellules: Array<{ lat: number; lng: number; demande: number; offre: number }>): Array<{ lat: number; lng: number; demande: number; offre: number }> {
  const zones: Array<{ lat: number; lng: number; demande: number; offre: number }> = [];
  for (const c of [...cellules].sort((a, b) => b.demande - a.demande)) {
    const proche = zones.find((z) => haversineMeters(z, c) < 900);
    if (proche) {
      const total = proche.demande + c.demande;
      proche.lat = (proche.lat * proche.demande + c.lat * c.demande) / total;
      proche.lng = (proche.lng * proche.demande + c.lng * c.demande) / total;
      proche.demande = total;
      proche.offre = Math.max(proche.offre, c.offre);
    } else zones.push({ ...c });
  }
  return zones;
}

export async function carteChauffeurRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const bases = (): BaseOrion[] => depotBases(container).get('bases')?.bases ?? [];

  /** Zones en direct : demande réelle par cellule, et le lieu du simulateur quand il agit. */
  const zonesEnDirect = async (moi: LatLng | null): Promise<ZoneDemande[]> => {
    const cellules = (await container.demand.hotCells(40)).map((c) => ({ lat: c.lat, lng: c.lng, demande: c.demand, offre: c.supply }));
    const sim = container.simulateur.etat();
    if (container.simulateur.enVigueur() && sim.lieu && sim.demande > 0) {
      const reelle = container.demand.demandAt(sim.lieu);
      const offreReelle = (await container.geo.nearby(sim.lieu, SUPPLY_RADIUS_M, 50)).length;
      cellules.push({ lat: sim.lieu.lat, lng: sim.lieu.lng, demande: sim.demande + reelle, offre: offreReelle + container.simulateur.offre(sim.lieu, RAYON_DEMANDE_M) });
    }
    const out: ZoneDemande[] = [];
    for (const z of regrouper(cellules)) {
      const niveau = niveauZone(z.demande, z.offre);
      if (!niveau) continue;
      const m = z.demande >= 3 ? multiplicateur(z.demande, z.offre) : 1;
      const ops = container.settings.getOps();
      // Flotte ORION 100 % électrique : la majoration est plafonnée (console), coupée si le surge l'est.
      const plafond = ops.surgeEnabled === false ? 1 : ops.surgeCapGreen ?? m;
      out.push({
        id: `z-${z.lat.toFixed(4)}-${z.lng.toFixed(4)}`, lat: z.lat, lng: z.lng, niveau,
        demande: z.demande, offre: z.offre, majorationPct: Math.round((Math.min(m, plafond) - 1) * 100),
        nom: nomDuLieu(z), distanceMeters: moi ? Math.round(haversineMeters(moi, z)) : null,
      });
    }
    const rang: Record<NiveauZone, number> = { forte: 0, elevee: 1, moderee: 2 };
    return out.sort((a, b) => rang[a.niveau] - rang[b.niveau] || b.demande - a.demande).slice(0, 12);
  };

  /** Habitudes de l'heure : moyenne des commandes par cellule aux mêmes heures, 4 semaines. Calculée au plus toutes les 5 min. */
  let prevision: { cle: string; calculeA: number; zones: Array<{ lat: number; lng: number; attendu: number }> } | null = null;
  const zonesPrevues = (): Array<{ lat: number; lng: number; attendu: number }> => {
    const maintenant = new Date();
    const heure = maintenant.getUTCHours();
    const cle = String(heure);
    if (prevision && prevision.cle === cle && Date.now() - prevision.calculeA < 5 * 60_000) return prevision.zones;
    const heures = new Set([String(heure).padStart(2, '0'), String((heure + 1) % 24).padStart(2, '0')]);
    const parCellule = new Map<string, { lat: number; lng: number; jours: Map<string, number> }>();
    for (const r of container.rides.createdSince(Date.now() - 28 * 86_400_000)) {
      if (!heures.has(r.createdAt.slice(11, 13))) continue;
      const cell = container.demand.keyFor(r.origin);
      const e = parCellule.get(cell) ?? { lat: r.origin.lat, lng: r.origin.lng, jours: new Map<string, number>() };
      const jour = r.createdAt.slice(0, 10);
      e.jours.set(jour, (e.jours.get(jour) ?? 0) + 1);
      parCellule.set(cell, e);
    }
    const zones = [...parCellule.values()]
      .map((e) => ({ lat: e.lat, lng: e.lng, attendu: Math.round([...e.jours.values()].reduce((a, b) => a + b, 0) / 28 * 10) / 10 }))
      .filter((z) => z.attendu >= 0.5)
      .sort((a, b) => b.attendu - a.attendu)
      .slice(0, 8);
    prevision = { cle, calculeA: Date.now(), zones };
    return zones;
  };

  /** Siège ou agence de la zone du chauffeur : même commune / secteur, sinon la plus proche, sinon le siège principal. */
  const baseConseillee = (moi: LatLng | null): BaseOrion | null => {
    const liste = bases();
    if (liste.length === 0) return null;
    if (!moi) return liste.find((b) => b.principale) ?? liste[0]!;
    const commune = communeDe(moi);
    const zoneTarif = container.settings.getZones().find((z) => z.active && haversineMeters(moi, z) <= z.radiusKm * 1000);
    const deLaZone = liste.filter((b) => b.zone && [commune, zoneTarif?.name, zoneTarif?.id].some((n) => n && n.toLowerCase() === b.zone!.toLowerCase()));
    const parDistance = (l: BaseOrion[]) => [...l].sort((a, b) => haversineMeters(moi, a) - haversineMeters(moi, b))[0] ?? null;
    return parDistance(deLaZone) ?? parDistance(liste);
  };

  app.get('/drivers/:id/carte', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const q = parse(z.object({ lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional() }), req.query ?? {});
    const moi: LatLng | null = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : ((await container.geo.position?.(id)) ?? null);
    const direct = await zonesEnDirect(moi);
    const prevues: ZonePrevue[] = zonesPrevues()
      .filter((p) => !direct.some((z) => haversineMeters(z, p) < 900))
      .slice(0, 6)
      .map((p) => ({ id: `p-${p.lat.toFixed(4)}-${p.lng.toFixed(4)}`, lat: p.lat, lng: p.lng, attendu: p.attendu, nom: nomDuLieu(p), distanceMeters: moi ? Math.round(haversineMeters(moi, p)) : null }));
    const conseil = baseConseillee(moi);
    return {
      zones: direct,
      prevues,
      bases: bases().map((b) => ({ ...b, distanceMeters: moi ? Math.round(haversineMeters(moi, b)) : null })),
      baseConseillee: conseil?.id ?? null,
      majLe: new Date().toISOString(),
    };
  });
}

/** Routes de la console pour les sièges et agences (montées dans le périmètre admin). */
export function basesOrionAdminRoutes(
  scoped: FastifyInstance,
  container: Container,
  exiger: (req: FastifyRequest, perm: Permission) => void,
  journaliser: (req: FastifyRequest, action: string, target?: string, details?: Record<string, unknown>) => void,
): void {
  const depot = depotBases(container);
  scoped.get('/admin/bases-orion', async (req) => {
    exiger(req, 'services:read');
    const e = depot.get('bases');
    return { bases: e?.bases ?? [], majLe: e?.majLe ?? null, majPar: e?.majPar ?? null };
  });
  scoped.put('/admin/bases-orion', async (req) => {
    exiger(req, 'services:write');
    const { bases } = parse(z.object({ bases: z.array(schemaBase).max(60) }), req.body);
    const noms = new Set<string>();
    for (const b of bases) {
      const k = b.nom.toLowerCase();
      if (noms.has(k)) throw badRequest(`Deux sièges portent le nom « ${b.nom} »`);
      noms.add(k);
    }
    const propres: BaseOrion[] = bases.map((b) => ({
      id: b.id ?? randomUUID(), nom: b.nom, lat: b.lat, lng: b.lng,
      ...(b.adresse ? { adresse: b.adresse } : {}), ...(b.zone ? { zone: b.zone } : {}),
      ...(b.telephone ? { telephone: b.telephone } : {}), ...(b.horaires ? { horaires: b.horaires } : {}),
      ...(b.principale ? { principale: true } : {}),
    }));
    const acteur = (req as unknown as { admin?: { name?: string } }).admin?.name ?? 'console';
    depot.put({ id: 'bases', bases: propres, majLe: new Date().toISOString(), majPar: acteur });
    journaliser(req, 'bases_orion.update', 'bases', { nombre: propres.length });
    return { bases: propres };
  });
}
