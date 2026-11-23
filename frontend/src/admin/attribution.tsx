import { useMemo, useState } from 'react';
import { adminPost, LIVE, AdminError } from './api';
import type { FleetUnit, RideRow } from './types';

/**
 * VALIDER UN CHAUFFEUR ET LUI ATTRIBUER SON VÉHICULE (chauffeurs salariés).
 *
 * Le chauffeur ne saisit que ses informations personnelles dans son app. ORION lui attribue
 * sa gamme, son véhicule (modèle, plaque, couleur, motorisation) et, au besoin, un matricule,
 * puis valide son dossier : il peut se mettre en ligne aussitôt. Son app reçoit la fiche en
 * direct.
 */
export interface FicheAttribution {
  id: string; name: string; matricule: string; category: string; kycStatus: string;
  /** Gammes servies (celle du véhicule comprise). */
  categories?: string[];
  vehicule?: { modele: string | null; plaque: string | null; couleur: string | null; motorisation: string | null; batterieKwh: number | null } | null;
}

const GAMMES: Array<[string, string]> = [['argent', 'Argent'], ['or', 'Or'], ['diamant', 'Diamant'], ['moto', 'Coursier moto']];

export function DialogueAttribution({ fiche, valider, onFermer, onFait }: {
  fiche: FicheAttribution; valider: boolean; onFermer: () => void;
  onFait: (r: { category: string; categories?: string[]; kycStatus: string; matricule: string }) => void;
}) {
  const v = fiche.vehicule;
  const [categorie, setCategorie] = useState(fiche.category || 'argent');
  // GAMMES SERVIES : le PDG ouvre au chauffeur d'autres gammes que celle de son véhicule ;
  // il reçoit alors les courses de chacune (son app l'affiche aussitôt).
  const [servies, setServies] = useState<string[]>(() => (fiche.categories?.length ? fiche.categories : [fiche.category || 'argent']).filter((g) => g !== 'moto'));
  const toutesServies = categorie === 'moto' ? [] : [...new Set([categorie, ...servies])];
  const [modele, setModele] = useState(v?.modele ?? '');
  const [plaque, setPlaque] = useState(v?.plaque ?? '');
  const [couleur, setCouleur] = useState(v?.couleur ?? '');
  const [motorisation, setMotorisation] = useState(v?.motorisation ?? 'electric');
  const [batterie, setBatterie] = useState(v?.batterieKwh ? String(v.batterieKwh) : '');
  const [matricule, setMatricule] = useState(fiche.matricule);
  const [activer, setActiver] = useState(valider || fiche.kycStatus === 'active');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');

  const envoyer = async () => {
    setErreur('');
    if (activer && (!modele.trim() || !plaque.trim())) { setErreur('Indiquez au moins le modèle et la plaque du véhicule attribué.'); return; }
    const corps: Record<string, unknown> = { category: categorie, engine: motorisation, valider: activer && fiche.kycStatus !== 'active' ? true : undefined };
    if (categorie !== 'moto') corps['categories'] = toutesServies;
    if (modele.trim()) corps['vehicleModel'] = modele.trim();
    if (plaque.trim()) corps['vehiclePlate'] = plaque.trim();
    if (couleur.trim()) corps['vehicleColor'] = couleur.trim();
    if (batterie.trim() && Number(batterie) > 0) corps['batteryKwh'] = Number(batterie);
    if (matricule.trim() && matricule.trim() !== fiche.matricule) corps['matricule'] = matricule.trim();
    setEnvoi(true);
    try {
      if (LIVE) {
        const r = await adminPost<{ driver: { category: string; categories?: string[]; kycStatus: string; matricule: string } }>(`/admin/drivers/${fiche.id}/attribution`, corps);
        onFait(r.driver);
      } else {
        onFait({ category: categorie, categories: toutesServies, kycStatus: activer ? 'active' : fiche.kycStatus, matricule: matricule.trim() || fiche.matricule });
      }
    } catch (e) {
      setErreur(e instanceof AdminError ? e.message : 'Le serveur n’a pas répondu. Rien n’a été enregistré.');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="adm-modal-wrap" onKeyDown={(e) => { if (e.key === 'Escape') onFermer(); }}>
      <form className="adm-modal adm-dialogue adm-attribution" role="dialog" aria-modal="true" aria-label="Attribution du véhicule"
        onSubmit={(e) => { e.preventDefault(); void envoyer(); }}>
        <h3>{valider ? 'Valider l’inscription' : 'Véhicule et gamme attribués'}</h3>
        <p className="adm-muted">{fiche.name} · {fiche.matricule}. Le chauffeur voit ces informations dans son application, en lecture seule.</p>
        <div className="adm-attribution-grille">
          <label className="field">Gamme
            <select className="adm-select" value={categorie} onChange={(e) => setCategorie(e.target.value)}>
              {GAMMES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            </select>
          </label>
          <label className="field">Matricule ORION
            <input className="adm-input mono" value={matricule} onChange={(e) => setMatricule(e.target.value.toUpperCase())} />
          </label>
          <label className="field">Modèle du véhicule
            <input className="adm-input" placeholder="BYD Seal" value={modele} onChange={(e) => setModele(e.target.value)} />
          </label>
          <label className="field">Plaque
            <input className="adm-input mono" placeholder="1234 AB 01" value={plaque} onChange={(e) => setPlaque(e.target.value.toUpperCase())} />
          </label>
          <label className="field">Couleur
            <input className="adm-input" placeholder="Noir" value={couleur} onChange={(e) => setCouleur(e.target.value)} />
          </label>
          <label className="field">Motorisation
            <select className="adm-select" value={motorisation} onChange={(e) => setMotorisation(e.target.value)}>
              <option value="electric">Électrique</option>
              <option value="hybrid">Hybride</option>
            </select>
          </label>
          {motorisation === 'electric' && (
            <label className="field">Batterie (kWh)
              <input className="adm-input" inputMode="decimal" placeholder="82" value={batterie} onChange={(e) => setBatterie(e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
          )}
        </div>
        {categorie !== 'moto' && (
          <fieldset className="adm-gammes-servies">
            <legend>Gammes servies</legend>
            <p className="adm-muted">Le chauffeur reçoit les courses de chaque gamme cochée. La gamme de son véhicule reste toujours servie.</p>
            <div className="adm-gammes-cases">
              {GAMMES.filter(([id]) => id !== 'moto').map(([id, l]) => {
                const principale = id === categorie;
                return (
                  <label key={id} className={`adm-case${principale ? ' principale' : ''}`}>
                    <input type="checkbox" checked={principale || servies.includes(id)} disabled={principale}
                      onChange={(e) => setServies((s) => (e.target.checked ? [...s, id] : s.filter((x) => x !== id)))} />
                    <span>{l}{principale ? ' · gamme du véhicule' : ''}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        {fiche.kycStatus !== 'active' && (
          <label className="adm-case">
            <input type="checkbox" checked={activer} onChange={(e) => setActiver(e.target.checked)} />
            <span>Valider le dossier : le chauffeur peut se mettre en ligne et recevoir des courses.</span>
          </label>
        )}
        {erreur && <p className="adm-erreur" role="alert">{erreur}</p>}
        <div className="adm-dialogue-actions">
          <button type="button" className="adm-btn" onClick={onFermer}>Annuler</button>
          <button type="submit" className="adm-btn solid" disabled={envoi}>{envoi ? 'Enregistrement…' : activer && fiche.kycStatus !== 'active' ? 'Valider et attribuer' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  );
}

/** Distance à vol d'oiseau (km). */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * ATTRIBUER UNE COURSE À UN CHAUFFEUR PRÉCIS : la console propose les chauffeurs en ligne
 * et libres, du plus proche au plus loin du point de prise en charge. Le chauffeur choisi
 * reçoit l'offre dans son app ; le passager voit son nouveau chauffeur.
 */
export function DialogueAttribuerCourse({ course, flotte, onFermer, onFait }: {
  course: RideRow; flotte: FleetUnit[]; onFermer: () => void; onFait: () => void;
}) {
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState('');
  const origine = course.origin;
  const libres = useMemo(() => flotte
    .filter((f) => f.availability === 'online' && f.id !== course.driverId)
    .map((f) => ({ ...f, km: origine ? distanceKm(origine, f) : null }))
    .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9))
    .slice(0, 30), [flotte, origine, course.driverId]);

  const attribuer = async (driverId: string | null) => {
    setErreur('');
    setEnvoi(driverId ?? 'auto');
    try {
      if (LIVE) await adminPost(`/admin/rides/${course.id}/reassign`, driverId ? { driverId } : {});
      onFait();
    } catch (e) {
      setErreur(e instanceof AdminError ? e.message : 'Le serveur n’a pas répondu.');
    } finally {
      setEnvoi(null);
    }
  };

  return (
    <div className="adm-modal-wrap" onKeyDown={(e) => { if (e.key === 'Escape') onFermer(); }}>
      <div className="adm-modal adm-dialogue adm-attribution" role="dialog" aria-modal="true" aria-label="Attribuer la course">
        <h3>Attribuer la course</h3>
        <p className="adm-muted">{course.depart ?? '—'}{course.arrivee ? ` → ${course.arrivee}` : ''} · chauffeurs en ligne et libres, du plus proche au plus loin.</p>
        <button type="button" className="adm-btn" disabled={envoi !== null} onClick={() => void attribuer(null)}>
          {envoi === 'auto' ? 'Recherche…' : 'Laisser ORION choisir le plus proche (jusqu’à 30 km)'}
        </button>
        <div className="adm-attribution-liste">
          {libres.length === 0 && <p className="adm-muted">Aucun chauffeur en ligne et libre pour le moment.</p>}
          {libres.map((f) => (
            <button key={f.id} type="button" className="adm-attribution-ligne" disabled={envoi !== null} onClick={() => void attribuer(f.id)}>
              <span className="grow" style={{ textAlign: 'start' }}><strong>{f.name}</strong><br /><span className="adm-muted mono" style={{ fontSize: 11.5 }}>{f.matricule ?? '—'} · {f.category}</span></span>
              <span className="mono">{f.km !== null ? `${f.km.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km` : '—'}</span>
              <span className="adm-btn xs solid">{envoi === f.id ? '…' : 'Attribuer'}</span>
            </button>
          ))}
        </div>
        {erreur && <p className="adm-erreur" role="alert">{erreur}</p>}
        <div className="adm-dialogue-actions">
          <button type="button" className="adm-btn" onClick={onFermer}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
