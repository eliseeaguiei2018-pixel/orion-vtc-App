import { especesAutorisees, montantArrets, resumeArrets } from '../rides/courseLive.js';
import type { Container } from '../../container.js';
import { effectiveCommissionRate } from '../wallet/service.js';
import type { Driver } from '../drivers/store.js';
import type { Ride } from '../rides/store.js';
import type { RentalReservation } from '../rental/service.js';
import { lieuDe } from '../maps/lieux.js';

/** Statuts de course « actifs » côté chauffeur (mission en cours). */
export const ACTIVE = new Set(['accepted', 'driver_en_route', 'arrived', 'in_progress', 'completed']);

/** Début de journée locale Abidjan (UTC+0, pas d'heure d'été). */
export const startOfDay = (d = new Date()) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Vue d'une course POUR LE CHAUFFEUR : trajet, montant, moyen de paiement, et surtout
 * ce que la course lui a rapporté (ledger) — gain net, bonus, commission, espèces.
 */
export function driverRideView(ride: Ride, container: Container, driverId: string, ecritures?: readonly LedgerLike[]) {
  // VOLUME : les écritures du chauffeur se lisent sans copie ni tri (ecritures), et
  // l'historique les passe déjà regroupées par course.
  const entries = (ecritures ?? container.wallet.ecritures(driverId)).filter((e) => e.rideId === ride.id);
  const sum = (types: string[]) => entries.filter((e) => types.includes(e.type)).reduce((s, e) => s + e.amount, 0);
  const paid = ride.events.find((e) => e.type === 'paid')?.payload as { method?: string; amount?: number } | undefined;
  const rated = ride.events.find((e) => e.type === 'rated')?.payload as { stars?: number; comment?: string } | undefined;
  const last = ride.events[ride.events.length - 1];
  return {
    id: ride.id,
    status: ride.status,
    serviceType: ride.serviceType,
    category: ride.quote.category,
    origin: ride.origin,
    destination: ride.destination,
    // Noms réels (quartier, commune) : le chauffeur voyait « Cocody » ou des coordonnées.
    lieux: { depart: lieuDe(ride.origin).libelle, arrivee: lieuDe(ride.destination).libelle },
    stops: ride.quote.stops ?? [],
    distanceMeters: ride.quote.distanceMeters,
    etaSeconds: ride.quote.etaSeconds,
    amount: ride.quote.amount,
    // Itinéraire choisi par le client (pont à péage ou voie normale), péage compris dans le prix.
    ...(ride.quote.itineraire ? { itineraire: { ...ride.quote.itineraire, peage: ride.quote.breakdown.peage ?? 0 } } : {}),
    // Mise à disposition à l'heure : le chauffeur reste avec le client pendant `heures` heures.
    ...(ride.quote.miseADisposition ? { miseADisposition: ride.quote.miseADisposition } : {}),
    ...(ride.quote.breakdown.horsAbidjan ? { horsAbidjan: true } : {}),
    waitMinutes: ride.waitMinutes ?? 0,
    // Arrêts prévus et demandés : compteur en cours, minutes et montants (visibles des deux côtés).
    arrets: resumeArrets(ride, container.settings.getPricing().arretParMin),
    // Espèces de secours autorisées par le chauffeur (le moyen choisi n'a pas fonctionné).
    especesAutorisees: especesAutorisees(ride),
    paymentMethod: paid?.method ?? ride.paymentMethod ?? null,
    paidAmount: paid?.amount ?? null,
    earnings: {
      net: Math.round(sum(['ride_earning'])),
      bonus: Math.round(sum(['adjustment'])),
      commission: Math.round(-sum(['commission'])),
      cashCollected: Math.round(-sum(['cash_collected'])),
    },
    rating: rated?.stars ?? null,
    // Abonnement du client : ce qu'il paie réellement (le chauffeur est payé sur le brut).
    encaissement: montantsAEncaisser(container, ride),
    // Course terminée sans paiement après le délai console : chauffeur libéré, à régulariser.
    liberee: ride.events.some((e) => e.type === 'driver_released_unpaid'),
    createdAt: ride.createdAt,
    updatedAt: last?.at ?? ride.createdAt,
  };
}

interface LedgerLike { rideId?: string; type: string; amount: number }

/**
 * Ce que le client doit RÉELLEMENT payer à la fin de la course — même calcul que la route
 * de paiement : prix fixe + attente facturée, moins la part prise en charge par son
 * abonnement ORION. Le chauffeur est rémunéré sur le BRUT dans tous les cas ; en espèces,
 * il n'encaisse que `aEncaisser` (0 F si la course est entièrement couverte).
 */
export function montantsAEncaisser(container: Container, ride: Ride) {
  const freeWait = container.settings.getPricing().freeWaitMinutes;
  const attente = Math.max(0, (ride.waitMinutes ?? 0) - freeWait) * container.settings.getOps().waitFeePerMin;
  // Arrêts en course : chaque minute facturée (tarif de la console), ajoutée au prix fixe.
  const arrets = montantArrets(ride);
  const brut = ride.quote.amount + attente + arrets;
  const prisEnCharge = (ride.subscription?.montantCouvert ?? 0) + (ride.subscription?.remise ?? 0);
  return {
    brut,
    attente,
    arrets,
    prisEnCharge: Math.min(brut, prisEnCharge),
    aEncaisser: Math.max(0, brut - prisEnCharge),
    abonnement: ride.subscription ? { plan: ride.subscription.plan, raison: ride.subscription.raison } : null,
  };
}

/** Courses terminées que le chauffeur n'a pas encore vu payer (libération après délai console). */
export function coursesARegulariser(container: Container, driverId: string) {
  return container.rides.listByDriver(driverId)
    .filter((r) => r.status === 'completed')
    .slice(0, 20)
    .map((r) => driverRideView(r, container, driverId));
}

/**
 * Location Signature vue par le chauffeur : la prestation à assurer, jamais la facture
 * (le prix reste à la console et au client).
 */
export function vueLocationChauffeur(r: RentalReservation) {
  const etapes = r.events
    .filter((e) => e.type.startsWith('chauffeur:'))
    .map((e) => ({ etape: e.type.slice('chauffeur:'.length), at: e.at, note: e.note ?? null }));
  return {
    id: r.id,
    formula: r.formula,
    duree: r.duree,
    heures: r.heures,
    heuresService: r.heuresService,
    vehicle: r.vehicle,
    debut: r.debut,
    fin: r.fin,
    lieu: r.lieu ?? null,
    contact: r.contact ?? null,
    societe: r.societe ?? null,
    status: r.status,
    options: r.options,
    jourJ: r.jourJ,
    kmInclus: r.kmInclus,
    secondChauffeurRequis: r.secondChauffeurRequis,
    /** Avancement déclaré par le chauffeur (véhicule préparé, en route, sur place…). */
    etapes,
  };
}

/** Totaux de gains sur une période (courses payées). */
export function totals(views: ReturnType<typeof driverRideView>[], sinceMs: number) {
  const rows = views.filter((v) => v.paidAmount !== null && Date.parse(v.updatedAt) >= sinceMs);
  return {
    rides: rows.length,
    // Brut = ce qui rémunère le chauffeur (gain net + commission), y compris quand le
    // client n'a rien payé parce que la course était couverte par son abonnement.
    gross: rows.reduce((s, v) => s + v.earnings.net + v.earnings.commission, 0),
    net: rows.reduce((s, v) => s + v.earnings.net + v.earnings.bonus, 0),
    commission: rows.reduce((s, v) => s + v.earnings.commission, 0),
    cashCollected: rows.reduce((s, v) => s + v.earnings.cashCollected, 0),
  };
}

/** Course en cours du chauffeur, enrichie (client, secteur de prise en charge). */
export function activeRideFor(container: Container, driverId: string, offer?: { expiresAt: string; timeoutSec: number; status: string } | null) {
  // Une course terminée dont le chauffeur a été LIBÉRÉ faute de paiement n'est plus sa
  // mission : elle passe dans « à régulariser » (sinon l'app restait bloquée dessus).
  const ride = container.rides.listByDriver(driverId)
    .find((r) => ACTIVE.has(r.status) && !(r.status === 'completed' && r.events.some((e) => e.type === 'driver_released_unpaid')));
  if (!ride) return null;
  const client = container.clients.get(ride.clientId);
  // Confidentialité (politique publiée) : le chauffeur voit le PRÉNOM et la photo du
  // passager, le temps de la course — pas son nom complet.
  const prenom = client?.name?.trim().split(/\s+/)[0] ?? null;
  const zone = container.settings.zoneForPoint(ride.origin);
  return {
    ...driverRideView(ride, container, driverId),
    events: ride.events.map((e) => ({ type: e.type, at: e.at })),
    // Coordonnées du passager : visibles UNIQUEMENT pendant la mission.
    client: { id: ride.clientId, name: prenom, phone: client?.phone ?? null, rides: client?.rides ?? 0, photo: client?.photo ?? null },
    pickupZone: zone ? { id: zone.id, name: zone.name, driverBonus: zone.driverBonus ?? 0 } : null,
    // Code de prise en charge : le chauffeur sait s'il doit le demander, jamais sa valeur.
    codeRequis: container.codesPriseEnCharge.requis(ride.id),
    codeVerifie: Boolean(container.codesPriseEnCharge.lire(ride.id)?.verifieLe),
    // Livraison : le colis, le destinataire (nom et téléphone, le temps de la mission) et le
    // code de remise à demander à la livraison (jamais sa valeur).
    livraison: ride.serviceType === 'delivery' ? {
      destinataire: ride.livraison?.destinataire ?? null,
      description: ride.livraison?.description ?? null,
      instructions: ride.livraison?.instructions ?? null,
      codeRemiseRequis: container.codesRemise.requis(ride.id),
    } : null,
    // Offre à confirmer (compte à rebours console) — null si déjà confirmée / chauffeur démo.
    offer: offer && offer.status === 'pending' ? { expiresAt: offer.expiresAt, timeoutSec: offer.timeoutSec } : null,
  };
}

/** Situation financière synthétique (solde, dette espèces, taux appliqué). */
export function financeFor(container: Container, driver: Driver) {
  const ops = container.settings.getOps();
  const balance = Math.round(container.wallet.balance(driver.id));
  const debt = balance < 0 ? -balance : 0;
  return {
    balance,
    cashDebt: debt,
    cashDebtLimit: ops.cashDebtLimit,
    /** Au-delà du plafond : plus de courses payées en espèces (règle console). */
    cashBlocked: debt > ops.cashDebtLimit,
    commissionRate: effectiveCommissionRate(driver, ops),
    frozen: container.wallet.isFrozen(driver.id),
  };
}
