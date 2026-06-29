export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place {
  id: string;
  name: string;
  area: string;
  location: LatLng;
  kind?: 'home' | 'work' | 'recent' | 'hub';
}

export type TierId = 'bronze' | 'argent' | 'or' | 'diamant';

export interface TierOption {
  id: TierId;
  /** Clé i18n du libellé (tier_bronze, …). */
  key: string;
  multiplier: number;
  capacity: number;
  eta: number; // minutes
  cars: string[];
  accent: string;
  weddingDayPrice: number;
}

export interface PaymentMethod {
  method: string;
  label: string;
  kind: 'cash' | 'mobile_money' | 'card';
}

export interface Quote {
  lockId: string;
  amount: number;
  currency: string;
  distanceMeters: number;
  etaSeconds: number;
  breakdown: { base: number; distance: number; time: number; surge: number; discount: number };
}

export interface Driver {
  name: string;
  rating: number;
  trips: number;
  plate: string;
  car: string;
  color: string;
}

export interface SubPlan {
  id: 'bronze' | 'argent' | 'gold';
  key: string;
  ridesPerDay: number;
  monthlyPrice: number;
  benefits: string[];
  accent: string;
}

export interface Country {
  code: string;
  name: string;
  flag: string;
  currency: string;
  dialCode: string;
  status: 'active' | 'coming_soon';
}

export type WeddingDuration = 'halfday' | 'fullday' | 'weekend';

export type Screen =
  | 'splash'
  | 'onboarding'
  | 'auth'
  | 'otp'
  | 'home'
  | 'destination'
  | 'estimate'
  | 'confirm'
  | 'searching'
  | 'tracking'
  | 'rating'
  | 'settings'
  | 'subscription'
  | 'wedding';
