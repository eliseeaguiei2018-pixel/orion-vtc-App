import type { Overview, Alert, FleetUnit, RideRow, DriverRow } from './Admin';

/** Jeu de données de démonstration (console autonome, sans backend). */
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();

const fleet: FleetUnit[] = [
  { id: 'd1', name: 'Konan Yao', matricule: 'ORION-CI-1042', category: 'bronze', availability: 'online', lat: 5.3258, lng: -4.0205 },
  { id: 'd2', name: 'Awa Diomandé', matricule: 'ORION-CI-2210', category: 'bronze', availability: 'on_trip', lat: 5.331, lng: -4.012 },
  { id: 'd3', name: 'Aïcha Touré', matricule: 'ORION-CI-1207', category: 'argent', availability: 'online', lat: 5.3585, lng: -3.989 },
  { id: 'd4', name: 'Ismaël Cissé', matricule: 'ORION-CI-3391', category: 'argent', availability: 'on_trip', lat: 5.347, lng: -3.999 },
  { id: 'd5', name: 'Mamadou Bamba', matricule: 'ORION-CI-9034', category: 'or', availability: 'online', lat: 5.3402, lng: -4.0095 },
  { id: 'd6', name: 'Grace Kouamé', matricule: 'ORION-CI-5567', category: 'or', availability: 'online', lat: 5.353, lng: -3.995 },
  { id: 'd7', name: 'Fatou Koné', matricule: 'ORION-CI-7788', category: 'diamant', availability: 'on_trip', lat: 5.301, lng: -3.998 },
  { id: 'd8', name: 'Serge Aka', matricule: 'ORION-CI-4820', category: 'diamant', availability: 'online', lat: 5.3265, lng: -4.0185 },
  { id: 'd9', name: 'Yao N’Guessan', matricule: 'ORION-CI-6120', category: 'bronze', availability: 'online', lat: 5.362, lng: -4.02 },
  { id: 'd10', name: 'Adjoua Brou', matricule: 'ORION-CI-3055', category: 'argent', availability: 'online', lat: 5.312, lng: -3.978 },
];

const alerts: Alert[] = [
  { id: 'a1', kind: 'crash', status: 'dispatched', userId: 'client-8842', location: { lat: 5.348, lng: -4.002 }, zoneName: 'Adjamé', impactG: 6.2, dispatchedTo: ['185', '170'], createdAt: iso(2), note: 'Accident détecté automatiquement (capteurs)' },
  { id: 'a2', kind: 'sos', status: 'acknowledged', userId: 'client-1190', location: { lat: 5.335, lng: -3.99 }, zoneName: 'Cocody', dispatchedTo: ['185', '170'], createdAt: iso(9), note: 'SOS déclenché par le client' },
  { id: 'a3', kind: 'sos', status: 'resolved', userId: 'client-4521', location: { lat: 5.31, lng: -4.01 }, zoneName: 'Treichville', dispatchedTo: ['185'], createdAt: iso(41) },
];

const rides: RideRow[] = [
  { id: 'r10a2f9c1', clientId: 'client-8842', driverName: 'Awa Diomandé', matricule: 'ORION-CI-2210', status: 'in_progress', amount: 3150, currency: 'XOF', trafficLevel: 'dense', createdAt: iso(4) },
  { id: 'r22b7e004', clientId: 'client-1190', driverName: 'Ismaël Cissé', matricule: 'ORION-CI-3391', status: 'driver_en_route', amount: 5400, currency: 'XOF', trafficLevel: 'jam', createdAt: iso(6) },
  { id: 'r0091cd7a', clientId: 'client-7781', driverName: 'Fatou Koné', matricule: 'ORION-CI-7788', status: 'in_progress', amount: 12250, currency: 'XOF', trafficLevel: 'fluid', createdAt: iso(11) },
  { id: 'r55aa120e', clientId: 'client-3345', driverName: 'Mamadou Bamba', matricule: 'ORION-CI-9034', status: 'completed', amount: 7150, currency: 'XOF', trafficLevel: 'dense', createdAt: iso(20) },
  { id: 'r7c3390fd', clientId: 'client-9902', driverName: 'Konan Yao', matricule: 'ORION-CI-1042', status: 'paid', amount: 2650, currency: 'XOF', trafficLevel: 'fluid', createdAt: iso(33) },
  { id: 'r3e1180ab', clientId: 'client-2214', driverName: null, matricule: null, status: 'searching', amount: 4100, currency: 'XOF', trafficLevel: 'dense', createdAt: iso(1) },
];

const drivers: DriverRow[] = fleet.map((f, i) => ({
  id: f.id, name: f.name, matricule: f.matricule!, category: f.category,
  kycStatus: i === 8 ? 'manual_review' : 'active',
  availability: f.availability, rating: 4.7 + (i % 3) * 0.1, trips: 800 + i * 137, balance: 15000 + i * 4200,
}));

const overview: Overview = {
  currency: 'XOF',
  rides: { total: 148, active: 12, completed: 129, cancelled: 7, byStatus: { in_progress: 8, driver_en_route: 3, searching: 1, completed: 129 } },
  drivers: { total: fleet.length, online: fleet.filter((f) => f.availability !== 'offline').length, onTrip: fleet.filter((f) => f.availability === 'on_trip').length },
  finance: { gmv: 1263500, revenue: 1263500, commission: 227430, payouts: 640000 },
  safety: { total: alerts.length, open: alerts.filter((a) => a.status !== 'resolved' && a.status !== 'cancelled').length },
  generatedAt: new Date().toISOString(),
};

export const DEMO = { overview, alerts, fleet, rides, drivers };
