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

export interface Vehicle {
  id: string;
  label: string;
  tagline: string;
  multiplier: number;
  capacity: number;
  eta: number; // minutes
  icon: 'eco' | 'green' | 'comfort' | 'van';
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

export type Screen =
  | 'onboarding'
  | 'home'
  | 'destination'
  | 'estimate'
  | 'confirm'
  | 'searching'
  | 'tracking'
  | 'rating';
