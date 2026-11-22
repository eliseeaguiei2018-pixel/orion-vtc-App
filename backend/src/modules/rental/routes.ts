import type { FastifyInstance, FastifyRequest } from 'fastify';
import { exigerTitulaire } from '../clients/auth.js';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { badRequest, notFound } from '../../core/errors.js';

import { finDeLocation, periodeDeLocation, quoteRental } from './service.js';
import {
  DUREES, HEURES_PAR_JOURNEE, JOURS_DUREE, LABEL_DUREE, LABEL_FORMULE, LABEL_OPTION,
  MAX_HEURES, MIN_HEURES, MOIS_MAX, dureesPermises, remiseMensuelle, type RentalDuree,
} from './tariff.js';

const optionsSchema = z.object({
  decoration: z.boolean().optional(),
  tapisRouge: z.boolean().optional(),
  cortege: z.number().int().min(0).max(10).optional(),
  hotesses: z.number().int().min(0).max(10).optional(),
  escorte: z.boolean().optional(),
  plaque: z.boolean().optional(),
  kilometrageIllimite: z.boolean().optional(),
  secondChauffeur: z.boolean().optional(),
  rafraichissements: z.boolean().optional(),
});

const baseSchema = z.object({
  formula: z.enum(['evenement', 'entreprise', 'mise_a_disposition']),
  vehicleId: z.string().min(1),
  debut: z.string().optional(),
  duree: z.enum(['heures', 'journee', 'weekend', 'semaine', 'mois']).optional(),
  heures: z.number().int().min(MIN_HEURES).max(MAX_HEURES).optional(),
  /** Forfait mensuel : nombre de mois (les minimums par formule sont vérifiés au devis). */
  mois: z.number().int().min(1).max(MOIS_MAX).optional(),
  renouvelable: z.boolean().optional(),
  options: optionsSchema.optional(),
  /** Client connu : sa remise d'abonné ORION s'applique automatiquement. */
  userId: z.string().min(1).max(64).optional(),
});

export async function rentalRoutes(app: FastifyInstance, container: Container): Promise<void> {
  /** Locations d'un client : un compte inscrit doit présenter sa propre session. */
  const titulaire = (req: FastifyRequest, userId: string) =>
    exigerTitulaire(req, userId, (c) => Boolean(container.clients.get(c)?.phoneVerifiedAt));

  /**
   * Contexte de calcul d'un devis : barème et prix EN VIGUEUR (console), TVA, remise
   * d'abonné et disponibilité réelle. Centralisé pour que le devis consulté et le
   * devis réservé ne puissent jamais diverger.
   */
  const contexte = (vehicleId: string, debut: Date, fin: Date, userId?: string) => {
    const vehicle = container.rentalSettings.vehicule(vehicleId);
    if (!vehicle) throw badRequest('Véhicule de location inconnu');
    if (!container.rentalSettings.estActif(vehicleId)) {
      throw badRequest('Ce véhicule n’est pas proposé à la location actuellement');
    }
    return {
      tvaRate: container.settings.getPricing().tvaRate,
      remiseAbonnement: userId ? container.subscriptions.remiseLocation(userId) : 0,
      disponibilite: container.rental.disponibilite(vehicleId, debut, fin),
      tarif: container.rentalSettings.getTarif(),
      vehicle,
    };
  };

  /**
   * VITRINE DES VÉHICULES — photos et vidéos réelles (Mariage et Location Signature), par
   * véhicule et par option. Publique : l'application la lit avant toute réservation. La
   * liste se règle depuis la console (PUT /admin/medias/vehicules).
   */
  app.get('/rental/medias-vehicules', async () => ({ version: 1, medias: container.mediasVehicules.liste() }));

  /**
   * Catalogue complet : gamme Signature, formules, durées, options et barème.
   * L'app cliente et la console lisent TOUT ici — aucune liste de prix dupliquée
   * côté interface, donc aucun écart possible entre l'affiché et le facturé.
   */
  app.get('/rental/catalogue', async () => {
    const tarif = container.rentalSettings.getTarif();
    return {
    vehicles: container.rentalSettings.catalogue(),
    formules: (['evenement', 'entreprise', 'mise_a_disposition'] as const).map((f) => ({
      id: f,
      label: LABEL_FORMULE[f],
      // Une entreprise ne loue qu'au forfait mensuel ; l'app n'affiche que ces durées.
      durees: dureesPermises(f),
      moisMin: f === 'entreprise' ? tarif.moisMinEntreprise : 1,
    })),
    // Forfait mensuel : remise par mois selon l'engagement, telle qu'elle sera facturée.
    engagement: {
      moisMinEntreprise: tarif.moisMinEntreprise,
      moisMax: MOIS_MAX,
      paliers: [1, 3, 6, 12].map((m) => ({ aPartirDeMois: m, remise: remiseMensuelle(tarif, m) })),
    },
    durees: DUREES.map((d) => ({
      id: d,
      label: LABEL_DUREE[d],
      coef: d === 'heures' ? null : tarif.coefs[d],
      jours: d === 'heures' ? null : JOURS_DUREE[d],
    })),
    options: (Object.keys(LABEL_OPTION) as Array<keyof typeof LABEL_OPTION>).map((k) => ({ id: k, label: LABEL_OPTION[k] })),
    // Barème EN VIGUEUR (réglé depuis la console) : l'app cliente n'affiche jamais un
    // prix différent de celui qui sera facturé.
    bareme: { ...tarif, heuresParJournee: HEURES_PAR_JOURNEE },
    currency: 'XOF',
    };
  });

  /** Disponibilité de toute la gamme sur une période (écran de choix du véhicule). */
  app.get('/rental/disponibilites', async (req) => {
    const q = parse(
      z.object({
        debut: z.string().optional(),
        duree: z.enum(['heures', 'journee', 'weekend', 'semaine', 'mois']).optional(),
        heures: z.coerce.number().int().min(MIN_HEURES).max(MAX_HEURES).optional(),
        mois: z.coerce.number().int().min(1).max(MOIS_MAX).optional(),
      }),
      req.query,
    );
    const debut = q.debut ? new Date(q.debut) : new Date();
    const duree = (q.duree ?? 'journee') as RentalDuree;
    const fin = finDeLocation(debut, duree, q.heures, q.mois);
    return {
      debut: debut.toISOString(),
      fin: fin.toISOString(),
      disponibilites: container.rental.disponibilites(debut, fin),
    };
  });

  /**
   * Devis de location. Consultation PURE : rien n'est réservé, aucun quota consommé.
   * Le devis porte la disponibilité réelle et, le jour même, le délai de mise à
   * disposition en minutes.
   */
  app.post('/rental/quote', async (req) => {
    const body = parse(baseSchema, req.body);
    const { debut, fin } = periodeDeLocation(body, container.rentalSettings.getTarif());
    const quote = quoteRental(body, contexte(body.vehicleId, debut, fin, body.userId));
    return { quote };
  });

  /** Réservation ferme (la disponibilité est revérifiée au moment de l'engagement). */
  app.post('/rental/reserve', async (req, reply) => {
    const body = parse(
      baseSchema.extend({
        userId: z.string().min(1).max(64),
        lieu: z.string().min(2).max(200).optional(),
        contact: z.object({
          nom: z.string().min(2).max(80),
          telephone: z.string().min(8).max(20),
          email: z.string().email().optional(),
        }).optional(),
        societe: z.object({
          nom: z.string().min(2).max(120),
          bonCommande: z.string().max(60).optional(),
          contribuable: z.string().max(40).optional(),
        }).optional(),
      }),
      req.body,
    );
    titulaire(req, body.userId);
    const { debut, fin } = periodeDeLocation(body, container.rentalSettings.getTarif());
    const quote = quoteRental(body, contexte(body.vehicleId, debut, fin, body.userId));
    const reservation = container.rental.reserve(body.userId, quote, {
      contact: body.contact,
      societe: body.societe,
      lieu: body.lieu,
    });
    // La console (session Location) voit la demande arriver en direct.
    container.realtime.publish('support', 'rental.new', {
      id: reservation.id,
      vehicle: reservation.vehicle.name,
      formula: reservation.formula,
      debut: reservation.debut,
      total: reservation.total,
      jourJ: reservation.jourJ,
    });
    reply.code(201);
    return { reservation };
  });

  /** Mes locations. */
  app.get('/rental/mes-locations/:userId', async (req) => {
    const { userId } = req.params as { userId: string };
    titulaire(req, userId);
    return { reservations: container.rental.listByUser(userId) };
  });

  /** Détail d'une location (suivi client). */
  app.get('/rental/reservation/:id', async (req) => {
    const { id } = req.params as { id: string };
    const reservation = container.rental.get(id);
    if (reservation) titulaire(req, reservation.userId);
    return { reservation: reservation ?? null };
  });

  /** Annulation par le client (frais selon le délai de prévenance). */
  app.post('/rental/reservation/:id/annuler', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ raison: z.string().max(200).optional() }), req.body ?? {});
    const existante = container.rental.get(id);
    if (!existante) throw notFound('Location introuvable');
    titulaire(req, existante.userId);
    const r = container.rental.annuler(id, body.raison);
    // Annulation gratuite incluse dans l'abonnement Gold : les frais sont pris en charge.
    const gratuite = container.subscriptions.annulationGratuite(r.reservation.userId);
    return {
      reservation: r.reservation,
      frais: gratuite ? 0 : r.frais,
      taux: gratuite ? 0 : r.taux,
      fraisPrisEnCharge: gratuite && r.frais > 0,
      message: gratuite && r.frais > 0
        ? 'Annulation sans frais : avantage de votre abonnement ORION Gold.'
        : r.frais > 0
          ? `Frais d’annulation : ${r.frais.toLocaleString('fr-FR')} F (${Math.round(r.taux * 100)} % du montant).`
          : 'Annulation sans frais.',
    };
  });
}
