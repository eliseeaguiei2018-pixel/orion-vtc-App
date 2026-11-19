import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { createRepository, type Repository } from '../../core/db/repository.js';
import { parse } from '../../core/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { validerPhoto } from '../clients/auth.js';
import {
  MAX_ECHEANCES, PLAFOND_AVANCE, PLAFOND_PRET, STATUT_LABEL, TYPE_LABEL, TYPES_FINANCIERS,
  type RequeteChauffeur,
} from '../crew/requests.js';
import { STATUT_RAPPORT_LABEL } from '../staff/comms.js';
import { requireDriver } from './auth.js';
import type { Driver } from '../drivers/store.js';

/**
 * LE POSTE DU CHAUFFEUR DANS SON APP — le même que celui de la console (session
 * « Mon poste » d'un compte chauffeur), servi au jeton de l'app : son activité sur 30
 * jours, son argent (solde, dette espèces, reste dû sur un prêt), son équipe et son
 * chef à appeler, ses requêtes (prêt, avance, congé, réparation…) et les messages de
 * son chef. Ce qu'il dépose ici suit exactement le circuit console :
 * chef d'équipe → direction financière → trésorerie.
 *
 * Il ne voit ni chiffre de l'entreprise, ni dossier d'un collègue.
 */

/* ------------------------------ Photo du chauffeur ------------------------------ */

interface PhotoChauffeur { id: string; photo: string; at: string }

/**
 * Photos des chauffeurs, rangées À PART de la fiche : une photo pèse des dizaines de
 * kilo-octets et la fiche circule sans cesse (canal temps réel, listes console).
 */
class PhotosChauffeurs {
  private readonly photos = new Map<string, PhotoChauffeur>();
  constructor(private readonly repo: Repository<PhotoChauffeur>) {
    for (const p of repo.all()) this.photos.set(p.id, p);
  }
  get(id: string): PhotoChauffeur | undefined { return this.photos.get(id); }
  set(id: string, photo: string): PhotoChauffeur {
    const p = { id, photo, at: new Date().toISOString() };
    this.photos.set(id, p);
    this.repo.put(p);
    return p;
  }
  delete(id: string): void {
    this.photos.delete(id);
    this.repo.delete(id);
  }
}

const registre = new WeakMap<Container, PhotosChauffeurs>();
export function photosChauffeurs(container: Container): PhotosChauffeurs {
  let p = registre.get(container);
  if (!p) {
    p = new PhotosChauffeurs(createRepository<PhotoChauffeur>('driver_photos'));
    registre.set(container, p);
  }
  return p;
}

/** Adresse de la photo d'un chauffeur (versionnée : un changement invalide les caches). */
export const photoUrl = (d: Pick<Driver, 'id' | 'photoUpdatedAt'>): string | null =>
  d.photoUpdatedAt ? `/drivers/${d.id}/photo?v=${encodeURIComponent(d.photoUpdatedAt)}` : null;

/**
 * Le chauffeur tel que le PASSAGER le voit : de quoi le reconnaître (photo, véhicule,
 * VRAIE plaque, couleur) et lui faire confiance (note). Rien d'autre.
 */
export function chauffeurPourClient(d: Driver) {
  return {
    name: d.name, matricule: d.matricule, ratingAvg: d.ratingAvg, ratingCount: d.ratingCount,
    vehicleModel: d.vehicleModel ?? null, vehiclePlate: d.vehiclePlate ?? null, vehicleColor: d.vehicleColor ?? null,
    photoUrl: photoUrl(d),
  };
}

/* ---------------------------------- Routes ---------------------------------- */

const vueRequete = (r: RequeteChauffeur) => ({
  id: r.id, type: r.type, typeLabel: TYPE_LABEL[r.type], statut: r.statut, statutLabel: STATUT_LABEL[r.statut],
  montant: r.montant ?? null, montantAccorde: r.montantAccorde ?? null, echeances: r.echeances ?? null,
  du: r.du ?? null, au: r.au ?? null, motif: r.motif, createdAt: r.createdAt,
  // Les étapes du circuit, sans l'avis interne du chef (il le motive pour la direction).
  instruiteLe: r.avisAt ?? null, decideLe: r.decideAt ?? null, decisionNote: r.decisionNote ?? null,
  verseLe: r.verseLe ?? null, canalVersement: r.canalVersement ?? null,
  plan: r.plan ?? null, rembourse: r.rembourse ?? 0, clotureLe: r.clotureLe ?? null,
});

export async function posteChauffeurRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const photos = photosChauffeurs(container);
  /** Identifiant console du chauffeur (messages du chef, rapports). */
  const compte = (driverId: string) => container.accounts.parChauffeur(driverId);

  app.get('/drivers/:id/poste', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const dossier = container.crew.dossier(id, 30);
    if (!dossier) throw notFound('Chauffeur introuvable');
    const acces = compte(id);
    const chef = dossier.equipe?.managerUsername ? container.accounts.get(dossier.equipe.managerUsername) : undefined;
    return {
      activite: dossier.activite,
      argent: {
        solde: dossier.argent.solde,
        detteEspeces: dossier.argent.detteEspeces,
        plafondDette: container.settings.getOps().cashDebtLimit ?? 0,
        resteDu: dossier.argent.resteDu,
      },
      equipe: dossier.equipe
        ? { name: dossier.equipe.name, mission: dossier.equipe.mission ?? null, chef: dossier.equipe.managerName ?? chef?.name ?? null, chefTelephone: chef?.phone ?? null }
        : null,
      // Son identifiant pour la console ORION (Mon poste), s'il en a un.
      acces: acces ? { identifiant: acces.username, actif: acces.active, aChangerMotDePasse: acces.mustChangePassword } : null,
      requetes: container.crewRequests.list({ driverId: id }).map(vueRequete),
      // Litiges sur ses courses : l'état, jamais le texte du plaignant.
      litiges: dossier.litiges.map(({ id: lid, kind, status, createdAt }) => ({ id: lid, kind, status, createdAt })),
      maintenance: dossier.maintenance,
      alertes: dossier.alertes,
      typesRequete: Object.entries(TYPE_LABEL).map(([code, label]) => ({ code, label, financiere: TYPES_FINANCIERS.includes(code as never) })),
      plafonds: { avance: PLAFOND_AVANCE, pret: PLAFOND_PRET, echeancesMax: MAX_ECHEANCES },
      messagesNonLus: acces ? container.staffComms.nonLus(acces.username) : 0,
      genereA: dossier.genereA,
    };
  });

  // Dépôt d'une requête depuis l'app : même circuit que la console.
  app.post('/drivers/:id/requetes', async (req, reply) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const body = parse(z.object({
      type: z.enum(['pret', 'avance', 'conge', 'materiel', 'reparation', 'reclamation', 'document']),
      montant: z.number().positive().max(10_000_000).optional(),
      echeances: z.number().int().min(1).max(MAX_ECHEANCES).optional(),
      du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      au: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      motif: z.string().trim().min(3).max(600),
    }), req.body);
    const d = container.drivers.get(id);
    if (!d) throw notFound('Chauffeur introuvable');
    if (body.type === 'conge' && (!body.du || !body.au || body.au < body.du)) throw badRequest('Indiquez les dates du congé (du … au …)');
    const equipe = container.teams.list().find((t) => t.driverIds.includes(id));
    const res = container.crewRequests.deposer({ driverId: id, driverName: d.name, matricule: d.matricule, teamId: equipe?.id, ...body });
    if (typeof res === 'string') {
      const messages: Record<string, string> = {
        montant_requis: 'Indiquez le montant demandé.',
        plafond_depasse: `Montant au-dessus du plafond (avance ${PLAFOND_AVANCE.toLocaleString('fr-FR')} F, prêt ${PLAFOND_PRET.toLocaleString('fr-FR')} F).`,
        doublon: 'Un prêt est déjà en cours : il doit être remboursé avant un nouveau prêt.',
      };
      throw res === 'doublon' ? conflict(messages[res]!) : badRequest(messages[res]!);
    }
    container.audit.log({ actor: d.name, role: 'chauffeur', action: 'crew.request', target: res.id, details: { driverId: id, type: body.type, montant: body.montant, via: 'app' } });
    reply.code(201);
    return { requete: vueRequete(res) };
  });

  /* ---------------------- Messages et rapports du chef ---------------------- */

  const monCompte = (id: string) => {
    const acces = compte(id);
    if (!acces) throw forbidden('Pas encore d’identifiant ORION : demandez-le à votre chef d’équipe.');
    return acces;
  };

  app.get('/drivers/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const acces = compte(id);
    if (!acces) return { messages: [], rapports: [], nonLus: 0, identifiant: null };
    return {
      messages: container.staffComms.recus(acces.username),
      rapports: container.staffComms.rapports_({ destinataire: acces.username })
        .map((r) => ({ ...r, statutLabel: STATUT_RAPPORT_LABEL[r.statut] })),
      nonLus: container.staffComms.nonLus(acces.username),
      identifiant: acces.username,
    };
  });

  app.post('/drivers/:id/messages/:messageId/lu', async (req) => {
    const { id, messageId } = req.params as { id: string; messageId: string };
    requireDriver(req, id);
    const r = container.staffComms.marquerLu(messageId, monCompte(id).username);
    if (!r || r === 'pas_destinataire') throw notFound('Message introuvable');
    return { message: r };
  });

  app.post('/drivers/:id/messages/:messageId/reponse', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { id, messageId } = req.params as { id: string; messageId: string };
    requireDriver(req, id);
    const { texte } = parse(z.object({ texte: z.string().trim().min(1).max(1000) }), req.body);
    const acces = monCompte(id);
    const r = container.staffComms.repondre(messageId, acces.username, acces.name, texte);
    if (!r || r === 'hors_conversation') throw notFound('Message introuvable');
    return { message: r };
  });

  app.post('/drivers/:id/rapports/:rapportId/rendre', async (req) => {
    const { id, rapportId } = req.params as { id: string; rapportId: string };
    requireDriver(req, id);
    const { texte } = parse(z.object({ texte: z.string().trim().min(3).max(4000) }), req.body);
    const r = container.staffComms.rendre(rapportId, monCompte(id).username, texte);
    if (!r || r === 'pas_destinataire') throw notFound('Rapport introuvable');
    if (r === 'deja_accepte') throw conflict('Ce rapport a déjà été accepté.');
    return { rapport: { ...r, statutLabel: STATUT_RAPPORT_LABEL[r.statut] } };
  });

  /* ------------------------------- Photo ------------------------------- */

  // Photo prise ou choisie dans l'app (recadrée et compressée), vérifiée octet par octet.
  app.put('/drivers/:id/photo', async (req, reply) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const { photo } = parse(z.object({ photo: z.string().min(30).max(600_000) }), req.body);
    const v = validerPhoto(photo);
    if (!v.ok) { reply.code(400); return { error: v.raison }; }
    const d = container.drivers.get(id);
    if (!d) throw notFound('Chauffeur introuvable');
    const p = photos.set(id, photo);
    d.photoUpdatedAt = p.at;
    container.drivers.persist(id);
    container.audit.log({ actor: d.name, role: 'chauffeur', action: 'driver.photo', target: id, details: {} });
    return { photoUrl: photoUrl(d) };
  });

  app.delete('/drivers/:id/photo', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const d = container.drivers.get(id);
    if (!d) throw notFound('Chauffeur introuvable');
    photos.delete(id);
    delete d.photoUpdatedAt;
    container.drivers.persist(id);
    return { photoUrl: null };
  });

  /**
   * Image de la photo : pour le passager (reconnaître son chauffeur), son contact de
   * confiance, la console et le dossier SOS. Adresse non devinable (identifiant aléatoire).
   */
  app.get('/drivers/:id/photo', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = photos.get(id);
    if (!p) throw notFound('Pas de photo');
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(p.photo);
    if (!m) throw notFound('Pas de photo');
    reply.header('content-type', m[1]);
    reply.header('cache-control', 'private, max-age=86400');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(Buffer.from(m[2]!, 'base64'));
  });
}
