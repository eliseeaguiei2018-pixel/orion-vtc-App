/**
 * Pays d'exploitation ORION. Seule la Côte d'Ivoire est active et visible. Les autres pays
 * sont gardés ici pour une ouverture future (réglages par pays), mais ne sont publiés nulle
 * part : ni par la route /countries, ni dans les applications.
 */
export interface Country {
  code: string;
  name: string;
  flag: string;
  currency: string;
  dialCode: string;
  emergencySamu: string;
  status: 'active' | 'coming_soon';
}

export const COUNTRIES: Country[] = [
  { code: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮', currency: 'XOF', dialCode: '+225', emergencySamu: '185', status: 'active' },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'GHS', dialCode: '+233', emergencySamu: '193', status: 'coming_soon' },
  { code: 'SN', name: 'Sénégal', flag: '🇸🇳', currency: 'XOF', dialCode: '+221', emergencySamu: '1515', status: 'coming_soon' },
  { code: 'TG', name: 'Togo', flag: '🇹🇬', currency: 'XOF', dialCode: '+228', emergencySamu: '8200', status: 'coming_soon' },
  { code: 'BJ', name: 'Bénin', flag: '🇧🇯', currency: 'XOF', dialCode: '+229', emergencySamu: '112', status: 'coming_soon' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'NGN', dialCode: '+234', emergencySamu: '112', status: 'coming_soon' },
];
