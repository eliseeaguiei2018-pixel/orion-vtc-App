import { randomUUID } from 'node:crypto';
import { createGeoIndex, type GeoIndex } from './core/geo.js';
import { IdempotencyStore } from './core/idempotency.js';
import { ServiceRegistry } from './modules/services/registry.js';
import { RideServiceModule } from './modules/services/ride/rideModule.js';
import { DriverStore } from './modules/drivers/store.js';
import { RideStore } from './modules/rides/store.js';
import { MatchingEngine } from './modules/rides/matching.js';
import { RideSimulator } from './modules/rides/simulator.js';
import { trafficInfo } from './modules/geo-ci/zones.js';
import { WalletService } from './modules/wallet/service.js';
import { SubscriptionService } from './modules/subscriptions/service.js';
import { WeddingService } from './modules/wedding/service.js';
import { InsuranceService, type InsuranceContribution } from './modules/insurance/service.js';
import { PaymentRegistry } from './modules/payments/providers.js';
import { SafetyService } from './modules/safety/service.js';
import { SettingsService, type PricingRecord } from './modules/settings/service.js';
import { RealtimeHub } from './modules/realtime/hub.js';
import { createMapsProvider, type MapsProvider } from './modules/maps/service.js';
import { createRepository } from './core/db/repository.js';
import { genMatricule, type Driver } from './modules/drivers/store.js';
import { ClientStore, type Client } from './modules/clients/store.js';
import { PromoService, type Promo } from './modules/promos/service.js';
import { SupportService } from './modules/support/service.js';
import { NotificationService } from './modules/notifications/service.js';
import { AuditService } from './modules/admin/audit.js';
import { TreasuryService, type Transfer } from './modules/treasury/service.js';
import { DisputeService, type Dispute } from './modules/disputes/service.js';
import { DemandService } from './modules/rides/demand.js';
import { TeamService, type Team } from './modules/teams/service.js';
import { CorporateService, type CorporateAccount } from './modules/corporate/service.js';
import { SecurityAlertsService } from './modules/admin/security.js';
import { ReservationService, type Reservation } from './modules/reservations/service.js';
import { StaffService } from './modules/staff/service.js';
import { ExpenseService, type ExpenseTicket } from './modules/expenses/service.js';
import type { Ride } from './modules/rides/store.js';
import type { LedgerEntry } from './modules/wallet/service.js';
import type { Subscription } from './modules/subscriptions/service.js';
import type { WeddingReservation } from './modules/wedding/service.js';

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
  clientWallet: WalletService;
  insurance: InsuranceService;
  subscriptions: SubscriptionService;
  wedding: WeddingService;
  settings: SettingsService;
  clients: ClientStore;
  promos: PromoService;
  support: SupportService;
  notifications: NotificationService;
  audit: AuditService;
  treasury: TreasuryService;
  disputes: DisputeService;
  demand: DemandService;
  teams: TeamService;
  corporate: CorporateService;
  /** Alertes sécurité interne : tentatives d'accès non autorisé (signalées à la direction). */
  security: SecurityAlertsService;
  /** Réservations à l'avance (courses planifiées). */
  reservations: ReservationService;
  /** Personnel interne : shifts, pointage, maintenance, squads (session Équipes). */
  staff: StaffService;
  /** Notes de frais & avances (self-service + validation CFO). */
  expenses: ExpenseService;
}

export function createContainer(): Container {
  const geo = createGeoIndex();
  // Repositories durables (mémoire par défaut, SQLite si PERSISTENCE=sqlite).
  const drivers = new DriverStore(geo, createRepository<Driver>('drivers'));
  const rides = new RideStore(createRepository<Ride>('rides'));
  // Dispatch : la règle d'attribution (console) est relue à chaque course.
  const matching = new MatchingEngine(geo, drivers, undefined, (origin) => {
    const z = settings.zoneForPoint(origin);
    const ops = settings.getOps();
    return {
      strategy: ops.strategy,
      inQueueZone: (p) => Boolean(settings.zoneForPoint(p)),
      maxEtaMinutes: ops.maxEtaMinutes,
      originZone: z ? { id: z.id, minStandard: z.minStandard } : null,
      // Rayons évolutifs pilotés depuis la console (initial → intermédiaire → max).
      radiiMeters: [
        ops.radiusKm * 1000,
        Math.max(ops.radiusKm, (ops.radiusKm + ops.radiusMaxKm) / 2) * 1000,
        Math.max(ops.radiusKm, ops.radiusMaxKm) * 1000,
      ],
      weightRating: ops.weightRating,
      weightIdle: ops.weightIdle,
      greenPriority: ops.greenPriority,
    };
  });

  // Surge par cellules : demande vs offre en fenêtre glissante (10 min).
  const demand = new DemandService(geo);

  // Paramètres pilotables (prix + services) — modifiables depuis la console Admin, persistés.
  const settings = new SettingsService(createRepository<PricingRecord>('settings'), createRepository('services'), createRepository('zones'), createRepository('ops'));
  // Codes promo (remises) pilotés depuis la console.
  const promos = new PromoService(createRepository<Promo>('promos'));

  // Tarification : paramètres pilotables (Admin) + trafic intégré + code promo éventuel.
  const registry = new ServiceRegistry().register(
    new RideServiceModule(async (req) => {
      const traffic = trafficInfo(req.origin, req.destination);
      // Surge : chaque devis compte comme une demande dans sa cellule ;
      // plafonné (incitation verte) — la flotte ORION est électrique.
      demand.record(req.origin);
      const ops = settings.getOps();
      const surgeRaw = ops.surgeEnabled ? await demand.surgeFor(req.origin) : 1;
      // Surge MANUEL d'urgence (zone dessinée dans la console) — toujours plafonné (cap vert).
      const surgeManual = settings.zoneForPoint(req.origin)?.surgeManual ?? 1;
      return {
        trafficFactor: traffic.factor,
        trafficLevel: traffic.level,
        settings: settings.getPricing(),
        zoneFactor: settings.zoneFactor(req.origin),
        zonePickupFee: settings.zoneForPoint(req.origin)?.pickupFee ?? 0,
        surgeMultiplier: Math.min(Math.max(surgeRaw, surgeManual), ops.surgeCapGreen),
        promoDiscount: (subtotal: number) => promos.evaluate(req.promoCode, subtotal)?.discount ?? 0,
      };
    }),
  );
  // Extension : registry.register(new DeliveryServiceModule()) ... (cf. docs/04)

  const realtime = new RealtimeHub();
  const safety = new SafetyService(realtime);
  // Portefeuille client (séparé du wallet chauffeur) : remboursements ORION Assurance.
  const clientWallet = new WalletService(createRepository<LedgerEntry>('client_wallet'));

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
    wallet: new WalletService(createRepository<LedgerEntry>('wallet_ledger')),
    clientWallet,
    insurance: new InsuranceService(createRepository<InsuranceContribution>('insurance'), clientWallet),
    subscriptions: new SubscriptionService(createRepository<Subscription>('subscriptions')),
    wedding: new WeddingService(createRepository<WeddingReservation>('wedding')),
    settings,
    promos,
    clients: new ClientStore(createRepository<Client>('clients')),
    treasury: new TreasuryService(createRepository<Transfer>('treasury')),
    disputes: new DisputeService(createRepository<Dispute>('disputes')),
    demand,
    teams: new TeamService(createRepository<Team>('teams')),
    corporate: new CorporateService(createRepository<CorporateAccount>('corporate')),
    support: new SupportService(realtime),
    notifications: new NotificationService(realtime),
    audit: new AuditService(),
    security: new SecurityAlertsService(),
    reservations: new ReservationService(createRepository<Reservation>('reservations')),
    staff: new StaffService(createRepository('staff_shifts'), createRepository('staff_tickets')),
    expenses: new ExpenseService(createRepository<ExpenseTicket>('expenses')),
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
      matricule: genMatricule(),
      category: s.category,
      kycStatus: 'active',
      availability: 'offline',
      ratingAvg: 4.9,
      ratingCount: 1000,
    });
    await c.drivers.goOnline(d.id, { lat: s.lat, lng: s.lng });
  }
}
