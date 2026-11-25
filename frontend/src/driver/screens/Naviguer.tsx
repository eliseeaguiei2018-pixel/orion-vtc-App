import { useEffect, useMemo, useRef, useState } from 'react';
import { OrionMap } from '../../components/OrionMap';
import type { ZoneCarte } from '../../components/zonesCarte';
import { IconArrowLeft, IconBuilding, IconChevronDown, IconFlame, IconPin, IconSearch, IconTrend } from '../../icons';
import { rechercherLieux } from '../../lieux';
import type { Place } from '../../types';
import { km } from '../format';
import { tr } from '../i18n';
import type { BaseOrion, CarteService, LatLng, NiveauZone, ZoneDemande, ZonePrevue } from '../types';
import type { DestinationLibre, DriverApp } from '../useDriver';
import { BandeauGuidage } from './Guidage';
import { useGlisserFeuille } from './Ride';

/**
 * ORION PRO COMME GPS, HORS COURSE (chauffeurs et livreurs moto) : la carte montre les zones à
 * forte demande en direct, celles où les clients commandent d'habitude à cette heure, et les
 * sièges ORION. Un toucher choisit le point ; « Y aller » lance le guidage (voix comprise), le
 * même que pendant une course. On peut aussi chercher n'importe quel lieu.
 */
type Onglet = 'zones' | 'sieges' | 'lieu';

const NIVEAU: Record<NiveauZone, string> = { forte: 'Très forte demande', elevee: 'Forte demande', moderee: 'Demande en hausse' };

export function Naviguer({ app, onClose }: { app: DriverApp; onClose: () => void }) {
  const [carte, setCarte] = useState<CarteService | null>(null);
  const [charge, setCharge] = useState(true);
  const [onglet, setOnglet] = useState<Onglet>('zones');
  const [choix, setChoix] = useState<DestinationLibre & { detail?: string } | null>(null);
  const [suivi, setSuivi] = useState(true);
  const nav = app.navLibre;
  const guidage = app.navigation.guidage;
  const [deplie, setDeplie] = useState(!nav);
  const feuille = useGlisserFeuille(deplie, setDeplie);
  const livreur = app.driver?.category === 'moto';

  // Carte de service : relue chaque minute, et quand le véhicule a bougé d'environ 500 m.
  const ici = app.position;
  const cle = `${ici.lat.toFixed(2)},${ici.lng.toFixed(2)}`;
  const pos = useRef(ici);
  pos.current = ici;
  useEffect(() => {
    let fini = false;
    const lire = () => { void app.backend.carte(pos.current).then((c) => { if (!fini) { setCarte(c); setCharge(false); } }); };
    lire();
    const t = window.setInterval(lire, 60_000);
    return () => { fini = true; window.clearInterval(t); };
  }, [app.backend, cle]);

  const zones: ZoneCarte[] = useMemo(() => {
    if (!carte) return [];
    const choisi = (p: LatLng) => Boolean(nav && nav.cible.lat === p.lat && nav.cible.lng === p.lng) || Boolean(choix && choix.cible.lat === p.lat && choix.cible.lng === p.lng);
    return [
      ...carte.zones.map((z) => ({ id: z.id, lat: z.lat, lng: z.lng, genre: z.niveau, libelle: z.nom, detail: tr(NIVEAU[z.niveau]), choisie: choisi(z) })),
      ...carte.prevues.map((z) => ({ id: z.id, lat: z.lat, lng: z.lng, genre: 'prevue' as const, libelle: z.nom, detail: tr('Demandée d’habitude à cette heure'), choisie: choisi(z) })),
      ...carte.bases.map((b) => ({ id: b.id, lat: b.lat, lng: b.lng, genre: 'siege' as const, libelle: b.nom, choisie: choisi(b) })),
    ];
  }, [carte, nav, choix]);

  const choisirZone = (z: ZoneDemande) => setChoix({ cible: { lat: z.lat, lng: z.lng }, nom: z.nom, type: 'zone', detail: tr(NIVEAU[z.niveau]) });
  const choisirPrevue = (z: ZonePrevue) => setChoix({ cible: { lat: z.lat, lng: z.lng }, nom: z.nom, type: 'prevue', detail: tr('Demandée d’habitude à cette heure') });
  const choisirBase = (b: BaseOrion) => setChoix({ cible: { lat: b.lat, lng: b.lng }, nom: b.nom, type: 'siege', detail: b.adresse ?? b.zone });
  const surZoneCarte = (id: string) => {
    const z = carte?.zones.find((x) => x.id === id); if (z) { choisirZone(z); setDeplie(true); return; }
    const p = carte?.prevues.find((x) => x.id === id); if (p) { choisirPrevue(p); setDeplie(true); return; }
    const b = carte?.bases.find((x) => x.id === id); if (b) { choisirBase(b); setDeplie(true); }
  };
  const partir = (d: DestinationLibre) => { app.actions.naviguerVers({ cible: d.cible, nom: d.nom, type: d.type }); setChoix(null); setDeplie(false); setSuivi(true); };
  const arreter = () => { app.actions.arreterNavigation(); setDeplie(true); };

  // Arrivée : le guidage s'arrête de lui-même quelques secondes après (moins de 40 m du point).
  const arrive = Boolean(nav && guidage && guidage.reste < 40);
  useEffect(() => {
    if (!arrive) return;
    const t = window.setTimeout(() => app.actions.arreterNavigation(), 8000);
    return () => window.clearTimeout(t);
  }, [arrive, app.actions]);

  const resteMin = guidage ? Math.max(1, Math.round(guidage.resteSecondes / 60)) : null;
  const conseil = carte?.bases.find((b) => b.id === carte.baseConseillee) ?? null;

  return (
    <div className={`dv-ride dv-naviguer${nav && !deplie ? ' navigation' : ''}`}>
      <div className="dv-ride-map">
        {nav
          ? <OrionMap origin={ici} destination={nav.cible} car={ici} vehicle={livreur ? 'moto' : 'car'} traffic
              trace={guidage?.restant ?? null} ponts={guidage?.ponts} suivi={suivi} basCouvert={0} libelleRecentrer={tr('Recentrer')} />
          : <OrionMap origin={ici} car={ici} vehicle={livreur ? 'moto' : 'car'} traffic={false} basCouvert={deplie ? 0.5 : 0.2}
              destination={choix?.cible ?? null} zones={zones} onZone={surZoneCarte} />}
        <BandeauGuidage guidage={guidage} recalcul={app.navigation.recalcul} actif={Boolean(nav)} arrivee={nav ? tr('Arrivée : {0}', [nav.nom]) : ''} />
        <div className={`dv-map-chip${nav ? ' bas' : ''}`}>
          <button type="button" className="dv-link dv-vue" onClick={onClose} aria-label={tr('Retour à l’accueil')}><IconArrowLeft size={14} /> {tr('Accueil')}</button>
          {nav && <button type="button" className="dv-link dv-vue" onClick={() => setSuivi((v) => !v)}>{suivi ? tr('Vue d’ensemble') : tr('Navigation')}</button>}
        </div>
      </div>

      {nav && !deplie ? (
        <div className="dv-ride-sheet reduite" ref={feuille.ref}>
          <button type="button" className="dv-poignee" {...feuille.poignee} aria-expanded={false} aria-label={tr('Choisir une autre destination')}>
            <span className="dv-ride-grab" />
            <span className="dv-poignee-fleche haut" aria-hidden="true"><IconChevronDown size={16} /></span>
          </button>
          <div className="dv-ride-resume" {...feuille.zone}>
            <span className="row between" style={{ width: '100%', gap: 12 }}>
              <span className="col grow" style={{ minWidth: 0, alignItems: 'flex-start' }}>
                <strong className="dv-ride-resume-titre">{arrive ? tr('Vous êtes arrivé') : `${resteMin !== null ? `${resteMin} min` : '…'} · ${km(guidage?.reste ?? 0)}`}</strong>
                <span className="faint dv-ride-resume-sous">{nav.nom}</span>
              </span>
            </span>
          </div>
          <div className="dv-ride-resume-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setDeplie(true)}>{tr('Changer')}</button>
            <button type="button" className="btn btn-primary" onClick={arreter}>{arrive ? tr('Terminer') : tr('Arrêter le guidage')}</button>
          </div>
        </div>
      ) : (
        <div className="dv-ride-sheet depliee dv-nav-feuille" ref={feuille.ref}>
          <button type="button" className="dv-poignee" {...feuille.poignee} aria-expanded aria-label={tr('Réduire pour voir la carte')}>
            <span className="dv-ride-grab" />
            <span className="dv-poignee-fleche" aria-hidden="true"><IconChevronDown size={16} /></span>
          </button>
          <div className="dv-nav-entete">
            <strong className="h-title" style={{ fontSize: 19 }}>{nav ? tr('Changer de destination') : tr('Où voulez-vous aller ?')}</strong>
            <span className="faint" style={{ fontSize: 12.5 }}>{livreur ? tr('Rejoignez les zones où les colis attendent, ou votre siège ORION.') : tr('Rejoignez les zones où les clients attendent, ou votre siège ORION.')}</span>
          </div>

          {choix && (
            <div className="card dv-nav-choix">
              <span className="col grow" style={{ minWidth: 0 }}>
                <strong>{choix.nom}</strong>
                <span className="faint">{[choix.detail, km(distance(ici, choix.cible))].filter(Boolean).join(' · ')}</span>
              </span>
              <button type="button" className="btn btn-primary" onClick={() => partir(choix)}>{tr('Y aller')}</button>
            </div>
          )}

          <div className="dv-nav-onglets" role="tablist">
            {([['zones', tr('Forte demande'), <IconFlame size={15} key="z" />], ['sieges', tr('Siège ORION'), <IconBuilding size={15} key="s" />], ['lieu', tr('Autre lieu'), <IconSearch size={15} key="l" />]] as const).map(([id, label, ico]) => (
              <button key={id} type="button" role="tab" aria-selected={onglet === id} className={`dv-nav-onglet${onglet === id ? ' on' : ''}`} onClick={() => setOnglet(id)}>{ico}{label}</button>
            ))}
          </div>

          {onglet === 'zones' && (
            <div className="col" style={{ gap: 8 }}>
              {charge && <div className="faint" style={{ fontSize: 13 }}>{tr('Chargement de la carte…')}</div>}
              {!charge && !carte && <div className="faint" style={{ fontSize: 13 }}>{tr('Carte indisponible : vérifiez votre connexion.')}</div>}
              {carte && carte.zones.length === 0 && <div className="faint" style={{ fontSize: 13 }}>{tr('Demande calme pour le moment.')}</div>}
              {carte?.zones.map((z) => (
                <button key={z.id} type="button" className="dv-nav-ligne" onClick={() => choisirZone(z)}>
                  <span className={`dv-nav-pastille ${z.niveau}`} aria-hidden="true" />
                  <span className="col grow" style={{ minWidth: 0, alignItems: 'flex-start' }}>
                    <strong>{z.nom}</strong>
                    <span className="faint">{tr(NIVEAU[z.niveau])}{z.majorationPct > 0 ? ` · ${tr('prix +{0} %', [z.majorationPct])}` : ''}</span>
                  </span>
                  <span className="dv-nav-distance">{z.distanceMeters !== null ? km(z.distanceMeters) : ''}</span>
                </button>
              ))}
              {carte && carte.prevues.length > 0 && (
                <>
                  <div className="dv-nav-sous-titre"><IconTrend size={14} /> {tr('Demandées d’habitude à cette heure')}</div>
                  {carte.prevues.map((z) => (
                    <button key={z.id} type="button" className="dv-nav-ligne" onClick={() => choisirPrevue(z)}>
                      <span className="dv-nav-pastille prevue" aria-hidden="true" />
                      <span className="col grow" style={{ minWidth: 0, alignItems: 'flex-start' }}>
                        <strong>{z.nom}</strong>
                        <span className="faint">{tr('≈ {0} commande(s) par jour à cette heure', [z.attendu.toLocaleString('fr-FR')])}</span>
                      </span>
                      <span className="dv-nav-distance">{z.distanceMeters !== null ? km(z.distanceMeters) : ''}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {onglet === 'sieges' && (
            <div className="col" style={{ gap: 8 }}>
              {carte && carte.bases.length === 0 && (
                <div className="faint" style={{ fontSize: 13 }}>{tr('Le siège de votre zone n’est pas encore renseigné : la direction l’ajoute dans la console ORION.')}</div>
              )}
              {conseil && (
                <button type="button" className="btn btn-primary" onClick={() => partir({ cible: { lat: conseil.lat, lng: conseil.lng }, nom: conseil.nom, type: 'siege' })}>
                  {tr('Rentrer au siège de ma zone · {0}', [conseil.nom])}
                </button>
              )}
              {carte?.bases.map((b) => (
                <button key={b.id} type="button" className="dv-nav-ligne" onClick={() => choisirBase(b)}>
                  <span className="dv-nav-ico" aria-hidden="true"><IconBuilding size={16} /></span>
                  <span className="col grow" style={{ minWidth: 0, alignItems: 'flex-start' }}>
                    <strong>{b.nom}</strong>
                    <span className="faint">{[b.adresse, b.zone && tr('Zone {0}', [b.zone]), b.horaires].filter(Boolean).join(' · ') || tr('Siège ORION')}</span>
                  </span>
                  <span className="dv-nav-distance">{b.distanceMeters !== null ? km(b.distanceMeters) : ''}</span>
                </button>
              ))}
            </div>
          )}

          {onglet === 'lieu' && <RechercheLieu pres={ici} onChoix={(p) => setChoix({ cible: p.location, nom: p.name, type: 'lieu', detail: p.area })} />}
        </div>
      )}
    </div>
  );
}

/** Recherche d'un lieu (index ORION embarqué + serveur) pour s'y rendre hors course. */
function RechercheLieu({ pres, onChoix }: { pres: LatLng; onChoix: (p: Place) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Place[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => { void rechercherLieux(q, pres, ctrl.signal).then(setRes).catch(() => undefined); }, 220);
    return () => { window.clearTimeout(t); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div className="col" style={{ gap: 8 }}>
      <label className="dv-nav-recherche">
        <IconSearch size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Quartier, rue, lieu…')} aria-label={tr('Rechercher un lieu')} autoComplete="off" />
      </label>
      {res.map((p) => (
        <button key={p.id} type="button" className="dv-nav-ligne" onClick={() => onChoix(p)}>
          <span className="dv-nav-ico" aria-hidden="true"><IconPin size={16} /></span>
          <span className="col grow" style={{ minWidth: 0, alignItems: 'flex-start' }}><strong>{p.name}</strong><span className="faint">{p.area}</span></span>
          <span className="dv-nav-distance">{km(distance(pres, p.location))}</span>
        </button>
      ))}
    </div>
  );
}

function distance(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}
