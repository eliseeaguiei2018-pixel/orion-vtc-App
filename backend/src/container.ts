import { randomUUID } from 'node:crypto';
import { createGeoIndex, type GeoIndex } from './core/geo.js';
import { IdempotencyStore } from './core/idempotency.js';
import { ServiceRegistry } from './modules/services/registry.js';
import { RideServiceModule } from './modules/services/ride/rideModule.js';
import { DriverStore } from './modules/drivers/store.js';
import { RideStore } from './modules/rides/store.js';
import { MatchingEngine } from './modules/rides/matching.js';
import { RideSimulator } from './modules/rides/simulator.js';
import { zoneSurge } from './modules/geo-ci/zones.js';
import { WalletService } from './modules/wallet/service.js';
import { SubscriptionService } from './modules/subscriptions/service.js';
import { WeddingService } from './modules/wedding/service.js';
import { PaymentRegistry } from './modules/payments/providers.js';
import { SafetyService } from './modules/safety/service.js';
import { RealtimeHub } from './modules/realtime/hub.js';
import { createMapsProvider, type MapsProvider } from './modules/maps/service.js';

/**
 * Conteneur d'injection de dépendances. Centralise le câblage et facilite les tests
 * (on peut substituer n'importe quelle dépendance). Les implémentations en mémoire sont
 * remplaçables par PostgreSQL/Redis sans changer les modules métier.
 */
export interface Container {
  geo: GeoIndex;
  idempotency: IdempotencyStore;
  registry: ServiceRegistry;
  drivers: DriverStore;
  rides: RideStore;
  matching: MatchingEngine;
  payments: PaymentRegistry;
  safety: SafetyService;
  realtime: RealtimeHub;
  maps: MapsProvider;
  simulator: RideSimulator;
  wallet: WalletService;
  subscriptions: SubscriptionService;
  wedding: WeddingService;
}

export function createContainer(): Container {
  const geo = createGeoIndex();
  const drivers = new DriverStore(geo);
  const rides = new RideStore();
  const matching = new MatchingEngine(geo, drivers);

  // Tarification dynamique branchée sur le plan directeur ivoirien (surge par zone + heure).
  const registry = new ServiceRegistry().register(
    new RideServiceModule((req) => ({ surgeMultiplier: zoneSurge(req.origin, req.destination) })),
  );
  // Extension : registry.register(new DeliveryServiceModule()) ... (cf. docs/04)

  const realtime = new RealtimeHub();
  const safety = new SafetyService(realtime);

  return {
    geo,
    idempotency: new IdempotencyStore(),
    registry,
    drivers,
    rides,
    matching,
    payments: new PaymentRegistry(),
    safety,
    realtime,
    maps: createMapsProvider(),
    simulator: new RideSimulator(rides, realtime),
    wallet: new WalletService(),
    subscriptions: new SubscriptionService(),
    wedding: new WeddingService(),
  };
}

/**
 * Amorce quelques chauffeurs en ligne autour d'Abidjan (aide de développement).
 * En l'absence d'app chauffeur, cela permet à l'app cliente de trouver un chauffeur et
 * de déclencher le suivi temps réel. Désactivé quand la simulation est coupée (prod/tests).
 */
export async function seedDemoDrivers(c: Container): Promise<void> {
  // Plusieurs chauffeurs par niveau (Bronze→Diamant) répartis dans Abidjan,
  // afin que chaque niveau de course trouve un véhicule disponible.
  const seeds: Array<{ name: string; lat: number; lng: number; category: string }> = [
    { name: 'Konan Yao', lat: 5.3258, lng: -4.0205, category: 'bronze' },
    { name: 'Awa Diomandé', lat: 5.331, lng: -4.012, category: 'bronze' },
    { name: 'Aïcha Touré', lat: 5.3585, lng: -3.989, category: 'argent' },
    { name: 'Ismaël Cissé', lat: 5.347, lng: -3.999, category: 'argent' },
    { name: 'Mamadou Bamba', lat: 5.3402, lng: -4.0095, category: 'or' },
    { name: 'Grace Kouamé', lat: 5.353, lng: -3.995, category: 'or' },
    { name: 'Fatou Koné', lat: 5.301, lng: -3.998, category: 'diamant' },
    { name: 'Serge Gbagbo', lat: 5.3265, lng: -4.0185, category: 'diamant' },
  ];
  for (const s of seeds) {
    const d = c.drivers.upsert({
      id: randomUUID(),
      name: s.name,
      category: s.category,
      kycStatus: 'active',
      availability: 'offline',
      ratingAvg: 4.9,
      ratingCount: 1000,
    });
    await c.drivers.goOnline(d.id, { lat: s.lat, lng: s.lng });
  }
}
