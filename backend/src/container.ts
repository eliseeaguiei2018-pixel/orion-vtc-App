import { createGeoIndex, type GeoIndex } from './core/geo.js';
import { IdempotencyStore } from './core/idempotency.js';
import { ServiceRegistry } from './modules/services/registry.js';
import { RideServiceModule } from './modules/services/ride/rideModule.js';
import { DriverStore } from './modules/drivers/store.js';
import { RideStore } from './modules/rides/store.js';
import { MatchingEngine } from './modules/rides/matching.js';

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
}

export function createContainer(): Container {
  const geo = createGeoIndex();
  const drivers = new DriverStore(geo);
  const rides = new RideStore();
  const matching = new MatchingEngine(geo, drivers);

  const registry = new ServiceRegistry().register(new RideServiceModule());
  // Extension : registry.register(new DeliveryServiceModule()) ... (cf. docs/04)

  return {
    geo,
    idempotency: new IdempotencyStore(),
    registry,
    drivers,
    rides,
    matching,
  };
}
