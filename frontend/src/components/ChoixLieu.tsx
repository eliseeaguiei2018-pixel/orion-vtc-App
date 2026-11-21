import { useEffect, useMemo, useRef, useState } from 'react';
import { chargerGoogle, cleRefusee, fondCarte, googleSeul, suivreFondCarte } from '../carteGoogle';
import { fermerAvisSansCle, GoogleIndisponible, optionsCarte } from './CarteGoogle';
import type { Map as CarteML } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LatLng, Place } from '../types';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { getVectorConfig } from '../mapConfig';
import { chargerML } from './chargerCarte';
import { styleOrion } from './styleCarte';
import { OrionMap } from './OrionMap';
import { Sheet, TopBar } from './ui';
import { IconCheck, IconClock, IconPin, IconSearch } from '../icons';
import { Objet, type Icone3D, type ObjetService } from './Vehicules';
import { LIEUX_POPULAIRES, lieuEnregistre, lieuxRecents, adresseDe, rechercherLieux, rechercherTousLesLieux, type EtatPosition } from '../lieux';
import { etatPlaces, resoudreLieuGoogle, suivreEtatPlaces } from '../lieuxGoogle';

export type ModeChoix = 'destination' | 'depart' | 'livraison' | 'arret' | 'domicile' | 'bureau';

/** Pictogramme d'un lieu : domicile, bureau, aéroport, ou sa catégorie (restaurant, église, banque…). */
/** Objet en volume d'un lieu, d'après sa nature ou sa catégorie. */
function objetLieu(p: Place): ObjetService | Icone3D {
  if (p.kind === 'home') return 'domicile';
  if (p.kind === 'work') return 'bureau';
  if (p.kind === 'hub') return 'aeroport';
  switch (p.categorie) {
    case 'restaurant': case 'fast_food': case 'cafe': case 'bakery': case 'ice_cream': case 'bar': case 'music': return 'food';
    case 'bank': return 'banque';
    case 'grocery': return 'supermarche';
    case 'shop': case 'clothing_store': case 'hairdresser': return 'achat';
    case 'commercial': return 'bureau';
    case 'building': case 'town_hall': case 'embassy': case 'post': case 'cemetery': case 'place_of_worship': return 'immeuble';
    case 'airport': return 'aeroport';
    case 'religious_christian': return 'eglise';
    case 'religious_muslim': return 'mosquee';
    case 'school': case 'college': case 'library': return 'ecole';
    case 'hospital': case 'pharmacy': case 'doctors': case 'dentist': return 'samu';
    case 'lodging': return 'hotel';
    case 'fuel': return 'carburant';
    case 'cinema': case 'theatre': case 'museum': case 'art_gallery': case 'stadium': return 'loisirs';
    case 'attraction': case 'park': return 'parc';
    case 'police': return 'police';
    case 'fire_station': return 'pompiers';
    case 'bus': case 'ferry': case 'railway': case 'harbor': return 'bus';
    case 'road': return 'mes-courses';
    default: return 'lieu';
  }
}
export function iconeLieu(p: Place, taille = 20) {
  return <Objet nom={objetLieu(p)} taille={Math.round(taille * 1.7)} />;
}
const icone = (p: Place) => iconeLieu(p);

/**
 * CHOIX D'UN LIEU (destination, point de prise en charge, livraison, domicile, bureau).
 * Recherche d'adresse réelle, position GPS, domicile et bureau du client, récents, lieux
 * populaires, et en dernier recours le point exact sur la carte.
 */
export function ChoixLieu({ mode, centre, etatPosition, onMaPosition, onChoose, onBack }: {
  mode: ModeChoix; centre: LatLng; etatPosition?: EtatPosition;
  onMaPosition?: () => void; onChoose: (p: Place) => void; onBack: () => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState<Place[] | null>(null);
  const [cherche, setCherche] = useState(false);
  const [surCarte, setSurCarte] = useState(false);
  // Lieux de Google : état du service (actif, refusé par Google…), recherche complète, choix en cours.
  const [places, setPlaces] = useState(etatPlaces);
  const [complet, setComplet] = useState(false);
  const [echec, setEchec] = useState(false);
  const choix = useRef(0);
  useEffect(() => suivreEtatPlaces(() => setPlaces(etatPlaces())), []);

  // Recherche au fil de la frappe (250 ms), la requête précédente est annulée.
  useEffect(() => {
    const requete = q.trim();
    setComplet(false); setEchec(false);
    if (requete.length < 2) { setResultats(null); setCherche(false); return; }
    const ctrl = new AbortController();
    setCherche(true);
    const minuteur = window.setTimeout(() => {
      rechercherLieux(requete, centre, ctrl.signal, { google: true })
        .then((r) => { setResultats(r); setCherche(false); })
        .catch(() => { /* annulée */ });
    }, 250);
    return () => { ctrl.abort(); window.clearTimeout(minuteur); };
  }, [q, centre]);

  /** Recherche validée (touche « Rechercher » ou ligne « tous les lieux ») : la liste complète, comme dans Google Maps. */
  const toutChercher = () => {
    const requete = q.trim();
    if (requete.length < 2) return;
    const tour = ++choix.current;
    setCherche(true); setEchec(false);
    void rechercherTousLesLieux(requete, centre).then((r) => {
      if (tour !== choix.current) return;
      setResultats(r); setComplet(true); setCherche(false);
    });
  };

  /** Une suggestion Google n'a pas encore de position : on la demande avant de valider le lieu. */
  const choisir = (p: Place) => {
    if (!p.aResoudre) { onChoose(p); return; }
    const tour = ++choix.current;
    setCherche(true); setEchec(false);
    resoudreLieuGoogle(p)
      .then((lieu) => { if (tour === choix.current) onChoose(lieu); })
      .catch(() => { if (tour === choix.current) { setCherche(false); setEchec(true); } });
  };

  const domicile = lieuEnregistre('home');
  const bureau = lieuEnregistre('work');
  const recents = useMemo(() => lieuxRecents(), []);
  const titre = {
    destination: t('dest_title'), depart: t('lieu_titre_depart'), livraison: t('lieu_titre_livraison'), arret: t('lieu_titre_arret'),
    domicile: t('lieu_titre_domicile'), bureau: t('lieu_titre_bureau'),
  }[mode];

  if (surCarte) {
    return <ChoixSurCarte centre={centre} onBack={() => setSurCarte(false)} onValider={onChoose} />;
  }

  const ligne = (p: Place) => (
    <button key={`${p.id}-${p.location.lat}`} className="list-row list-btn" onClick={() => choisir(p)}>
      <span className="list-ico">{icone(p)}</span>
      <span className="col grow" style={{ textAlign: 'start', minWidth: 0 }}>
        <strong style={{ fontSize: 15 }}>{p.name}</strong>
        {p.area && <span className="faint" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.area}</span>}
      </span>
    </button>
  );
  const section = (titreSection: string, lieux: Place[]) => lieux.length > 0 && (
    <>
      <span className="eyebrow" style={{ display: 'block', margin: '12px 4px 4px' }}>{titreSection}</span>
      {lieux.map(ligne)}
    </>
  );

  return (
    <div className="screen">
      <OrionMap origin={centre} />
      <TopBar onBack={onBack} title={titre} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="field" style={{ marginBottom: 8 }}>
          <IconSearch size={20} color="var(--text-faint)" />
          <input autoFocus placeholder={t('lieu_recherche')} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); toutChercher(); (e.target as HTMLInputElement).blur(); } }}
            aria-label={t('lieu_recherche')} enterKeyHint="search" autoComplete="off" />
        </div>
        <div style={{ maxHeight: 'min(46vh, 380px)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {resultats === null ? (
            <>
              {mode === 'depart' && onMaPosition && (
                <button className="list-row list-btn" onClick={onMaPosition}>
                  <span className="list-ico"><Objet nom="lieu" taille={34} /></span>
                  <span className="col grow" style={{ textAlign: 'start' }}>
                    <strong style={{ fontSize: 15 }}>{t('lieu_ma_position')}</strong>
                    <span className="faint" style={{ fontSize: 13 }}>
                      {etatPosition === 'attente' ? t('lieu_position_attente')
                        : etatPosition === 'refus' ? t('lieu_position_refus')
                          : etatPosition === 'hors_zone' ? t('lieu_position_hors_zone')
                            : etatPosition === 'indisponible' ? t('lieu_position_indispo') : t('lieu_ma_position_d')}
                    </span>
                  </span>
                </button>
              )}
              <button className="list-row list-btn" onClick={() => setSurCarte(true)}>
                <span className="list-ico"><Objet nom="lieu" taille={34} /></span>
                <span className="col grow" style={{ textAlign: 'start' }}>
                  <strong style={{ fontSize: 15 }}>{t('lieu_sur_carte')}</strong>
                  <span className="faint" style={{ fontSize: 13 }}>{t('lieu_sur_carte_d')}</span>
                </span>
              </button>
              {mode !== 'domicile' && mode !== 'bureau' && section(t('lieu_enregistres'), [domicile, bureau].filter((x): x is Place => Boolean(x)))}
              {section(t('lieu_recents'), recents)}
              {section(t('lieu_populaires'), LIEUX_POPULAIRES)}
            </>
          ) : (
            <>
              {resultats.map(ligne)}
              {resultats.length === 0 && !cherche && <p className="faint" style={{ padding: 20, textAlign: 'center' }}>{t('lieu_aucun')}</p>}
              {echec && <p className="lieu-source refus" role="alert">{t('lieu_google_echec')}</p>}
              {places === 'actif' && !complet && !cherche && (
                <button className="list-row list-btn lieu-tout" onClick={toutChercher}>
                  <span className="list-ico"><IconSearch size={22} strokeWidth={1.9} /></span>
                  <span className="col grow" style={{ textAlign: 'start', minWidth: 0 }}><strong style={{ fontSize: 15 }}>{t('lieu_tous_resultats', { q: q.trim() })}</strong></span>
                </button>
              )}
              {places === 'actif' && resultats.some((r) => r.googleId) && <p className="lieu-source">{t('lieu_source_google')}</p>}
              {places === 'refuse' && !cherche && <p className="lieu-source">{t('lieu_source_orion')}</p>}
            </>
          )}
          {cherche && <p className="faint" style={{ padding: 12, textAlign: 'center', fontSize: 13 }}><IconClock size={13} /> {t('lieu_recherche_encours')}</p>}
        </div>
      </Sheet>
    </div>
  );
}

/**
 * Le point exact sur la vraie carte : le client déplace la carte, le repère au centre
 * marque le point ; le quartier s'affiche à l'arrêt. Utile quand l'adresse n'existe pas
 * (beaucoup de rues d'Abidjan n'ont ni nom ni numéro).
 */
function ChoixSurCarte(props: { centre: LatLng; onBack: () => void; onValider: (p: Place) => void }) {
  // Fond Google Maps si le client l'a activé ; s'il échoue (clé refusée, hors connexion), carte ORION.
  const { t } = useI18n();
  const [googleEchec, setGoogleEchec] = useState(false);
  const [, relancer] = useState(0);
  useEffect(() => suivreFondCarte(() => { setGoogleEchec(false); relancer((n) => n + 1); }), []);
  if (fondCarte() === 'google' && !googleEchec && !(googleSeul() && cleRefusee())) return <ChoixSurCarteGoogle {...props} onEchec={() => setGoogleEchec(true)} />;
  // Construction « Google seul » : pas d'autre carte ; l'écran dit pourquoi et propose de réessayer.
  if (googleSeul()) {
    return (
      <div className="screen choix-carte">
        <GoogleIndisponible />
        <TopBar onBack={props.onBack} title={t('lieu_sur_carte')} />
      </div>
    );
  }
  return <ChoixSurCarteOrion {...props} />;
}

/** Le même choix de point, sur le fond Google Maps : le repère est au centre de la carte. */
function ChoixSurCarteGoogle({ centre, onBack, onValider, onEchec }: { centre: LatLng; onBack: () => void; onValider: (p: Place) => void; onEchec: () => void }) {
  const { t } = useI18n();
  const { resolved } = useTheme();
  const zone = useRef<HTMLDivElement>(null);
  const boite = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<LatLng>(centre);
  const [quartier, setQuartier] = useState<string>('');

  useEffect(() => {
    let annule = false;
    let ecoute: { remove(): void } | undefined;
    void chargerGoogle().then((g) => {
      if (annule || !boite.current) return;
      const m = new g.Map(boite.current, optionsCarte(g, resolved !== 'light', centre, 17));
      g.event.addListenerOnce(m, 'tilesloaded', () => fermerAvisSansCle(boite.current));
      ecoute = g.event.addListener(m, 'idle', () => { const c = m.getCenter(); setPoint({ lat: c.lat(), lng: c.lng() }); });
    }).catch(() => { if (!annule) onEchec(); });
    return () => { annule = true; ecoute?.remove(); if (boite.current) boite.current.innerHTML = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  // La carte s'arrête au-dessus de la feuille : le repère, au centre de la carte, reste visible,
  // et les mentions de Google aussi.
  useEffect(() => {
    const ecran = zone.current?.closest('.screen');
    if (!zone.current || !ecran) return;
    const caler = () => {
      const feuille = ecran.querySelector('.sheet')?.getBoundingClientRect();
      const cadre = ecran.getBoundingClientRect();
      if (zone.current) zone.current.style.bottom = `${feuille ? Math.max(0, cadre.bottom - feuille.top) : 0}px`;
    };
    caler();
    const obs = new ResizeObserver(caler);
    obs.observe(ecran);
    const id = window.setInterval(caler, 700);
    return () => { obs.disconnect(); window.clearInterval(id); };
  }, []);

  useEffect(() => {
    let actif = true;
    const minuteur = window.setTimeout(() => { void adresseDe(point).then((q) => { if (actif) setQuartier(q?.nom ?? ''); }); }, 300);
    return () => { actif = false; window.clearTimeout(minuteur); };
  }, [point]);

  return (
    <div className="screen choix-carte">
      <div ref={zone} className="choix-carte-google">
        <div ref={boite} className="choix-carte-ml" />
        <div className="choix-carte-repere" aria-hidden="true"><IconPin size={38} /></div>
      </div>
      <TopBar onBack={onBack} title={t('lieu_sur_carte')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <p className="faint" style={{ margin: '0 0 6px', fontSize: 13 }}>{t('lieu_sur_carte_d')}</p>
        <strong style={{ fontSize: 16 }}>{quartier || '…'}</strong>
        <p className="faint mono" style={{ margin: '2px 0 12px', fontSize: 12 }}>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</p>
        <button className="btn btn-primary" onClick={() => onValider({ id: `carte-${point.lat.toFixed(5)},${point.lng.toFixed(5)}`, name: t('lieu_point_choisi'), area: quartier, location: point })}>
          <IconCheck size={18} /> {t('lieu_valider_point')}
        </button>
      </Sheet>
    </div>
  );
}

function ChoixSurCarteOrion({ centre, onBack, onValider }: { centre: LatLng; onBack: () => void; onValider: (p: Place) => void }) {
  const { t } = useI18n();
  const { resolved } = useTheme();
  const boite = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteML | null>(null);
  const [point, setPoint] = useState<LatLng>(centre);
  const [quartier, setQuartier] = useState<string>('');
  const [indispo, setIndispo] = useState(false);

  useEffect(() => {
    const config = getVectorConfig();
    if (!config) { setIndispo(true); return; }
    let annule = false;
    void chargerML().then((ml) => {
      if (annule || !boite.current) return;
      const m = new ml.Map({ container: boite.current, style: styleOrion(resolved === 'light' ? 'light' : 'dark', config), center: [centre.lng, centre.lat], zoom: 15.5, attributionControl: false, dragRotate: false, pitchWithRotate: false });
      // Mention OpenStreetMap sous l'en-tête, repliée sur son bouton « i » : elle ne passe plus sous le titre.
      m.addControl(new ml.AttributionControl({ compact: true, customAttribution: config.attribution }), 'top-left');
      m.once('load', () => boite.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
      // Le repère est dessiné à 38 % de la hauteur (au-dessus de la feuille) : le « centre »
      // de la carte y est aligné, sinon le point validé ne serait pas celui que voit le client.
      const caler = () => m.setPadding({ top: 0, left: 0, right: 0, bottom: Math.round(m.getContainer().clientHeight * 0.24) });
      caler();
      m.jumpTo({ center: [centre.lng, centre.lat] });
      m.on('resize', caler);
      m.on('moveend', () => { const c = m.getCenter(); setPoint({ lat: c.lat, lng: c.lng }); });
      m.once('load', () => window.clearTimeout(delai));
      carte.current = m;
    }).catch(() => setIndispo(true));
    // Tuiles injoignables : carte stylisée, le point reste celui de départ (validable).
    const delai = window.setTimeout(() => { if (!carte.current?.loaded()) setIndispo(true); }, 12_000);
    return () => { annule = true; window.clearTimeout(delai); carte.current?.remove(); carte.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  useEffect(() => { if (indispo) { carte.current?.remove(); carte.current = null; } }, [indispo]);

  // Quartier du point, à l'arrêt de la carte.
  useEffect(() => {
    let actif = true;
    const minuteur = window.setTimeout(() => { void adresseDe(point).then((q) => { if (actif) setQuartier(q?.nom ?? ''); }); }, 300);
    return () => { actif = false; window.clearTimeout(minuteur); };
  }, [point]);

  return (
    <div className="screen choix-carte">
      {indispo ? <OrionMap origin={centre} /> : <div ref={boite} className="choix-carte-ml" />}
      <div className="choix-carte-repere" aria-hidden="true"><IconPin size={38} /></div>
      <TopBar onBack={onBack} title={t('lieu_sur_carte')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <p className="faint" style={{ margin: '0 0 6px', fontSize: 13 }}>{t('lieu_sur_carte_d')}</p>
        <strong style={{ fontSize: 16 }}>{quartier || '…'}</strong>
        <p className="faint mono" style={{ margin: '2px 0 12px', fontSize: 12 }}>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</p>
        <button className="btn btn-primary" onClick={() => onValider({ id: `carte-${point.lat.toFixed(5)},${point.lng.toFixed(5)}`, name: t('lieu_point_choisi'), area: quartier, location: point })}>
          <IconCheck size={18} /> {t('lieu_valider_point')}
        </button>
      </Sheet>
    </div>
  );
}
