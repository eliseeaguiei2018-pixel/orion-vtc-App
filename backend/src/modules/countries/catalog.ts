/**
 * Pays d'exploitation ORION. La Côte d'Ivoire est active ; l'expansion sous-régionale
 * (Ghana, Sénégal, Togo, Bénin, Nigeria) est planifiée. La structure permet d'activer un
 * pays sans changement de code (config par pays).
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
