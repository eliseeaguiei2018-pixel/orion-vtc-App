import { createGeoIndex, type GeoIndex } from './core/geo.js';
import { IdempotencyStore } from './core/idempotency.js';
import { ServiceRegistry } from './modules/services/registry.js';
import { RideServiceModule } from './modules/services/ride/rideModule.js';
import { DriverStore } from './modules/drivers/store.js';
import { RideStore } from './modules/rides/store.js';
import { MatchingEngine } from './modules/rides/matching.js';
import { zoneSurge } from './modules/geo-ci/zones.js';
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
  };
}
