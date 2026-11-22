import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as CarteML, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { chargerML } from './chargerCarte';
import type { LatLng } from '../types';
import { useTheme } from '../theme';
import type { VectorConfig } from '../mapConfig';
import { ajouterFeuxEtPeages, marquerPeages } from '../carteFeux';
import { itineraire, type ItineraireRoute } from '../api';
import { styleOrion } from './styleCarte';
import { comblerCarte } from '../lieux';
import { nomVoitureDessus, rendu } from './Vehicules';

/**
 * VRAIE CARTE (MapLibre, données OpenStreetMap) : l'itinéraire suit les routes,
 * franchit la lagune par les ponts, passe les échangeurs. Le véhicule glisse le long
 * du tracé et s'oriente dans le sens de la marche.
 *
 * Si la carte ne se charge pas (hors-ligne, tuiles injoignables), `onEchec` rend la
 * main à la carte stylisée : rien ne bloque la course.
 */
interface Props {
  origin: LatLng;
  destination?: LatLng | null;
  stops?: LatLng[];
  car?: LatLng | null;
  vehicle?: 'car' | 'moto';
  /** Trajet d'approche du chauffeur vers le départ (pointillés). */
  approche?: boolean;
  config: VectorConfig;
  onEchec: () => void;
  /** Part de l'écran couverte par la feuille du bas : l'itinéraire se cadre au-dessus. */
  basCouvert?: number;
  /**
   * Navigation guidée (app chauffeur) : tracé fourni par l'appelant (partie restant à
   * parcourir), au lieu d'un itinéraire calculé ici.
   */
  trace?: LatLng[] | null;
  /** Ponts du tracé fourni (bandeau « via »). */
  ponts?: string[];
  /** Mode navigation : la carte suit le véhicule, orientée dans le sens de la marche. */
  suivi?: boolean;
  /** Libellé du bouton qui reprend le suivi après un déplacement manuel de la carte. */
  libelleRecentrer?: string;
  /** Position réelle du téléphone (« vous êtes ici »), après une actualisation du GPS. */
  moi?: LatLng | null;
  /** Péages de l'itinéraire choisi : mis en avant sur la carte. */
  peages?: { id: string }[];
}


const couleur = (v: string, defaut: string) => {
  const c = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  return c || defaut;
};

/** Repères du véhicule sur la carte : rendus 3D vus de dessus, nez vers le haut. */
const repere = (nom: string, largeur: number) =>
  `<img src="${rendu(nom)}" width="${largeur}" height="${largeur * 2}" alt="" draggable="false" />`;

function element(classe: string, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = classe;
  d.innerHTML = html;
  return d;
}

const cap = (a: LatLng, b: LatLng) => {
  const y = Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
  const x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180)
    - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180);
  return (Math.atan2(y, x) * 180) / Math.PI;
};

export function CarteReelle({ origin, destination, stops = [], car, vehicle = 'car', approche = false, config, onEchec, basCouvert = 0.46, trace, ponts, suivi = false, libelleRecentrer = 'Recentrer', moi, peages }: Props) {
  const { resolved, accent } = useTheme();
  const boite = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteML | null>(null);
  const marqueurs = useRef<{ depart?: Marker; arrivee?: Marker; arrets: Marker[]; vehicule?: Marker; moi?: Marker }>({ arrets: [] });
  const [prete, setPrete] = useState(false);
  const [route, setRoute] = useState<ItineraireRoute | null>(null);
  const [routeApproche, setRouteApproche] = useState<LatLng[] | null>(null);
  const derniere = useRef<{ pos: LatLng; angle: number } | null>(null);
  const echecSignale = useRef(false);
  // Suivi du véhicule interrompu quand le chauffeur déplace la carte à la main.
  const [libre, setLibre] = useState(false);
  const suit = suivi && !libre;
  const suitRef = useRef(suit);
  suitRef.current = suit;
  const traceExterne = trace !== undefined;

  // 1. Création de la carte (recréée au changement clair/sombre : autre fond).
  useEffect(() => {
    let annule = false;
    let instance: CarteML | null = null;
    const echec = () => { if (!echecSignale.current) { echecSignale.current = true; onEchec(); } };
    // « loaded() » répond vrai quand la source de tuiles a échoué sans rien charger : on se fie
    // à l'ouverture effective de la carte (événement « load »).
    let ouverte = false;
    const delai = window.setTimeout(() => { if (!ouverte) echec(); }, 12_000);
    // Fond de carte injoignable APRÈS l'ouverture (réseau faible, serveur de tuiles bloqué) :
    // si aucune tuile n'arrive, la carte stylisée prend le relais au lieu d'un écran vide.
    let tuileRecue = false;
    let delaiTuiles = 0;
    void chargerML().then((ml) => {
      if (annule || !boite.current) return;
      instance = new ml.Map({
        container: boite.current,
        style: styleOrion(resolved === 'light' ? 'light' : 'dark', config),
        center: [origin.lng, origin.lat],
        zoom: 13.6,
        attributionControl: false,
        fadeDuration: 120,
        dragRotate: false,
        pitchWithRotate: false,
      });
      instance.addControl(new ml.AttributionControl({ compact: true, customAttribution: config.attribution }), 'top-left');
      instance.on('error', (e) => { if (!instance?.loaded() && /Failed to fetch|NetworkError|AJAXError/i.test(String((e as unknown as { error?: { message?: string } }).error?.message ?? ''))) echec(); });
      instance.on('sourcedata', (e) => { if ((e as unknown as { tile?: unknown }).tile) tuileRecue = true; });
      instance.on('load', () => {
        ouverte = true;
        window.clearTimeout(delai);
        delaiTuiles = window.setTimeout(() => { if (!tuileRecue && !annule) echec(); }, 15_000);
        // Mention OpenStreetMap repliée sur le bouton « i » : elle ne masque pas la carte.
        boite.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        const m = instance!;
        m.addSource('route', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
        m.addSource('approche', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'approche', type: 'line', source: 'approche', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': couleur('--green', '#00e08a'), 'line-width': 4, 'line-dasharray': [0.1, 1.8], 'line-opacity': 0.9 } });
        m.addLayer({ id: 'route-bord', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': resolved === 'light' ? '#ffffff' : '#04100b', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 13], 'line-opacity': 0.95 } });
        m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4.5, 16, 8.5], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, couleur('--green-bright', '#2bffa6'), 1, couleur('--green-deep', '#00b46e')] } });
        // Feux tricolores du district et postes de péage (visibles en zoomant).
        ajouterFeuxEtPeages(m, resolved !== 'light', [config.policesLocales ? 'NotoSansRegular' : 'Noto Sans Regular']);
        // Carte « comblée » : dès que l'index des lieux est chargé, la carte affiche tous ses
        // lieux et masque ceux des tuiles (un sous-ensemble du même répertoire).
        if (config.lieuxIndex) comblerCarte(m, () => annule);
        // Un geste de l'utilisateur (pas un mouvement programmé) suspend le suivi.
        m.on('dragstart', (e) => { if ((e as { originalEvent?: unknown }).originalEvent) setLibre(true); });
        carte.current = m;
        setPrete(true);
      });
    }).catch(echec);
    return () => {
      annule = true;
      window.clearTimeout(delai);
      window.clearTimeout(delaiTuiles);
      instance?.remove();
      carte.current = null;
      marqueurs.current = { arrets: [] };
      setPrete(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  // 2. Couleur de l'itinéraire = couleur choisie par le client.
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    const id = window.setTimeout(() => {
      m.setPaintProperty('route', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, couleur('--green-bright', '#2bffa6'), 1, couleur('--green-deep', '#00b46e')]);
      m.setPaintProperty('approche', 'line-color', couleur('--green', '#00e08a'));
    }, 60);
    return () => window.clearTimeout(id);
  }, [accent, prete]);

  // 3. Itinéraire réel (départ, arrêts, arrivée).
  const cleTrajet = destination ? [origin, ...stops, destination].map((p) => `${p.lat},${p.lng}`).join(';') : '';
  useEffect(() => {
    if (!destination || traceExterne) { setRoute(null); return; }
    let actif = true;
    void itineraire([origin, ...stops, destination]).then((r) => { if (actif) setRoute(r); });
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleTrajet]);

  // 4. Approche du chauffeur (calculée une fois, depuis sa première position connue).
  const approcheCalculee = useRef(false);
  useEffect(() => {
    if (!approche || !car || approcheCalculee.current) { if (!approche) { setRouteApproche(null); approcheCalculee.current = false; } return; }
    approcheCalculee.current = true;
    void itineraire([car, origin]).then((r) => setRouteApproche(r?.geometrie ?? [car, origin]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approche, car]);

  // 5. Tracés et cadrage.
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    const geo = (traceExterne ? trace : null) ?? route?.geometrie ?? (destination ? [origin, ...stops, destination] : []);
    (m.getSource('route') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: geo.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geo.map((p) => [p.lng, p.lat]) } }] : [],
    });
    (m.getSource('approche') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: routeApproche && routeApproche.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeApproche.map((p) => [p.lng, p.lat]) } }] : [],
    });
    // La position réelle du client entre dans le cadre : il se voit sur la carte avec son trajet.
    const tous = [...geo, ...(routeApproche ?? []), origin, ...(moi ? [moi] : [])];
    const h = boite.current?.clientHeight ?? 800;
    // La feuille du bas masque une partie de la carte : on cadre le trajet au-dessus d'elle.
    const feuille = boite.current?.closest('.screen')?.querySelector('.sheet')?.getBoundingClientRect();
    const haut = boite.current?.getBoundingClientRect().top ?? 0;
    const couvert = feuille ? Math.max(0, h - (feuille.top - haut)) : Math.round(h * basCouvert);
    // En navigation, c'est le véhicule qui guide la caméra (étape 7), pas le cadrage du trajet.
    if (suitRef.current && car) return;
    if (tous.length > 1) {
      const lngs = tous.map((p) => p.lng), lats = tous.map((p) => p.lat);
      m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
        padding: { top: 120, bottom: Math.min(h - 200, couvert + 36), left: 46, right: 46 }, duration: 900, maxZoom: 16, bearing: 0, pitch: 0,
      });
    } else {
      m.easeTo({ center: [origin.lng, origin.lat], zoom: 14.2, padding: { top: 60, bottom: Math.min(h - 200, couvert), left: 0, right: 0 }, duration: 700 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, route, routeApproche, cleTrajet, traceExterne ? trace : null, suit, moi?.lat, moi?.lng]);

  // 6. Repères : départ, arrêts, arrivée.
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    void chargerML().then((ml) => {
      const M = marqueurs.current;
      M.depart?.remove(); M.arrivee?.remove(); M.arrets.forEach((x) => x.remove());
      M.depart = new ml.Marker({ element: element('carte-depart', '<span></span>') }).setLngLat([origin.lng, origin.lat]).addTo(m);
      M.arrets = stops.map((s, i) => new ml.Marker({ element: element('carte-arret', String(i + 1)) }).setLngLat([s.lng, s.lat]).addTo(m));
      M.arrivee = destination
        ? new ml.Marker({ element: element('carte-arrivee', '<span></span>'), anchor: 'bottom' }).setLngLat([destination.lng, destination.lat]).addTo(m)
        : undefined;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, cleTrajet, origin.lat, origin.lng]);

  // 6 bis. Position réelle du client : un point bleu, sur lequel la carte se recentre.
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    const M = marqueurs.current;
    if (!moi) { M.moi?.remove(); M.moi = undefined; return; }
    void chargerML().then((ml) => {
      if (M.moi) M.moi.setLngLat([moi.lng, moi.lat]);
      else M.moi = new ml.Marker({ element: element('carte-moi', '<span></span>') }).setLngLat([moi.lng, moi.lat]).addTo(m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, moi?.lat, moi?.lng]);

  // 7. Véhicule : glisse d'une position à la suivante et s'oriente dans le sens de la marche.
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    if (!car) { marqueurs.current.vehicule?.remove(); marqueurs.current.vehicule = undefined; derniere.current = null; return; }
    let raf = 0;
    void chargerML().then((ml) => {
      const M = marqueurs.current;
      if (!M.vehicule) {
        M.vehicule = new ml.Marker({ element: element(`carte-vehicule ${vehicle}`, `<span class="halo"></span><i>${vehicle === 'moto' ? repere('scooter-dessus', 24) : repere(nomVoitureDessus(accent), 30)}</i>`), rotationAlignment: 'map' })
          .setLngLat([car.lng, car.lat]).addTo(m);
        derniere.current = { pos: car, angle: 0 };
        return;
      }
      const depart = derniere.current?.pos ?? car;
      const distance = Math.hypot(car.lat - depart.lat, car.lng - depart.lng);
      const angle = distance > 1e-6 ? cap(depart, car) : derniere.current?.angle ?? 0;
      const t0 = performance.now();
      const etape = (t: number) => {
        const f = Math.min(1, (t - t0) / 650);
        const pos = { lat: depart.lat + (car.lat - depart.lat) * f, lng: depart.lng + (car.lng - depart.lng) * f };
        M.vehicule?.setLngLat([pos.lng, pos.lat]).setRotation(angle);
        if (f < 1) raf = requestAnimationFrame(etape);
      };
      raf = requestAnimationFrame(etape);
      derniere.current = { pos: car, angle };
      // Navigation : la caméra accompagne le véhicule, la route droit devant (vue inclinée).
      if (suitRef.current) {
        const h = boite.current?.clientHeight ?? 800;
        m.easeTo({ center: [car.lng, car.lat], bearing: angle, pitch: 50, zoom: 16.4, duration: 650, padding: { top: Math.round(h * 0.42), bottom: 0, left: 0, right: 0 } });
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, car?.lat, car?.lng, suit]);

  // Péages de l'itinéraire choisi par le client : cercle plein orange.
  const clePeages = (peages ?? []).map((p) => p.id).join(',');
  useEffect(() => {
    if (prete && carte.current) marquerPeages(carte.current, clePeages ? clePeages.split(',') : []);
  }, [prete, clePeages]);

  return (
    <div className="map-wrap carte-reelle">
      <div ref={boite} className="carte-ml" />
      {(() => {
        const via = traceExterne ? ponts ?? [] : route?.ponts ?? [];
        return via.length > 0 && (
          <div className="carte-ponts" aria-live="polite">
            <span>via</span> {via.slice(0, 2).join(' · ')}
          </div>
        );
      })()}
      {suivi && libre && (
        <button type="button" className="carte-recentrer" onClick={() => setLibre(false)}>{libelleRecentrer}</button>
      )}
    </div>
  );
}
