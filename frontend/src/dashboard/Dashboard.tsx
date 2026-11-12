import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as CarteML, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { chargerML } from '../components/chargerCarte';
import { styleOrion } from '../components/styleCarte';
import { getVectorConfig } from '../mapConfig';
import { LIVE } from '../admin/api';
import { AccesRefuse, NonConnecte, ecouter, lireEtat, seConnecter } from './donnees';
import { AccesReserve } from './AccesReserve';
import { Objectifs } from './Objectifs';
import type { CourseActive, EntreeJournal, EtatTableau, VehiculeFlotte } from './types';

/**
 * TABLEAU DE BORD ORION : une interface à part, pensée pour l'écran de la salle de
 * supervision. Elle se synchronise avec tout l'écosystème : chaque commande de l'app
 * cliente, chaque geste de l'app chauffeur, chaque action de la console arrive dans le
 * journal à l'instant où le serveur la publie, et les chiffres suivent.
 */

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
/** Accord en français : 0 et 1 au singulier. */
const pl = (n: number, mot: string, pluriel = `${mot}s`) => `${n} ${n > 1 ? pluriel : mot}`;
const heure = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ilYa = (iso: string, maintenant: number) => {
  const s = Math.max(0, Math.round((maintenant - Date.parse(iso)) / 1000));
  if (s < 45) return 'à l’instant';
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

type Vue = 'direct' | 'objectifs';
/** Événements qui changent les chiffres des objectifs et des tendances. */
const GENRES_ANALYSE = new Set<EntreeJournal['genre']>(['commande', 'terminee', 'paiement', 'annulation']);
const DEFILEMENT_MS = 45_000;
const lirePref = (cle: string) => { try { return localStorage.getItem(cle); } catch { return null; } };
const ecrirePref = (cle: string, v: string) => { try { localStorage.setItem(cle, v); } catch { /* stockage indisponible */ } };

export function Tableau() {
  const [vue, setVueEtat] = useState<Vue>(() => (window.location.hash === '#objectifs' ? 'objectifs' : 'direct'));
  // Écran mural : les deux vues peuvent défiler seules.
  const [defilement, setDefilementEtat] = useState(() => lirePref('orion.tableau.defilement') === '1');
  const [signal, setSignal] = useState(0);
  const setVue = useCallback((v: Vue) => {
    setVueEtat(v);
    try { window.history.replaceState(null, '', v === 'objectifs' ? '#objectifs' : window.location.pathname + window.location.search); } catch { /* aperçu sans historique */ }
  }, []);
  const setDefilement = (on: boolean) => { setDefilementEtat(on); ecrirePref('orion.tableau.defilement', on ? '1' : '0'); };
  useEffect(() => {
    if (!defilement) return;
    const t = window.setInterval(() => setVueEtat((v) => (v === 'direct' ? 'objectifs' : 'direct')), DEFILEMENT_MS);
    return () => window.clearInterval(t);
  }, [defilement]);
  const flux = useTableauDirect(setSignal);
  const { setConnexion, setRefus } = flux;
  const surRefus = useCallback((connexion: boolean) => (connexion ? setConnexion(true) : setRefus(true)), [setConnexion, setRefus]);
  const surAcces = useCallback(() => setRefus(false), [setRefus]);
  const surConnexion = useCallback(() => { setRefus(false); setConnexion(true); }, [setConnexion, setRefus]);

  if (flux.connexion) return <Connexion onOk={() => { setConnexion(false); }} />;
  // Connecté sans droit : rien du tableau n'est chargé ni affiché.
  if (flux.refus) return <AccesReserve onAcces={surAcces} onConnexion={surConnexion} />;

  return (
    <div className="tb">
      <Entete direct={flux.direct} maintenant={flux.maintenant} vue={vue} setVue={setVue} defilement={defilement} setDefilement={setDefilement} />
      {flux.erreur && <div className="tb-erreur" role="status">{flux.erreur}</div>}
      {vue === 'objectifs'
        // Les courbes attendent que l'accès soit vérifié : une seule lecture refusée, pas deux.
        ? (flux.pret ? <Objectifs signal={signal} onRefus={surRefus} /> : <div className="tb-chargement">Vérification de l’accès…</div>)
        : <VueDirect etat={flux.etat} journal={flux.journal} nouveaux={flux.nouveaux} maintenant={flux.maintenant} />}
    </div>
  );
}

/** Le direct : état complet toutes les 4 s, journal par WebSocket. */
function useTableauDirect(onAnalyse: (f: (n: number) => number) => void) {
  const [etat, setEtat] = useState<EtatTableau | null>(null);
  const [journal, setJournal] = useState<EntreeJournal[]>([]);
  const [nouveaux, setNouveaux] = useState<Set<string>>(new Set());
  const [direct, setDirect] = useState(false);
  const [connexion, setConnexion] = useState(false);
  const [refus, setRefus] = useState(false);
  // Le direct (WebSocket) ne s'ouvre qu'une fois l'accès vérifié par une première lecture.
  const [pret, setPret] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [maintenant, setMaintenant] = useState(() => new Date());
  const relecture = useRef<number | undefined>(undefined);

  const charger = useCallback(async () => {
    try {
      const e = await lireEtat();
      setEtat(e);
      setPret(true);
      setErreur(null);
      // Le journal du serveur fait foi ; les lignes arrivées en direct entre-temps restent.
      setJournal((j) => {
        const ids = new Set(e.journal.map((x) => x.id));
        return [...j.filter((x) => !ids.has(x.id) && Date.parse(x.at) > Date.parse(e.journal[0]?.at ?? '0')), ...e.journal].slice(0, 30);
      });
    } catch (err) {
      if (err instanceof NonConnecte) { setConnexion(true); setPret(false); }
      else if (err instanceof AccesRefuse) { setRefus(true); setPret(false); setEtat(null); }
      else setErreur('Serveur ORION injoignable : nouvelle tentative…');
    }
  }, []);

  useEffect(() => {
    if (connexion || refus) return;
    void charger();
    const t = window.setInterval(() => void charger(), 4000);
    return () => window.clearInterval(t);
  }, [charger, connexion, refus]);

  useEffect(() => {
    if (!pret || connexion || refus) return;
    const fin = ecouter((e) => {
      setJournal((j) => (j.some((x) => x.id === e.id) ? j : [e, ...j].slice(0, 30)));
      setNouveaux((n) => new Set(n).add(e.id));
      window.setTimeout(() => setNouveaux((n) => { const m = new Set(n); m.delete(e.id); return m; }), 2600);
      window.clearTimeout(relecture.current);
      relecture.current = window.setTimeout(() => void charger(), 500);
      if (GENRES_ANALYSE.has(e.genre)) onAnalyse((n) => n + 1);
    }, setDirect, () => onAnalyse((n) => n + 1));
    return fin;
  }, [charger, connexion, refus, pret, onAnalyse]);

  useEffect(() => {
    const t = window.setInterval(() => setMaintenant(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  return { etat, journal, nouveaux, direct, connexion, setConnexion, refus, setRefus, pret, erreur, maintenant };
}

function VueDirect({ etat, journal, nouveaux, maintenant }: { etat: EtatTableau | null; journal: EntreeJournal[]; nouveaux: Set<string>; maintenant: Date }) {
  if (!etat) return <div className="tb-chargement">Chargement du tableau de bord…</div>;
  return (
        <main className="tb-grille">
          <Tuiles e={etat} />
          <section className="tb-panneau tb-carte" aria-label="Carte de la flotte en direct">
            <div className="tb-panneau-h">
              <h2>Flotte en direct · Abidjan</h2>
              <Legende />
            </div>
            <CarteFlotte flotte={etat.flotte} courses={etat.coursesActives} />
          </section>
          <section className="tb-panneau tb-journal" aria-label="Journal d'activité">
            <div className="tb-panneau-h">
              <h2>Activité en direct</h2>
              <span className="tb-muet">app client · app chauffeur · console</span>
            </div>
            <Journal entrees={journal} nouveaux={nouveaux} maintenant={maintenant.getTime()} />
          </section>
          <section className="tb-panneau tb-heures" aria-label="Commandes par heure">
            <div className="tb-panneau-h">
              <h2>Commandes d’aujourd’hui, heure par heure</h2>
              <div className="tb-legende">
                <span><i style={{ background: 'var(--serie-course)' }} />Courses</span>
                <span><i style={{ background: 'var(--serie-livraison)' }} />Livraisons moto</span>
              </div>
            </div>
            <ParHeure donnees={etat.parHeure} heureCourante={maintenant.getHours()} />
          </section>
          <section className="tb-panneau tb-paiements" aria-label="Encaissements du jour">
            <div className="tb-panneau-h"><h2>Encaissements du jour</h2><span className="tb-muet">par moyen de paiement</span></div>
            <Paiements paiements={etat.paiements} />
          </section>
        </main>
  );
}

/* --------------------------------- En-tête --------------------------------- */

function Entete({ direct, maintenant, vue, setVue, defilement, setDefilement }: {
  direct: boolean; maintenant: Date; vue: Vue; setVue: (v: Vue) => void; defilement: boolean; setDefilement: (on: boolean) => void;
}) {
  return (
    <header className="tb-entete">
      <div className="tb-marque">
        <span className="tb-logo" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 512 512"><path d="M256 92 C 338 150 372 252 318 350 C 300 382 280 404 256 424 C 232 404 212 382 194 350 C 140 252 174 150 256 92 Z" fill="#04140d"/><g fill="#04140d"><circle cx="372" cy="120" r="15"/><circle cx="406" cy="150" r="12"/><circle cx="430" cy="186" r="9"/></g></svg>
        </span>
        <div>
          <strong>ORION</strong>
          <span>Tableau de bord</span>
        </div>
      </div>
      <nav className="tb-onglets" aria-label="Vues du tableau de bord">
        <button type="button" className={vue === 'direct' ? 'on' : ''} aria-current={vue === 'direct' ? 'page' : undefined} onClick={() => setVue('direct')}>En direct</button>
        <button type="button" className={vue === 'objectifs' ? 'on' : ''} aria-current={vue === 'objectifs' ? 'page' : undefined} onClick={() => setVue('objectifs')}>Objectifs et tendances</button>
        <label className="tb-defil" title="Écran mural : alterne les deux vues toutes les 45 secondes">
          <input type="checkbox" checked={defilement} onChange={(e) => setDefilement(e.target.checked)} />
          <span className="tb-defil-int" aria-hidden />Défilement auto
        </label>
      </nav>
      <div className="tb-entete-d">
        <span className={`tb-direct${direct ? '' : ' hors'}`} role="status">
          <i aria-hidden />{direct ? (LIVE ? 'EN DIRECT' : 'DÉMONSTRATION') : 'RECONNEXION…'}
        </span>
        <span className="tb-date">{maintenant.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <span className="tb-horloge" aria-label="Heure">{heure(maintenant)}</span>
        <a className="tb-lien" href="./admin.html">Console ↗</a>
      </div>
    </header>
  );
}

/* --------------------------------- Tuiles --------------------------------- */

function Tuile({ libelle, valeur, detail, ton, icone }: { libelle: string; valeur: string; detail: string; ton?: 'alerte' | 'calme'; icone: React.ReactNode }) {
  return (
    <div className={`tb-tuile${ton ? ` ${ton}` : ''}`}>
      <span className="tb-tuile-ico" aria-hidden>{icone}</span>
      <span className="tb-tuile-lib">{libelle}</span>
      <span className="tb-tuile-val">{valeur}</span>
      <span className="tb-tuile-det">{detail}</span>
    </div>
  );
}

function Tuiles({ e }: { e: EtatTableau }) {
  const a = e.aujourdhui;
  const s = e.securite;
  return (
    <div className="tb-tuiles">
      <Tuile icone={<IcoVoiture />} libelle="Courses en cours" valeur={String(e.enDirect.courses)}
        detail={e.enDirect.enRecherche ? `${e.enDirect.enRecherche} en recherche de chauffeur` : 'VTC électrique, en direct'} />
      <Tuile icone={<IcoScooter />} libelle="Livraisons moto en cours" valeur={String(e.enDirect.livraisons)}
        detail={`${pl(e.conducteurs.coursiers, 'coursier')} en service`} />
      <Tuile icone={<IcoVolant />} libelle="Conducteurs en ligne" valeur={String(e.conducteurs.enLigne)}
        detail={`${e.conducteurs.enCourse} en course · ${pl(e.conducteurs.enLigne - e.conducteurs.enCourse, 'disponible')}`} />
      <Tuile icone={<IcoCaisse />} libelle="Chiffre d’affaires du jour" valeur={fcfa(a.chiffreAffaires)}
        detail={a.panierMoyen ? `panier moyen ${fcfa(a.panierMoyen)}` : 'aucune course terminée'} />
      <Tuile icone={<IcoDrapeau />} libelle="Terminées aujourd’hui" valeur={String(a.courses + a.livraisons)}
        detail={`${pl(a.courses, 'course')} · ${pl(a.livraisons, 'livraison')}${a.noteMoyenne ? ` · ${a.noteMoyenne.toLocaleString('fr-FR')} ★` : ''}`} />
      <Tuile icone={<IcoBouclier />} libelle="Sécurité" ton={s.alertesOuvertes ? 'alerte' : 'calme'}
        valeur={s.alertesOuvertes ? pl(s.alertesOuvertes, 'alerte') : 'RAS'}
        detail={`${pl(s.controles, 'contrôle')} · ${pl(e.assurance.inscrits, 'assuré')} ORION`} />
    </div>
  );
}

/* ------------------------------ Carte de flotte ------------------------------ */

function Legende() {
  return (
    <div className="tb-legende">
      <span><i className="pastille libre" />Disponible</span>
      <span><i className="pastille course" />En course</span>
      <span><i style={{ background: 'var(--serie-course)' }} />Trajet course</span>
      <span><i style={{ background: 'var(--serie-livraison)' }} />Trajet livraison</span>
    </div>
  );
}

const SVG_VOITURE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11a2 2 0 0 1 2 2v3.5a1 1 0 0 1-1 1h-1a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H4a1 1 0 0 1-1-1V13a2 2 0 0 1 2-2zm2.2 0h9.6l-1.2-3.3a.6.6 0 0 0-.6-.4H9a.6.6 0 0 0-.6.4z"/></svg>';
const SVG_SCOOTER = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M14 5h3l1 4.2a4 4 0 1 1-2 .5L15.4 7H14zM6 12h6.5l1.2 3H9.9A3.5 3.5 0 1 1 6 12zm0 2.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm12 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"/></svg>';

function trajetsGeoJSON(courses: CourseActive[]) {
  return {
    type: 'FeatureCollection' as const,
    features: courses.map((c) => ({
      type: 'Feature' as const,
      properties: { service: c.service },
      geometry: { type: 'LineString' as const, coordinates: (c.itineraire && c.itineraire.length > 1 ? c.itineraire : [c.origine, c.destination]).map((p) => [p.lng, p.lat]) },
    })),
  };
}
function arriveesGeoJSON(courses: CourseActive[]) {
  return {
    type: 'FeatureCollection' as const,
    features: courses.map((c) => ({ type: 'Feature' as const, properties: { service: c.service }, geometry: { type: 'Point' as const, coordinates: [c.destination.lng, c.destination.lat] } })),
  };
}

function CarteFlotte({ flotte, courses }: { flotte: VehiculeFlotte[]; courses: CourseActive[] }) {
  const boite = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteML | null>(null);
  const marqueurs = useRef(new Map<string, Marker>());
  const [prete, setPrete] = useState(false);
  const [indispo, setIndispo] = useState(false);
  const config = useMemo(() => getVectorConfig(), []);

  useEffect(() => {
    if (!config) { setIndispo(true); return; }
    let annule = false;
    void chargerML().then((ml) => {
      if (annule || !boite.current) return;
      const m = new ml.Map({
        container: boite.current, style: styleOrion('dark', config), center: [-3.995, 5.333], zoom: 11.9,
        attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 120,
      });
      m.addControl(new ml.AttributionControl({ compact: true, customAttribution: config.attribution }), 'bottom-left');
      m.on('load', () => {
        boite.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        m.addSource('trajets', { type: 'geojson', data: trajetsGeoJSON([]) });
        m.addSource('arrivees', { type: 'geojson', data: arriveesGeoJSON([]) });
        const couleur = ['match', ['get', 'service'], 'livraison', '#3987e5', '#18a571'] as unknown as string;
        m.addLayer({ id: 'trajets-halo', type: 'line', source: 'trajets', paint: { 'line-color': '#04110b', 'line-width': 7, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        m.addLayer({ id: 'trajets', type: 'line', source: 'trajets', paint: { 'line-color': couleur, 'line-width': 3.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        m.addLayer({ id: 'arrivees', type: 'circle', source: 'arrivees', paint: { 'circle-radius': 6, 'circle-color': couleur, 'circle-stroke-color': '#0b1a14', 'circle-stroke-width': 2.5 } });
        carte.current = m;
        setPrete(true);
      });
      m.on('error', (e) => { if (!m.loaded() && /Failed to fetch|NetworkError|AJAXError/i.test(String((e as unknown as { error?: { message?: string } }).error?.message ?? ''))) setIndispo(true); });
    }).catch(() => setIndispo(true));
    return () => { annule = true; carte.current?.remove(); carte.current = null; marqueurs.current.clear(); };
  }, [config]);

  // Trajets en cours.
  useEffect(() => {
    const m = carte.current;
    if (!m || !prete) return;
    (m.getSource('trajets') as GeoJSONSource | undefined)?.setData(trajetsGeoJSON(courses));
    (m.getSource('arrivees') as GeoJSONSource | undefined)?.setData(arriveesGeoJSON(courses));
  }, [courses, prete]);

  // Véhicules : un marqueur par conducteur en service, déplacé en douceur.
  useEffect(() => {
    const m = carte.current;
    if (!m || !prete) return;
    void chargerML().then((ml) => {
      const vus = new Set<string>();
      for (const v of flotte) {
        vus.add(v.id);
        let mk = marqueurs.current.get(v.id);
        if (!mk) {
          const el = document.createElement('div');
          el.className = 'tb-vehicule';
          el.innerHTML = v.moto ? SVG_SCOOTER : SVG_VOITURE;
          mk = new ml.Marker({ element: el }).setLngLat([v.lng, v.lat]).addTo(m);
          marqueurs.current.set(v.id, mk);
        }
        const el = mk.getElement();
        el.classList.toggle('course', v.enCourse);
        el.classList.toggle('moto', v.moto);
        el.title = `${v.nom} · ${v.moto ? 'coursier moto' : `gamme ${v.categorie}`} · ${v.enCourse ? 'en course' : 'disponible'}`;
        mk.setLngLat([v.lng, v.lat]);
      }
      for (const [id, mk] of marqueurs.current) if (!vus.has(id)) { mk.remove(); marqueurs.current.delete(id); }
    });
  }, [flotte, prete]);

  return (
    <div className="tb-carte-boite">
      <div ref={boite} className="tb-carte-ml" />
      {indispo && <div className="tb-carte-indispo">Carte indisponible : vérifiez la connexion au serveur de tuiles.</div>}
      <div className="tb-carte-compte" aria-live="polite">
        <strong>{flotte.length}</strong> en service · <strong>{courses.length}</strong> {courses.length > 1 ? 'trajets' : 'trajet'} en cours
      </div>
    </div>
  );
}

/* --------------------------------- Journal --------------------------------- */

const ICONE_GENRE: Record<EntreeJournal['genre'], () => React.ReactNode> = {
  commande: () => <IcoPlus />, attribution: () => <IcoVolant />, approche: () => <IcoFleche />, arrivee: () => <IcoEpingle />,
  depart: () => <IcoFleche />, terminee: () => <IcoDrapeau />, paiement: () => <IcoCaisse />, annulation: () => <IcoCroix />,
  alerte: () => <IcoBouclier />, secours: () => <IcoTel />, message: () => <IcoBulle />, location: () => <IcoVoiture />,
};

function Journal({ entrees, nouveaux, maintenant }: { entrees: EntreeJournal[]; nouveaux: Set<string>; maintenant: number }) {
  if (!entrees.length) return <p className="tb-vide">En attente d’activité : chaque commande, attribution, livraison ou alerte s’affichera ici en direct.</p>;
  return (
    <ol className="tb-fil">
      {entrees.map((e) => (
        <li key={e.id} className={`tb-ligne ${e.niveau}${nouveaux.has(e.id) ? ' nouveau' : ''}`}>
          <span className={`tb-ligne-ico ${e.service ?? 'neutre'}`} aria-hidden>{ICONE_GENRE[e.genre]()}</span>
          <span className="tb-ligne-corps">
            <span className="tb-ligne-titre">{e.titre}</span>
            {e.detail && <span className="tb-ligne-detail">{e.detail}</span>}
          </span>
          <span className="tb-ligne-d">
            {e.service && <span className={`tb-puce ${e.service}`}>{e.service === 'livraison' ? 'Livraison' : 'Course'}</span>}
            <time dateTime={e.at}>{ilYa(e.at, maintenant)}</time>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* --------------------------------- Graphiques --------------------------------- */

function ParHeure({ donnees, heureCourante }: { donnees: EtatTableau['parHeure']; heureCourante: number }) {
  const [survol, setSurvol] = useState<number | null>(null);
  const L = 720, H = 190, G = 30, B = 22, haut = 10;
  const max = Math.max(4, ...donnees.map((d) => d.courses + d.livraisons));
  const pas = (L - G) / 24;
  const larg = Math.max(6, pas - 6);
  const y = (v: number) => H - B - (v / max) * (H - B - haut);
  const graduations = [0, Math.round(max / 2), max];
  const d = survol !== null ? donnees[survol] : null;
  return (
    <div className="tb-graph">
      <svg viewBox={`0 0 ${L} ${H}`} role="img" aria-label="Commandes par heure, courses et livraisons" onMouseLeave={() => setSurvol(null)}>
        {graduations.map((g) => (
          <g key={g}>
            <line x1={G} x2={L} y1={y(g)} y2={y(g)} className="tb-grille-l" />
            <text x={G - 6} y={y(g) + 4} className="tb-axe" textAnchor="end">{g}</text>
          </g>
        ))}
        {donnees.map((p, i) => {
          const x = G + i * pas + (pas - larg) / 2;
          const yc = y(p.courses);
          const yl = y(p.courses + p.livraisons);
          const total = p.courses + p.livraisons;
          return (
            <g key={p.heure} onMouseEnter={() => setSurvol(i)}>
              <rect x={G + i * pas} y={haut} width={pas} height={H - B - haut} fill="transparent" />
              {p.courses > 0 && <path d={barre(x, yc, larg, H - B - yc, p.livraisons === 0)} fill="var(--serie-course)" />}
              {p.livraisons > 0 && <path d={barre(x, yl, larg, Math.max(0, yc - yl - (p.courses ? 2 : 0)), true)} fill="var(--serie-livraison)" />}
              {i === heureCourante && <rect x={x - 2} y={H - B + 3} width={larg + 4} height={3} rx={1.5} fill="var(--texte)" opacity={0.8} />}
              {(i % 3 === 0) && <text x={x + larg / 2} y={H - 4} className="tb-axe" textAnchor="middle">{i} h</text>}
              {survol === i && total > 0 && <rect x={x - 2} y={yl - 2} width={larg + 4} height={H - B - yl + 2} fill="none" stroke="var(--texte)" strokeOpacity={0.5} rx={4} />}
            </g>
          );
        })}
      </svg>
      {d && (
        <div className="tb-infobulle" style={{ left: `${((G + (survol! + 0.5) * pas) / L) * 100}%` }}>
          <strong>{d.heure} h – {d.heure + 1} h</strong>
          <span><i style={{ background: 'var(--serie-course)' }} />{d.courses} course{d.courses > 1 ? 's' : ''}</span>
          <span><i style={{ background: 'var(--serie-livraison)' }} />{d.livraisons} livraison{d.livraisons > 1 ? 's' : ''}</span>
        </div>
      )}
      <table className="tb-sr">
        <caption>Commandes par heure</caption>
        <thead><tr><th>Heure</th><th>Courses</th><th>Livraisons</th></tr></thead>
        <tbody>{donnees.map((p) => <tr key={p.heure}><td>{p.heure} h</td><td>{p.courses}</td><td>{p.livraisons}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Barre à bout arrondi (4 px) du côté de la valeur, base droite sur l'axe. */
function barre(x: number, y: number, l: number, h: number, arrondi: boolean): string {
  if (h <= 0) return '';
  const r = arrondi ? Math.min(4, h, l / 2) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + l - r} Q${x + l},${y} ${x + l},${y + r} V${y + h} Z`;
}

function Paiements({ paiements }: { paiements: Record<string, number> }) {
  const lignes = Object.entries(paiements).sort((a, b) => b[1] - a[1]);
  const total = lignes.reduce((s, [, v]) => s + v, 0);
  if (!total) return <p className="tb-vide">Aucun encaissement pour l’instant aujourd’hui.</p>;
  const max = lignes[0]![1];
  return (
    <ul className="tb-barres">
      {lignes.map(([moyen, v]) => (
        <li key={moyen} title={`${moyen} : ${fcfa(v)} (${Math.round((v / total) * 100)} %)`}>
          <span className="tb-barre-lib">{moyen}</span>
          <span className="tb-barre-piste"><span className="tb-barre" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} /></span>
          <span className="tb-barre-val">{fcfa(v)} <em>{Math.round((v / total) * 100)} %</em></span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------- Connexion --------------------------------- */

function Connexion({ onOk }: { onOk: () => void }) {
  const [id, setId] = useState('');
  const [mdp, setMdp] = useState('');
  const [code, setCode] = useState('');
  const [deuxFacteurs, setDeuxFacteurs] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const valider = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnvoi(true); setErreur('');
    try {
      const r = await seConnecter(id.trim(), mdp, deuxFacteurs ? code.trim() : undefined);
      if (r === 'ok') onOk();
      else if (r === 'code') setDeuxFacteurs(true);
      else setErreur(r);
    } catch { setErreur('Serveur injoignable. Réessayez dans un instant.'); }
    setEnvoi(false);
  };
  return (
    <div className="tb-connexion">
      <form onSubmit={valider} className="tb-connexion-carte">
        <span className="tb-logo grand" aria-hidden>
          <svg width="30" height="30" viewBox="0 0 512 512"><path d="M256 92 C 338 150 372 252 318 350 C 300 382 280 404 256 424 C 232 404 212 382 194 350 C 140 252 174 150 256 92 Z" fill="#04140d"/></svg>
        </span>
        <h1>Tableau de bord ORION</h1>
        <p>Accès réservé au personnel ORION, avec les identifiants de la console.</p>
        {!deuxFacteurs ? (
          <>
            <label>Identifiant<input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoFocus /></label>
            <label>Mot de passe<input type="password" value={mdp} onChange={(e) => setMdp(e.target.value)} autoComplete="current-password" /></label>
          </>
        ) : (
          <label>Code à 6 chiffres<input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
        )}
        {erreur && <p className="tb-connexion-err" role="alert">{erreur}</p>}
        <button type="submit" disabled={envoi || !id || !mdp}>{envoi ? 'Connexion…' : 'Ouvrir le tableau de bord'}</button>
      </form>
    </div>
  );
}

/* --------------------------------- Icônes --------------------------------- */

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoVoiture = () => <Svg><path d="M5 16V12l2-5h10l2 5v4M3 16h18M7 19a1.5 1.5 0 1 0 0-.01M17 19a1.5 1.5 0 1 0 0-.01M5 12h14" /></Svg>;
const IcoScooter = () => <Svg><circle cx="6" cy="17" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path d="M8.5 17h6.5l-2-6H8M14 5h3l1.5 6.5" /></Svg>;
const IcoVolant = () => <Svg><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2" /><path d="M3.8 10.5 10 12M20.2 10.5 14 12M12 14v6.3" /></Svg>;
const IcoCaisse = () => <Svg><rect x="3" y="6" width="18" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.5" /><path d="M6.5 9.5v.01M17.5 14.5v.01" /></Svg>;
const IcoDrapeau = () => <Svg><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></Svg>;
const IcoBouclier = () => <Svg><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></Svg>;
const IcoPlus = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>;
const IcoFleche = () => <Svg><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const IcoEpingle = () => <Svg><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></Svg>;
const IcoCroix = () => <Svg><path d="M6 6l12 12M18 6 6 18" /></Svg>;
const IcoTel = () => <Svg><path d="M5 4h4l1.5 4.5-2.5 1.5a11 11 0 0 0 6 6l1.5-2.5L20 15v4a1.5 1.5 0 0 1-1.6 1.5C10.6 20 4 13.4 3.5 5.6A1.5 1.5 0 0 1 5 4z" /></Svg>;
const IcoBulle = () => <Svg><path d="M4 5h16v11H9l-5 4z" /></Svg>;
