import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { config } from '../../config/index.js';
import { parse } from '../../core/validate.js';
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../../core/errors.js';
import { OtpStore, normalizePhone } from '../driver-app/auth.js';
import { emettreCode } from '../sms/codes.js';
import { nearestZone } from '../geo-ci/zones.js';
import { vueUsager } from '../safety/service.js';
import type { Client } from './store.js';
import { issueClientToken, requireClient, validerPhoto } from './auth.js';
import { lieuDe } from '../maps/lieux.js';
import { exigerHumain } from '../gcp/securite.js';
import { JetonRefuse } from '../gcp/jetons.js';

/**
 * COMPTE CLIENT : inscription par numéro vérifié, profil, photo, historique.
 *
 * Un compte = un numéro de téléphone VÉRIFIÉ par code SMS. Si le numéro a déjà un
 * compte (nouveau téléphone, application réinstallée), le client retrouve CE compte,
 * avec son historique, au lieu d'en créer un second.
 */
const masquer = (phone: string) => `${phone.slice(0, 6)}••••${phone.slice(-2)}`;

const TERMINEES = new Set(['completed', 'paid', 'rated']);

/** Ce que le client voit de son propre compte. */
function profil(c: Client, container: Container) {
  // « Courses » = courses effectuées. Le compteur interne compte les commandes,
  // annulées comprises : il affichait 4 courses à qui n'en avait fait que 2.
  const effectuees = container.rides.listByClient(c.id).filter((r) => TERMINEES.has(r.status)).length;
  return {
    id: c.id, name: c.name ?? null, phone: c.phone ?? null, email: c.email ?? null,
    photo: c.photo ?? null, phoneVerifiedAt: c.phoneVerifiedAt ?? null, createdAt: c.createdAt,
    stats: {
      courses: effectuees, commandes: c.rides, annulations: c.cancellations ?? 0, avertissements: c.warnings ?? 0,
      pointsCarbone: c.greenPoints ?? 0, co2EconomiseKg: Math.round((c.co2SavedKg ?? 0) * 10) / 10,
    },
  };
}

const LIBELLE_STATUT: Record<string, string> = {
  searching: 'Recherche d’un chauffeur', accepted: 'Chauffeur attribué', driver_en_route: 'Chauffeur en approche',
  arrived: 'Chauffeur arrivé', in_progress: 'En course', completed: 'Terminée · paiement en attente',
  paid: 'Payée', rated: 'Payée et notée', cancelled: 'Annulée', no_driver: 'Annulée · aucun chauffeur disponible',
};

export async function clientAccountRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Codes propres aux clients : un code chauffeur n'ouvre jamais un compte client.
  const otps = new OtpStore();

  /* ------------------------------ Inscription / connexion ------------------------------ */

  app.post('/clients/auth/otp', async (req) => {
    const body = parse(z.object({ phone: z.string().min(6).max(25), canal: z.enum(['sms', 'whatsapp']).optional() }), req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw badRequest('Numéro de téléphone invalide');
    // reCAPTCHA Enterprise (si configuré) : pas de SMS pour un robot.
    await exigerHumain(container.securiteGoogle, req, 'connexion_client');
    // Numéro de vérification des stores : code fixe, connu des seuls vérificateurs.
    const revue = config.CLIENT_REVIEW_PHONE && config.CLIENT_REVIEW_CODE
      && normalizePhone(config.CLIENT_REVIEW_PHONE) === phone ? config.CLIENT_REVIEW_CODE : undefined;
    // Envoi par l'opérateur SMS ; ni le code ni le numéro complet ne sont journalisés.
    const issued = await emettreCode({ sms: container.sms, whatsapp: container.whatsapp, canal: body.canal, otps, phone, pour: 'client', log: req.log, codeImpose: revue });
    req.log.info({ phone: masquer(phone), revue: Boolean(revue), canal: body.canal ?? 'sms', envoye: issued.envoye }, 'Code de connexion client émis');
    return {
      sent: true, phone, expiresAt: issued.expiresAt, canal: body.canal ?? 'sms',
      compteExistant: Boolean(container.clients.findByVerifiedPhone(phone)),
      // Développement uniquement : le code revient dans la réponse pour tester sans SMS.
      ...(config.NODE_ENV !== 'production' ? { devCode: issued.code } : {}),
    };
  });

  app.post('/clients/auth/verify', async (req) => {
    const body = parse(z.object({
      clientId: z.string().min(1).max(64),
      phone: z.string().min(6).max(25),
      code: z.string().min(4).max(8),
      name: z.string().trim().min(2).max(80).optional(),
      email: z.string().trim().email().max(120).optional(),
    }), req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw badRequest('Numéro de téléphone invalide');
    const existant = container.clients.findByVerifiedPhone(phone);
    // Inscription sans nom : refus AVANT de consommer le code.
    if (!existant && !body.name) throw badRequest('Indiquez votre nom pour créer votre compte');
    const r = otps.verify(phone, body.code);
    if (r === 'expired') throw unauthorized('Code expiré — demandez un nouveau code');
    if (r === 'locked') throw unauthorized('Trop d’essais — demandez un nouveau code');
    if (r === 'invalid') throw unauthorized('Code incorrect');

    return ouvrirSession(phone, body, existant);
  });

  /**
   * IDENTITY PLATFORM : le numéro a été vérifié par Google (connexion par SMS d'Identity
   * Platform). L'application présente le jeton d'identité reçu ; le serveur le vérifie
   * (signature, projet, dates) et ouvre le compte ORION de ce numéro. Route absente tant que
   * IDENTITY_PLATFORM n'est pas activé.
   */
  app.post('/clients/auth/identity', async (req) => {
    const identite = container.securiteGoogle.identite;
    if (!identite) throw notFound('Connexion par Identity Platform non activée sur ce serveur');
    const body = parse(z.object({
      clientId: z.string().min(1).max(64),
      idToken: z.string().min(100).max(4096),
      name: z.string().trim().min(2).max(80).optional(),
      email: z.string().trim().email().max(120).optional(),
    }), req.body);
    let verifiee;
    try { verifiee = await identite.verifier(body.idToken); } catch (e) {
      if (e instanceof JetonRefuse) { req.log.warn({ raison: e.raison }, 'Jeton Identity Platform refusé'); throw unauthorized('Session Google invalide ou expirée — reconnectez-vous'); }
      throw e;
    }
    // Seule une connexion par téléphone ouvre un compte ORION : un compte = un numéro vérifié.
    const phone = verifiee.telephone ? normalizePhone(verifiee.telephone) : null;
    if (!phone) throw badRequest('Cette session Google ne porte pas de numéro de téléphone vérifié');
    const prefixes = config.SMS_ALLOWED_PREFIXES.split(',').map((x) => x.trim()).filter(Boolean);
    if (prefixes.length && !prefixes.some((x) => phone.startsWith(x))) throw forbidden('Numéro hors de la zone de service ORION');
    const existant = container.clients.findByVerifiedPhone(phone);
    if (!existant && !body.name) throw badRequest('Indiquez votre nom pour créer votre compte');
    return ouvrirSession(phone, body, existant, 'identity-platform');
  });

  /** Ouvre (ou crée) le compte du numéro vérifié et délivre le jeton de session ORION. */
  function ouvrirSession(phone: string, body: { clientId: string; name?: string; email?: string }, existant: Client | undefined, preuve: 'sms-orion' | 'identity-platform' = 'sms-orion') {
    if (existant?.status === 'blocked') throw forbidden('Ce compte est suspendu. Contactez le support ORION.');
    const now = new Date().toISOString();
    // Numéro déjà connu : le client retrouve SON compte (et son historique).
    // Appareil partagé : si l'identifiant présenté porte déjà le compte vérifié
    // d'une AUTRE personne, le nouveau compte reçoit son propre identifiant — sinon
    // il écraserait le nom, le numéro et l'historique de la précédente.
    const occupe = container.clients.get(body.clientId);
    const idNeuf = occupe?.phoneVerifiedAt && occupe.phone !== phone && !occupe.deletedAt
      ? `client-${randomBytes(6).toString('hex')}` : body.clientId;
    const client = existant
      ? container.clients.updateProfile(existant.id, { phoneVerifiedAt: existant.phoneVerifiedAt ?? now })
      : container.clients.updateProfile(idNeuf, { name: body.name, email: body.email, phone, phoneVerifiedAt: now });
    container.audit.log({
      actor: client.name ?? 'Client', role: 'super_admin', action: existant ? 'client.login' : 'client.signup',
      target: client.id, details: { phone: masquer(phone), preuve },
    });
    const { token, expiresAt } = issueClientToken(client.id);
    return { token, expiresAt, compteRetrouve: Boolean(existant), client: profil(client, container) };
  }

  /* ------------------------------------ Profil ------------------------------------ */

  app.get('/clients/:clientId/profile', async (req) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    const c = container.clients.get(clientId);
    if (!c || c.deletedAt) throw notFound('Compte introuvable');
    return { client: profil(c, container) };
  });

  app.put('/clients/:clientId/profile', async (req) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    const body = parse(z.object({
      name: z.string().trim().min(2).max(80).optional(),
      email: z.union([z.string().trim().email().max(120), z.literal('')]).optional(),
    }), req.body);
    const c = container.clients.updateProfile(clientId, {
      name: body.name, email: body.email === undefined ? undefined : (body.email || null),
    });
    return { client: profil(c, container) };
  });

  // Photo prise avec l'appareil ou choisie dans la galerie (recadrée et compressée par l'app).
  app.put('/clients/:clientId/photo', async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    const { photo } = parse(z.object({ photo: z.string().min(30).max(600_000) }), req.body);
    const v = validerPhoto(photo);
    if (!v.ok) { reply.code(400); return { error: v.raison }; }
    return { client: profil(container.clients.setPhoto(clientId, photo), container) };
  });

  app.delete('/clients/:clientId/photo', async (req) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    return { client: profil(container.clients.setPhoto(clientId, null), container) };
  });

  // Suppression du compte : identité effacée, courses conservées sans nom.
  app.delete('/clients/:clientId', async (req) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    if (!container.clients.anonymiser(clientId)) throw notFound('Compte introuvable');
    container.audit.log({ actor: 'Client', role: 'super_admin', action: 'client.account_deleted', target: clientId, details: {} });
    return { supprime: true };
  });

  /* ----------------------------------- Historique ----------------------------------- */

  app.get('/clients/:clientId/history', async (req) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    const zone = (p: { lat: number; lng: number }) => lieuDe(p).libelle;
    const alertes = container.safety.parUsager(clientId);
    // listByClient rend déjà les courses de la plus récente à la plus ancienne (index).
    const courses = container.rides.listByClient(clientId)
      .map((r) => {
        const d = r.driverId ? container.drivers.get(r.driverId) : undefined;
        const ev = (t: string) => r.events.find((e) => e.type === t);
        const annul = ev('cancelled');
        const p = (annul?.payload ?? {}) as { by?: string; motif?: string; details?: string };
        const frais = (ev('cancel_fee')?.payload as { amount?: number } | undefined)?.amount ?? 0;
        const paye = ev('paid')?.payload as { method?: string; amount?: number } | undefined;
        const note = (ev('rated')?.payload as { stars?: number } | undefined)?.stars;
        const annulee = r.status === 'cancelled' || r.status === 'no_driver';
        return {
          id: r.id, createdAt: r.createdAt, status: r.status, statutLabel: LIBELLE_STATUT[r.status] ?? r.status,
          depart: zone(r.origin), arrivee: zone(r.destination),
          distanceKm: Math.round(r.quote.distanceMeters / 100) / 10,
          montant: r.quote.amount, breakdown: r.quote.breakdown, categorie: r.quote.category,
          paiement: { moyen: paye?.method ?? r.paymentMethod ?? null, regle: Boolean(paye), montant: paye?.amount ?? null },
          chauffeur: d ? { name: d.name, matricule: d.matricule, vehicule: d.vehicleModel ?? null, plaque: d.vehiclePlate ?? null } : null,
          note: note ?? null,
          annulation: annulee ? {
            par: r.status === 'no_driver' ? 'systeme' : (p.by ?? 'inconnu'),
            motif: r.status === 'no_driver' ? 'aucun_chauffeur' : (p.motif ?? null),
            details: p.details ?? null, frais, at: annul?.at ?? ev('no_driver')?.at ?? r.createdAt,
          } : null,
          sos: alertes.filter((a) => a.rideId === r.id).map((a) => ({ id: a.id, at: a.createdAt, status: a.status })),
        };
      });
    const terminees = courses.filter((c) => ['completed', 'paid', 'rated'].includes(c.status));
    const annulees = courses.filter((c) => c.annulation);
    return {
      courses,
      resume: {
        total: courses.length, terminees: terminees.length, annulees: annulees.length,
        depense: terminees.reduce((s, c) => s + c.montant, 0),
        fraisAnnulation: annulees.reduce((s, c) => s + (c.annulation?.frais ?? 0), 0),
        alertesSos: alertes.length,
      },
    };
  });

  // Ses alertes SOS passées et en cours (vue usager : rien d'interne).
  app.get('/clients/:clientId/sos', async (req) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    return { alertes: container.safety.parUsager(clientId).map(vueUsager) };
  });
}
