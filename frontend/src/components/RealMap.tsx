import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '../types';
import { useTheme } from '../theme';
import type { TileConfig } from '../mapConfig';

/**
 * Fond de carte RÉEL (tuiles) via Leaflet — rues d'Abidjan, projection Web Mercator.
 * Mêmes repères que la carte stylisée : itinéraire, arrêts numérotés, VOITURE, départ,
 * destination. Activé quand un fournisseur de tuiles est configuré (cf. mapConfig.ts).
 */
interface Props {
  origin: LatLng;
  destination?: LatLng | null;
  stops?: LatLng[];
  car?: LatLng | null;
  tiles: TileConfig;
}

const GREEN = '#00a865';
const GREEN_BRIGHT = '#00c884';
const DEST = '#e0a92e';

function pinIcon(color: string) {
  return L.divIcon({
    className: 'orion-pin',
    html: `<span style="display:block;width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  });
}
function dotIcon(color: string) {
  return L.divIcon({
    className: 'orion-dot',
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};
      border:3px solid #fff;box-shadow:0 0 0 6px ${color}33"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}
function numIcon(n: number) {
  return L.divIcon({
    className: 'orion-num',
    html: `<span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;
      background:${GREEN};color:#fff;font:700 11px system-ui;border:2px solid #fff">${n}</span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}
function carIcon() {
  return L.divIcon({
    className: 'orion-car',
    html: `<span style="display:grid;place-items:center;width:30px;height:30px;border-radius:50%;
      background:#fff;border:2px solid ${GREEN};box-shadow:0 2px 8px rgba(0,0,0,.3)">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${GREEN}" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"><path d="M4 13l1.5-4.5A2 2 0 0 1 7.4 7h9.2a2 2 0 0 1 1.9 1.5L20 13"/>
        <rect x="3" y="13" width="18" height="4" rx="1.5"/><circle cx="7.5" cy="16.5" r="1"/><circle cx="16.5" cy="16.5" r="1"/></svg>
    </span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export function RealMap({ origin, destination, stops = [], car, tiles }: Props) {
  const { resolved } = useTheme();
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // Init une seule fois.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      center: [origin.lat, origin.lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    });
    L.tileLayer(tiles.url, { maxZoom: tiles.maxZoom, attribution: tiles.attribution }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Recalage après montage (le conteneur peut être dimensionné après coup).
    setTimeout(() => map.invalidateSize(), 60);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtre thème (léger assombrissement en mode sombre).
  useEffect(() => {
    if (elRef.current) elRef.current.classList.toggle('map-dark', resolved !== 'light');
  }, [resolved]);

  // Met à jour les repères + itinéraire.
  useEffect(() => {
    const map = mapRef.current, group = layerRef.current;
    if (!map || !group) return;
    group.clearLayers();

    const pts: [number, number][] = [[origin.lat, origin.lng]];
    stops.forEach((s) => pts.push([s.lat, s.lng]));
    if (destination) pts.push([destination.lat, destination.lng]);

    if (pts.length > 1) {
      L.polyline(pts, { color: GREEN_BRIGHT, weight: 6, opacity: 0.95, lineCap: 'round' }).addTo(group);
      L.polyline(pts, { color: '#fff', weight: 2, opacity: 0.7, dashArray: '1 12', lineCap: 'round' }).addTo(group);
    }

    L.marker([origin.lat, origin.lng], { icon: dotIcon(GREEN) }).addTo(group);
    stops.forEach((s, i) => L.marker([s.lat, s.lng], { icon: numIcon(i + 1) }).addTo(group));
    if (destination) L.marker([destination.lat, destination.lng], { icon: pinIcon(DEST) }).addTo(group);
    if (car) L.marker([car.lat, car.lng], { icon: carIcon() }).addTo(group);

    // Cadre sur l'ensemble des points (course) ou léger zoom (départ seul).
    const all = [...pts, ...(car ? [[car.lat, car.lng] as [number, number]] : [])];
    if (all.length > 1) map.fitBounds(L.latLngBounds(all), { padding: [60, 60], maxZoom: 15 });
    else map.setView([origin.lat, origin.lng], 14);
  }, [origin, destination, stops, car]);

  return (
    <div className="map-wrap">
      <div ref={elRef} className="orion-leaflet" />
      <div className="map-grad-top" />
    </div>
  );
}
