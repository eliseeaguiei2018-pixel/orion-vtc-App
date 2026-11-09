import type { SettingsService } from '../settings/service.js';

/**
 * Configuration CHAUFFEUR publique : sous-ensemble SÛR des réglages pilotés depuis la
 * console (aucune donnée interne : pas de pondération de scoring, pas de plafond de
 * remboursement support). Servie par GET /drivers/config, poussée à la connexion au
 * canal /ws/drivers/:id puis rediffusée (`driver-config.update`) à chaque changement.
 */
export interface DriverAppConfig {
  currency: 'XOF';
  /** Offres de course : délai d'acceptation (10–15 s) et mode cascade / broadcast. */
  offer: { timeoutSec: number; mode: 'cascade' | 'broadcast' };
  /** Attente facturée : minutes de courtoisie puis tarif à la minute. */
  wait: { freeMinutes: number; feePerMin: number };
  /** Annulation : délai de grâce et frais au-delà. */
  cancel: { graceMinutes: number; fee: number };
  /** Qualité : note minimale exigée et avertissement automatique. */
  quality: { minRating: number; autoWarn: boolean };
  /** Commissions plateforme (0..1) : standard, verte réduite, fidélité verte. */
  commission: { standard: number; green: number; loyalty: number; loyaltyRideThreshold: number };
  /** Plafond de dette espèces (F CFA) : au-delà, plus de courses payées en espèces. */
  cashDebtLimit: number;
  /** Incitation recharge en heures creuses. */
  offPeak: { bonus: number; start: number; end: number };
  /** Prime de prise en charge longue (approche à vide). */
  longPickup: { thresholdKm: number; perKm: number };
  /** Règles de dispatch utiles au chauffeur (transparence). */
  dispatch: { strategy: string; greenPriority: boolean; maxEtaMinutes: number };
  /** Secteurs actifs : bonus chauffeur, standard minimal, surge manuel. */
  zones: Array<{
    id: string; name: string; lat: number; lng: number; radiusKm: number;
    driverBonus: number; minStandard: string | null; waitMaxMin: number | null;
    dedicated: boolean; surgeManual: number | null;
  }>;
}

export function driverAppConfig(settings: SettingsService): DriverAppConfig {
  const ops = settings.getOps();
  const pr = settings.getPricing();
  return {
    currency: 'XOF',
    offer: { timeoutSec: ops.offerTimeoutSec, mode: ops.offerMode },
    wait: { freeMinutes: pr.freeWaitMinutes, feePerMin: ops.waitFeePerMin },
    cancel: { graceMinutes: pr.cancelGraceMinutes, fee: pr.cancelFee },
    quality: { minRating: ops.minRating, autoWarn: ops.autoWarn },
    commission: {
      standard: ops.commissionStandard, green: ops.commissionGreen,
      loyalty: ops.commissionLoyalty, loyaltyRideThreshold: ops.loyaltyRideThreshold,
    },
    cashDebtLimit: ops.cashDebtLimit,
    offPeak: { bonus: ops.offPeakBonus, start: ops.offPeakStart, end: ops.offPeakEnd },
    longPickup: { thresholdKm: pr.longPickupThresholdKm, perKm: pr.longPickupPerKm },
    dispatch: { strategy: ops.strategy, greenPriority: ops.greenPriority, maxEtaMinutes: ops.maxEtaMinutes },
    zones: settings.getZones().filter((z) => z.active).map((z) => ({
      id: z.id, name: z.name, lat: z.lat, lng: z.lng, radiusKm: z.radiusKm,
      driverBonus: z.driverBonus ?? 0, minStandard: z.minStandard ?? null, waitMaxMin: z.waitMaxMin ?? null,
      dedicated: z.dedicated ?? false, surgeManual: z.surgeManual ?? null,
    })),
  };
}
