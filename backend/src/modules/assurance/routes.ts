import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { AppError } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { requireClient } from '../clients/auth.js';
import { INSURANCE_RATE } from '../services/ride/pricing.js';
import { ANTECEDENTS, CONSENTEMENT_VERSION, GROUPES_SANGUINS, consentementSchema, ficheSchema } from './dossier.js';

/** Les données médicales ne doivent rester dans aucun cache (navigateur, proxy, CDN). */
function sansCache(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store, max-age=0');
  reply.header('pragma', 'no-cache');
}

/**
 * ORION Assurance : routes du CLIENT. Toutes exigent la session du titulaire ; un
 * jeton valide pour un autre compte est refusé (403), sans indiquer si un dossier existe.
 */
export async function assuranceRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const verifierService = () => {
    if (!container.dossiers.disponible) {
      throw new AppError(503, 'ASSURANCE_INDISPONIBLE', 'ORION Assurance est momentanément indisponible. Réessayez plus tard.');
    }
  };
  // Écritures limitées : un dossier se remplit une fois, pas des centaines de fois par minute.
  const limiteEcriture = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  /** Ce que le client doit lire avant de s'inscrire (version, tarif, listes de l'écran). */
  app.get('/assurance/conditions', async () => ({
    version: CONSENTEMENT_VERSION,
    taux: INSURANCE_RATE,
    inscriptionGratuite: true,
    groupesSanguins: GROUPES_SANGUINS,
    antecedents: ANTECEDENTS,
  }));

  app.get('/clients/:clientId/assurance', async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    sansCache(reply);
    return { statut: container.dossiers.statut(clientId) };
  });

  app.get('/clients/:clientId/assurance/dossier', async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    verifierService();
    sansCache(reply);
    return { fiche: container.dossiers.lire(clientId), statut: container.dossiers.statut(clientId) };
  });

  app.put('/clients/:clientId/assurance/dossier', { config: limiteEcriture }, async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    verifierService();
    const body = parse(z.object({ fiche: ficheSchema, consentement: consentementSchema }), req.body);
    const premiere = !container.dossiers.estInscrit(clientId);
    const statut = container.dossiers.inscrire(clientId, body.fiche);
    // Journal : QUE le dossier a changé, jamais son contenu.
    container.audit.log({ actor: `client:${clientId}`, role: 'client', action: premiere ? 'assurance.inscription' : 'assurance.mise_a_jour', target: clientId });
    sansCache(reply);
    return { statut };
  });

  app.delete('/clients/:clientId/assurance/dossier', { config: limiteEcriture }, async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    requireClient(req, clientId);
    container.dossiers.supprimer(clientId);
    container.audit.log({ actor: `client:${clientId}`, role: 'client', action: 'assurance.suppression', target: clientId });
    sansCache(reply);
    return { statut: container.dossiers.statut(clientId) };
  });
}

/** Activer l'option à la commande exige un dossier : sans lui, l'assistance ne serait pas rapide. */
export function exigerDossierAssurance(container: Container, clientId: string | undefined): void {
  if (!clientId || !container.dossiers.estInscrit(clientId)) {
    throw new AppError(409, 'ASSURANCE_NON_INSCRIT',
      'Pour activer ORION Assurance, inscrivez-vous d’abord (gratuit) : Paramètres, ORION Assurance.');
  }
}
