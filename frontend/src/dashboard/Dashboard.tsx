import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as CarteML, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { chargerML } from '../components/chargerCarte';
import { styleOrion } from '../components/styleCarte';
import { comblerCarte } from '../lieux';
import { LogoApp } from '../components/Logo';
import { Objet, Scooter, Voiture, type Icone3D, type ObjetService } from '../components/Vehicules';
import { getVectorConfig } from '../mapConfig';
import { LIVE } from '../admin/api';
import { AccesRefuse, NonConnecte, ecouter, lireEtat, seConnecter } from './donnees';
import { AccesReserve } from './AccesReserve';
import { Objectifs } from './Objectifs';
import type { CourseActive, EntreeJournal, EtatTableau, VehiculeFlotte } from './types';
import { EnrolementAppareil, LigneAppareil, estAppEmballee, useEtatAppareil, type ClassesFormulaire } from '../appareil';
import { BoutonInstaller } from '../pwa';

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

/** Thème : suit le téléphone ou l'ordinateur (auto), ou un choix explicite mémorisé. */
type ChoixTheme = 'auto' | 'light' | 'dark';
type Theme = 'light' | 'dark';
const systemeClair = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches;
function useThemeTableau() {
  const [choix, setChoixEtat] = useState<ChoixTheme>(() => {
    const c = lirePref('orion.tableau.theme');
    return c === 'light' || c === 'dark' ? c : 'auto';
  });
  const [systeme, setSysteme] = useState<Theme>(() => (systemeClair() ? 'light' : 'dark'));
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const suivre = () => setSysteme(mq.matches ? 'light' : 'dark');
    mq.addEventListener?.('change', suivre);
    return () => mq.removeEventListener?.('change', suivre);
  }, []);
  useEffect(() => {
    if (choix === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choix;
  }, [choix]);
  const setChoix = (c: ChoixTheme) => { setChoixEtat(c); ecrirePref('orion.tableau.theme', c); };
  return { choix, setChoix, theme: (choix === 'auto' ? systeme : choix) as Theme };
}

export function Tableau() {
  const apparence = useThemeTableau();
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
      <Entete direct={flux.direct} maintenant={flux.maintenant} vue={vue} setVue={setVue} defilement={defilement} setDefilement={setDefilement}
        choixTheme={apparence.choix} setChoixTheme={apparence.setChoix} />
      {flux.erreur && <div className="tb-erreur" role="status">{flux.erreur}</div>}
      {vue === 'objectifs'
        // Les courbes attendent que l'accès soit vérifié : une seule lecture refusée, pas deux.
        ? (flux.pret ? <Objectifs signal={signal} onRefus={surRefus} /> : <div className="tb-chargement">Vérification de l’accès…</div>)
        : <VueDirect etat={flux.etat} journal={flux.journal} nouveaux={flux.nouveaux} debit={flux.debit} maintenant={flux.maintenant} theme={apparence.theme} />}
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

  // LE DIRECT, PAR LOTS. Chaque lot reçu va dans un tampon ; l'écran se met à jour au
  // plus toutes les 300 ms, une seule fois pour tout ce qui est arrivé entre-temps.
  // Avant, chaque ligne déclenchait son propre rendu et sa propre minuterie : sous un
  // test de 5 000 courses, des milliers par seconde, et l'onglet ne répondait plus.
  const tampon = useRef<{ entrees: EntreeJournal[]; recus: number }>({ entrees: [], recus: 0 });
  const masseRef = useRef(false);
  masseRef.current = etat?.carte?.mode === 'masse';
  const historique = useRef<Array<{ t: number; n: number }>>([]);
  const [debit, setDebit] = useState(0);
  useEffect(() => {
    if (!pret || connexion || refus) return;
    let vidage: number | undefined;
    let effacement: number | undefined;
    let relectureDifferee: number | undefined;
    let derniereRelecture = 0;
    const relire = () => {
      const t = Date.now();
      if (t - derniereRelecture >= 1500) { derniereRelecture = t; void charger(); return; }
      relectureDifferee ??= window.setTimeout(() => { relectureDifferee = undefined; derniereRelecture = Date.now(); void charger(); }, 1500 - (t - derniereRelecture));
    };
    const vider = () => {
      vidage = undefined;
      const { entrees, recus } = tampon.current;
      tampon.current = { entrees: [], recus: 0 };
      if (!entrees.length && !recus) return;
      const t = Date.now();
      setJournal((j) => {
        const vus = new Set(j.map((x) => x.id));
        return [...entrees.filter((e) => !vus.has(e.id)), ...j].slice(0, 30);
      });
      setNouveaux(new Set(entrees.map((e) => e.id)));
      window.clearTimeout(effacement);
      effacement = window.setTimeout(() => setNouveaux(new Set()), 2600);
      historique.current.push({ t, n: recus });
      historique.current = historique.current.filter((x) => t - x.t <= 60_000);
      setDebit(historique.current.reduce((n, x) => n + x.n, 0));
      if (entrees.some((e) => GENRES_ANALYSE.has(e.genre))) onAnalyse((n) => n + 1);
      // Sous forte charge (carte en mode masse), la relecture toutes les 4 s suffit : le
      // journal montre le direct, et chaque relecture redessine des milliers de points.
      if (!masseRef.current) relire();
    };
    const fin = ecouter((entrees, recus) => {
      // Lots du plus récent au plus ancien : le dernier arrivé passe devant.
      tampon.current = { entrees: [...entrees, ...tampon.current.entrees].slice(0, 30), recus: tampon.current.recus + recus };
      vidage ??= window.setTimeout(vider, 300);
    }, setDirect, () => onAnalyse((n) => n + 1));
    return () => { fin(); window.clearTimeout(vidage); window.clearTimeout(effacement); window.clearTimeout(relectureDifferee); };
  }, [charger, connexion, refus, pret, onAnalyse]);

  useEffect(() => {
    const t = window.setInterval(() => setMaintenant(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  return { etat, journal, nouveaux, debit, direct, connexion, setConnexion, refus, setRefus, pret, erreur, maintenant };
}

function VueDirect({ etat, journal, nouveaux, debit, maintenant, theme }: { etat: EtatTableau | null; journal: EntreeJournal[]; nouveaux: Set<string>; debit: number; maintenant: Date; theme: Theme }) {
  if (!etat) return <div className="tb-chargement">Chargement du tableau de bord…</div>;
  return (
        <main className="tb-grille">
          <Tuiles e={etat} />
          <section className="tb-panneau tb-carte" aria-label="Carte de la flotte en direct">
            <div className="tb-panneau-h">
              <h2>Flotte en direct · Abidjan</h2>
              <Legende />
            </div>
            <CarteFlotte key={theme} theme={theme} flotte={etat.flotte} courses={etat.coursesActives} masse={etat.carte?.mode === 'masse' ? etat.carte : null}
              enService={etat.conducteurs.enLigne} enCoursTotal={etat.enDirect.courses + etat.enDirect.livraisons} />
          </section>
          <section className="tb-panneau tb-journal" aria-label="Journal d'activité">
            <div className="tb-panneau-h">
              <h2>Activité en direct</h2>
              {debit >= 60
                ? <span className="tb-debit" title="Événements reçus sur la dernière minute"><strong>{debit.toLocaleString('fr-FR')}</strong> événements/min</span>
                : <span className="tb-muet">app client · app chauffeur · console</span>}
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

const THEME_SUIVANT: Record<ChoixTheme, ChoixTheme> = { auto: 'light', light: 'dark', dark: 'auto' };
const THEME_LIBELLE: Record<ChoixTheme, string> = { auto: 'Auto', light: 'Clair', dark: 'Sombre' };

function Entete({ direct, maintenant, vue, setVue, defilement, setDefilement, choixTheme, setChoixTheme }: {
  direct: boolean; maintenant: Date; vue: Vue; setVue: (v: Vue) => void; defilement: boolean; setDefilement: (on: boolean) => void;
  choixTheme: ChoixTheme; setChoixTheme: (c: ChoixTheme) => void;
}) {
  return (
    <header className="tb-entete">
      <div className="tb-marque">
        <LogoApp size={42} className="tb-logo-volume" />
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
          <i aria-hidden />{direct ? (LIVE ? 'En direct' : 'Démonstration') : 'Reconnexion…'}
        </span>
        <span className="tb-date">{maintenant.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <span className="tb-horloge" aria-label="Heure">{heure(maintenant)}</span>
        <button type="button" className="tb-theme" onClick={() => setChoixTheme(THEME_SUIVANT[choixTheme])}
          title="Thème : automatique (suit l’appareil), clair ou sombre" aria-label={`Thème : ${THEME_LIBELLE[choixTheme]}. Changer de thème`}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></svg>
          {THEME_LIBELLE[choixTheme]}
        </button>
        <a className="tb-lien" href="./admin.html">Console ↗</a>
      </div>
    </header>
  );
}

/* --------------------------------- Tuiles --------------------------------- */

/** Tuile de chiffre. `objet` : l'objet en volume de ce que le chiffre compte (comme l'app cliente). */
function Tuile({ libelle, valeur, detail, ton, icone, objet }: {
  libelle: string; valeur: string; detail: string; ton?: 'alerte' | 'calme'; icone: React.ReactNode;
  objet?: 'voiture' | 'scooter' | ObjetService | Icone3D;
}) {
  return (
    <div className={`tb-tuile${ton ? ` ${ton}` : ''}`}>
      <span className={`tb-tuile-ico${objet ? ' volume' : ''}`} aria-hidden>
        {objet === 'voiture' ? <Voiture largeur={44} /> : objet === 'scooter' ? <Scooter largeur={44} /> : objet ? <Objet nom={objet} taille={38} /> : icone}
      </span>
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
      <Tuile objet="voiture" icone={<IcoVoiture />} libelle="Courses en cours" valeur={String(e.enDirect.courses)}
        detail={e.enDirect.enRecherche ? `${e.enDirect.enRecherche} en recherche de chauffeur` : 'VTC électrique, en direct'} />
      <Tuile objet="scooter" icone={<IcoScooter />} libelle="Livraisons moto en cours" valeur={String(e.enDirect.livraisons)}
        detail={`${pl(e.conducteurs.coursiers, 'coursier')} en service`} />
      <Tuile objet="chauffeur" icone={<IcoVolant />} libelle="Conducteurs en ligne" valeur={String(e.conducteurs.enLigne)}
        detail={`${e.conducteurs.enCourse} en course · ${pl(e.conducteurs.enLigne - e.conducteurs.enCourse, 'disponible')}`} />
      <Tuile objet="finances" icone={<IcoCaisse />} libelle="Chiffre d’affaires du jour" valeur={fcfa(a.chiffreAffaires)}
        detail={a.panierMoyen ? `panier moyen ${fcfa(a.panierMoyen)}` : 'aucune course terminée'} />
      <Tuile objet="destination" icone={<IcoDrapeau />} libelle="Terminées aujourd’hui" valeur={String(a.courses + a.livraisons)}
        detail={`${pl(a.courses, 'course')} · ${pl(a.livraisons, 'livraison')}${a.noteMoyenne ? ` · ${a.noteMoyenne.toLocaleString('fr-FR')} ★` : ''}`} />
      <Tuile objet="assurance" icone={<IcoBouclier />} libelle="Sécurité" ton={s.alertesOuvertes ? 'alerte' : 'calme'}
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

/** Couleurs des tracés sur la carte, par thème (mêmes séries que les graphiques). */
const TRACES: Record<Theme, { course: string; livraison: string; halo: string; bord: string; libre: string; enCourse: string }> = {
  dark: { course: '#18a571', livraison: '#8f6bff', halo: '#0c0d0f', bord: '#0c0d0f', libre: '#2fd67b', enCourse: '#e8b84a' },
  light: { course: '#00a352', livraison: '#6a35f0', halo: '#ffffff', bord: '#ffffff', libre: '#00a352', enCourse: '#b7791f' },
};

type Masse = { libres: Array<[number, number]>; enCourse: Array<[number, number, number]> };
const VIDE = { type: 'FeatureCollection' as const, features: [] };
function pointsGeoJSON(points: Array<[number, number] | [number, number, number]>) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((p) => ({ type: 'Feature' as const, properties: { livraison: p[2] ?? 0 }, geometry: { type: 'Point' as const, coordinates: [p[0], p[1]] } })),
  };
}

function CarteFlotte({ flotte, courses, theme, masse, enService, enCoursTotal }: {
  flotte: VehiculeFlotte[]; courses: CourseActive[]; theme: Theme; masse: Masse | null; enService: number; enCoursTotal: number;
}) {
  const boite = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteML | null>(null);
  const marqueurs = useRef(new Map<string, Marker>());
  const vueElargie = useRef(false);
  const [prete, setPrete] = useState(false);
  const [indispo, setIndispo] = useState(false);
  const config = useMemo(() => getVectorConfig(), []);

  useEffect(() => {
    if (!config) { setIndispo(true); return; }
    let annule = false;
    void chargerML().then((ml) => {
      if (annule || !boite.current) return;
      const m = new ml.Map({
        container: boite.current, style: styleOrion(theme, config), center: [-3.995, 5.333], zoom: 11.9,
        attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 120,
      });
      m.addControl(new ml.AttributionControl({ compact: true, customAttribution: config.attribution }), 'bottom-left');
      m.on('load', () => {
        boite.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        m.addSource('trajets', { type: 'geojson', data: trajetsGeoJSON([]) });
        m.addSource('arrivees', { type: 'geojson', data: arriveesGeoJSON([]) });
        const T = TRACES[theme];
        const couleur = ['match', ['get', 'service'], 'livraison', T.livraison, T.course] as unknown as string;
        m.addLayer({ id: 'trajets-halo', type: 'line', source: 'trajets', paint: { 'line-color': T.halo, 'line-width': 7, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        m.addLayer({ id: 'trajets', type: 'line', source: 'trajets', paint: { 'line-color': couleur, 'line-width': 3.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        m.addLayer({ id: 'arrivees', type: 'circle', source: 'arrivees', paint: { 'circle-radius': 6, 'circle-color': couleur, 'circle-stroke-color': T.bord, 'circle-stroke-width': 2.5 } });
        // MODE MASSE : densité des courses en cours, puis un point par véhicule (couche
        // GPU : des milliers de points sans un seul élément HTML).
        m.addSource('libres', { type: 'geojson', data: VIDE });
        m.addSource('encourse', { type: 'geojson', data: VIDE });
        m.addLayer({ id: 'densite', type: 'heatmap', source: 'encourse', paint: {
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 13, 26, 15, 40],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1.2],
          'heatmap-opacity': theme === 'light' ? 0.5 : 0.6,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.2, theme === 'light' ? 'rgba(0,163,82,0.35)' : 'rgba(47,214,123,0.3)',
            0.5, theme === 'light' ? '#e8b021' : '#e8b84a', 0.85, theme === 'light' ? '#e36a3a' : '#ff8a4c', 1, theme === 'light' ? '#d92d3a' : '#ff5c6a'],
        } } as never, 'trajets-halo');
        m.addLayer({ id: 'libres', type: 'circle', source: 'libres', paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 14, 3.5], 'circle-color': T.libre, 'circle-opacity': 0.7,
        } });
        m.addLayer({ id: 'encourse', type: 'circle', source: 'encourse', paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 14, 4.2],
          'circle-color': ['match', ['get', 'livraison'], 1, T.livraison, T.enCourse] as unknown as string, 'circle-opacity': 0.9,
        } });
        // Mêmes lieux que l'app cliente : banques, sièges, écoles, commerces, immeubles nommés.
        if (config.lieuxIndex) comblerCarte(m, () => annule);
        carte.current = m;
        setPrete(true);
      });
      // Une tuile qui échoue (réseau passager, serveur de tuiles chargé) ne condamne pas
      // la carte : elle n'est déclarée indisponible que si elle ne s'est pas chargée au
      // bout de 12 s, et le message disparaît dès qu'elle se charge. Avant, une seule
      // tuile en échec au démarrage masquait la carte pour toute la séance.
      let chargee = false;
      const delai = window.setTimeout(() => { if (!chargee) setIndispo(true); }, 12_000);
      m.once('load', () => { chargee = true; window.clearTimeout(delai); setIndispo(false); });
      m.once('remove', () => window.clearTimeout(delai));
    }).catch(() => setIndispo(true));
    return () => { annule = true; carte.current?.remove(); carte.current = null; marqueurs.current.clear(); };
  }, [config, theme]);

  // Trajets en cours (en mode masse, des centaines de tracés superposés ne se lisent plus :
  // la densité et les points prennent le relais).
  useEffect(() => {
    const m = carte.current;
    if (!m || !prete) return;
    (m.getSource('trajets') as GeoJSONSource | undefined)?.setData(masse ? VIDE : trajetsGeoJSON(courses));
    (m.getSource('arrivees') as GeoJSONSource | undefined)?.setData(masse ? VIDE : arriveesGeoJSON(courses));
    (m.getSource('libres') as GeoJSONSource | undefined)?.setData(masse ? pointsGeoJSON(masse.libres) : VIDE);
    (m.getSource('encourse') as GeoJSONSource | undefined)?.setData(masse ? pointsGeoJSON(masse.enCourse) : VIDE);
    // Passage en mode masse : la vue s'élargit une fois à tout Abidjan (de Yopougon à la
    // Riviera), pour voir la densité de chaque commune d'un coup d'œil.
    if (masse && !vueElargie.current) {
      vueElargie.current = true;
      m.easeTo({ center: [-4.0, 5.345], zoom: 11.3, duration: 1600 });
    }
  }, [courses, masse, prete]);

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
        <strong>{enService.toLocaleString('fr-FR')}</strong> en service · <strong>{enCoursTotal.toLocaleString('fr-FR')}</strong> {enCoursTotal > 1 ? 'trajets' : 'trajet'} en cours
      </div>
    </div>
  );
}

/* --------------------------------- Journal --------------------------------- */

const ICONE_GENRE: Record<EntreeJournal['genre'], () => React.ReactNode> = {
  commande: () => <IcoPlus />, attribution: () => <IcoVolant />, approche: () => <IcoFleche />, arrivee: () => <IcoEpingle />, identite: () => <IcoCle />,
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

const CLASSES_TABLEAU: ClassesFormulaire = {
  carte: 'tb-connexion-carte', sous: 'tb-enrol-sous', label: 'tb-enrol-label', champ: 'tb-enrol-champ',
  bouton: 'tb-enrol-bouton', erreur: 'tb-connexion-err', lien: 'tb-enrol-lien',
};

function Connexion({ onOk }: { onOk: () => void }) {
  // Code de synchronisation ORION : même enrôlement que la console (un appareil enrôlé
  // pour l'une sert aussi pour l'autre, c'est le même appareil de confiance).
  const [etatAppareil, relireAppareil] = useEtatAppareil();
  const [enrolement, setEnrolement] = useState(false);
  const enrolementRequis = Boolean(etatAppareil?.configure && !etatAppareil.appareil && (etatAppareil.exige || estAppEmballee()));
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
      else if (r === 'appareil') { setEnrolement(true); relireAppareil(); }
      else setErreur(r);
    } catch { setErreur('Serveur injoignable. Réessayez dans un instant.'); }
    setEnvoi(false);
  };
  if (enrolement || enrolementRequis) {
    return (
      <div className="tb-connexion">
        <EnrolementAppareil application="tableau" classes={CLASSES_TABLEAU}
          onEnrole={() => { setEnrolement(false); relireAppareil(); }}
          onRetour={enrolementRequis ? undefined : () => setEnrolement(false)} />
      </div>
    );
  }
  return (
    <div className="tb-connexion">
      <form onSubmit={valider} className="tb-connexion-carte">
        <LogoApp size={60} className="tb-logo-volume grand" />
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
        <LigneAppareil etat={etatAppareil} classe="tb-enrol-sous" onEnroler={() => setEnrolement(true)} />
        <BoutonInstaller classe="tb-enrol-lien" nom="ORION Tableau de bord" />
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
const IcoCle = () => <Svg><rect x="4" y="10" width="16" height="10" rx="2.5" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14v2.5" /></Svg>;
const IcoBulle = () => <Svg><path d="M4 5h16v11H9l-5 4z" /></Svg>;
