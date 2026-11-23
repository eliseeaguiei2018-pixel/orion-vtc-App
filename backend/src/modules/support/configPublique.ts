import { FACTEUR_ROUTE } from '../proches/service.js';
import type { Container } from '../../container.js';
import { DELIVERY_TARIFF } from '../services/delivery/deliveryModule.js';

/**
 * CONFIG PUBLIQUE des apps (GET /config, canal temps réel `config`) : services ouverts,
 * WhatsApp, et la GRILLE DE PRIX en vigueur décidée par la direction (ajustement général,
 * écarts entre gammes). Les apps installées l'appliquent à leurs aperçus dès qu'elle change :
 * aucune nouvelle version à publier pour changer les prix.
 */
export function configPublique(container: Pick<Container, 'settings' | 'whatsapp'>) {
  const p = container.settings.getPricing();
  return {
    ...container.settings.getServices(),
    currency: 'XOF',
    codeWhatsApp: container.whatsapp !== null,
    prix: {
      ajustementPct: p.ajustementPct ?? 0,
      majorationsPct: { or: p.majorationsPct['or'] ?? 0, diamant: p.majorationsPct['diamant'] ?? 0 },
      majorationsPctHorsAbidjan: { or: p.majorationsPctHorsAbidjan?.['or'] ?? 0, diamant: p.majorationsPctHorsAbidjan?.['diamant'] ?? 0 },
      // Barème en vigueur (Tarification en console) : les aperçus de prix des apps le suivent.
      bareme: { baseFare: p.baseFare, perKm: p.perKm, perMinute: p.perMinute, minFare: p.minFare },
      livraison: { baseFare: DELIVERY_TARIFF.baseFare, perKm: DELIVERY_TARIFF.perKm, perMinute: DELIVERY_TARIFF.perMinute, minFare: DELIVERY_TARIFF.minFare },
      // Temps d'approche affiché par les apps pendant que le chauffeur arrive : même règle que le serveur.
      approche: { vitesseKmh: p.approche?.vitesseKmh ?? 40, facteurRoute: FACTEUR_ROUTE },
    },
  };
}
