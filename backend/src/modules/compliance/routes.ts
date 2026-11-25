import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { notFound } from '../../core/errors.js';
import { COMPLIANCE_RULES, DEFAULT_JURISDICTION, evaluateCompliance } from './rules.js';

const docSchema = z.object({ type: z.string(), expiresAt: z.string().optional() });
const evalSchema = z.object({
  jurisdiction: z.string().default(DEFAULT_JURISDICTION),
  driverDocs: z.array(docSchema).default([]),
  vehicleDocs: z.array(docSchema).default([]),
});

/**
 * Expose les règles réglementaires (docs/03) et l'évaluation d'un dossier chauffeur.
 * La logique pure est dans rules.ts (testable). Ces endpoints servent l'app chauffeur
 * (savoir quels documents fournir) et le dashboard admin (file de validation).
 */
export async function complianceRoutes(app: FastifyInstance, _container: Container): Promise<void> {
  app.get('/compliance/rules/:jurisdiction', async (req) => {
    const { jurisdiction } = req.params as { jurisdiction: string };
    const rule = COMPLIANCE_RULES[jurisdiction];
    if (!rule) throw notFound(`Juridiction inconnue: ${jurisdiction}`);
    return { rule };
  });

  app.post('/compliance/evaluate', async (req) => {
    const body = parse(evalSchema, req.body);
    const result = evaluateCompliance(body.jurisdiction, body.driverDocs, body.vehicleDocs);
    return { result };
  });
}
