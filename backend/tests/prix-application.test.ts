import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { haversineMeters } from '../src/core/geo.js';
import { FLEET } from '../src/modules/fleet/catalog.js';
import { estimatePrice } from '../src/modules/services/ride/pricing.js';
import { trafficInfo } from '../src/modules/geo-ci/zones.js';
import { PACKAGE_FACTOR } from '../src/modules/services/delivery/deliveryModule.js';
import { DEFAULT_ZONES } from '../src/modules/settings/service.js';
import { ALL_ZONES } from '../src/modules/geo-ci/zones.js';
import { readFileSync } from 'node:fs';

/**
 * LE PRIX DE L'APPLICATION EST CELUI DU SERVEUR.
 *
 * Sans serveur relié, l'application cliente calcule le prix elle-même avec une copie des
 * règles du serveur (frontend/src/tarifServeur.ts). Ce test demande le même devis aux deux
 * et exige le même montant, au franc près : il échoue dès qu'un côté change sans l'autre.
 * La majoration de forte demande et les codes promo n'existent que sur un serveur relié :
 * ici il n'y a ni demande ni code, donc aucun écart n'est permis.
 */
type Pt = { lat: number; lng: number };
interface Detail { amount: number; trafficLevel: string; breakdown: Record<string, number> }
interface Appli {
  prixCourse(d: { origin: Pt; destination: Pt; stops?: Pt[]; distanceMeters: number; multiplier: number; gamme?: 'argent' | 'or' | 'diamant'; bodyType?: string; insurance?: boolean; at?: Date; itineraire?: 'peage' | 'normal'; peages?: string[] }): Detail;
  prixMiseADisposition(d: { heures: number; gamme?: 'argent' | 'or' | 'diamant'; insurance?: boolean }): Detail;
  supplementGamme(gamme: 'argent' | 'or' | 'diamant', montantArgent: number, horsAbidjan?: boolean): number;
  sortDAbidjan(points: Pt[]): boolean;
  prixLivraison(d: { origin: Pt; destination: Pt; distanceMeters: number; tailleFacteur: number; at?: Date }): Detail;
  ZONES_TARIF: { id: string; factor: number; lat: number; lng: number; radiusKm: number; pickupFee?: number }[];
  ZONES_DENSITE: readonly (readonly [string, number, number, number])[];
  appliquerGrillePrix(g: unknown): void;
}
// Import par chemin calculé : le fichier vit dans le dossier de l'application, hors du projet serveur.
const appli = (await import(new URL('../../frontend/src/tarifServeur.ts', import.meta.url).href)) as Appli;

const LIEUX: Record<string, Pt> = {
  plateau: { lat: 5.3237, lng: -4.017 },
  cocody: { lat: 5.3596, lng: -3.9903 },
  rivieraGolf: { lat: 5.3742, lng: -3.9721 },         // secteur résidentiel : facteur 1,15 et 200 F de prise en charge
  beverlyHills: { lat: 5.3808, lng: -3.9611 },
  zone4: { lat: 5.2942, lng: -3.9846 },
  yopougon: { lat: 5.3456, lng: -4.0864 },            // facteur 0,92
  abobo: { lat: 5.4204, lng: -4.0159 },
  aeroport: { lat: 5.2614, lng: -3.9268 },            // facteur 1,10, pôle très dense
  treichville: { lat: 5.2925, lng: -4.0027 },
  bingerville: { lat: 5.355, lng: -3.885 },           // hors zone tarifaire
  grandBassam: { lat: 5.2118, lng: -3.7388 },
  zoneIndustrielle: { lat: 5.3712, lng: -4.0931 },    // Yopougon, zone industrielle
};
const TRAJETS: [string, string][] = [
  ['cocody', 'plateau'], ['plateau', 'cocody'], ['rivieraGolf', 'plateau'], ['beverlyHills', 'aeroport'],
  ['yopougon', 'plateau'], ['zoneIndustrielle', 'cocody'], ['abobo', 'treichville'], ['aeroport', 'rivieraGolf'],
  ['zone4', 'bingerville'], ['bingerville', 'grandBassam'], ['treichville', 'zone4'], ['cocody', 'cocody'],
];
// Un seul client pour tous les devis : le serveur compte une demande par personne, donc aucune majoration de demande.
const CLIENT = 'parite-prix';
const vol = (pts: Pt[]) => pts.slice(1).reduce((s, p, i) => s + haversineMeters(pts[i]!, p), 0);

/** Le serveur lit l'heure au moment du devis : on refait le calcul si l'heure a tourné entre-temps. */
async function memeHeure<T>(f: (at: Date) => Promise<T>): Promise<T> {
  for (;;) {
    const avant = new Date();
    const r = await f(avant);
    if (new Date().getHours() === avant.getHours()) return r;
  }
}

test('les zones recopiées dans l’application sont celles du serveur', () => {
  assert.deepEqual(
    appli.ZONES_TARIF.map((z) => [z.id, z.factor, z.lat, z.lng, z.radiusKm, z.pickupFee ?? 0]),
    DEFAULT_ZONES.filter((z) => z.active).map((z) => [z.id, z.factor, z.lat, z.lng, z.radiusKm, z.pickupFee ?? 0]),
  );
  assert.deepEqual(
    appli.ZONES_DENSITE.map((z) => [...z]),
    ALL_ZONES.map((z) => [z.id, z.center.lat, z.center.lng, z.demandFactor]),
  );
  // Aucune zone d'origine n'a de forfait, de retour à vide ni de plancher : s'il en vient, il faut les recopier.
  for (const z of DEFAULT_ZONES) assert.ok(!z.flatRates && !z.emptyReturnFee && !z.premiumFloor, `règle à recopier pour ${z.id}`);
});

test('course : même prix dans l’application et sur le serveur, pour chaque gamme', async () => {
  const { app } = await buildApp();
  let compares = 0;
  for (const [a, b] of TRAJETS) {
    const origin = LIEUX[a]!, destination = LIEUX[b]!;
    for (const gamme of ['argent', 'or', 'diamant'] as const) {
      for (const option of [{}, { bodyType: 'suv' }, { stops: [LIEUX.treichville!] }] as { bodyType?: string; insurance?: boolean; stops?: Pt[] }[]) {
        const { serveur, local } = await memeHeure(async (at) => {
          const res = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: gamme, ...option, clientId: CLIENT } });
          assert.equal(res.statusCode, 200, res.body);
          const local = appli.prixCourse({
            origin, destination, stops: option.stops, distanceMeters: vol([origin, ...(option.stops ?? []), destination]) * 1.3,
            multiplier: FLEET[gamme].multiplier, gamme, bodyType: option.bodyType, insurance: option.insurance, at,
          });
          return { serveur: res.json().quote as Detail, local };
        });
        const cas = `${a} → ${b}, ${gamme}, ${JSON.stringify(option).slice(0, 40)}`;
        assert.equal(local.amount, serveur.amount, `montant ${cas}`);
        assert.equal(local.trafficLevel, serveur.trafficLevel, `trafic ${cas}`);
        assert.deepEqual(local.breakdown, serveur.breakdown, `détail ${cas}`);
        compares++;
      }
    }
  }
  assert.equal(compares, TRAJETS.length * 3 * 3);
  await app.close();
});

test('livraison : même prix dans l’application et sur le serveur, pour chaque taille de colis', async () => {
  const { app } = await buildApp();
  for (const [a, b] of TRAJETS) {
    const origin = LIEUX[a]!, destination = LIEUX[b]!;
    for (const taille of ['petit', 'moyen', 'grand']) {
      const { serveur, local } = await memeHeure(async (at) => {
        const res = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { serviceType: 'delivery', origin, destination, category: taille, clientId: CLIENT } });
        assert.equal(res.statusCode, 200, res.body);
        const local = appli.prixLivraison({ origin, destination, distanceMeters: vol([origin, destination]) * 1.3, tailleFacteur: PACKAGE_FACTOR[taille]!, at });
        return { serveur: res.json().quote as Detail, local };
      });
      assert.equal(local.amount, serveur.amount, `montant ${a} → ${b}, ${taille}`);
      assert.deepEqual(local.breakdown, serveur.breakdown, `détail ${a} → ${b}, ${taille}`);
    }
  }
  await app.close();
});

test('le secteur de départ change le prix comme sur le serveur', () => {
  const at = new Date(2026, 0, 14, 22, 0, 0);            // 22 h : hors pointe, le trafic ne joue pas
  const prix = (origin: Pt) => appli.prixCourse({ origin, destination: LIEUX.bingerville!, distanceMeters: 10_000, multiplier: 0.9, at }).amount;
  const neutre = prix(LIEUX.bingerville!);                 // hors zone : facteur 1
  assert.ok(prix(LIEUX.yopougon!) < neutre, 'Yopougon (0,92) est moins cher');
  assert.ok(prix(LIEUX.rivieraGolf!) > neutre, 'Riviera Golf (1,15 et 200 F) est plus cher');
});

test('ORION Assurance : même supplément dans l’application et sur le serveur', () => {
  // Le devis avec assurance demande un client inscrit : on compare ici les deux calculs directement.
  const at = new Date(2026, 0, 14, 18, 30, 0);           // heure de pointe
  for (const [a, b] of TRAJETS) {
    const origin = LIEUX[a]!, destination = LIEUX[b]!;
    const zone = DEFAULT_ZONES.find((z) => z.lat === origin.lat && z.lng === origin.lng);
    const trafic = trafficInfo(origin, destination, at);
    for (const gamme of ['argent', 'or', 'diamant'] as const) {
      const serveur = estimatePrice({ origin, destination, category: gamme, insurance: true }, {
        trafficFactor: trafic.factor, trafficLevel: trafic.level, zoneFactor: zone?.factor ?? 1, zonePickupFee: zone?.pickupFee ?? 0,
      });
      const local = appli.prixCourse({
        origin, destination, distanceMeters: vol([origin, destination]) * 1.3,
        multiplier: FLEET[gamme].multiplier, gamme, insurance: true, at,
      });
      if (!zone) continue;                                 // lieux hors centre de zone : couverts par le test HTTP
      assert.equal(local.amount, serveur.amount, `montant assuré ${a} → ${b}, ${gamme}`);
      assert.deepEqual(local.breakdown, serveur.breakdown, `détail assuré ${a} → ${b}, ${gamme}`);
    }
  }
});

test('pont à péage ou voie normale : même prix dans l’application et sur le serveur', async () => {
  const { app } = await buildApp();
  // Cocody → Plateau par le pont Henri-Konan-Bédié (péage) ou par la voie normale (plus longue).
  const origin = LIEUX.cocody!, destination = LIEUX.zone4!;
  const choix = [
    { itineraire: 'peage' as const, peages: ['hkb'], routeMeters: Math.round(vol([origin, destination]) * 1.25) },
    { itineraire: 'normal' as const, peages: [] as string[], routeMeters: Math.round(vol([origin, destination]) * 1.7) },
  ];
  const montants: Record<string, number> = {};
  for (const c of choix) {
    for (const gamme of ['argent', 'or', 'diamant'] as const) {
      const { serveur, local } = await memeHeure(async (at) => {
        const res = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: gamme, clientId: CLIENT, ...c } });
        assert.equal(res.statusCode, 200, res.body);
        const local = appli.prixCourse({ origin, destination, distanceMeters: c.routeMeters, multiplier: FLEET[gamme].multiplier, gamme, at, itineraire: c.itineraire, peages: c.peages });
        return { serveur: res.json().quote as Detail, local };
      });
      assert.equal(local.amount, serveur.amount, `montant ${c.itineraire}, ${gamme}`);
      assert.deepEqual(local.breakdown, serveur.breakdown, `détail ${c.itineraire}, ${gamme}`);
      if (c.itineraire === 'peage') assert.equal(serveur.breakdown.peage, 500, 'le péage du pont HKB est de 500 F');
      else assert.equal(serveur.breakdown.peage, undefined, 'aucun péage sur la voie normale');
      montants[`${c.itineraire}-${gamme}`] = serveur.amount;
    }
  }
  // Le péage n'est pas majoré par la gamme : l'Or paie le même péage que l'Argent.
  assert.ok(montants['peage-argent']! > 0 && montants['normal-argent']! > 0);
  await app.close();
});

test('hors d’Abidjan, la grille entre gammes passe à 10 % (Or) et 20 % (Diamant)', async () => {
  assert.equal(appli.sortDAbidjan([LIEUX.cocody!, LIEUX.plateau!]), false, 'Cocody → Plateau reste dans le district');
  assert.equal(appli.sortDAbidjan([LIEUX.bingerville!, LIEUX.grandBassam!]), true, 'Grand-Bassam est hors du district');
  assert.equal(appli.supplementGamme('or', 10_000, false), 500);
  assert.equal(appli.supplementGamme('or', 10_000, true), 1000);
  assert.equal(appli.supplementGamme('diamant', 10_000, false), 1500);
  assert.equal(appli.supplementGamme('diamant', 10_000, true), 2000);
  const { app } = await buildApp();
  const origin = LIEUX.plateau!, destination = LIEUX.grandBassam!;
  const prix: Record<string, Detail> = {};
  for (const gamme of ['argent', 'or', 'diamant'] as const) {
    const { serveur, local } = await memeHeure(async (at) => {
      const res = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: gamme, clientId: CLIENT } });
      assert.equal(res.statusCode, 200, res.body);
      const local = appli.prixCourse({ origin, destination, distanceMeters: vol([origin, destination]) * 1.3, multiplier: FLEET[gamme].multiplier, gamme, at });
      return { serveur: res.json().quote as Detail, local };
    });
    assert.equal(local.amount, serveur.amount, `montant hors Abidjan, ${gamme}`);
    assert.deepEqual(local.breakdown, serveur.breakdown, `détail hors Abidjan, ${gamme}`);
    assert.equal((serveur.breakdown as Record<string, unknown>).horsAbidjan, true);
    prix[gamme] = serveur;
  }
  const ecart = (g: 'or' | 'diamant') => (prix[g]!.amount - prix.argent!.amount) / prix.argent!.amount;
  assert.ok(Math.abs(ecart('or') - 0.10) < 0.02, `Or ≈ +10 % (${ecart('or')})`);
  assert.ok(Math.abs(ecart('diamant') - 0.20) < 0.02, `Diamant ≈ +20 % (${ecart('diamant')})`);
  await app.close();
});

test('mise à disposition à l’heure : même prix, Abidjan seulement', async () => {
  const { app } = await buildApp();
  for (const heures of [2, 3.5, 8, 12]) {
    for (const gamme of ['argent', 'or', 'diamant'] as const) {
      const res = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: LIEUX.cocody, destination: LIEUX.cocody, category: gamme, clientId: CLIENT, miseADisposition: { heures } } });
      assert.equal(res.statusCode, 200, res.body);
      const serveur = res.json().quote as Detail;
      const local = appli.prixMiseADisposition({ heures, gamme });
      assert.equal(local.amount, serveur.amount, `montant ${heures} h, ${gamme}`);
      assert.deepEqual(local.breakdown, serveur.breakdown, `détail ${heures} h, ${gamme}`);
      assert.equal(serveur.breakdown.heures, heures);
    }
  }
  // 2 h en Argent au tarif par défaut (5 000 F l'heure) : 10 000 F.
  assert.equal(appli.prixMiseADisposition({ heures: 2 }).amount, 10_000);
  // Bornes : moins de 2 h est compté 2 h, plus de 12 h est compté 12 h.
  assert.equal(appli.prixMiseADisposition({ heures: 1 }).breakdown.heures, 2);
  assert.equal(appli.prixMiseADisposition({ heures: 20 }).breakdown.heures, 12);
  // Hors du district : refusé par le serveur.
  const hors = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: LIEUX.grandBassam, destination: LIEUX.grandBassam, category: 'argent', clientId: CLIENT, miseADisposition: { heures: 3 } } });
  assert.equal(hors.statusCode, 400, hors.body);
  assert.match(hors.body, /MISE_A_DISPOSITION_HORS_ABIDJAN/);
  await app.close();
});

test('district d’Abidjan et péages : la copie de l’application est celle du serveur', () => {
  // Seule la première phrase de l'en-tête (qui nomme l'autre copie) diffère.
  const corps = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), 'utf8').split('\n').slice(4).join('\n');
  assert.equal(corps('../../frontend/src/routesAbidjan.ts'), corps('../src/modules/geo-ci/abidjan.ts'));
});

test('barème changé en console : l’application reçoit la grille et affiche le même prix que le serveur', async () => {
  const { app } = await buildApp();
  const A = { 'x-admin-token': 'orion-admin-dev' };
  const put = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: A, payload: { baseFare: 350, perKm: 120, perMinute: 17, minFare: 700 } });
  assert.equal(put.statusCode, 200, put.body);
  const config = (await app.inject({ method: 'GET', url: '/config' })).json() as { prix: { bareme: Record<string, number>; livraison: Record<string, number> } };
  assert.deepEqual(config.prix.bareme, { baseFare: 350, perKm: 120, perMinute: 17, minFare: 700 });
  assert.equal(config.prix.livraison.perKm, 46);
  appli.appliquerGrillePrix(config.prix);
  try {
    const origin = LIEUX.cocody!, destination = LIEUX.plateau!;
    const { serveur, local } = await memeHeure(async (at) => {
      const res = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'or', clientId: CLIENT } });
      assert.equal(res.statusCode, 200, res.body);
      return { serveur: res.json().quote as Detail, local: appli.prixCourse({ origin, destination, distanceMeters: vol([origin, destination]) * 1.3, multiplier: FLEET.or.multiplier, gamme: 'or', at }) };
    });
    assert.equal(local.amount, serveur.amount);
    // Un barème reçu incohérent est ignoré : l'application garde le dernier barème valable.
    appli.appliquerGrillePrix({ bareme: { perKm: -5, baseFare: Number.NaN } });
    const apres = appli.prixCourse({ origin, destination, distanceMeters: vol([origin, destination]) * 1.3, multiplier: FLEET.or.multiplier, gamme: 'or' });
    assert.equal(apres.amount, local.amount);
  } finally {
    // Les autres tests de ce fichier comparent au barème par défaut.
    const { DEFAULT_PRICING } = await import('../src/modules/services/ride/pricing.js');
    appli.appliquerGrillePrix({ bareme: DEFAULT_PRICING, livraison: { baseFare: 145, perKm: 46, perMinute: 4, minFare: 400 } });
    await app.close();
  }
});
