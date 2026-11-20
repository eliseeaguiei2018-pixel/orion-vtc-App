/**
 * Règles de conformité KYC paramétrables par juridiction (cf. docs/03).
 * En production : table `compliance_rules`. Ici : valeurs de référence.
 */
export interface ComplianceRule {
  jurisdiction: string;
  minDriverAge: number;
  minLicenseYears: number;
  greenThreshold: { type: 'co2_g_km'; max: number };
  requiredDriverDocs: string[];
  requiredVehicleDocs: string[];
  criminalRecordMaxAgeDays: number;
}

export const COMPLIANCE_RULES: Record<string, ComplianceRule> = {
  FR: {
    jurisdiction: 'FR',
    minDriverAge: 21,
    minLicenseYears: 3,
    greenThreshold: { type: 'co2_g_km', max: 50 },
    requiredDriverDocs: [
      'ID',
      'DRIVING_LICENSE',
      'VTC_CARD',
      'CRIMINAL_RECORD',
      'PROOF_OF_ADDRESS',
      'TAX_STATUS',
      'BANK_DETAILS',
      'PROFILE_PHOTO',
    ],
    requiredVehicleDocs: [
      'VEHICLE_REGISTRATION',
      'INSURANCE_TRANSPORT',
      'TECHNICAL_INSPECTION',
      'GREEN_COMPLIANCE',
      'VEHICLE_PHOTOS',
    ],
    criminalRecordMaxAgeDays: 90,
  },
};

export const DEFAULT_JURISDICTION = 'FR';

export interface SubmittedDoc {
  type: string;
  expiresAt?: string; // ISO date
}

export interface ComplianceResult {
  eligible: boolean;
  missingDriverDocs: string[];
  missingVehicleDocs: string[];
  expiredDocs: string[];
}

/**
 * Évalue l'éligibilité d'un dossier chauffeur : documents requis présents et non expirés.
 * Logique pure → testable et déterministe.
 */
export function evaluateCompliance(
  jurisdiction: string,
  driverDocs: SubmittedDoc[],
  vehicleDocs: SubmittedDoc[],
  now = new Date(),
): ComplianceResult {
  const rule = COMPLIANCE_RULES[jurisdiction] ?? COMPLIANCE_RULES[DEFAULT_JURISDICTION]!;
  const driverTypes = new Set(driverDocs.map((d) => d.type));
  const vehicleTypes = new Set(vehicleDocs.map((d) => d.type));

  const missingDriverDocs = rule.requiredDriverDocs.filter((t) => !driverTypes.has(t));
  const missingVehicleDocs = rule.requiredVehicleDocs.filter((t) => !vehicleTypes.has(t));

  const expiredDocs = [...driverDocs, ...vehicleDocs]
    .filter((d) => d.expiresAt && new Date(d.expiresAt).getTime() <= now.getTime())
    .map((d) => d.type);

  const eligible =
    missingDriverDocs.length === 0 &&
    missingVehicleDocs.length === 0 &&
    expiredDocs.length === 0;

  return { eligible, missingDriverDocs, missingVehicleDocs, expiredDocs };
}
