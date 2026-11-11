import { creerSms, type SmsSender } from './modules/sms/index.js';
import { randomUUID } from 'node:crypto';
import { createGeoIndex, type GeoIndex } from './core/geo.js';
import { IdempotencyStore } from './core/idempotency.js';
import { ServiceRegistry } from './modules/services/registry.js';
import { RideServiceModule } from './modules/services/ride/rideModule.js';
import { DeliveryServiceModule } from './modules/services/delivery/deliveryModule.js';
import { DriverStore } from './modules/drivers/store.js';
import { RideStore } from './modules/rides/store.js';
import { MatchingEngine } from './modules/rides/matching.js';
import { RideSimulator } from './modules/rides/simulator.js';
import { RideReleaseService } from './modules/rides/release.js';
import { trafficInfo } from './modules/geo-ci/zones.js';
import { WalletService } from './modules/wallet/service.js';
import { SubscriptionService } from './modules/subscriptions/service.js';
import { RentalService } from './modules/rental/service.js';
import { RentalSettingsService, type RentalTarifRecord } from './modules/rental/settings.js';
import { TelematiqueService, type Immobilisation, type DeclarationVol } from './modules/rental/telematique.js';
import { WeddingService } from './modules/wedding/service.js';
import { InsuranceService, type InsuranceContribution } from './modules/insurance/service.js';
import { PaymentRegistry } from './modules/payments/providers.js';
import { SafetyService } from './modules/safety/service.js';
import { EmergencyContactsService, type ContactJournalEntry } from './modules/safety/contacts.js';
import { SettingsService, type PricingRecord } from './modules/settings/service.js';
import { RealtimeHub, CONFIG_ROOM, DRIVER_CONFIG_ROOM, driverRoom } from './modules/realtime/hub.js';
import { driverAppConfig } from './modules/driver-app/config.js';
import { config } from './config/index.js';
import { createMapsProvider, type MapsProvider } from './modules/maps/service.js';
import { createRepository } from './core/db/repository.js';
import { brancherAnnuaire, identifiantsDeConfiguration } from './modules/admin/auth.js';
import { genMatricule, type Driver } from './modules/drivers/store.js';
import { ClientStore, type Client } from './modules/clients/store.js';
import { PromoService, type Promo } from './modules/promos/service.js';
import { SupportService } from './modules/support/service.js';
import { NotificationService } from './modules/notifications/service.js';
import { AuditService } from './modules/admin/audit.js';
import { TreasuryService, type Transfer } from './modules/treasury/service.js';
import { CaisseService, type Caisse, type MouvementCaisse } from './modules/treasury/caisse.js';
import { DisputeService, type Dispute } from './modules/disputes/service.js';
import { DemandService } from './modules/rides/demand.js';
import { TeamService, type Team } from './modules/teams/service.js';
import { CorporateService, type CorporateAccount } from './modules/corporate/service.js';
import { SecurityAlertsService } from './modules/admin/security.js';
import { ReservationService, type Reservation } from './modules/reservations/service.js';
import { StaffService } from './modules/staff/service.js';
import { StaffAccountService, type StaffAccount } from './modules/staff/accounts.js';
import { CrewRequestService, type RequeteChauffeur } from './modules/crew/requests.js';
import { CrewService } from './modules/crew/service.js';
import { StaffCommsService, type MessageInterne, type DemandeRapport } from './modules/staff/comms.js';
import { TeamWorkspaceService } from './modules/teams/workspace.js';
import { ExecutiveService } from './modules/executive/service.js';
import { VigilanceService } from './modules/vigilance/service.js';
import { WorkspaceService } from './modules/workspace/service.js';
import { AssistantService } from './modules/assistant/service.js';
import { ExpenseService, type ExpenseTicket } from './modules/expenses/service.js';
import type { Ride } from './modules/rides/store.js';
import type { LedgerEntry } from './modules/wallet/service.js';
import type { Subscription, SubscriptionInvoice } from './modules/subscriptions/service.js';
import type { WeddingReservation } from './modules/wedding/service.js';
import type { RentalReservation } from './modules/rental/service.js';

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
  /** Répertoire d'urgence + registre des contacts (poste SAMU). */
  contacts: EmergencyContactsService;
  maps: MapsProvider;
  simulator: RideSimulator;
  wallet: WalletService;
  clientWallet: WalletService;
  insurance: InsuranceService;
  subscriptions: SubscriptionService;
  wedding: WeddingService;
  /** Location de véhicules Signature : événements, entreprises, mise à disposition. */
  rental: RentalService;
  /** Tarifs de location pilotés depuis la console (prix journée, stocks, barème). */
  rentalSettings: RentalSettingsService;
  /** Boîtiers embarqués des véhicules Signature : position, vol, coupure moteur. */
  telematique: TelematiqueService;
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
  /** Annuaire du personnel : un identifiant de connexion par employé et par chauffeur. */
  accounts: StaffAccountService;
  /** Requêtes des chauffeurs : prêt, avance, congé, matériel, réclamation. */
  crewRequests: CrewRequestService;
  /** Caisses nominatives : espèces reçues, comptage et arrêté par trésorier. */
  caisses: CaisseService;
  /** Session Équipages : le dossier complet d'un chauffeur, agrégé. */
  crew: CrewService;
  /** Communication interne : messages et demandes de rapport entre employés. */
  staffComms: StaffCommsService;
  /** Poste de travail du chef d'équipe : ses membres, sa flotte, son bilan. */
  teamWorkspace: TeamWorkspaceService;
  /** Notes de frais & avances (self-service + validation CFO). */
  expenses: ExpenseService;
  /** Direction générale : consolidation de TOUS les flux financiers (poste du PDG). */
  executive: ExecutiveService;
  /** Moteur de vigilance : inspecte la plateforme et signale les failles. */
  vigilance: VigilanceService;
  /** « Mon poste » : la journée de travail de l'employé connecté. */
  workspace: WorkspaceService;
  /** Assistant ORION : répond en français à des questions sur les données réelles. */
  assistant: AssistantService;
  /** Filet de sécurité : libère un chauffeur dont la course terminée n'est jamais réglée. */
  rideRelease: RideReleaseService;
  /** Opérateur SMS : codes de connexion des clients et des chauffeurs. */
  sms: SmsSender;
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
      demand.record(req.origin, req.clientId);
      const ops = settings.getOps();
      const surgeRaw = ops.surgeEnabled ? await demand.surgeFor(req.origin) : 1;
      // Surge MANUEL d'urgence (zone dessinée dans la console) — toujours plafonné (cap vert).
      const surgeManual = settings.zoneForPoint(req.origin)?.surgeManual ?? 1;
      // Règles géographiques du trajet : forfait plat A→B, retour à vide, plancher premium.
      const trip = settings.tripPricing(req.origin, req.destination);
      return {
        trafficFactor: traffic.factor,
        trafficLevel: traffic.level,
        settings: settings.getPricing(),
        zoneFactor: settings.zoneFactor(req.origin),
        zonePickupFee: settings.zoneForPoint(req.origin)?.pickupFee ?? 0,
        flatAmount: trip.flatAmount,
        extraFee: trip.extraFee,
        premiumFloor: trip.premiumFloor,
        surgeMultiplier: Math.min(Math.max(surgeRaw, surgeManual), ops.surgeCapGreen),
        promoDiscount: (subtotal: number) => promos.evaluate(req.promoCode, subtotal)?.discount ?? 0,
      };
    }),
  );
  // Livraison à moto : même contexte tarifaire que la course (trafic intégré, zone,
  // surge plafonné, codes promo de la console) sur le barème coursier.
  registry.register(
    new DeliveryServiceModule(async (req) => {
      const traffic = trafficInfo(req.origin, req.destination);
      demand.record(req.origin, req.clientId);
      const ops = settings.getOps();
      const surgeRaw = ops.surgeEnabled ? await demand.surgeFor(req.origin) : 1;
      const surgeManual = settings.zoneForPoint(req.origin)?.surgeManual ?? 1;
      return {
        trafficFactor: traffic.factor,
        trafficLevel: traffic.level,
        settings: settings.getPricing(),
        zoneFactor: settings.zoneFactor(req.origin),
        surgeMultiplier: Math.min(Math.max(surgeRaw, surgeManual), ops.surgeCapGreen),
        promoDiscount: (subtotal: number) => promos.evaluate(req.promoCode, subtotal)?.discount ?? 0,
      };
    }),
  );

  const realtime = new RealtimeHub();
  // Diffusion temps réel de la config publique : à chaque changement piloté depuis la
  // console (maintenance, services, passerelles), toutes les apps clientes connectées au
  // canal WS `config` reçoivent la nouvelle config et se mettent à jour instantanément.
  settings.onServicesChanged((cfg) => realtime.publish(CONFIG_ROOM, 'config.update', { ...cfg, currency: 'XOF' }));
  // App CHAUFFEUR synchronisée : réglages flotte (délai d'offre, commissions, dette
  // espèces, heures creuses, zones) rediffusés à chaque changement console…
  settings.onDriverConfigChanged(() => realtime.publish(DRIVER_CONFIG_ROOM, 'driver-config.update', driverAppConfig(settings)));
  // …et chaque modification de fiche (KYC, suspension motivée, avertissement, VIP,
  // fidélité, disponibilité) poussée en direct au chauffeur concerné.
  drivers.onChange((d) => realtime.publish(driverRoom(d.id), 'driver.update', { driver: d }));
  // Tarifs de location : réglés depuis la console, persistés, diffusés en direct aux
  // apps clientes connectées — un ajustement de prix prend effet sans redéploiement.
  const rentalSettings = new RentalSettingsService(createRepository<RentalTarifRecord>('rental_tarifs'));
  const rentalService = new RentalService(rentalSettings, createRepository<RentalReservation>('rental'));
  rentalSettings.onChange(() => realtime.publish(CONFIG_ROOM, 'rental-config.update', {
    tarif: rentalSettings.getTarif(),
    vehicles: rentalSettings.catalogue(),
    currency: 'XOF',
  }));

  // Annuaire du personnel : branché à l'authentification de la console pour que les
  // comptes créés à l'écran puissent effectivement se connecter. Les identifiants
  // définis dans la configuration sont protégés contre toute écriture depuis l'écran.
  const comptes = new StaffAccountService(createRepository<StaffAccount>('staff_accounts'));
  comptes.protege(identifiantsDeConfiguration());
  brancherAnnuaire(() => comptes.asAdminUsers());

  // Requêtes des chauffeurs : déposées par eux, instruites par leur chef d'équipe,
  // décidées par la finance, versées par la trésorerie.
  const requetesChauffeurs = new CrewRequestService(createRepository<RequeteChauffeur>('crew_requests'));

  // Messagerie interne et demandes de rapport : un chef écrit à ses membres et leur
  // demande des bilans, et l'on sait qui a lu, qui a répondu, qui n'a rien rendu.
  const comms = new StaffCommsService(
    createRepository<MessageInterne>('staff_messages'),
    createRepository<DemandeRapport>('staff_rapports'),
  );

  // Télématique des véhicules de location : position, déclaration de vol,
  // immobilisation moteur à distance.
  const telematique = new TelematiqueService(
    createRepository<Immobilisation>('rental_immobilisations'),
    createRepository<DeclarationVol>('rental_vols'),
  );

  const safety = new SafetyService(realtime);
  // Portefeuille client (séparé du wallet chauffeur) : remboursements ORION Assurance.
  const clientWallet = new WalletService(createRepository<LedgerEntry>('client_wallet'));

  const container: Container = {
    geo,
    idempotency: new IdempotencyStore(),
    registry,
    drivers,
    rides,
    matching,
    payments: new PaymentRegistry(),
    safety,
    realtime,
    contacts: new EmergencyContactsService(
      createRepository('contacts_urgence'),
      createRepository<ContactJournalEntry>('contacts_journal'),
    ),
    maps: createMapsProvider(),
    simulator: (() => {
      const sim = new RideSimulator(rides, realtime);
      // Les chauffeurs équipés de l'app pilotent eux-mêmes leurs courses.
      sim.skipWhen((driverId) => Boolean(drivers.get(driverId)?.appLinkedAt));
      return sim;
    })(),
    wallet: new WalletService(createRepository<LedgerEntry>('wallet_ledger')),
    clientWallet,
    insurance: new InsuranceService(createRepository<InsuranceContribution>('insurance'), clientWallet),
    subscriptions: new SubscriptionService(
      createRepository<Subscription>('subscriptions'),
      createRepository<SubscriptionInvoice>('subscription_invoices'),
    ),
    wedding: new WeddingService(createRepository<WeddingReservation>('wedding')),
    rental: rentalService,
    rentalSettings,
    telematique,
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
    accounts: comptes,
    crewRequests: requetesChauffeurs,
    staffComms: comms,
    caisses: new CaisseService(createRepository<Caisse>('caisses'), createRepository<MouvementCaisse>('caisse_mouvements')),
    expenses: new ExpenseService(createRepository<ExpenseTicket>('expenses')),
    // Renseigné juste après : la consolidation a besoin du conteneur complet.
    executive: undefined as unknown as ExecutiveService,
    vigilance: undefined as unknown as VigilanceService,
    workspace: undefined as unknown as WorkspaceService,
    crew: undefined as unknown as CrewService,
    teamWorkspace: undefined as unknown as TeamWorkspaceService,
    assistant: undefined as unknown as AssistantService,
    rideRelease: undefined as unknown as RideReleaseService,
    sms: creerSms(config),
  };
  // La direction générale ne stocke rien, elle lit les autres modules. On la câble
  // après coup pour qu'elle voie l'intégralité du conteneur.
  container.executive = new ExecutiveService(container);
  container.vigilance = new VigilanceService(container);
  container.workspace = new WorkspaceService(container);
  container.crew = new CrewService(container);
  container.teamWorkspace = new TeamWorkspaceService(container);
  container.assistant = new AssistantService(container);
  container.rideRelease = new RideReleaseService(container, config.RIDE_UNPAID_RELEASE_MINUTES);

  // MODE SIMULATION : la présence géographique d'un chauffeur expire après
  // PRESENCE_TTL_SECONDS sans position reçue — c'est l'app chauffeur qui la
  // rafraîchit en roulant. Ici, le simulateur tient lieu d'app : sans ce battement,
  // les chauffeurs de démonstration disparaissaient du dispatch 30 s après leur
  // mise en ligne, et chaque commande partait en « aucun chauffeur » alors que la
  // console en affichait 44 en ligne. Trouvé en enregistrant la démonstration.
  // Seuls les chauffeurs SANS app réelle sont concernés : un vrai téléphone muet
  // doit, lui, sortir du dispatch.
  if (config.SIMULATE_RIDES) {
    const battement = setInterval(async () => {
      for (const e of await geo.snapshot()) {
        const d = drivers.get(e.id);
        if (d && !d.appLinkedAt && d.availability !== 'offline') await geo.upsert(e);
      }
    }, Math.max(2_000, Math.floor((config.PRESENCE_TTL_SECONDS * 1000) / 3)));
    battement.unref?.();
  }
  // En test, le balayage s'appelle à la main pour rester déterministe.
  if (config.NODE_ENV !== 'test') container.rideRelease.start();

  // INTERCONNEXION : une requête chauffeur qui bouge réveille les sessions qui en
  // dépendent. Sans cela, le chauffeur dépose, et personne ne le sait avant la
  // prochaine ouverture de l'écran.
  requetesChauffeurs.onChange((r, evenement) => {
    realtime.publish(driverRoom(r.driverId), 'crew.request', { requete: r, evenement });
    const messages: Record<string, string> = {
      depot: `Nouvelle requête ${r.type} de ${r.driverName} (${r.matricule}).`,
      instruction: `Requête ${r.id} instruite : avis ${r.avis}.`,
      accord: `Requête ${r.id} accordée à ${r.driverName}.`,
      refus: `Requête ${r.id} refusée pour ${r.driverName}.`,
      versement: `Requête ${r.id} versée à ${r.driverName}.`,
    };
    // Le chauffeur concerné est prévenu directement : c'est sa demande, il a le
    // droit de savoir où elle en est sans rappeler le bureau.
    const texte = messages[evenement];
    if (texte && evenement !== 'depot') {
      container.notifications.notify({ driverId: r.driverId }, 'Votre requête ORION', texte);
    }
  });
  return container;
}

/**
 * Amorce quelques chauffeurs en ligne autour d'Abidjan (aide de développement).
 * En l'absence d'app chauffeur, cela permet à l'app cliente de trouver un chauffeur et
 * de déclencher le suivi temps réel. Désactivé quand la simulation est coupée (prod/tests).
 */
export async function seedDemoDrivers(c: Container): Promise<void> {
  // Plusieurs chauffeurs par niveau (Bronze→Diamant) répartis dans Abidjan,
  // afin que chaque niveau de course trouve un véhicule disponible.
  // Un numéro par chauffeur : la console affiche des boutons d'appel, et une fiche
  // sans téléphone donne un « n° inconnu » qui ne sert à personne — y compris en
  // développement, où c'est précisément ce qu'on veut pouvoir vérifier.
  const seeds: Array<{ name: string; lat: number; lng: number; category: string; phone: string }> = [
    { name: 'Konan Yao', lat: 5.3258, lng: -4.0205, category: 'bronze', phone: '+2250701020304' },
    { name: 'Awa Diomandé', lat: 5.331, lng: -4.012, category: 'bronze', phone: '+2250702030405' },
    { name: 'Aïcha Touré', lat: 5.3585, lng: -3.989, category: 'argent', phone: '+2250703040506' },
    { name: 'Ismaël Cissé', lat: 5.347, lng: -3.999, category: 'argent', phone: '+2250704050607' },
    { name: 'Mamadou Bamba', lat: 5.3402, lng: -4.0095, category: 'or', phone: '+2250705060708' },
    { name: 'Grace Kouamé', lat: 5.353, lng: -3.995, category: 'or', phone: '+2250706070809' },
    { name: 'Fatou Koné', lat: 5.301, lng: -3.998, category: 'diamant', phone: '+2250707080910' },
    { name: 'Serge Gbagbo', lat: 5.3265, lng: -4.0185, category: 'diamant', phone: '+2250708091011' },
  ];
  for (const s of seeds) {
    const d = c.drivers.upsert({
      id: randomUUID(),
      name: s.name,
      matricule: genMatricule(),
      category: s.category,
      phone: s.phone,
      kycStatus: 'active',
      availability: 'offline',
      ratingAvg: 4.9,
      ratingCount: 1000,
    });
    await c.drivers.goOnline(d.id, { lat: s.lat, lng: s.lng });
  }
}
