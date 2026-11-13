import type { Container } from '../../container.js';
import { effectiveCommissionRate } from '../wallet/service.js';
import type { Driver } from '../drivers/store.js';
import type { Ride } from '../rides/store.js';

/** Statuts de course « actifs » côté chauffeur (mission en cours). */
export const ACTIVE = new Set(['accepted', 'driver_en_route', 'arrived', 'in_progress', 'completed']);

/** Début de journée locale Abidjan (UTC+0, pas d'heure d'été). */
export const startOfDay = (d = new Date()) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Vue d'une course POUR LE CHAUFFEUR : trajet, montant, moyen de paiement, et surtout
 * ce que la course lui a rapporté (ledger) — gain net, bonus, commission, espèces.
 */
export function driverRideView(ride: Ride, container: Container, driverId: string) {
  const entries = container.wallet.history(driverId).filter((e) => e.rideId === ride.id);
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
    stops: ride.quote.stops ?? [],
    distanceMeters: ride.quote.distanceMeters,
    etaSeconds: ride.quote.etaSeconds,
    amount: ride.quote.amount,
    waitMinutes: ride.waitMinutes ?? 0,
    paymentMethod: paid?.method ?? ride.paymentMethod ?? null,
    paidAmount: paid?.amount ?? null,
    earnings: {
      net: Math.round(sum(['ride_earning'])),
      bonus: Math.round(sum(['adjustment'])),
      commission: Math.round(-sum(['commission'])),
      cashCollected: Math.round(-sum(['cash_collected'])),
    },
    rating: rated?.stars ?? null,
    createdAt: ride.createdAt,
    updatedAt: last?.at ?? ride.createdAt,
  };
}

/** Totaux de gains sur une période (courses payées). */
export function totals(views: ReturnType<typeof driverRideView>[], sinceMs: number) {
  const rows = views.filter((v) => v.paidAmount !== null && Date.parse(v.updatedAt) >= sinceMs);
  return {
    rides: rows.length,
    gross: rows.reduce((s, v) => s + (v.paidAmount ?? 0), 0),
    net: rows.reduce((s, v) => s + v.earnings.net + v.earnings.bonus, 0),
    commission: rows.reduce((s, v) => s + v.earnings.commission, 0),
    cashCollected: rows.reduce((s, v) => s + v.earnings.cashCollected, 0),
  };
}

/** Course en cours du chauffeur, enrichie (client, secteur de prise en charge). */
export function activeRideFor(container: Container, driverId: string, offer?: { expiresAt: string; timeoutSec: number; status: string } | null) {
  const ride = container.rides.listByDriver(driverId).find((r) => ACTIVE.has(r.status));
  if (!ride) return null;
  const client = container.clients.get(ride.clientId);
  const zone = container.settings.zoneForPoint(ride.origin);
  return {
    ...driverRideView(ride, container, driverId),
    events: ride.events.map((e) => ({ type: e.type, at: e.at })),
    // Coordonnées du passager : visibles UNIQUEMENT pendant la mission.
    client: { id: ride.clientId, name: client?.name ?? null, phone: client?.phone ?? null, rides: client?.rides ?? 0 },
    pickupZone: zone ? { id: zone.id, name: zone.name, driverBonus: zone.driverBonus ?? 0 } : null,
    // Code de prise en charge : le chauffeur sait s'il doit le demander, jamais sa valeur.
    codeRequis: container.codesPriseEnCharge.requis(ride.id),
    codeVerifie: Boolean(container.codesPriseEnCharge.lire(ride.id)?.verifieLe),
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
