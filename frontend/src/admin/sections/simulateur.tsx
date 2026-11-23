import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as CarteML, MapMouseEvent, Marker } from 'maplibre-gl';
import { AdminError, LIVE, adminGet, adminPost, adminPut } from '../api';
import { demanderLieu } from '../dialogues';
import { chargerML } from '../../components/chargerCarte';
import { useCarteReelle, useThemeConsole } from '../SupervisionMap';

/**
 * SIMULATEUR DU MARCHÉ — session réservée au PDG.
 *
 * Le PDG choisit un lieu de prise en charge, place des chauffeurs autour (nombre, distance,
 * gamme) et des clients qui commandent. Tant que la simulation est coupée, la console mesure
 * seulement ce qu'elle changerait. Une fois VALIDÉE ET ACTIVÉE, le serveur ORION compte ces
 * chauffeurs et ces clients comme des vrais : l'app cliente voit les véhicules sur sa carte,
 * le temps d'approche, et le prix qui monte ou baisse selon l'offre et la demande.
 *
 * Les courses restent confiées aux seuls vrais chauffeurs, et la simulation se coupe seule à
 * l'heure prévue : elle n'influence jamais durablement l'activité réelle.
 */
type Gamme = 'argent' | 'or' | 'diamant' | 'moto';
interface ChauffeurSim { id: string; lat: number; lng: number; gamme: Gamme }
interface Lieu { lat: number; lng: number; nom: string }
interface Simulation {
  actif: boolean; lieu: Lieu | null; chauffeurs: ChauffeurSim[]; demande: number; dureeMin: number;
  activeLe: string | null; expireA: string | null; fin: { le: string; par: string; motif: 'manuelle' | 'expiree' } | null;
  majLe: string; majPar: string; rev: number;
}
interface Approche { km: number; minutes: number }
interface Mesures {
  demandeReelle: number; demandeSimulee: number; offreReelle: number; offreSimulee: number;
  surgeAvec: number; surgeSans: number;
  approches: Array<{ gamme: string; avec: Approche | null; sans: Approche | null }>;
}
interface Regles {
  rayonOffreM: number; rayonDemandeM: number; demandeMinimale: number; surgeActif: boolean; plafond: number;
  approche: { actif: boolean; offerteKm: number; offerteMin: number; parKm: number; parMin: number; plafond: number } | null;
  maxChauffeurs: number; maxDemande: number; dureeMin: number; dureeMax: number;
}
interface Etat { simulation: Simulation; mesures: Mesures | null; regles: Regles }
interface PrixGamme { montant: number; surge: number; approche: number; approcheMin: number | null; approcheKm: number | null }
interface Apercu { distanceKm: number; trafic: string; gammes: Array<{ gamme: string; sans: PrixGamme; avec: PrixGamme }> }
type Brouillon = { lieu: Lieu | null; chauffeurs: ChauffeurSim[]; demande: number };
type Mode = 'lieu' | 'chauffeur' | 'destination';

const GAMMES: Array<{ id: Gamme; label: string }> = [
  { id: 'argent', label: 'Argent' }, { id: 'or', label: 'Or' }, { id: 'diamant', label: 'Diamant' }, { id: 'moto', label: 'Moto' },
];
const NOM_GAMME: Record<string, string> = { argent: 'Argent', or: 'Or', diamant: 'Diamant', moto: 'Moto' };
const DISTANCES = [300, 800, 1500, 3000, 6000];
const DUREES = [15, 30, 60, 120, 240];
const fcfa = (n: number) => `${new Intl.NumberFormat('fr-FR').format(Math.round(n))} F`;
const metres = (m: number) => (m >= 1000 ? `${String(Math.round(m / 100) / 10).replace('.', ',')} km` : `${Math.round(m)} m`);
const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const coef = (x: number) => `×${String(Math.round(x * 100) / 100).replace('.', ',')}`;

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000, r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function pointA(c: { lat: number; lng: number }, m: number, angle: number) {
  return { lat: c.lat + (m * Math.sin(angle)) / 111_320, lng: c.lng + (m * Math.cos(angle)) / (111_320 * Math.cos(c.lat * Math.PI / 180)) };
}
let compteur = 0;
const nouvelId = () => `c${Date.now().toString(36)}${(compteur++).toString(36)}`.slice(0, 24);

export function SimulateurSection() {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon>({ lieu: null, chauffeurs: [], demande: 0 });
  const [modifie, setModifie] = useState(false);
  const [mode, setMode] = useState<Mode>('lieu');
  const [gamme, setGamme] = useState<Gamme>('argent');
  const [nombre, setNombre] = useState(6);
  const [distance, setDistance] = useState(800);
  const [duree, setDuree] = useState(60);
  const [destination, setDestination] = useState<Lieu | null>(null);
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [calcul, setCalcul] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null);
  const [focus, setFocus] = useState(0);
  const [, setTic] = useState(0);
  const modifieRef = useRef(false);
  modifieRef.current = modifie;

  const recevoir = useCallback((e: Etat, garderBrouillon = false) => {
    setEtat(e);
    if (!garderBrouillon) {
      setBrouillon({ lieu: e.simulation.lieu, chauffeurs: e.simulation.chauffeurs, demande: e.simulation.demande });
      setModifie(false);
      setDuree((d) => (e.simulation.actif ? e.simulation.dureeMin : d));
    }
  }, []);

  // État du serveur : au chargement, puis toutes les 10 s (fin automatique, vrais chauffeurs).
  useEffect(() => {
    if (!LIVE) return;
    let fini = false;
    const lire = () => adminGet<Etat>('/admin/simulateur').then((e) => { if (!fini) recevoir(e, modifieRef.current); }).catch((e) => {
      if (!fini) setMessage({ texte: e instanceof AdminError ? e.message : 'Le serveur n’a pas répondu.', erreur: true });
    });
    void lire();
    const id = window.setInterval(() => { void lire(); setTic((t) => t + 1); }, 10_000);
    return () => { fini = true; window.clearInterval(id); };
  }, [recevoir]);

  const sim = etat?.simulation ?? null;
  const actif = Boolean(sim?.actif);

  const enregistrer = useCallback(async (b: Brouillon) => {
    const e = await adminPut<Etat>('/admin/simulateur', { lieu: b.lieu, chauffeurs: b.chauffeurs, demande: b.demande });
    recevoir(e);
    return e;
  }, [recevoir]);

  // Simulation coupée : chaque changement est enregistré aussitôt (sans effet pour les clients),
  // pour que la mesure de l'effet reste à jour. Active : il faut « Appliquer ».
  useEffect(() => {
    if (!modifie || actif || !LIVE) return;
    const id = window.setTimeout(() => { void enregistrer(brouillon).catch(() => setMessage({ texte: 'Enregistrement impossible : le serveur n’a pas répondu.', erreur: true })); }, 600);
    return () => window.clearTimeout(id);
  }, [brouillon, modifie, actif, enregistrer]);

  const changer = (f: (b: Brouillon) => Brouillon) => { setBrouillon((b) => f(b)); setModifie(true); setApercu(null); };

  const choisirLieu = async () => {
    const p = await demanderLieu('Lieu de prise en charge à simuler');
    if (!p) return;
    changer((b) => ({ ...b, lieu: { lat: p.location.lat, lng: p.location.lng, nom: p.name } }));
    setFocus((f) => f + 1);
  };
  const choisirDestination = async () => {
    const p = await demanderLieu('Destination de la course d’essai');
    if (p) { setDestination({ lat: p.location.lat, lng: p.location.lng, nom: p.name }); setApercu(null); }
  };

  const placerAnneau = () => {
    if (!brouillon.lieu) { setMessage({ texte: 'Choisissez d’abord le lieu de prise en charge.', erreur: true }); return; }
    const max = etat?.regles.maxChauffeurs ?? 300;
    const n = Math.max(1, Math.min(nombre, max - brouillon.chauffeurs.length));
    if (n <= 0 || brouillon.chauffeurs.length >= max) { setMessage({ texte: `${max} chauffeurs simulés au plus.`, erreur: true }); return; }
    const depart = Math.random() * 2 * Math.PI;
    const lieu = brouillon.lieu;
    const nouveaux = Array.from({ length: n }, (_, i) => ({ id: nouvelId(), gamme, ...pointA(lieu, distance, depart + (2 * Math.PI * i) / n) }));
    changer((b) => ({ ...b, chauffeurs: [...b.chauffeurs, ...nouveaux] }));
    setMessage(null);
  };

  const clicCarte = (p: { lat: number; lng: number }) => {
    if (mode === 'lieu') { changer((b) => ({ ...b, lieu: { lat: p.lat, lng: p.lng, nom: 'Point choisi sur la carte' } })); return; }
    if (mode === 'destination') { setDestination({ lat: p.lat, lng: p.lng, nom: 'Point choisi sur la carte' }); setApercu(null); return; }
    if (brouillon.chauffeurs.length >= (etat?.regles.maxChauffeurs ?? 300)) return;
    changer((b) => ({ ...b, chauffeurs: [...b.chauffeurs, { id: nouvelId(), gamme, lat: p.lat, lng: p.lng }] }));
  };
  const retirer = (id: string) => changer((b) => ({ ...b, chauffeurs: b.chauffeurs.filter((c) => c.id !== id) }));

  // Groupes lisibles : gamme et distance au lieu (arrondie à 50 m).
  const groupes = useMemo(() => {
    const m = new Map<string, { gamme: Gamme; distance: number; ids: string[] }>();
    for (const c of brouillon.chauffeurs) {
      const d = brouillon.lieu ? Math.round(distanceM(brouillon.lieu, c) / 50) * 50 : 0;
      const cle = `${c.gamme}|${d}`;
      const g = m.get(cle) ?? { gamme: c.gamme, distance: d, ids: [] };
      g.ids.push(c.id);
      m.set(cle, g);
    }
    return [...m.values()].sort((a, b) => a.distance - b.distance || a.gamme.localeCompare(b.gamme));
  }, [brouillon]);
  const rayons = useMemo(() => [...new Set(groupes.map((g) => g.distance).filter((d) => d > 0))], [groupes]);

  const action = async (f: () => Promise<Etat>, ok: (e: Etat) => string) => {
    setEnvoi(true); setMessage(null);
    try { const e = await f(); recevoir(e); setMessage({ texte: ok(e) }); }
    catch (e) { setMessage({ texte: e instanceof AdminError ? e.message : 'Le serveur n’a pas répondu. Rien n’a changé.', erreur: true }); }
    finally { setEnvoi(false); }
  };
  const activer = () => action(async () => {
    if (modifie) await enregistrer(brouillon);
    return adminPost<Etat>('/admin/simulateur/activer', { dureeMin: duree });
  }, (e) => `Simulation active jusqu’à ${e.simulation.expireA ? heure(e.simulation.expireA) : '—'} : l’app cliente voit ${e.simulation.chauffeurs.length} chauffeur${e.simulation.chauffeurs.length > 1 ? 's' : ''} simulé${e.simulation.chauffeurs.length > 1 ? 's' : ''}.`);
  const appliquer = () => action(() => enregistrer(brouillon), () => 'Changements appliqués : l’app cliente refait ses prix.');
  const couper = () => action(() => adminPost<Etat>('/admin/simulateur/couper', {}), () => 'Simulation coupée : l’app cliente ne voit plus que les vrais chauffeurs.');
  const prolonger = () => action(() => adminPost<Etat>('/admin/simulateur/activer', { dureeMin: duree }), (e) => `Prolongée jusqu’à ${e.simulation.expireA ? heure(e.simulation.expireA) : '—'}.`);

  const calculerApercu = async () => {
    if (!destination) return;
    setCalcul(true); setMessage(null);
    try {
      if (modifie && !actif) await enregistrer(brouillon);
      setApercu(await adminPost<Apercu>('/admin/simulateur/apercu', { destination: { lat: destination.lat, lng: destination.lng } }));
    } catch (e) {
      setMessage({ texte: e instanceof AdminError ? e.message : 'Calcul impossible : le serveur n’a pas répondu.', erreur: true });
    } finally { setCalcul(false); }
  };

  if (!LIVE) return <div className="adm-card"><p className="adm-muted">Le simulateur agit sur le serveur ORION : connectez la console au serveur pour l’utiliser.</p></div>;
  if (!etat || !sim) return <p className="adm-muted">{message?.texte ?? 'Chargement du simulateur…'}</p>;

  const r = etat.regles;
  const m = etat.mesures;
  const resteMin = sim.expireA ? Math.max(0, Math.round((Date.parse(sim.expireA) - Date.now()) / 60_000)) : 0;
  const parGamme = GAMMES.map((g) => ({ ...g, n: brouillon.chauffeurs.filter((c) => c.gamme === g.id).length }));

  return (
    <div className="adm-sim">
      <div className={`adm-sim-etat${actif ? ' actif' : ''}`} role="status">
        <span className="adm-sim-voyant" aria-hidden="true" />
        <div className="adm-sim-etat-texte">
          {actif ? (
            <>
              <strong>Simulation active</strong>
              <span>L’app cliente voit {sim.chauffeurs.length} chauffeur{sim.chauffeurs.length > 1 ? 's' : ''} simulé{sim.chauffeurs.length > 1 ? 's' : ''}{sim.demande > 0 ? ` et ${sim.demande} client${sim.demande > 1 ? 's' : ''} qui commande${sim.demande > 1 ? 'nt' : ''}` : ''}. Fin automatique à {sim.expireA ? heure(sim.expireA) : '—'} (dans {resteMin} min).</span>
            </>
          ) : (
            <>
              <strong>Simulation coupée</strong>
              <span>{sim.fin?.motif === 'expiree' ? `Arrêtée seule à ${heure(sim.fin.le)}. ` : sim.fin ? `Coupée à ${heure(sim.fin.le)}. ` : ''}Préparez le scénario : rien ne change pour les clients avant l’activation.</span>
            </>
          )}
        </div>
        <div className="adm-sim-etat-actions">
          <label className="adm-sim-duree">Durée
            <select className="adm-input" value={duree} onChange={(e) => setDuree(Number(e.target.value))}>
              {DUREES.map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${d / 60} h`}</option>)}
            </select>
          </label>
          {actif ? (
            <>
              {modifie && <button type="button" className="adm-btn solid" disabled={envoi} onClick={() => void appliquer()}>Appliquer les changements</button>}
              <button type="button" className="adm-btn" disabled={envoi} onClick={() => void prolonger()}>Prolonger</button>
              <button type="button" className="adm-btn danger" disabled={envoi} onClick={() => void couper()}>Couper la simulation</button>
            </>
          ) : (
            <button type="button" className="adm-btn solid" disabled={envoi || (!brouillon.lieu && brouillon.chauffeurs.length === 0)} onClick={() => void activer()}>
              {envoi ? 'Activation…' : 'Valider et activer'}
            </button>
          )}
        </div>
      </div>
      {message && <p className={message.erreur ? 'adm-erreur' : 'adm-ok'} role="status">{message.texte}</p>}

      <div className="adm-sim-grille">
        <div className="adm-card adm-sim-carte-carte">
          <div className="adm-card-h">
            <h3>Carte du scénario</h3>
            <div className="adm-sim-modes" role="group" aria-label="Un clic sur la carte">
              {([['lieu', 'Placer le lieu'], ['chauffeur', 'Ajouter un chauffeur'], ['destination', 'Destination d’essai']] as Array<[Mode, string]>).map(([id, label]) => (
                <button key={id} type="button" className={`adm-btn xs${mode === id ? ' solid' : ''}`} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>
              ))}
            </div>
          </div>
          <CarteSimulateur lieu={brouillon.lieu} chauffeurs={brouillon.chauffeurs} destination={destination} rayons={rayons}
            rayonMarche={r.rayonOffreM} focus={focus} onClic={clicCarte} onRetirer={retirer} />
          <p className="adm-muted adm-sim-aide">
            {mode === 'lieu' ? 'Un clic place le lieu de prise en charge.' : mode === 'chauffeur' ? `Un clic ajoute un chauffeur ${NOM_GAMME[gamme]}.` : 'Un clic choisit la destination de la course d’essai.'}
            {' '}Un clic sur un chauffeur le retire. Le cercle en pointillé montre le rayon de {metres(r.rayonOffreM)} où se comptent l’offre et la demande.
          </p>
        </div>

        <div className="adm-sim-colonne">
          <div className="adm-card">
            <div className="adm-card-h"><h3>Lieu de prise en charge</h3></div>
            <div className="adm-sim-lieu">
              <span className="adm-sim-lieu-nom">{brouillon.lieu ? brouillon.lieu.nom : 'Aucun lieu choisi'}</span>
              {brouillon.lieu && <span className="adm-muted mono">{brouillon.lieu.lat.toFixed(5)}, {brouillon.lieu.lng.toFixed(5)}</span>}
              <button type="button" className="adm-btn" onClick={() => void choisirLieu()}>Rechercher un lieu</button>
            </div>
          </div>

          <div className="adm-card">
            <div className="adm-card-h"><h3>Chauffeurs autour du lieu</h3><span className="adm-muted mono">{brouillon.chauffeurs.length} / {r.maxChauffeurs}</span></div>
            <div className="adm-sim-gammes" role="radiogroup" aria-label="Gamme des chauffeurs à placer">
              {GAMMES.map((g) => (
                <button key={g.id} type="button" role="radio" aria-checked={gamme === g.id} className={`adm-sim-gamme g-${g.id}${gamme === g.id ? ' on' : ''}`} onClick={() => setGamme(g.id)}>
                  <i aria-hidden="true" />{g.label}
                </button>
              ))}
            </div>
            <div className="adm-sim-anneau">
              <label>Nombre<input className="adm-input mono" type="number" min={1} max={r.maxChauffeurs} value={nombre} onChange={(e) => setNombre(Math.max(1, Math.min(r.maxChauffeurs, Number(e.target.value) || 1)))} /></label>
              <label>Distance du lieu<span className="adm-sim-unite"><input className="adm-input mono" type="number" min={50} max={30000} step={50} value={distance} onChange={(e) => setDistance(Math.max(50, Math.min(30000, Number(e.target.value) || 50)))} />m</span></label>
              <button type="button" className="adm-btn solid" disabled={!brouillon.lieu} onClick={placerAnneau}>Placer {nombre} {NOM_GAMME[gamme]}</button>
            </div>
            <div className="adm-sim-distances" role="group" aria-label="Distances courantes">
              {DISTANCES.map((d) => <button key={d} type="button" className={`adm-btn xs${distance === d ? ' solid' : ''}`} onClick={() => setDistance(d)}>{metres(d)}</button>)}
            </div>
            {groupes.length > 0 ? (
              <ul className="adm-sim-groupes">
                {groupes.map((g) => (
                  <li key={`${g.gamme}|${g.distance}`}>
                    <i className={`g-${g.gamme}`} aria-hidden="true" />
                    <span><strong className="mono">{g.ids.length}</strong> {NOM_GAMME[g.gamme]} à {metres(g.distance)}</span>
                    <button type="button" className="adm-btn xs ghost" onClick={() => changer((b) => ({ ...b, chauffeurs: b.chauffeurs.filter((c) => !g.ids.includes(c.id)) }))}>Retirer</button>
                  </li>
                ))}
                <li className="adm-sim-total">
                  <span className="adm-muted">{parGamme.filter((g) => g.n > 0).map((g) => `${g.n} ${g.label}`).join(' · ')}</span>
                  <button type="button" className="adm-btn xs ghost" onClick={() => changer((b) => ({ ...b, chauffeurs: [] }))}>Tout retirer</button>
                </li>
              </ul>
            ) : <p className="adm-muted">Aucun chauffeur simulé. Placez-en un groupe ci-dessus, ou en cliquant sur la carte.</p>}
          </div>

          <div className="adm-card">
            <div className="adm-card-h"><h3>Clients qui commandent</h3><span className="adm-muted">à moins de {metres(r.rayonDemandeM)} du lieu</span></div>
            <div className="adm-sim-demande">
              <input type="range" min={0} max={r.maxDemande} value={brouillon.demande} aria-label="Clients simulés qui commandent"
                onChange={(e) => changer((b) => ({ ...b, demande: Number(e.target.value) }))} />
              <strong className="mono">{brouillon.demande}</strong>
            </div>
            <p className="adm-muted">
              Le prix monte de {Math.round((Math.min(1.3, r.plafond) - 1) * 100)} % quand les demandes des 10 dernières minutes dépassent 1,3 fois les chauffeurs libres à moins de {metres(r.rayonOffreM)}, à partir de {r.demandeMinimale} demandes (plafond {coef(r.plafond)}).
              {!r.surgeActif && ' La majoration de forte demande est coupée dans Dispatch : seule l’approche changera le prix.'}
            </p>
          </div>
        </div>
      </div>

      <div className="adm-sim-grille bas">
        <div className="adm-card">
          <div className="adm-card-h"><h3>Effet au lieu</h3><span className="adm-muted">{actif ? 'en ce moment, pour les clients' : 'si vous activez ce scénario'}</span></div>
          {!m ? <p className="adm-muted">Choisissez un lieu pour mesurer l’effet.</p> : (
            <>
              <dl className="adm-sim-mesures">
                <div><dt>Chauffeurs libres à {metres(r.rayonOffreM)}</dt><dd>{m.offreReelle} réel{m.offreReelle > 1 ? 's' : ''} + {m.offreSimulee} simulé{m.offreSimulee > 1 ? 's' : ''}</dd></div>
                <div><dt>Demandes (10 min)</dt><dd>{m.demandeReelle} réelle{m.demandeReelle > 1 ? 's' : ''} + {m.demandeSimulee} simulée{m.demandeSimulee > 1 ? 's' : ''}</dd></div>
                <div><dt>Majoration de forte demande</dt><dd>{coef(m.surgeSans)} → <strong className={m.surgeAvec > m.surgeSans ? 'hausse' : m.surgeAvec < m.surgeSans ? 'baisse' : ''}>{coef(m.surgeAvec)}</strong></dd></div>
              </dl>
              <table className="adm-table adm-sim-approches">
                <thead><tr><th>Approche du plus proche</th><th>Sans simulation</th><th>Avec</th></tr></thead>
                <tbody>
                  {m.approches.map((a) => (
                    <tr key={a.gamme}>
                      <td>{NOM_GAMME[a.gamme] ?? a.gamme}</td>
                      <td className="mono">{a.sans ? `${a.sans.minutes} min · ${String(a.sans.km).replace('.', ',')} km` : 'aucun'}</td>
                      <td className="mono">{a.avec ? `${a.avec.minutes} min · ${String(a.avec.km).replace('.', ',')} km` : 'aucun'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.approche?.actif && <p className="adm-muted">Approche offerte jusqu’à {r.approche.offerteKm} km et {r.approche.offerteMin} min, puis {r.approche.parKm} F/km et {r.approche.parMin} F/min, {r.approche.plafond} F au plus.</p>}
            </>
          )}
        </div>

        <div className="adm-card">
          <div className="adm-card-h"><h3>Prix affiché au client</h3><span className="adm-muted">course d’essai depuis le lieu</span></div>
          <div className="adm-sim-lieu">
            <span className="adm-sim-lieu-nom">{destination ? destination.nom : 'Aucune destination'}</span>
            <button type="button" className="adm-btn" onClick={() => void choisirDestination()}>Choisir la destination</button>
            <button type="button" className="adm-btn solid" disabled={!destination || !brouillon.lieu || calcul} onClick={() => void calculerApercu()}>{calcul ? 'Calcul…' : 'Calculer'}</button>
          </div>
          {apercu ? (
            <>
              <table className="adm-table adm-sim-prix">
                <thead><tr><th>Gamme</th><th>Sans simulation</th><th>Avec la simulation</th><th>Écart</th></tr></thead>
                <tbody>
                  {apercu.gammes.map((g) => {
                    const ecart = g.avec.montant - g.sans.montant;
                    return (
                      <tr key={g.gamme}>
                        <td>{NOM_GAMME[g.gamme] ?? g.gamme}</td>
                        <td className="mono">{fcfa(g.sans.montant)}</td>
                        <td className="mono"><strong>{fcfa(g.avec.montant)}</strong>{g.avec.surge > 1 && <span className="adm-muted"> · {coef(g.avec.surge)}</span>}</td>
                        <td className={`mono ${ecart > 0 ? 'hausse' : ecart < 0 ? 'baisse' : ''}`}>{ecart === 0 ? '0 F' : `${ecart > 0 ? '+' : '−'}${fcfa(Math.abs(ecart))}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="adm-muted">{String(apercu.distanceKm).replace('.', ',')} km · trafic {apercu.trafic === 'fluid' ? 'fluide' : apercu.trafic === 'dense' ? 'dense' : 'embouteillé'} · même calcul que l’app cliente, avec ce scénario{actif ? '' : ' (pas encore activé)'}.</p>
            </>
          ) : <p className="adm-muted">Choisissez une destination, puis « Calculer » : les prix de chaque gamme, sans et avec ce scénario.</p>}
        </div>
      </div>

      <p className="adm-muted adm-sim-note">
        Les commandes passées pendant une simulation sont confiées aux seuls vrais chauffeurs. La simulation se coupe seule à l’heure prévue, et chaque activation est inscrite au journal.
        {sim.majPar && ` Dernière modification : ${heure(sim.majLe)} par ${sim.majPar}.`}
      </p>
    </div>
  );
}

/* ------------------------------ Carte du scénario ------------------------------ */

const COULEURS_GAMME: Record<'dark' | 'light', Record<Gamme, string>> = {
  dark: { argent: '#c9ced6', or: '#e3b341', diamant: '#7aa7ff', moto: '#3ccf7e' },
  light: { argent: '#6b7280', or: '#b7791f', diamant: '#2f5fd0', moto: '#0f9d58' },
};
const cercle = (c: { lat: number; lng: number }, m: number) => {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 64; i++) { const p = pointA(c, m, (2 * Math.PI * i) / 64); pts.push([p.lng, p.lat]); }
  return pts;
};

function CarteSimulateur({ lieu, chauffeurs, destination, rayons, rayonMarche, focus, onClic, onRetirer }: {
  lieu: Lieu | null; chauffeurs: ChauffeurSim[]; destination: Lieu | null; rayons: number[]; rayonMarche: number; focus: number;
  onClic: (p: { lat: number; lng: number }) => void; onRetirer: (id: string) => void;
}) {
  const theme = useThemeConsole();
  const boite = useRef<HTMLDivElement>(null);
  const pins = useRef<{ lieu?: Marker; dest?: Marker }>({});
  const rappels = useRef({ onClic, onRetirer });
  rappels.current = { onClic, onRetirer };
  const C = COULEURS_GAMME[theme];
  const { carte, pret, indispo } = useCarteReelle(boite, theme, { center: lieu ? [lieu.lng, lieu.lat] : [-3.98, 5.35], zoom: lieu ? 13.6 : 11.6 }, (m: CarteML) => {
    m.addSource('sim-cercles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addSource('sim-chauffeurs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'sim-cercles', type: 'line', source: 'sim-cercles', paint: {
      'line-color': theme === 'light' ? '#1f2937' : '#e5e7eb', 'line-opacity': ['case', ['==', ['get', 'marche'], 1], 0.55, 0.22] as unknown as number,
      'line-width': 1.2, 'line-dasharray': [2, 2],
    } });
    m.addLayer({ id: 'sim-chauffeurs-halo', type: 'circle', source: 'sim-chauffeurs', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 12] as unknown as number,
      'circle-color': ['get', 'couleur'] as unknown as string, 'circle-opacity': 0.2,
    } });
    m.addLayer({ id: 'sim-chauffeurs', type: 'circle', source: 'sim-chauffeurs', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 6.5] as unknown as number,
      'circle-color': ['get', 'couleur'] as unknown as string,
      'circle-stroke-color': theme === 'light' ? '#ffffff' : '#0c0d0f', 'circle-stroke-width': 1.5,
    } });
    m.on('click', (e: MapMouseEvent) => {
      const touche = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['sim-chauffeurs'] });
      const id = touche[0]?.properties?.['id'];
      if (typeof id === 'string') { rappels.current.onRetirer(id); return; }
      rappels.current.onClic({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    m.on('mouseenter', 'sim-chauffeurs', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'sim-chauffeurs', () => { m.getCanvas().style.cursor = ''; });
    m.getCanvas().style.cursor = 'crosshair';
  });

  // Chauffeurs et cercles de distance.
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;
    (m.getSource('sim-chauffeurs') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: chauffeurs.map((c) => ({ type: 'Feature', properties: { id: c.id, couleur: C[c.gamme] }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })),
    });
    (m.getSource('sim-cercles') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: lieu ? [rayonMarche, ...rayons.filter((d) => d !== rayonMarche)].map((d, i) => ({
        type: 'Feature', properties: { marche: i === 0 ? 1 : 0 }, geometry: { type: 'LineString', coordinates: cercle(lieu, d) },
      })) : [],
    });
  }, [chauffeurs, lieu, rayons, rayonMarche, pret, carte, C]);

  // Épingles : lieu de prise en charge et destination d'essai.
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;
    void chargerML().then((ml) => {
      const poser = (cle: 'lieu' | 'dest', p: Lieu | null, classe: string, titre: string) => {
        const existant = pins.current[cle];
        if (!p) { existant?.remove(); delete pins.current[cle]; return; }
        if (existant) { existant.setLngLat([p.lng, p.lat]); existant.getElement().title = `${titre} : ${p.nom}`; return; }
        const el = document.createElement('div');
        el.className = `adm-sim-pin ${classe}`;
        el.title = `${titre} : ${p.nom}`;
        pins.current[cle] = new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(m);
      };
      poser('lieu', lieu, 'lieu', 'Prise en charge');
      poser('dest', destination, 'dest', 'Destination d’essai');
    });
  }, [lieu, destination, pret, carte]);

  useEffect(() => {
    const m = carte.current;
    if (!m || !pret || !lieu || focus === 0) return;
    m.flyTo({ center: [lieu.lng, lieu.lat], zoom: 14, duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, pret]);

  useEffect(() => () => { pins.current.lieu?.remove(); pins.current.dest?.remove(); pins.current = {}; }, [theme]);

  if (indispo) return <p className="adm-muted">Carte indisponible (serveur de cartes injoignable) : placez le lieu par la recherche et les chauffeurs par groupes.</p>;
  return (
    <div className="adm-map adm-map-reelle adm-sim-carte">
      <div ref={boite} className="adm-map-ml" />
      {!pret && <div className="adm-map-chargement">Chargement de la carte d’Abidjan…</div>}
      <div className="adm-loc-legende adm-sim-legende">
        {GAMMES.map((g) => <span key={g.id}><i style={{ background: C[g.id] }} />{g.label}</span>)}
      </div>
    </div>
  );
}
