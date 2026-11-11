import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as CarteML, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LatLng } from '../types';
import { useTheme } from '../theme';
import type { VectorConfig } from '../mapConfig';
import { itineraire, type ItineraireRoute } from '../api';
import { styleOrion } from './styleCarte';

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
}

type ML = typeof import('maplibre-gl');
/** MapLibre est chargé à la demande (bibliothèque lourde) ; selon le bundler, il arrive sous `default`. */
let chargement: Promise<ML> | null = null;
function chargerML(): Promise<ML> {
  chargement ??= import('maplibre-gl').then((mod) => ((mod as unknown as { default?: ML }).default ?? mod));
  return chargement;
}

const couleur = (v: string, defaut: string) => {
  const c = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  return c || defaut;
};

const VOITURE = `<svg viewBox="0 0 26 44" width="26" height="44" aria-hidden="true">
  <rect x="2" y="2" width="22" height="40" rx="9" fill="currentColor" stroke="#fff" stroke-width="2"/>
  <rect x="5.5" y="9" width="15" height="8" rx="3" fill="#0b1a14" opacity=".85"/>
  <rect x="5.5" y="27" width="15" height="7" rx="3" fill="#0b1a14" opacity=".7"/>
  <rect x="4" y="3.5" width="5" height="2.5" rx="1.2" fill="#fffbe6"/><rect x="17" y="3.5" width="5" height="2.5" rx="1.2" fill="#fffbe6"/>
</svg>`;
const MOTO = `<svg viewBox="0 0 20 40" width="20" height="40" aria-hidden="true">
  <rect x="6" y="1" width="8" height="38" rx="4" fill="#1d2a32" stroke="#fff" stroke-width="1.6"/>
  <rect x="3" y="22" width="14" height="12" rx="3" fill="currentColor" stroke="#fff" stroke-width="1.6"/>
  <circle cx="10" cy="13" r="4" fill="#0b1a14"/>
</svg>`;

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

export function CarteReelle({ origin, destination, stops = [], car, vehicle = 'car', approche = false, config, onEchec, basCouvert = 0.46 }: Props) {
  const { resolved, accent } = useTheme();
  const boite = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteML | null>(null);
  const marqueurs = useRef<{ depart?: Marker; arrivee?: Marker; arrets: Marker[]; vehicule?: Marker }>({ arrets: [] });
  const [prete, setPrete] = useState(false);
  const [route, setRoute] = useState<ItineraireRoute | null>(null);
  const [routeApproche, setRouteApproche] = useState<LatLng[] | null>(null);
  const derniere = useRef<{ pos: LatLng; angle: number } | null>(null);
  const echecSignale = useRef(false);

  // 1. Création de la carte (recréée au changement clair/sombre : autre fond).
  useEffect(() => {
    let annule = false;
    let instance: CarteML | null = null;
    const echec = () => { if (!echecSignale.current) { echecSignale.current = true; onEchec(); } };
    const delai = window.setTimeout(() => { if (!instance?.loaded()) echec(); }, 12_000);
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
      instance.on('error', (e) => { if (!instance?.loaded() && /Failed to fetch|NetworkError|AJAXError/i.test(String((e as { error?: Error }).error?.message ?? ''))) echec(); });
      instance.on('load', () => {
        window.clearTimeout(delai);
        // Mention OpenStreetMap repliée sur le bouton « i » : elle ne masque pas la carte.
        boite.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        const m = instance!;
        m.addSource('route', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
        m.addSource('approche', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'approche', type: 'line', source: 'approche', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': couleur('--green', '#00e08a'), 'line-width': 4, 'line-dasharray': [0.1, 1.8], 'line-opacity': 0.9 } });
        m.addLayer({ id: 'route-bord', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': resolved === 'light' ? '#ffffff' : '#04100b', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 13], 'line-opacity': 0.95 } });
        m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4.5, 16, 8.5], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, couleur('--green-bright', '#2bffa6'), 1, couleur('--green-deep', '#00b46e')] } });
        carte.current = m;
        setPrete(true);
      });
    }).catch(echec);
    return () => {
      annule = true;
      window.clearTimeout(delai);
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
    if (!destination) { setRoute(null); return; }
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
    const geo = route?.geometrie ?? (destination ? [origin, ...stops, destination] : []);
    (m.getSource('route') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: geo.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geo.map((p) => [p.lng, p.lat]) } }] : [],
    });
    (m.getSource('approche') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: routeApproche && routeApproche.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeApproche.map((p) => [p.lng, p.lat]) } }] : [],
    });
    const tous = [...geo, ...(routeApproche ?? []), origin];
    const h = boite.current?.clientHeight ?? 800;
    // La feuille du bas masque une partie de la carte : on cadre le trajet au-dessus d'elle.
    const feuille = boite.current?.closest('.screen')?.querySelector('.sheet')?.getBoundingClientRect();
    const haut = boite.current?.getBoundingClientRect().top ?? 0;
    const couvert = feuille ? Math.max(0, h - (feuille.top - haut)) : Math.round(h * basCouvert);
    if (tous.length > 1) {
      const lngs = tous.map((p) => p.lng), lats = tous.map((p) => p.lat);
      m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
        padding: { top: 120, bottom: Math.min(h - 200, couvert + 36), left: 46, right: 46 }, duration: 900, maxZoom: 16,
      });
    } else {
      m.easeTo({ center: [origin.lng, origin.lat], zoom: 14.2, padding: { top: 60, bottom: Math.min(h - 200, couvert), left: 0, right: 0 }, duration: 700 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, route, routeApproche, cleTrajet]);

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

  // 7. Véhicule : glisse d'une position à la suivante et s'oriente dans le sens de la marche.
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    if (!car) { marqueurs.current.vehicule?.remove(); marqueurs.current.vehicule = undefined; derniere.current = null; return; }
    let raf = 0;
    void chargerML().then((ml) => {
      const M = marqueurs.current;
      if (!M.vehicule) {
        M.vehicule = new ml.Marker({ element: element(`carte-vehicule ${vehicle}`, `<span class="halo"></span><i>${vehicle === 'moto' ? MOTO : VOITURE}</i>`), rotationAlignment: 'map' })
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
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, car?.lat, car?.lng]);

  return (
    <div className="map-wrap carte-reelle">
      <div ref={boite} className="carte-ml" />
      {route && route.ponts.length > 0 && (
        <div className="carte-ponts" aria-live="polite">
          <span>via</span> {route.ponts.slice(0, 2).join(' · ')}
        </div>
      )}
    </div>
  );
}
