import type { DriverConfig, KycStatus, LatLng, RideStatus, Zone } from './types';
import { libelles, localeCourante, tr } from './i18n';

/** Montant en F CFA, ex. « 12 500 F ». */
export const fcfa = (n: number | null | undefined): string => `${Math.round(n ?? 0).toLocaleString('fr-FR')} F`;

/** Taux (0..1) en pourcentage, ex. « 12 % ». */
export const pct = (r: number): string => `${Math.round(r * 1000) / 10} %`;

export const km = (meters: number): string => `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;

export const minutes = (seconds: number): string => `${Math.max(1, Math.round(seconds / 60))} min`;

export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString(localeCourante(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const shortDate = (iso: string): string => new Date(iso).toLocaleDateString(localeCourante(), { day: '2-digit', month: 'short', year: 'numeric' });

export const METHOD_LABEL: Record<string, string> = libelles({
  cash: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', mtn_momo: 'MTN MoMo', moov_money: 'Moov Money', card: 'Carte bancaire',
});
export const methodLabel = (m: string | null | undefined): string => (m ? METHOD_LABEL[m] ?? m : tr('Non précisé'));

export const STATUS_LABEL: Record<RideStatus, string> = libelles({
  searching: 'Recherche', accepted: 'Attribuée', driver_en_route: 'En route vers le client', arrived: 'Arrivé au point de prise en charge',
  in_progress: 'Course en cours', completed: 'Terminée — paiement', paid: 'Payée', rated: 'Notée', cancelled: 'Annulée', no_driver: 'Sans chauffeur',
});

export const KYC_LABEL: Record<KycStatus, string> = libelles({
  draft: 'Brouillon — à compléter', docs_submitted: 'Envoyé — en attente d’examen', manual_review: 'En examen par ORION',
  approved: 'Validé', active: 'Actif', suspended: 'Suspendu',
});

export const TIER_LABEL: Record<string, string> = libelles({ bronze: 'Argent', argent: 'Argent', or: 'Or', diamant: 'Diamant', moto: 'Coursier moto' });

/** Livraison à moto : les mêmes étapes, dites avec les mots du coursier. */
export const STATUS_LABEL_LIVRAISON: Partial<Record<RideStatus, string>> = libelles({
  accepted: 'Livraison attribuée', driver_en_route: 'En route vers le colis', arrived: 'Au point de retrait',
  in_progress: 'Livraison en cours', completed: 'Colis livré · paiement',
});
export const TAILLE_COLIS: Record<string, string> = libelles({ petit: 'petit colis', moyen: 'colis moyen', grand: 'grand colis' });
/** Livraison 2.6 : formule choisie par le client et délai de remise. */
export const nomFormuleLivraison = (f: 'moto' | 'cargo') => (f === 'cargo' ? tr('Cargo · gros colis') : tr('Moto express'));
export const nomDelaiLivraison = (d: 'express' | 'heure' | 'deux_heures') => (d === 'express' ? tr('Dès que possible') : d === 'heure' ? tr('Sous 1 heure') : tr('Sous 2 heures'));
export const statutLabel = (status: RideStatus, livraison: boolean) => (livraison ? STATUS_LABEL_LIVRAISON[status] : undefined) ?? STATUS_LABEL[status];
// Trois gammes ; un compte créé avant la suppression du Bronze est lu comme Argent.
const TIER_RANK: Record<string, number> = { bronze: 0, argent: 0, or: 1, diamant: 2 };
export const meetsStandard = (category: string, min: string | null): boolean => !min || (TIER_RANK[category] ?? 0) >= (TIER_RANK[min] ?? 0);

export function haversine(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Secteur actif contenant le point (le plus proche du centre), comme le backend. */
export function zoneAt(p: LatLng, zones: Zone[]): Zone | null {
  let best: Zone | null = null;
  let bestDist = Infinity;
  for (const z of zones) {
    const d = haversine(p, { lat: z.lat, lng: z.lng });
    if (d <= z.radiusKm * 1000 && d < bestDist) { best = z; bestDist = d; }
  }
  return best;
}

/** Heures creuses de recharge (fenêtre console, éventuellement à cheval sur minuit). */
export function inOffPeak(cfg: DriverConfig, d = new Date()): boolean {
  const h = d.getHours();
  const { start, end } = cfg.offPeak;
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/** Liens de navigation GPS (Google Maps / Waze). */
export const navLinks = (to: LatLng) => ({
  google: `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`,
  waze: `https://waze.com/ul?ll=${to.lat},${to.lng}&navigate=yes`,
});

export const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** Nombre de jours avant une date ISO (négatif si dépassée). */
export const daysUntil = (iso?: string): number | null => (iso ? Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000) : null);

/** Gammes servies par le chauffeur, lisibles : « Or + Argent ». */
export function gammesLisibles(d: { category: string; categories?: string[] }): string {
  const toutes = [...new Set([d.category, ...(d.categories ?? [])])];
  return toutes.map((g) => TIER_LABEL[g] ?? g).join(' + ');
}
