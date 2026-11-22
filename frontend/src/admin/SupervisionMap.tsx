import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as CarteML, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { chargerML } from '../components/chargerCarte';
import { styleOrion } from '../components/styleCarte';
import { ajouterFeuxEtPeages } from '../carteFeux';
import { getVectorConfig } from '../mapConfig';
import { comblerCarte } from '../lieux';
import type { FleetUnit, Alert, SosDossier } from './types';

/**
 * CARTE DE SUPERVISION (console) — la vraie carte d'Abidjan.
 *
 * Même carte vectorielle que l'app cliente, l'app chauffeur et le tableau de bord
 * (OpenStreetMap, style ORION, clair ou sombre comme la console) : rues, ponts, communes
 * et lagune réels. La flotte est une couche GPU (des milliers de véhicules sans un seul
 * élément HTML) ; les alertes SOS les plus récentes pulsent et ouvrent leur dossier d'un
 * clic. Une nouvelle alerte recentre la carte sur elle tant qu'il y en a peu.
 *
 * Sans réseau vers le serveur de tuiles, la carte retombe sur le plan schématique : la
 * supervision ne reste jamais aveugle.
 */

type Theme = 'dark' | 'light';

/** Thème courant de la console (attribut posé par Admin.tsx), suivi en direct. */
export function useThemeConsole(): Theme {
  const lire = (): Theme => (document.documentElement.getAttribute('data-adm-theme') === 'light' ? 'light' : 'dark');
  const [theme, setTheme] = useState<Theme>(lire);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(lire()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-adm-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

const ABIDJAN: [number, number] = [-4.0, 5.335];
const COULEURS = {
  dark: { libre: '#2fd67b', enCourse: '#e8b84a', bord: '#0c0d0f', alerte: '#ff5c6a' },
  light: { libre: '#00a352', enCourse: '#b7791f', bord: '#ffffff', alerte: '#d92d3a' },
};
const ALERTES_ANIMEES = 12;
const RECENTRER_SI_MOINS_DE = 6;
const DELAI_TUILES_MS = 12_000;

const flotteGeoJSON = (fleet: FleetUnit[]) => ({
  type: 'FeatureCollection' as const,
  features: fleet.map((u) => ({
    type: 'Feature' as const,
    properties: { enCourse: u.availability === 'on_trip' ? 1 : 0 },
    geometry: { type: 'Point' as const, coordinates: [u.lng, u.lat] },
  })),
});
const alertesGeoJSON = (alerts: Alert[]) => ({
  type: 'FeatureCollection' as const,
  features: alerts.map((a) => ({
    type: 'Feature' as const,
    properties: { id: a.id },
    geometry: { type: 'Point' as const, coordinates: [a.location.lng, a.location.lat] },
  })),
});

/** Charge une carte MapLibre dans `boite` ; `pret` puis `indispo` si les tuiles ne viennent pas. */
export function useCarteReelle(boite: React.RefObject<HTMLDivElement | null>, theme: Theme, vue: { center: [number, number]; zoom: number }, init: (m: CarteML) => void) {
  const carte = useRef<CarteML | null>(null);
  const [pret, setPret] = useState(false);
  const [indispo, setIndispo] = useState(false);
  const config = useMemo(() => getVectorConfig(), []);
  const initRef = useRef(init);
  initRef.current = init;

  useEffect(() => {
    if (!config) { setIndispo(true); return; }
    let annule = false;
    let delai = 0;
    setPret(false);
    void chargerML().then((ml) => {
      if (annule || !boite.current) return;
      const m = new ml.Map({
        container: boite.current, style: styleOrion(theme, config), center: vue.center, zoom: vue.zoom,
        attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 120,
      });
      m.addControl(new ml.AttributionControl({ compact: true, customAttribution: config.attribution }), 'bottom-left');
      m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      let chargee = false;
      delai = window.setTimeout(() => { if (!chargee) setIndispo(true); }, DELAI_TUILES_MS);
      m.on('load', () => {
        chargee = true; window.clearTimeout(delai); setIndispo(false);
        boite.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        initRef.current(m);
        // Feux tricolores du district et postes de péage, comme dans les apps.
        ajouterFeuxEtPeages(m, theme !== 'light', [config.policesLocales ? 'NotoSansRegular' : 'Noto Sans Regular']);
        // Mêmes lieux que l'app cliente : banques, sièges, écoles, commerces, immeubles nommés.
        if (config.lieuxIndex) comblerCarte(m, () => annule);
        carte.current = m;
        setPret(true);
      });
    }).catch(() => setIndispo(true));
    return () => { annule = true; window.clearTimeout(delai); carte.current?.remove(); carte.current = null; };
    // La vue initiale ne relance pas la carte : seul le thème (style) la reconstruit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, theme]);

  return { carte, pret, indispo };
}

export function SupervisionMap({ fleet, alerts, onAlerte }: { fleet: FleetUnit[]; alerts: Alert[]; onAlerte?: (id: string) => void }) {
  const theme = useThemeConsole();
  const boite = useRef<HTMLDivElement>(null);
  const marqueurs = useRef(new Map<string, Marker>());
  const dejaVues = useRef<Set<string> | null>(null);
  const onAlerteRef = useRef(onAlerte);
  onAlerteRef.current = onAlerte;
  const C = COULEURS[theme];

  const { carte, pret, indispo } = useCarteReelle(boite, theme, { center: ABIDJAN, zoom: 11.2 }, (m) => {
    m.addSource('flotte', { type: 'geojson', data: flotteGeoJSON([]) });
    m.addSource('alertes', { type: 'geojson', data: alertesGeoJSON([]) });
    m.addLayer({ id: 'flotte-halo', type: 'circle', source: 'flotte', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 11],
      'circle-color': ['match', ['get', 'enCourse'], 1, C.enCourse, C.libre] as unknown as string, 'circle-opacity': 0.18,
    } });
    m.addLayer({ id: 'flotte', type: 'circle', source: 'flotte', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 14, 5.5],
      'circle-color': ['match', ['get', 'enCourse'], 1, C.enCourse, C.libre] as unknown as string,
      'circle-stroke-color': C.bord, 'circle-stroke-width': 1,
    } });
    m.addLayer({ id: 'alertes', type: 'circle', source: 'alertes', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7],
      'circle-color': C.alerte, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
    } });
    m.on('click', 'alertes', (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) onAlerteRef.current?.(id);
    });
    m.on('mouseenter', 'alertes', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'alertes', () => { m.getCanvas().style.cursor = ''; });
  });

  // Flotte et alertes : données mises à jour à chaque rafraîchissement, sans recréer la carte.
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;
    (m.getSource('flotte') as GeoJSONSource | undefined)?.setData(flotteGeoJSON(fleet));
    (m.getSource('alertes') as GeoJSONSource | undefined)?.setData(alertesGeoJSON(alerts));
  }, [fleet, alerts, pret, carte]);

  // Alertes récentes : un marqueur pulsant, cliquable, avec le type et l'heure.
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;
    void chargerML().then((ml) => {
      const recentes = alerts.slice(0, ALERTES_ANIMEES);
      const vus = new Set<string>();
      for (const a of recentes) {
        vus.add(a.id);
        let mk = marqueurs.current.get(a.id);
        if (!mk) {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'adm-ml-alerte';
          el.setAttribute('aria-label', 'Ouvrir le dossier de l’alerte');
          el.addEventListener('click', (ev) => { ev.stopPropagation(); onAlerteRef.current?.(a.id); });
          mk = new ml.Marker({ element: el }).setLngLat([a.location.lng, a.location.lat]).addTo(m);
          marqueurs.current.set(a.id, mk);
        }
        mk.setLngLat([a.location.lng, a.location.lat]);
        mk.getElement().title = `Alerte ${a.kind === 'sos' ? 'SOS' : a.kind}${a.userName ? ` · ${a.userName}` : ''}${a.zoneName ? ` · ${a.zoneName}` : ''} · ${new Date(a.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${a.agent ? ` · pris en charge par ${a.agent}` : ' · sans gestionnaire'}`;
      }
      for (const [id, mk] of marqueurs.current) if (!vus.has(id)) { mk.remove(); marqueurs.current.delete(id); }

      // Nouvelle alerte : la carte va vers elle (tant qu'elles sont peu nombreuses).
      // Peu d'alertes : le cadre les montre toutes ; beaucoup : la vue reste sur tout Abidjan.
      const cadrer = (duree: number) => {
        if (alerts.length === 0 || alerts.length >= RECENTRER_SI_MOINS_DE) return;
        if (alerts.length === 1) { m.easeTo({ center: [alerts[0]!.location.lng, alerts[0]!.location.lat], zoom: 13.4, duration: duree }); return; }
        const lngs = alerts.map((a) => a.location.lng), lats = alerts.map((a) => a.location.lat);
        m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, maxZoom: 13.6, duration: duree });
      };
      if (dejaVues.current === null) {
        dejaVues.current = new Set(alerts.map((a) => a.id));
        cadrer(900);
        return;
      }
      const nouvelle = alerts.some((a) => !dejaVues.current!.has(a.id));
      for (const a of alerts) dejaVues.current.add(a.id);
      if (nouvelle) cadrer(1400);
    });
  }, [alerts, pret, carte]);

  // Le thème reconstruit la carte : les marqueurs HTML sont à reposer.
  useEffect(() => () => { for (const mk of marqueurs.current.values()) mk.remove(); marqueurs.current.clear(); dejaVues.current = null; }, [theme]);

  if (indispo) return <CarteSchematique fleet={fleet} alerts={alerts} repli />;
  return (
    <div className="adm-map adm-map-reelle">
      <div ref={boite} className="adm-map-ml" />
      {!pret && <div className="adm-map-chargement">Chargement de la carte d’Abidjan…</div>}
    </div>
  );
}

/**
 * DOSSIER SOS — l'itinéraire sur la vraie carte : tracé GPS réel (rouge), trajet direct
 * théorique (pointillés), départ, destination et position de l'alerte.
 */
export function SosCarte({ ride, alerte, repli }: { ride: NonNullable<SosDossier['ride']>; alerte: { lat: number; lng: number }; repli?: React.ReactNode }) {
  const theme = useThemeConsole();
  const boite = useRef<HTMLDivElement>(null);
  const pts = ride.trace.length > 1 ? ride.trace : [ride.origin, ride.destination];
  const tous = [...pts, ride.origin, ride.destination, alerte];
  const lngs = tous.map((p) => p.lng), lats = tous.map((p) => p.lat);
  const centre: [number, number] = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];

  const { carte, pret, indispo } = useCarteReelle(boite, theme, { center: centre, zoom: 12.5 }, (m) => {
    m.addSource('theorique', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[ride.origin.lng, ride.origin.lat], [ride.destination.lng, ride.destination.lat]] } } });
    m.addSource('reel', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lng, p.lat]) } } });
    m.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { r: 'a' }, geometry: { type: 'Point', coordinates: [ride.origin.lng, ride.origin.lat] } },
      { type: 'Feature', properties: { r: 'b' }, geometry: { type: 'Point', coordinates: [ride.destination.lng, ride.destination.lat] } },
      { type: 'Feature', properties: { r: 'sos' }, geometry: { type: 'Point', coordinates: [alerte.lng, alerte.lat] } },
    ] } });
    m.addLayer({ id: 'theorique', type: 'line', source: 'theorique', paint: { 'line-color': '#8a8e98', 'line-width': 2.5, 'line-dasharray': [2, 2] } });
    m.addLayer({ id: 'reel', type: 'line', source: 'reel', paint: { 'line-color': '#ff5468', 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'points', type: 'circle', source: 'points', paint: {
      'circle-radius': ['match', ['get', 'r'], 'sos', 8, 6] as unknown as number,
      'circle-color': ['match', ['get', 'r'], 'a', '#1fcf73', 'b', '#8f6bff', '#ff5c6a'] as unknown as string,
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
    } });
  });

  // Cadrer tout l'itinéraire une fois la carte prête.
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;
    m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 36, maxZoom: 15, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pret, carte]);

  if (indispo) return <>{repli ?? null}</>;
  return (
    <div className="adm-sos-carte">
      <div ref={boite} className="adm-map-ml" />
      <div className="adm-sos-legende"><span><i className="adm-l-reel" />Trajet réel (GPS)</span><span><i className="adm-l-theo" />Trajet direct</span><span><i className="adm-l-sos" />Alerte</span></div>
    </div>
  );
}

/* ======================= FLOTTE EN LOCATION (télématique) ======================= */

export type EtatLocation = 'normal' | 'silencieux' | 'immobilise' | 'vol';
export interface PointLocation { id: string; nom: string; lat: number; lng: number; etat: EtatLocation; detail: string }

/**
 * SUIVI DES VÉHICULES DE LOCATION sur la vraie carte : un marqueur par véhicule, coloré
 * selon son état (en location, boîtier silencieux, moteur coupé, volé), son nom en
 * étiquette. Un clic ouvre sa fiche ; « Voir sur la carte » dans la liste centre ici.
 */
export function CarteLocation({ points, focus, onSelect }: {
  points: PointLocation[]; focus: { id: string; n: number } | null; onSelect?: (id: string) => void;
}) {
  const theme = useThemeConsole();
  const boite = useRef<HTMLDivElement>(null);
  const marqueurs = useRef(new Map<string, Marker>());
  const cadree = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const { carte, pret, indispo } = useCarteReelle(boite, theme, { center: ABIDJAN, zoom: 11.4 }, () => { /* marqueurs HTML */ });

  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;
    void chargerML().then((ml) => {
      const vus = new Set<string>();
      for (const pt of points) {
        vus.add(pt.id);
        let mk = marqueurs.current.get(pt.id);
        if (!mk) {
          const el = document.createElement('button');
          el.type = 'button';
          el.innerHTML = '<span class="adm-ml-loc-pin"></span><span class="adm-ml-loc-nom"></span>';
          el.addEventListener('click', (ev) => { ev.stopPropagation(); onSelectRef.current?.(pt.id); });
          mk = new ml.Marker({ element: el, anchor: 'left' }).setLngLat([pt.lng, pt.lat]).addTo(m);
          marqueurs.current.set(pt.id, mk);
        }
        const el = mk.getElement();
        el.className = `adm-ml-loc ${pt.etat}`;
        el.title = `${pt.nom} — ${pt.detail}`;
        el.setAttribute('aria-label', `${pt.nom}, ${pt.detail}. Ouvrir la fiche.`);
        (el.querySelector('.adm-ml-loc-nom') as HTMLElement).textContent = pt.nom;
        mk.setLngLat([pt.lng, pt.lat]);
      }
      for (const [id, mk] of marqueurs.current) if (!vus.has(id)) { mk.remove(); marqueurs.current.delete(id); }
      if (!cadree.current && points.length > 0) {
        cadree.current = true;
        if (points.length === 1) m.easeTo({ center: [points[0]!.lng, points[0]!.lat], zoom: 14, duration: 0 });
        else {
          const lngs = points.map((x) => x.lng), lats = points.map((x) => x.lat);
          m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 70, maxZoom: 14, duration: 0 });
        }
      }
    });
  }, [points, pret, carte]);

  // « Voir sur la carte » : la carte va vers le véhicule demandé.
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret || !focus) return;
    const pt = points.find((x) => x.id === focus.id);
    if (pt) m.flyTo({ center: [pt.lng, pt.lat], zoom: 15.5, duration: 1200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, pret, carte]);

  useEffect(() => () => { for (const mk of marqueurs.current.values()) mk.remove(); marqueurs.current.clear(); cadree.current = false; }, [theme]);

  if (indispo) return <p className="adm-muted">Carte indisponible (serveur de cartes injoignable) : les positions restent lisibles dans la liste ci-dessous.</p>;
  return (
    <div className="adm-map adm-map-reelle adm-map-location">
      <div ref={boite} className="adm-map-ml" />
      {!pret && <div className="adm-map-chargement">Chargement de la carte d’Abidjan…</div>}
      <div className="adm-loc-legende">
        <span><i className="normal" />En location</span><span><i className="silencieux" />Boîtier silencieux</span>
        <span><i className="immobilise" />Moteur coupé / armé</span><span><i className="vol" />Déclaré volé</span>
      </div>
    </div>
  );
}

/* ---------------- Repli : plan schématique (sans réseau vers les tuiles) ---------------- */

const W = 720, H = 420;
const B = { minLat: 5.18, maxLat: 5.46, minLng: -4.14, maxLng: -3.68 };
const px = (lng: number) => ((lng - B.minLng) / (B.maxLng - B.minLng)) * W;
const py = (lat: number) => (1 - (lat - B.minLat) / (B.maxLat - B.minLat)) * H;
const grille = () => {
  const p: string[] = [];
  for (let x = 40; x < W; x += 60) p.push(`M ${x} 0 L ${x} ${H}`);
  for (let y = 40; y < H; y += 60) p.push(`M 0 ${y} L ${W} ${y}`);
  return p;
};

function CarteSchematique({ fleet, alerts, repli }: { fleet: FleetUnit[]; alerts: Alert[]; repli?: boolean }) {
  let libres = '';
  let enCourse = '';
  for (const u of fleet) {
    const d = `M${px(u.lng).toFixed(1)} ${py(u.lat).toFixed(1)}h0`;
    if (u.availability === 'on_trip') enCourse += d; else libres += d;
  }
  return (
    <div className="adm-map">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <rect width={W} height={H} fill="var(--a-panel2)" />
        <g stroke="var(--a-stroke)" strokeWidth="1" fill="none">{grille().map((d, i) => <path key={i} d={d} />)}</g>
        <path d="M 0 250 C 180 232 320 268 460 250 C 560 236 640 262 720 248 L 720 330 C 600 350 520 320 440 332 C 300 350 160 322 0 352 Z" fill="var(--a-stroke)" opacity="0.7" />
        <g stroke="var(--a-muted)" strokeOpacity="0.45" strokeWidth="4" fill="none" strokeLinecap="round">
          <path d="M 0 150 C 220 140 460 180 720 150" />
          <path d="M 160 0 C 200 160 180 300 250 420" />
          <path d="M 520 0 C 560 160 590 300 560 420" />
        </g>
        <g fill="none" strokeLinecap="round">
          <path d={libres} stroke="var(--a-green)" strokeWidth="5" opacity="0.9" />
          <path d={enCourse} stroke="var(--a-amber)" strokeWidth="5.5" opacity="0.9" />
        </g>
        {alerts.map((a, i) => (
          <g key={a.id} transform={`translate(${px(a.location.lng)} ${py(a.location.lat)})`}>
            {i < ALERTES_ANIMEES
              ? <circle r="16" fill="#ff5468" opacity="0.22"><animate attributeName="r" values="10;20;10" dur="1.6s" repeatCount="indefinite" /></circle>
              : <circle r="9" fill="#ff5468" opacity="0.18" />}
            <circle r={i < ALERTES_ANIMEES ? 6 : 4} fill="#ff5468" stroke="#fff" strokeWidth={i < ALERTES_ANIMEES ? 1.5 : 1} />
          </g>
        ))}
      </svg>
      {repli && <div className="adm-map-repli">Plan schématique — serveur de cartes injoignable</div>}
    </div>
  );
}
