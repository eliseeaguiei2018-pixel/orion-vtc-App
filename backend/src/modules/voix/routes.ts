import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { AppError } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import type { Permission } from '../admin/roles.js';
import { requireDriver } from '../driver-app/auth.js';
import { composerBienvenue, courseDuChauffeur, messageDeCourse, textesEnVigueur } from '../rides/bienvenue.js';
import { CATALOGUE, ErreurVoix, FOURNISSEURS, STYLE_DEFAUT, voixHumaine, type AudioVoix, type Fournisseur, type GenreVoix } from './humaine.js';

/**
 * Routes de la voix humaine :
 *  - ORION Pro télécharge le son de l'accueil de sa course dès qu'il l'accepte (approche),
 *    puis le joue quand le client a donné son code ;
 *  - le chauffeur écoute un essai depuis son profil ;
 *  - la console choisit le fournisseur, la voix, le ton, enregistre la clé et fait un essai.
 */

function envoyer(reply: FastifyReply, a: AudioVoix & { empreinte?: string }) {
  reply.header('content-type', a.type);
  reply.header('cache-control', 'private, max-age=3600');
  reply.header('x-orion-voix', `${a.fournisseur}:${a.voix}`);
  reply.header('x-orion-modele', a.modele);
  if (a.empreinte) reply.header('x-orion-empreinte', a.empreinte);
  return reply.send(a.octets);
}

function erreurVoix(e: unknown): AppError {
  if (e instanceof ErreurVoix) {
    if (e.statut === 409) return new AppError(409, 'VOIX_HUMAINE_ABSENTE', e.message);
    return new AppError(502, 'VOIX_HUMAINE', `Voix humaine (${CATALOGUE[e.fournisseur].nom}) : ${e.message}`);
  }
  return new AppError(502, 'VOIX_HUMAINE', e instanceof Error ? e.message : 'Voix humaine indisponible');
}

/** Exemples d'accueil (heure réelle) : voix féminine pour un client, masculine pour une cliente. */
function exemple(container: Container, genre: GenreVoix) {
  return composerBienvenue(genre === 'feminine'
    ? { nom: 'Konan Yao', civilite: 'M', at: new Date(), assure: true, textes: textesEnVigueur(container) }
    : { nom: 'Aya Kouassi', civilite: 'Mme', at: new Date(), assure: false, textes: textesEnVigueur(container) });
}

export async function voixHumaineRoutes(app: FastifyInstance, container: Container): Promise<void> {
  /** Son de l'accueil de la course : préparé pendant l'approche, joué à bord. */
  app.get('/rides/:id/bienvenue/audio', async (req, reply) => {
    const ride = courseDuChauffeur(req, container, ['accepted', 'driver_en_route', 'arrived', 'in_progress']);
    const vh = voixHumaine(container);
    if (!vh.active()) throw new AppError(409, 'VOIX_HUMAINE_ABSENTE', 'Voix humaine non configurée : la voix du téléphone parle');
    const message = messageDeCourse(container, ride);
    try {
      return envoyer(reply, await vh.audio(message.texte, message.voix));
    } catch (e) { throw erreurVoix(e); }
  });

  /** ORION Pro, profil : écouter la voix humaine (client ou cliente d'exemple). */
  app.get('/drivers/:id/voix-bord/essai/audio', async (req, reply) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const { genre } = parse(z.object({ genre: z.enum(['feminine', 'masculine']).default('feminine') }), req.query ?? {});
    const vh = voixHumaine(container);
    if (!vh.active()) throw new AppError(409, 'VOIX_HUMAINE_ABSENTE', 'Voix humaine non configurée : la voix du téléphone parle');
    try {
      return envoyer(reply, await vh.audio(exemple(container, genre).texte, genre));
    } catch (e) { throw erreurVoix(e); }
  });

  /** ORION Pro : la voix humaine est-elle en service ? (le profil affiche la bonne source) */
  app.get('/drivers/:id/voix-bord/humaine', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const vh = voixHumaine(container);
    const r = vh.reglage();
    return {
      active: vh.active(),
      fournisseur: r.fournisseur === 'aucun' ? null : r.fournisseur,
      nom: r.fournisseur === 'aucun' ? null : CATALOGUE[r.fournisseur].nom,
      voix: r.fournisseur === 'aucun' ? null : { feminine: vh.voixPour(r.fournisseur, 'feminine', r), masculine: vh.voixPour(r.fournisseur, 'masculine', r) },
    };
  });
}

/** Console : réglage de la voix humaine (fournisseur, voix, ton, clé chiffrée) et essai d'écoute. */
export function voixHumaineAdminRoutes(
  scoped: FastifyInstance,
  container: Container,
  exiger: (req: FastifyRequest, perm: Permission) => void,
  journaliser: (req: FastifyRequest, action: string, target?: string, details?: Record<string, unknown>) => void,
): void {
  const fournisseur = z.enum(FOURNISSEURS as [Fournisseur, ...Fournisseur[]]);
  const voixId = z.string().trim().max(60).regex(/^[A-Za-z0-9_-]*$/, 'Identifiant de voix invalide');
  const cle = z.string().trim().min(10, 'Clé trop courte').max(400).regex(/^\S+$/, 'La clé ne doit pas contenir d’espace');

  const etat = () => {
    const vh = voixHumaine(container);
    const r = vh.reglage();
    return {
      fournisseur: r.fournisseur,
      active: vh.active(),
      style: r.style,
      styleDefaut: STYLE_DEFAUT,
      voix: Object.fromEntries(FOURNISSEURS.map((f) => [f, { feminine: vh.voixPour(f, 'feminine', r), masculine: vh.voixPour(f, 'masculine', r) }])),
      modele: Object.fromEntries(FOURNISSEURS.map((f) => [f, r.modele[f] || CATALOGUE[f].modele])),
      cles: Object.fromEntries(FOURNISSEURS.map((f) => [f, vh.etatCle(f)])),
      catalogue: CATALOGUE,
      dernierEssai: vh.dernierEssai,
      ...vh.majLe(),
    };
  };

  scoped.get('/admin/voix-humaine', async (req) => {
    exiger(req, 'services:read');
    return etat();
  });

  scoped.put('/admin/voix-humaine', async (req) => {
    exiger(req, 'services:write');
    const b = parse(z.object({
      fournisseur: z.union([fournisseur, z.literal('aucun')]),
      voix: z.object({ feminine: voixId.optional(), masculine: voixId.optional() }).optional(),
      style: z.string().trim().min(20).max(1500).optional(),
      modele: z.string().trim().max(80).regex(/^[A-Za-z0-9._-]*$/).optional(),
      /** Nouvelle clé du fournisseur choisi ; null l'efface ; absente, la clé enregistrée est gardée. */
      cle: cle.nullable().optional(),
    }), req.body);
    const acteur = (req as unknown as { admin?: { name?: string } }).admin?.name ?? 'console';
    const vh = voixHumaine(container);
    const f = b.fournisseur === 'aucun' ? null : b.fournisseur;
    vh.enregistrer({
      fournisseur: b.fournisseur,
      ...(f && b.voix ? { voix: { [f]: { ...vh.reglage().voix[f], ...b.voix } } } : {}),
      ...(b.style ? { style: b.style } : {}),
      ...(f && b.modele !== undefined ? { modele: { [f]: b.modele } } : {}),
      ...(f && b.cle !== undefined ? { cle: b.cle, cleDe: f } : {}),
    }, acteur);
    // Jamais la clé dans le journal : seulement le fait qu'elle a changé.
    journaliser(req, 'voix_humaine.update', b.fournisseur, { cle: b.cle === undefined ? 'inchangée' : b.cle === null ? 'effacée' : 'remplacée' });
    return etat();
  });

  scoped.post('/admin/voix-humaine/essai', async (req, reply) => {
    exiger(req, 'services:write');
    const b = parse(z.object({
      fournisseur,
      genre: z.enum(['feminine', 'masculine']).default('feminine'),
      voix: voixId.optional(),
      style: z.string().trim().max(1500).optional(),
      modele: z.string().trim().max(80).regex(/^[A-Za-z0-9._-]*$/).optional(),
      cle: cle.optional(),
      texte: z.string().trim().min(2).max(2500).optional(),
    }), req.body);
    const vh = voixHumaine(container);
    try {
      const a = await vh.essai({
        fournisseur: b.fournisseur,
        voix: b.voix || vh.voixPour(b.fournisseur, b.genre),
        style: b.style,
        modele: b.modele || vh.reglage().modele[b.fournisseur],
        cle: b.cle,
        texte: b.texte ?? exemple(container, b.genre).texte,
      });
      journaliser(req, 'voix_humaine.essai', b.fournisseur, { voix: a.voix, modele: a.modele, octets: a.octets.length });
      return envoyer(reply, a);
    } catch (e) { throw erreurVoix(e); }
  });
}
