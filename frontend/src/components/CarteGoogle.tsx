import { useEffect, useRef, useState } from 'react';
import { cleZones, elementZone, type ZoneCarte } from './zonesCarte';
import type { LatLng } from '../types';
import type { VehiculeProche } from '../api';
import { useTheme } from '../theme';
import { itineraire, type ItineraireRoute } from '../api';
import { itineraireGoogle } from '../itineraireGoogle';
import { nomVoitureDessus, rendu } from './Vehicules';
import { causeRefus, chargerGoogle, cleRefusee, essaiSansCle, motifRefus, reessayerGoogle, type GMap, type GoogleMaps, type GPolyline } from '../carteGoogle';
import { useI18n } from '../i18n';
import { IconMap, IconRefresh } from '../icons';
import { chargerFeux, HTML_FEU, ZOOM_FEUX, ZOOM_PEAGES } from '../carteFeux';
import { PEAGES_TARIF } from '../tarifServeur';

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
  /** Péages de l'itinéraire choisi : mis en avant (cercle plein, montant affiché). */
  peages?: { id: string }[];
  basCouvert?: number;
  /** Véhicules libres autour du client (avant la commande), positions du serveur ORION. */
  voisins?: VehiculeProche[];
  /** Clé refusée, API injoignable : l'appelant affiche la carte ORION. */
  onEchec: () => void;
  /** ORION Pro hors course : zones à forte demande et sièges ORION (touchables). */
  zones?: ZoneCarte[];
  onZone?: (id: string) => void;
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

/**
 * FEUX TRICOLORES (zoom 14 et plus) ET POSTES DE PÉAGE (zoom 11 et plus) du district
 * d'Abidjan sur la carte Google : une seule surcouche, dont les éléments sont réutilisés
 * d'un déplacement à l'autre ; seuls les repères visibles à l'écran sont placés.
 */
function coucheRoutiere(g: GoogleMaps, m: GMap): { actifs: (ids: string[]) => void; retirer: () => void } {
  const boite = document.createElement('div');
  boite.className = 'gm-couche-routiere';
  const o = new g.OverlayView();
  let feux: [number, number, number][] = [];
  let actifs: string[] = [];
  const elFeux: HTMLDivElement[] = [];
  const elPeages = PEAGES_TARIF.map((p) => {
    const e = element('gm-peage', `<i></i><span>Péage · ${p.montant} F</span>`);
    e.title = p.nom;
    boite.appendChild(e);
    return e;
  });
  const dessiner = () => {
    const proj = o.getProjection();
    if (!proj) return;
    const z = m.getZoom();
    const b = m.getBounds();
    let n = 0;
    if (z >= ZOOM_FEUX && b) {
      const ne = b.getNorthEast(), so = b.getSouthWest(), marge = 0.004;
      for (const [lat, lng] of feux) {
        if (lat > ne.lat() + marge || lat < so.lat() - marge || lng > ne.lng() + marge || lng < so.lng() - marge) continue;
        const p = proj.fromLatLngToDivPixel(new g.LatLng(lat, lng));
        if (!p) continue;
        let el = elFeux[n];
        if (!el) { el = element('gm-feu', HTML_FEU); boite.appendChild(el); elFeux.push(el); }
        el.style.display = '';
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        if (++n >= 300) break;
      }
    }
    for (let i = n; i < elFeux.length; i++) elFeux[i]!.style.display = 'none';
    PEAGES_TARIF.forEach((pg, i) => {
      const el = elPeages[i]!;
      const actif = actifs.includes(pg.id);
      if (z < ZOOM_PEAGES && !actif) { el.style.display = 'none'; return; }
      const p = proj.fromLatLngToDivPixel(new g.LatLng(pg.lat, pg.lng));
      if (!p) return;
      el.style.display = '';
      el.classList.toggle('actif', actif);
      el.classList.toggle('nomme', actif || z >= 13);
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    });
  };
  o.onAdd = () => { o.getPanes()?.markerLayer.appendChild(boite); };
  o.draw = dessiner;
  o.onRemove = () => { boite.remove(); };
  const ecoute = g.event.addListener(m, 'idle', dessiner);
  void chargerFeux().then((f) => { feux = f?.points ?? []; dessiner(); });
  o.setMap(m);
  return { actifs: (ids) => { actifs = ids; dessiner(); }, retirer: () => { ecoute.remove(); o.setMap(null); } };
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

/**
 * UNE SEULE CARTE pour toute l'application. Créer une carte Google coûte cher (script,
 * tuiles, une « carte chargée » facturée) : l'instance est créée une fois, puis déplacée
 * d'écran en écran avec son élément. Passer de la recherche au choix du véhicule, puis au
 * suivi, ne recharge plus rien : la carte est déjà là, au même endroit.
 * `occupee` : un écran l'utilise ; un second écran affiché en même temps crée la sienne.
 */
let partagee: { carte: GMap; hote: HTMLDivElement; sombre: boolean; occupee: boolean } | null = null;

/**
 * Prépare la carte dès l'accueil, hors de l'écran : quand le client ouvre la recherche, elle
 * est déjà chargée autour de lui et s'affiche sans attente ni écran blanc.
 */
export function prechaufferCarte(sombre: boolean, centre: LatLng): void {
  if (partagee) return;
  void chargerGoogle().then((g) => {
    if (partagee) return;
    const reserve = document.createElement('div');
    reserve.className = 'carte-reserve';
    reserve.setAttribute('aria-hidden', 'true');
    const hote = document.createElement('div');
    hote.className = 'carte-hote';
    reserve.appendChild(hote);
    document.body.appendChild(reserve);
    partagee = { carte: new g.Map(hote, optionsCarte(g, sombre, centre, 15)), hote, sombre, occupee: false };
    traficEnDirect(g, partagee.carte);
  }).catch(() => { /* pas de réseau : la carte sera créée, ou signalée indisponible, à l'ouverture */ });
}

/** Rectangle englobant, en nombres : sert à savoir si un recadrage changerait quelque chose. */
interface Cadre { s: number; o: number; n: number; e: number }
function cadreDe(points: LatLng[]): Cadre {
  let s = 90, o = 180, n = -90, e = -180;
  for (const p of points) { if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; if (p.lng < o) o = p.lng; if (p.lng > e) e = p.lng; }
  return { s, o, n, e };
}
/** Deux cadres presque identiques (à 12 % près de leur étendue) : inutile de recadrer. */
function memeCadre(a: Cadre, b: Cadre): boolean {
  const h = Math.max(a.n - a.s, b.n - b.s, 0.002) * 0.12, l = Math.max(a.e - a.o, b.e - b.o, 0.002) * 0.12;
  return Math.abs(a.s - b.s) < h && Math.abs(a.n - b.n) < h && Math.abs(a.o - b.o) < l && Math.abs(a.e - b.e) < l;
}

/** Itinéraire de Google s'il répond, sinon celui d'ORION. */
const tracer = (points: LatLng[]): Promise<ItineraireRoute | null> => itineraireGoogle(points).then((r) => r ?? itineraire(points));

/** Options communes aux cartes Google de l'application. */
/**
 * CIRCULATION EN DIRECT (comme Google Maps, Yango) : les rues se colorent selon le trafic du
 * moment — vert fluide, orange ralenti, rouge embouteillé. Le client voit pourquoi son trajet
 * prend du temps ; le chauffeur voit les bouchons sur sa vue d'ensemble.
 */
export function traficEnDirect(g: GoogleMaps, carte: GMap): void {
  if (g.TrafficLayer) new g.TrafficLayer().setMap(carte);
}

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

export function CarteGoogle({ origin, destination, stops = [], car, vehicle = 'car', approche = false, moi, trace, peages, basCouvert = 0.46, voisins, onEchec, zones, onZone }: Props) {
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
  /** Véhicules libres affichés (identifiant anonyme du serveur → repère et dernière position). */
  const flotte = useRef(new Map<string, { repere: Repere; pos: LatLng; angle: number }>());
  const traceExterne = trace !== undefined;
  const echec = useRef(onEchec);
  echec.current = onEchec;
  /** Recadre la carte sur le trajet. `force` : la carte a changé de taille, on recadre même si le trajet est le même. */
  const cadrer = useRef<(force?: boolean) => void>(() => {});
  const dernierCadre = useRef<Cadre | null>(null);
  const propre = useRef(false);        // cette instance a créé sa propre carte (la carte partagée était prise)

  // 1. La carte : celle de l'application si elle existe déjà (même thème), sinon on la crée.
  //    Google fixe le thème à la création : un passage clair/sombre en crée une nouvelle.
  useEffect(() => {
    let annule = false;
    const sombre = resolved !== 'light';
    void chargerGoogle().then((g) => {
      if (annule || !boite.current) return;
      api.current = g;
      if (partagee && partagee.sombre === sombre && !partagee.occupee) {
        partagee.occupee = true;
        boite.current.appendChild(partagee.hote);
        carte.current = partagee.carte;
        g.event.trigger(partagee.carte, 'resize');
        partagee.carte.setCenter(origin);
        setPrete(true);
        return;
      }
      const libre = !partagee || !partagee.occupee;
      if (partagee && libre) { partagee.hote.remove(); partagee = null; }       // l'ancienne était dans l'autre thème
      const hote = document.createElement('div');
      hote.className = 'carte-hote';
      boite.current.appendChild(hote);
      const m = new g.Map(hote, optionsCarte(g, sombre, origin, 14));
      traficEnDirect(g, m);
      carte.current = m;
      if (libre) partagee = { carte: m, hote, sombre, occupee: true }; else propre.current = true;
      g.event.addListenerOnce(m, 'tilesloaded', () => fermerAvisSansCle(hote));
      // Les surcouches ont besoin de la projection : elle arrive au premier « idle ».
      g.event.addListenerOnce(m, 'idle', () => { if (!annule) setPrete(true); });
    }).catch(() => { if (!annule) echec.current(); });
    return () => {
      annule = true;
      const R = reperes.current;
      [R.depart, R.arrivee, R.vehicule, R.moi, ...R.arrets].forEach((x) => x?.retirer());
      flotte.current.forEach((v) => v.repere.retirer());
      flotte.current.clear();
      reperes.current = { arrets: [] };
      Object.values(lignes.current).forEach((l) => l?.setMap(null));
      lignes.current = {};
      // La carte partagée est seulement détachée : le prochain écran la reprend telle quelle.
      if (partagee && carte.current === partagee.carte) { partagee.hote.remove(); partagee.occupee = false; }
      else if (propre.current && boite.current) boite.current.innerHTML = '';
      propre.current = false;
      carte.current = null;
      derniere.current = null;
      dernierCadre.current = null;
      setPrete(false);
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
    let applique = -1;           // hauteur déjà appliquée (px entiers)
    let cadree = -1;             // hauteur au dernier recadrage
    let recadrage = 0;
    const caler = () => {
      const feuille = ecran.querySelector('.sheet')?.getBoundingClientRect();
      const cadre = ecran.getBoundingClientRect();
      const bas = Math.round(feuille ? Math.max(0, cadre.bottom - feuille.top) : 0);
      // Un écart d'un ou deux pixels (animation de la feuille, arrondis) ne vaut pas un redimensionnement.
      if (!boite.current || Math.abs(bas - applique) < 3) return;
      const premier = applique < 0;
      applique = bas;
      boite.current.style.bottom = `${bas}px`;
      if (api.current && carte.current) api.current.event.trigger(carte.current, 'resize');
      // La carte vient de changer de hauteur : on recadre le trajet, une seule fois quand la
      // feuille s'est posée — et jamais pendant la saisie (clavier ouvert), où la carte doit
      // rester immobile sous les doigts.
      window.clearTimeout(recadrage);
      if (premier) { cadree = bas; return; }
      recadrage = window.setTimeout(() => {
        const actif = document.activeElement;
        if (actif instanceof HTMLInputElement || actif instanceof HTMLTextAreaElement) return;
        // Quelques dizaines de pixels de plus ou de moins ne cachent rien : on laisse la carte tranquille.
        if (Math.abs(applique - cadree) < 40) return;
        cadree = applique;
        cadrer.current(true);
      }, 260);
    };
    caler();
    const obs = new ResizeObserver(caler);
    obs.observe(ecran);
    const feuille = ecran.querySelector('.sheet');
    if (feuille) obs.observe(feuille);
    const id = window.setInterval(caler, 900); // la feuille peut apparaître ou changer après coup
    return () => { obs.disconnect(); window.clearInterval(id); window.clearTimeout(recadrage); };
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
    cadrer.current = (force = false) => {
      if (carte.current !== m) return;
      // Même trajet, même cadre : on ne touche pas à la carte (ni saut, ni tuiles rechargées).
      const cadre = cadreDe(tous);
      if (!force && dernierCadre.current && memeCadre(dernierCadre.current, cadre)) return;
      dernierCadre.current = cadre;
      if (tous.length > 1) {
        // Marges proportionnées à la carte visible : sur une petite bande (écran de
        // confirmation), des marges fixes dépassaient sa hauteur et Google affichait tout le pays.
        const boite = m.getDiv();
        const h = boite.clientHeight || 600; const w = boite.clientWidth || 400;
        const cote = Math.min(46, Math.round(w * 0.1));
        m.fitBounds({ south: cadre.s, west: cadre.o, north: cadre.n, east: cadre.e },
          { top: Math.min(150, Math.round(h * 0.3)), bottom: Math.min(46, Math.round(h * 0.1)), left: cote, right: cote });
      } else {
        m.panTo(origin);
        if (m.getZoom() < 13) m.setZoom(15);
      }
    };
    cadrer.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, route, routeApproche, cleTrajet, traceExterne ? trace : null, accent, basCouvert, moi?.lat, moi?.lng]);

  // 4 bis. Feux tricolores et péages du district ; péages de l'itinéraire choisi mis en avant.
  const couche = useRef<ReturnType<typeof coucheRoutiere> | null>(null);
  useEffect(() => {
    const g = api.current; const m = carte.current;
    if (!prete || !g || !m) return;
    couche.current = coucheRoutiere(g, m);
    return () => { couche.current?.retirer(); couche.current = null; };
  }, [prete]);
  const clePeages = (peages ?? []).map((p) => p.id).join(',');
  useEffect(() => { couche.current?.actifs(clePeages ? clePeages.split(',') : []); }, [prete, clePeages]);

  // 4 ter. Zones à forte demande et sièges ORION (ORION Pro hors course) : touchables.
  const surZone = useRef(onZone);
  surZone.current = onZone;
  const repZones = useRef<Repere[]>([]);
  const cleZ = cleZones(zones);
  useEffect(() => {
    const g = api.current; const m = carte.current;
    repZones.current.forEach((r) => r.retirer());
    repZones.current = [];
    if (!prete || !g || !m || !zones?.length) return;
    repZones.current = zones.map((z) => poserRepere(g, m, elementZone(z, (id) => surZone.current?.(id)), { lat: z.lat, lng: z.lng }));
    // Sans trajet à suivre : la carte s'ouvre assez large pour montrer le véhicule ET les zones.
    if (!destination && !(trace && trace.length > 1)) {
      const bornes = new g.LatLngBounds();
      bornes.extend(origin);
      zones.forEach((z) => bornes.extend(z));
      const h = m.getDiv().clientHeight || 600;
      m.fitBounds(bornes, { top: 100, left: 110, right: 110, bottom: Math.round(h * basCouvert) + 60 });
    }
    return () => { repZones.current.forEach((r) => r.retirer()); repZones.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, cleZ]);

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
        `<span class="halo"></span><i>${vehicle === 'moto' ? repereVehicule('scooter-dessus', 24) : repereVehicule(nomVoitureDessus(accent), 30)}</i>`), car);
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

  // 8. VÉHICULES LIBRES AUTOUR DU CLIENT (comme Yango) : chacun glisse de sa position à la
  //    suivante en 1,5 s, orienté dans le sens de la marche ; ceux qui partent s'effacent.
  //    Une seule boucle d'animation pour tous, arrêtée dès qu'ils sont posés (batterie).
  const cleVoisins = (voisins ?? []).map((v) => `${v.id}:${v.lat.toFixed(5)},${v.lng.toFixed(5)}`).join(';');
  useEffect(() => {
    const g = api.current; const m = carte.current;
    if (!prete || !g || !m) return;
    const F = flotte.current;
    const liste = car ? [] : (voisins ?? []);      // pendant la course, seul « son » chauffeur compte
    const vus = new Set(liste.map((v) => v.id));
    for (const [id, v] of F) if (!vus.has(id)) { v.repere.retirer(); F.delete(id); }
    const trajets: Array<{ v: { repere: Repere; pos: LatLng; angle: number }; de: LatLng; vers: LatLng; angle: number }> = [];
    for (const n of liste) {
      const vers = { lat: n.lat, lng: n.lng };
      const ex = F.get(n.id);
      if (!ex) {
        const html = n.gamme === 'moto' ? repereVehicule('scooter-dessus', 18) : repereVehicule(nomVoitureDessus(accent), 22);
        const repere = poserRepere(g, m, element('carte-voisin', `<i>${html}</i>`), vers);
        repere.placer(vers, n.cap);
        F.set(n.id, { repere, pos: vers, angle: n.cap });
        continue;
      }
      if (Math.abs(ex.pos.lat - vers.lat) < 1e-7 && Math.abs(ex.pos.lng - vers.lng) < 1e-7) continue;
      const loin = Math.hypot(vers.lat - ex.pos.lat, vers.lng - ex.pos.lng) > 0.02;   // > 2 km : saut, pas de glissade
      const angle = cap(ex.pos, vers);
      if (loin) { ex.repere.placer(vers, angle); ex.pos = vers; ex.angle = angle; continue; }
      trajets.push({ v: ex, de: ex.pos, vers, angle });
      ex.pos = vers; ex.angle = angle;
    }
    if (!trajets.length) return;
    const t0 = performance.now();
    let raf = 0;
    const etape = (t: number) => {
      const f = Math.min(1, (t - t0) / 1500);
      const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      for (const x of trajets) x.v.repere.placer({ lat: x.de.lat + (x.vers.lat - x.de.lat) * e, lng: x.de.lng + (x.vers.lng - x.de.lng) * e }, x.angle);
      if (f < 1) raf = requestAnimationFrame(etape);
    };
    raf = requestAnimationFrame(etape);
    return () => {
      cancelAnimationFrame(raf);
      for (const x of trajets) x.v.repere.placer(x.vers, x.angle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, cleVoisins, Boolean(car)]);

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
