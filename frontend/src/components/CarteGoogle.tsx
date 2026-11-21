import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '../types';
import { useTheme } from '../theme';
import { itineraire, type ItineraireRoute } from '../api';
import { itineraireGoogle } from '../itineraireGoogle';
import { rendu } from './Vehicules';
import { causeRefus, chargerGoogle, cleRefusee, essaiSansCle, motifRefus, reessayerGoogle, type GMap, type GoogleMaps, type GPolyline } from '../carteGoogle';
import { useI18n } from '../i18n';
import { IconMap, IconRefresh } from '../icons';

/**
 * CARTE GOOGLE MAPS (API officielle Maps JavaScript) — même rôle que la carte ORION :
 * départ, arrêts, arrivée, itinéraire, véhicule qui glisse et s'oriente, position du client.
 *
 * Le fond et tous ses lieux viennent de Google. L'itinéraire aussi quand son service « Routes
 * API » répond : tracé sur les routes de Google, distance et durée avec le trafic du moment,
 * affichées sur la carte. Sinon l'itinéraire reste celui d'ORION (serveur, ou calcul public
 * sans serveur). Les repères sont les mêmes éléments que sur la carte ORION, posés sur la
 * carte par une surcouche.
 *
 * La carte s'arrête au-dessus de la feuille du bas : le logo et les mentions de Google
 * restent visibles, comme ses conditions l'exigent.
 */
interface Props {
  origin: LatLng;
  destination?: LatLng | null;
  stops?: LatLng[];
  car?: LatLng | null;
  vehicle?: 'car' | 'moto';
  approche?: boolean;
  /** Position réelle du téléphone (« vous êtes ici »). */
  moi?: LatLng | null;
  trace?: LatLng[] | null;
  basCouvert?: number;
  /** Clé refusée, API injoignable : l'appelant affiche la carte ORION. */
  onEchec: () => void;
}

interface Repere { placer: (p: LatLng, angle?: number) => void; retirer: () => void }

/** Pose un élément HTML sur la carte, ancré sur une position. */
export function poserRepere(g: GoogleMaps, carte: GMap, contenu: HTMLElement, pos: LatLng, ancre: 'centre' | 'bas' = 'centre'): Repere {
  const boite = document.createElement('div');
  boite.className = 'gm-repere';
  boite.appendChild(contenu);
  let position = pos;
  let angle = 0;
  const o = new g.OverlayView();
  const dessiner = () => {
    const p = o.getProjection()?.fromLatLngToDivPixel(new g.LatLng(position.lat, position.lng));
    if (!p) return;
    boite.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, ${ancre === 'bas' ? '-100%' : '-50%'}) rotate(${angle}deg)`;
  };
  o.onAdd = () => { o.getPanes()?.overlayMouseTarget.appendChild(boite); };
  o.draw = dessiner;
  o.onRemove = () => { boite.remove(); };
  o.setMap(carte);
  return { placer: (p, a = angle) => { position = p; angle = a; dessiner(); }, retirer: () => o.setMap(null) };
}

function element(classe: string, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = classe;
  d.innerHTML = html;
  return d;
}
const repereVehicule = (nom: string, largeur: number) => `<img src="${rendu(nom)}" width="${largeur}" height="${largeur * 2}" alt="" draggable="false" />`;
const couleur = (v: string, defaut: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || defaut;
const cap = (a: LatLng, b: LatLng) => {
  const y = Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
  const x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180)
    - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180);
  return (Math.atan2(y, x) * 180) / Math.PI;
};

/** Itinéraire de Google s'il répond, sinon celui d'ORION. */
const tracer = (points: LatLng[]): Promise<ItineraireRoute | null> => itineraireGoogle(points).then((r) => r ?? itineraire(points));

/** Options communes aux cartes Google de l'application. */
export function optionsCarte(g: GoogleMaps, sombre: boolean, centre: LatLng, zoom: number): Record<string, unknown> {
  return {
    center: centre, zoom, disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy', keyboardShortcuts: false,
    backgroundColor: sombre ? '#0c0d0f' : '#ffffff',
    ...(g.ColorScheme ? { colorScheme: sombre ? g.ColorScheme.DARK : g.ColorScheme.LIGHT } : {}),
  };
}

/** Aperçu sans clé : Google affiche un avis dans la carte ; on le referme pour laisser voir la carte. */
export function fermerAvisSansCle(boite: HTMLElement | null): void {
  if (!essaiSansCle() || !boite) return;
  window.setTimeout(() => (boite.querySelector('.dismissButton') as HTMLElement | null)?.click(), 1200);
}

/**
 * Construction « Google seul » : Google ne répond pas (pas de connexion) ou refuse la clé.
 * Il n'y a pas d'autre carte à afficher : on le dit, avec le motif, et on propose de réessayer.
 * Le reste de l'écran (recherche, prix, commande) continue de fonctionner.
 */
export function GoogleIndisponible() {
  const { t } = useI18n();
  const motif = motifRefus();
  const refus = cleRefusee() || Boolean(motif);
  return (
    <div className="carte-indispo" role="status" aria-live="polite">
      <div className="carte-indispo-boite">
        <IconMap size={30} strokeWidth={1.8} />
        <strong>{t('carte_indispo_titre')}</strong>
        <p>{refus ? `${t('carte_indispo_cle')}${motif ? ` ${t(causeRefus(motif), { m: motif })}` : ''}` : t('carte_indispo_reseau')}</p>
        <button type="button" className="btn btn-ghost" onClick={reessayerGoogle}><IconRefresh size={17} /> {t('carte_reessayer')}</button>
      </div>
    </div>
  );
}

export function CarteGoogle({ origin, destination, stops = [], car, vehicle = 'car', approche = false, moi, trace, basCouvert = 0.46, onEchec }: Props) {
  const { resolved, accent } = useTheme();
  const { t, lang } = useI18n();
  const enveloppe = useRef<HTMLDivElement>(null);
  const boite = useRef<HTMLDivElement>(null);
  const api = useRef<GoogleMaps | null>(null);
  const carte = useRef<GMap | null>(null);
  const [prete, setPrete] = useState(false);
  const [route, setRoute] = useState<ItineraireRoute | null>(null);
  const [routeApproche, setRouteApproche] = useState<LatLng[] | null>(null);
  const lignes = useRef<{ bord?: GPolyline; trajet?: GPolyline; approche?: GPolyline }>({});
  const reperes = useRef<{ depart?: Repere; arrivee?: Repere; arrets: Repere[]; vehicule?: Repere; moi?: Repere }>({ arrets: [] });
  const derniere = useRef<{ pos: LatLng; angle: number } | null>(null);
  const traceExterne = trace !== undefined;
  const echec = useRef(onEchec);
  echec.current = onEchec;
  /** Recadre la carte sur le trajet : rappelé quand la feuille du bas change de hauteur. */
  const cadrer = useRef<() => void>(() => {});

  // 1. Création de la carte (recréée au changement clair/sombre : Google fixe le thème à la création).
  useEffect(() => {
    let annule = false;
    void chargerGoogle().then((g) => {
      if (annule || !boite.current) return;
      api.current = g;
      const m = new g.Map(boite.current, optionsCarte(g, resolved !== 'light', origin, 14));
      carte.current = m;
      g.event.addListenerOnce(m, 'tilesloaded', () => fermerAvisSansCle(boite.current));
      // Les surcouches ont besoin de la projection : elle arrive au premier « idle ».
      g.event.addListenerOnce(m, 'idle', () => { if (!annule) setPrete(true); });
    }).catch(() => { if (!annule) echec.current(); });
    return () => {
      annule = true;
      const R = reperes.current;
      [R.depart, R.arrivee, R.vehicule, R.moi, ...R.arrets].forEach((x) => x?.retirer());
      reperes.current = { arrets: [] };
      Object.values(lignes.current).forEach((l) => l?.setMap(null));
      lignes.current = {};
      carte.current = null;
      derniere.current = null;
      setPrete(false);
      if (boite.current) boite.current.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  // 2. La carte s'arrête exactement au bord de la feuille du bas : le logo et les mentions de
  //    Google, posés tout en bas de la carte, restent entièrement visibles (ses conditions
  //    l'exigent). Derrière les coins arrondis de la feuille, l'enveloppe a la couleur du sol.
  useEffect(() => {
    const env = enveloppe.current;
    const ecran = env?.closest('.screen');
    if (!env || !ecran) return;
    const caler = () => {
      const feuille = ecran.querySelector('.sheet')?.getBoundingClientRect();
      const cadre = ecran.getBoundingClientRect();
      const bas = feuille ? Math.max(0, cadre.bottom - feuille.top) : 0;
      if (boite.current && boite.current.style.bottom !== `${bas}px`) {
        boite.current.style.bottom = `${bas}px`;
        if (api.current && carte.current) api.current.event.trigger(carte.current, 'resize');
        // La carte vient de changer de hauteur : sans recadrage, le départ ou l'arrivée
        // pourrait se retrouver sous la feuille.
        window.setTimeout(() => cadrer.current(), 80);
      }
    };
    caler();
    const obs = new ResizeObserver(caler);
    obs.observe(ecran);
    const feuille = ecran.querySelector('.sheet');
    if (feuille) obs.observe(feuille);
    const id = window.setInterval(caler, 700); // la feuille peut apparaître ou changer après coup
    return () => { obs.disconnect(); window.clearInterval(id); };
  }, []);

  // 3. Itinéraire réel (départ, arrêts, arrivée) et approche du chauffeur : ceux de Google,
  //    sinon ceux d'ORION.
  const cleTrajet = destination ? [origin, ...stops, destination].map((p) => `${p.lat},${p.lng}`).join(';') : '';
  useEffect(() => {
    if (!destination || traceExterne) { setRoute(null); return; }
    let actif = true;
    void tracer([origin, ...stops, destination]).then((r) => { if (actif) setRoute(r); });
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleTrajet]);
  const approcheCalculee = useRef(false);
  useEffect(() => {
    if (!approche || !car || approcheCalculee.current) { if (!approche) { setRouteApproche(null); approcheCalculee.current = false; } return; }
    approcheCalculee.current = true;
    void tracer([car, origin]).then((r) => setRouteApproche(r?.geometrie ?? [car, origin]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approche, car]);

  // 4. Tracés et cadrage.
  useEffect(() => {
    const g = api.current; const m = carte.current;
    if (!prete || !g || !m) return;
    const geo = (traceExterne ? trace : null) ?? route?.geometrie ?? (destination ? [origin, ...stops, destination] : []);
    const L = lignes.current;
    const sombre = resolved !== 'light';
    L.bord ??= new g.Polyline({ map: m, clickable: false, strokeColor: sombre ? '#0c0d0f' : '#ffffff', strokeOpacity: 1, strokeWeight: 10, zIndex: 1 });
    L.trajet ??= new g.Polyline({ map: m, clickable: false, strokeOpacity: 1, strokeWeight: 6, zIndex: 2 });
    L.approche ??= new g.Polyline({ map: m, clickable: false, strokeOpacity: 0, zIndex: 2 });
    L.trajet.setOptions({ strokeColor: couleur('--green-bright', '#00b85c') });
    L.approche.setOptions({ icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: couleur('--green', '#00843d'), scale: 3 }, offset: '0', repeat: '13px' }] });
    L.bord.setPath(geo); L.trajet.setPath(geo);
    L.approche.setPath(routeApproche ?? []);
    const tous = [...geo, ...(routeApproche ?? []), origin, ...(moi ? [moi] : [])];
    cadrer.current = () => {
      if (carte.current !== m) return;
      if (tous.length > 1) {
        const b = new g.LatLngBounds();
        tous.forEach((p) => b.extend(p));
        m.fitBounds(b, { top: 150, bottom: 46, left: 46, right: 46 });
      } else {
        m.panTo(origin);
        if (m.getZoom() < 13) m.setZoom(15);
      }
    };
    cadrer.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, route, routeApproche, cleTrajet, traceExterne ? trace : null, accent, basCouvert, moi?.lat, moi?.lng]);

  // 5. Repères : départ, arrêts, arrivée.
  useEffect(() => {
    const g = api.current; const m = carte.current;
    if (!prete || !g || !m) return;
    const R = reperes.current;
    R.depart?.retirer(); R.arrivee?.retirer(); R.arrets.forEach((x) => x.retirer());
    R.depart = poserRepere(g, m, element('carte-depart', '<span></span>'), origin);
    R.arrets = stops.map((s, i) => poserRepere(g, m, element('carte-arret', String(i + 1)), s));
    R.arrivee = destination ? poserRepere(g, m, element('carte-arrivee', '<span></span>'), destination, 'bas') : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, cleTrajet, origin.lat, origin.lng]);

  // 6. Position réelle du client.
  useEffect(() => {
    const g = api.current; const m = carte.current;
    if (!prete || !g || !m) return;
    const R = reperes.current;
    if (!moi) { R.moi?.retirer(); R.moi = undefined; return; }
    if (R.moi) R.moi.placer(moi); else R.moi = poserRepere(g, m, element('carte-moi', '<span></span>'), moi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, moi?.lat, moi?.lng]);

  // 7. Véhicule : glisse d'une position à la suivante et s'oriente dans le sens de la marche.
  useEffect(() => {
    const g = api.current; const m = carte.current;
    if (!prete || !g || !m) return;
    const R = reperes.current;
    if (!car) { R.vehicule?.retirer(); R.vehicule = undefined; derniere.current = null; return; }
    if (!R.vehicule) {
      R.vehicule = poserRepere(g, m, element(`carte-vehicule ${vehicle}`,
        `<span class="halo"></span><i>${vehicle === 'moto' ? repereVehicule('scooter-dessus', 24) : repereVehicule(accent === 'vert' ? 'voiture-dessus' : `voiture-dessus-${accent}`, 30)}</i>`), car);
      derniere.current = { pos: car, angle: 0 };
      return;
    }
    const depart = derniere.current?.pos ?? car;
    const distance = Math.hypot(car.lat - depart.lat, car.lng - depart.lng);
    const angle = distance > 1e-6 ? cap(depart, car) : derniere.current?.angle ?? 0;
    const t0 = performance.now();
    let raf = 0;
    const etape = (t: number) => {
      const f = Math.min(1, (t - t0) / 650);
      R.vehicule?.placer({ lat: depart.lat + (car.lat - depart.lat) * f, lng: depart.lng + (car.lng - depart.lng) * f }, angle);
      if (f < 1) raf = requestAnimationFrame(etape);
    };
    raf = requestAnimationFrame(etape);
    derniere.current = { pos: car, angle };
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, car?.lat, car?.lng]);

  return (
    <div ref={enveloppe} className="map-wrap carte-reelle carte-google">
      <div ref={boite} className="carte-ml" />
      {route?.provider === 'google' && !traceExterne && !car ? (
        // Trajet de Google : durée avec le trafic du moment, distance par la route, grande voie empruntée.
        <div className="carte-ponts carte-trajet" aria-live="polite">
          <strong>{Math.max(1, Math.round(route.durationSeconds / 60))} {t('est_min')}</strong>
          <i>{new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(route.distanceMeters / 1000)} km</i>
          {route.via && <em><span>via</span> {route.via}</em>}
        </div>
      ) : route?.ponts && route.ponts.length > 0 && !traceExterne && (
        <div className="carte-ponts" aria-live="polite"><span>via</span> {route.ponts.slice(0, 2).join(' · ')}</div>
      )}
    </div>
  );
}
