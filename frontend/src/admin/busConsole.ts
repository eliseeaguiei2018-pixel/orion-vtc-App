/**
 * Console et tableau de bord sans serveur : les courses du SERVEUR DE TEST PARTAGÉ
 * (voir ../busTest.ts) rejoignent les données de démonstration. Une course commandée dans
 * l'app client et acceptée dans l'app chauffeur (même adresse, même appareil) apparaît
 * donc en tête de la liste des courses, le chauffeur de test dans la flotte, et les
 * compteurs de la vue d'ensemble les prennent en compte.
 */
import type { EtatBus, StatutBus } from '../busTest';
import type { DriverRow, Overview, RideRow } from './types';

/** Statut du registre → statut des courses de la console (celui du serveur ORION). */
export const STATUT_CONSOLE: Record<StatutBus, string> = {
  demandee: 'searching', acceptee: 'driver_en_route', arrivee: 'arrived', en_cours: 'in_progress',
  terminee: 'completed', payee: 'paid', annulee: 'cancelled', refusee: 'cancelled', expiree: 'cancelled',
};
const ACTIFS = new Set(['searching', 'driver_en_route', 'arrived', 'in_progress']);

export function ridesDuBus(etat: EtatBus | null): RideRow[] {
  if (!etat) return [];
  return etat.courses.map((c) => ({
    id: c.id, clientId: c.client.id, clientName: c.client.nom, clientPhone: c.client.telephone || null,
    driverId: c.chauffeur?.id ?? null, driverName: c.chauffeur?.nom ?? null, driverPhone: c.chauffeur?.telephone ?? null,
    matricule: c.chauffeur?.matricule ?? null, status: STATUT_CONSOLE[c.statut], amount: c.montant, currency: 'XOF',
    trafficLevel: 'fluid', anomaly: null, paymentMethod: c.paiementRegle ?? c.paiement,
    depart: c.origine.nom, arrivee: c.destination.nom, createdAt: new Date(c.creeLe).toISOString(),
  }));
}

export function driversDuBus(etat: EtatBus | null): DriverRow[] {
  if (!etat) return [];
  return etat.chauffeurs.map((ch) => ({
    id: ch.id, name: ch.nom, matricule: ch.matricule, category: ch.gamme, kycStatus: 'approved',
    availability: ch.occupe ? 'on_trip' : ch.enLigne ? 'online' : 'offline', rating: ch.note, trips: ch.nbCourses,
    balance: 0, phone: ch.telephone || null,
  }));
}

export function fusionBusConsole(etat: EtatBus | null, overview: Overview, rides: RideRow[], drivers: DriverRow[]) {
  const rb = ridesDuBus(etat);
  const db = driversDuBus(etat);
  if (!rb.length && !db.length) return { overview, rides, drivers };
  const ov: Overview = structuredClone(overview);
  for (const r of rb) {
    ov.rides.total += 1;
    if (ACTIFS.has(r.status)) ov.rides.active += 1;
    if (r.status === 'completed' || r.status === 'paid') {
      ov.rides.completed += 1;
      ov.finance.gmv += r.amount;
    }
    if (r.status === 'cancelled') ov.rides.cancelled += 1;
    ov.rides.byStatus[r.status] = (ov.rides.byStatus[r.status] ?? 0) + 1;
  }
  for (const d of db) {
    ov.drivers.total += 1;
    if (d.availability !== 'offline') ov.drivers.online += 1;
    if (d.availability === 'on_trip') ov.drivers.onTrip += 1;
  }
  ov.generatedAt = new Date().toISOString();
  return { overview: ov, rides: [...rb, ...rides], drivers: [...db, ...drivers] };
}

/** Empreinte du registre : on ne rafraîchit l'écran que si une course ou un chauffeur a changé. */
export const empreinteBus = (e: EtatBus) => JSON.stringify([e.courses.map((c) => [c.id, c.statut, c.majLe]), e.chauffeurs.map((c) => [c.id, c.enLigne, c.occupe])]);
