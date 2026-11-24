import { randomUUID } from 'node:crypto';
import { config } from '../../../config/index.js';
import { badRequest } from '../../../core/errors.js';
import type { LatLng } from '../../../core/geo.js';
import type { EstimateRequest, Quote, ServiceModule } from '../types.js';
import { coefAjustement, DEFAULT_PRICING, distanceFacturee, type PricingContext } from '../ride/pricing.js';
import { isWithinCotedIvoire } from '../../geo-ci/zones.js';

/**
 * LIVRAISON À MOTO (coursier) — seconde implémentation du contrat ServiceModule.
 *
 * Le service était annoncé partout (bascule dans la console, tuile dans l'app cliente,
 * drapeau `services.delivery` de /config) mais AUCUN module ne l'implémentait : le
 * registre ne contenait que la course. L'app cliente simulait donc le coursier, même
 * backend connecté — aucune livraison n'était réellement enregistrée.
 *
 * Tarification alignée sur celle qu'affichait l'app cliente, pour que le prix annoncé
 * reste identique : base plus faible qu'une course, moto plus rapide (26 km/h), et un
 * facteur selon la taille du colis. Mêmes règles transverses que la course : trafic
 * intégré au prix (jamais facturé à part), codes promo de la console, TVA 5 % et frais
 * de service 10 % — le montant affiché est le montant payé (prix fixe garanti).
 */

/** Tailles de colis acceptées et leur facteur de prix (anciennes versions de l'app : moto). */
export const PACKAGE_FACTOR: Record<string, number> = { petit: 1, moyen: 1.12, grand: 1.25 };
export const DEFAULT_PACKAGE = 'moyen';

/**
 * FORMULES DE LIVRAISON (version 2.6) : la moto pour les petits colis, le CARGO (petit camion
 * électrique à caisse) pour les gros colis — électroménager, meubles, marchandises, petit
 * déménagement. Le cargo a sa propre flotte et coûte nettement plus cher : 4,5 fois le
 * barème coursier, avec un plancher six fois plus haut (chargement compris).
 */
export const FORMULES_LIVRAISON = {
  moto: { facteur: 1, plancher: 1, poidsMaxKg: 10, dimensionsCm: [40, 40, 40], vitesseKmh: 26, flotte: 'moto' },
  cargo: { facteur: 4.5, plancher: 6, poidsMaxKg: 1000, dimensionsCm: [250, 160, 160], vitesseKmh: 24, flotte: 'cargo' },
} as const;
export type FormuleLivraison = keyof typeof FORMULES_LIVRAISON;
export const estFormule = (c: string | undefined): c is FormuleLivraison => c === 'moto' || c === 'cargo';

/**
 * DÉLAI DE REMISE : qui n'est pas pressé paie moins. « Express » part tout de suite ; « sous 1 h »
 * et « sous 2 h » laissent au coursier une fenêtre plus large (il peut grouper ses livraisons).
 */
export const DELAIS_LIVRAISON = {
  express: { facteur: 1, minutes: 0 },
  heure: { facteur: 0.9, minutes: 60 },
  deux_heures: { facteur: 0.75, minutes: 120 },
} as const;
/** Options payantes (F CFA, hors taxes) : porte-à-porte et sac isotherme (moto). */
export const SUPPLEMENTS_LIVRAISON = { portePorte: 150, isotherme: 100 } as const;

/**
 * Barème coursier (F CFA) — distinct de celui des voitures et DÉLIBÉRÉMENT moins cher.
 *
 * Le barème hérité de la maquette faisait payer une livraison 22 à 30 % de PLUS qu'une
 * course Argent sur le même trajet, ce qui est commercialement à l'envers : une moto
 * transportant un colis coûte moins cher à exploiter qu'une voiture transportant une
 * personne, et le client n'occupe pas le véhicule. Le barème vise désormais environ
 * 70 % du prix d'une course Argent, le plancher protégeant les très courtes distances.
 */
export const DELIVERY_TARIFF = {
  baseFare: 145,
  // Motos électriques : même baisse que les courses (grille calée sur les vrais prix Yango).
  perKm: 46,
  perMinute: 4,
  minFare: 400,
  avgSpeedKmh: 26, // la moto se faufile : plus rapide qu'une voiture en ville
  currency: 'XOF',
} as const;

export type DeliveryContextProvider = (req: EstimateRequest) => PricingContext | Promise<PricingContext>;

const roundFcfa = (n: number) => Math.round(n / 50) * 50;


export class DeliveryServiceModule implements ServiceModule {
  readonly type = 'delivery' as const;
  readonly supplyKind = 'courier' as const;

  constructor(private readonly contextProvider: DeliveryContextProvider = () => ({})) {}

  async estimate(req: EstimateRequest): Promise<Quote> {
    if (!isFinite(req.origin?.lat) || !isFinite(req.destination?.lat)) {
      throw badRequest('Coordonnées origine/destination requises');
    }
    if (!isWithinCotedIvoire(req.origin) || !isWithinCotedIvoire(req.destination)) {
      throw badRequest('Livraison hors zone de service (Côte d\'Ivoire)', { code: 'OUT_OF_SERVICE_AREA' });
    }

    const ctx = await this.contextProvider(req);
    const s = ctx.settings ?? DEFAULT_PRICING;
    // `category` : la formule (moto | voiture), ou la taille du colis des anciennes versions
    // de l'app (petit | moyen | grand, toutes à moto).
    const formule: FormuleLivraison = estFormule(req.category) ? req.category : 'moto';
    const size = estFormule(req.category) ? req.category : req.category && PACKAGE_FACTOR[req.category] ? req.category : DEFAULT_PACKAGE;
    const sizeFactor = estFormule(req.category) ? FORMULES_LIVRAISON[formule].facteur : PACKAGE_FACTOR[size]!;
    const vitesse = FORMULES_LIVRAISON[formule].vitesseKmh;
    const delai = req.livraison?.delai && req.livraison.delai in DELAIS_LIVRAISON ? req.livraison.delai : 'express';
    const portePorte = Boolean(req.livraison?.portePorte);
    const isotherme = formule === 'moto' && Boolean(req.livraison?.isotherme);
    const fragile = Boolean(req.livraison?.fragile);

    const stops = req.stops ?? [];
    // Distance par la route, comme pour une course (voir `distanceFacturee`).
    const distanceMeters = distanceFacturee(req.origin, req.destination, stops, ctx.routeMeters);
    const distanceKm = distanceMeters / 1000;
    const trafficFactor = Math.max(1, ctx.trafficFactor ?? 1);
    // ETA informative : allongée par le trafic. Temps FACTURÉ : à vitesse libre, pour
    // ne pas faire payer les embouteillages au client.
    const etaSeconds = Math.round((distanceKm / vitesse) * 3600 * trafficFactor);
    const minutes = (distanceKm / vitesse) * 60;

    const base = DELIVERY_TARIFF.baseFare * sizeFactor;
    const distanceCost = distanceKm * DELIVERY_TARIFF.perKm * sizeFactor;
    const timeCost = minutes * DELIVERY_TARIFF.perMinute * sizeFactor;

    // Trafic adouci et intégré au prix (pas de ligne « supplément » séparée).
    const trafficMult = 1 + (trafficFactor - 1) * s.trafficWeight;
    const zoneFactor = Math.max(0.1, ctx.zoneFactor ?? 1);
    const surge = Math.max(1, ctx.surgeMultiplier ?? 1);
    const metered = (base + distanceCost + timeCost) * trafficMult * zoneFactor * surge;
    const plancher = DELIVERY_TARIFF.minFare * FORMULES_LIVRAISON[formule].plancher;
    // Réglage des prix de la direction (Mon poste PDG, hausse ou baisse) : il vaut pour les
    // livraisons comme pour les courses — trajet, plancher et options compris.
    const coef = coefAjustement(s);
    const floored = Math.max(metered, plancher) * coef;
    // Délai souple : remise sur le trajet. Options : ajoutées après la remise (prix fixe).
    const remiseDelai = floored * (1 - DELAIS_LIVRAISON[delai].facteur);
    const options = ((portePorte ? SUPPLEMENTS_LIVRAISON.portePorte : 0) + (isotherme ? SUPPLEMENTS_LIVRAISON.isotherme : 0)) * coef;
    const avantPromo = floored - remiseDelai + options;

    // Codes promo de la console (montant calculé prioritaire sur un taux).
    const discountRate = Math.min(1, Math.max(0, ctx.discountRate ?? 0));
    const promo = ctx.promoDiscount ? ctx.promoDiscount(avantPromo) : 0;
    const discount = Math.min(avantPromo, promo > 0 ? promo : avantPromo * discountRate);

    const subtotal = avantPromo - discount;
    const tva = subtotal * s.tvaRate;
    const fee = subtotal * s.feeRate;
    const amount = roundFcfa(subtotal + tva + fee);

    return {
      lockId: randomUUID(),
      serviceType: this.type,
      category: size,
      amount,
      currency: DELIVERY_TARIFF.currency,
      origin: req.origin,
      destination: req.destination,
      stops: req.stops,
      distanceMeters: Math.round(distanceMeters),
      etaSeconds,
      trafficLevel: ctx.trafficLevel ?? 'fluid',
      breakdown: {
        base: Math.round(base),
        distance: Math.round(distanceCost),
        time: Math.round(timeCost),
        surge,
        traffic: 0, // intégré au prix, jamais facturé à part
        discount: Math.round(discount),
        subtotal: Math.round(subtotal),
        tva: Math.round(tva),
        fee: Math.round(fee),
        insurance: 0, // l'assurance ORION couvre les personnes, pas les colis
        ...(remiseDelai > 0 ? { remiseDelai: Math.round(remiseDelai) } : {}),
        ...(options > 0 ? { options: Math.round(options) } : {}),
      },
      livraison: { formule, delai, ...(portePorte ? { portePorte } : {}), ...(isotherme ? { isotherme } : {}), ...(fragile ? { fragile } : {}) },
      expiresAt: new Date(Date.now() + config.QUOTE_TTL_SECONDS * 1000).toISOString(),
    };
  }
}
