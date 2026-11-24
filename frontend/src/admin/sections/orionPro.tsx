import { useEffect, useState } from 'react';
import { AdminError, LIVE, adminDel, adminGet, adminPut } from '../api';
import { avis, demanderLieu } from '../dialogues';

/**
 * ORION PRO : CARTE ET VOIX DE BORD (console).
 *  - SIÈGES ET AGENCES : la direction les place sur la carte ; ORION Pro guide chaque chauffeur
 *    et livreur vers celui de sa zone (« Rentrer au siège de ma zone »).
 *  - VOIX DE BORD : les phrases de l'accueil vocal que le téléphone du chauffeur dit au client
 *    une fois à bord (salut et vœu selon le moment, consignes, ORION Assurance). Chaque phrase
 *    se retouche ici ; le texte d'origine reste disponible.
 */
interface Base { id?: string; nom: string; adresse?: string; zone?: string; lat: number; lng: number; telephone?: string; horaires?: string; principale?: boolean }
type Moment = 'matin' | 'fin_matinee' | 'debut_apres_midi' | 'fin_apres_midi' | 'debut_soiree' | 'soir' | 'nuit';
interface Phrase { salut: string; voeu: string; fin: string }
interface Textes { moments: Record<Moment, Phrase>; corps: string; assure: string; nonAssure: string }
interface Exemple { texte: string; voix: 'feminine' | 'masculine' }
interface EtatVoix { textes: Textes; origine: Textes; majLe: string | null; majPar: string | null; exemples: Exemple[] }

const MOMENTS: Array<{ id: Moment; label: string; heures: string }> = [
  { id: 'matin', label: 'Matin', heures: '4 h – 10 h' },
  { id: 'fin_matinee', label: 'Fin de matinée', heures: '10 h – 12 h' },
  { id: 'debut_apres_midi', label: 'Début d’après-midi', heures: '12 h – 15 h' },
  { id: 'fin_apres_midi', label: 'Fin d’après-midi', heures: '15 h – 17 h' },
  { id: 'debut_soiree', label: 'Début de soirée', heures: '17 h – 18 h' },
  { id: 'soir', label: 'Soir', heures: '18 h – 20 h' },
  { id: 'nuit', label: 'Nuit', heures: 'à partir de 20 h' },
];
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const message = (e: unknown) => (e instanceof AdminError ? e.message : 'Serveur ORION injoignable');

export function OrionProSection({ canWrite }: { canWrite: boolean }) {
  if (!LIVE) return <div className="adm-card"><p className="adm-muted">Connectez la console au serveur ORION pour régler la carte et la voix d’ORION Pro.</p></div>;
  return (
    <div className="adm-orionpro">
      <SiegesOrion canWrite={canWrite} />
      <VoixDeBord canWrite={canWrite} />
    </div>
  );
}

function SiegesOrion({ canWrite }: { canWrite: boolean }) {
  const [bases, setBases] = useState<Base[] | null>(null);
  const [maj, setMaj] = useState<{ le: string | null; par: string | null }>({ le: null, par: null });
  const [modifie, setModifie] = useState(false);
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    void adminGet<{ bases: Base[]; majLe: string | null; majPar: string | null }>('/admin/bases-orion')
      .then((r) => { setBases(r.bases); setMaj({ le: r.majLe, par: r.majPar }); })
      .catch((e) => { setBases([]); avis(message(e)); });
  }, []);
  const changer = (i: number, patch: Partial<Base>) => { setBases((l) => l!.map((b, j) => (j === i ? { ...b, ...patch } : b))); setModifie(true); };
  const ajouter = async () => {
    const lieu = await demanderLieu('Où se trouve ce siège ou cette agence ORION ? Cherchez l’adresse, le quartier ou un repère proche.');
    if (!lieu) return;
    setBases((l) => [...(l ?? []), { nom: `Agence ORION · ${lieu.area.split(' · ')[0] || lieu.name}`, adresse: lieu.name, zone: lieu.area.split(' · ')[0] || undefined, lat: lieu.location.lat, lng: lieu.location.lng, principale: (l ?? []).length === 0 }]);
    setModifie(true);
  };
  const deplacer = async (i: number) => {
    const lieu = await demanderLieu('Nouvel emplacement de ce siège : cherchez l’adresse ou un repère proche.');
    if (lieu) changer(i, { lat: lieu.location.lat, lng: lieu.location.lng, adresse: lieu.name });
  };
  const enregistrer = async () => {
    if (!bases) return;
    setOccupe(true);
    try {
      const r = await adminPut<{ bases: Base[] }>('/admin/bases-orion', { bases: bases.map((b) => ({ ...b, adresse: b.adresse || undefined, zone: b.zone || undefined, telephone: b.telephone || undefined, horaires: b.horaires || undefined })) });
      setBases(r.bases); setModifie(false); setMaj({ le: new Date().toISOString(), par: 'vous' });
      avis('Sièges enregistrés : ORION Pro les affiche à tous les chauffeurs et livreurs.');
    } catch (e) { avis(message(e)); } finally { setOccupe(false); }
  };
  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>Sièges et agences ORION</h3>
        {canWrite && <button type="button" className="adm-btn" onClick={() => void ajouter()}>Ajouter un siège</button>}
      </div>
      <p className="adm-muted">Dans ORION Pro, « Rentrer au siège de ma zone » guide le chauffeur ou le livreur vers le siège de sa commune (colonne Zone), sinon vers le plus proche, sinon vers le siège principal.</p>
      {bases === null ? <p className="adm-muted">Chargement…</p> : bases.length === 0 ? (
        <p className="adm-muted">Aucun siège renseigné : ORION Pro l’indique aux chauffeurs. Ajoutez le siège principal et les agences.</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Nom</th><th>Zone (commune)</th><th>Adresse</th><th>Horaires</th><th>Principal</th><th>Position</th><th /></tr></thead>
            <tbody>
              {bases.map((b, i) => (
                <tr key={b.id ?? `n${i}`}>
                  <td><input className="adm-input" value={b.nom} disabled={!canWrite} onChange={(e) => changer(i, { nom: e.target.value })} aria-label="Nom" /></td>
                  <td><input className="adm-input" value={b.zone ?? ''} placeholder="Cocody" disabled={!canWrite} onChange={(e) => changer(i, { zone: e.target.value })} aria-label="Zone" /></td>
                  <td><input className="adm-input" value={b.adresse ?? ''} disabled={!canWrite} onChange={(e) => changer(i, { adresse: e.target.value })} aria-label="Adresse" /></td>
                  <td><input className="adm-input" value={b.horaires ?? ''} placeholder="7 h – 20 h" disabled={!canWrite} onChange={(e) => changer(i, { horaires: e.target.value })} aria-label="Horaires" /></td>
                  <td><input type="radio" name="principale" checked={Boolean(b.principale)} disabled={!canWrite} onChange={() => { setBases((l) => l!.map((x, j) => ({ ...x, principale: j === i }))); setModifie(true); }} aria-label="Siège principal" /></td>
                  <td className="mono">{b.lat.toFixed(4)}, {b.lng.toFixed(4)}{canWrite && <> <button type="button" className="adm-btn xs ghost" onClick={() => void deplacer(i)}>Déplacer</button></>}</td>
                  <td>{canWrite && <button type="button" className="adm-btn xs ghost" onClick={() => { setBases((l) => l!.filter((_, j) => j !== i)); setModifie(true); }}>Retirer</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canWrite && (
        <div className="adm-orionpro-actions">
          <button type="button" className="adm-btn solid" disabled={!modifie || occupe || bases?.some((b) => b.nom.trim().length < 2)} onClick={() => void enregistrer()}>Enregistrer les sièges</button>
          {maj.le && <span className="adm-muted">Mis à jour le {date(maj.le)}{maj.par ? ` par ${maj.par}` : ''}</span>}
        </div>
      )}
    </div>
  );
}

function VoixDeBord({ canWrite }: { canWrite: boolean }) {
  const [etat, setEtat] = useState<EtatVoix | null>(null);
  const [t, setT] = useState<Textes | null>(null);
  const [modifie, setModifie] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const charger = () => adminGet<EtatVoix>('/admin/voix-bord').then((r) => { setEtat(r); setT(r.textes); setModifie(false); }).catch((e) => avis(message(e)));
  useEffect(() => { void charger(); }, []);
  if (!etat || !t) return <div className="adm-card"><p className="adm-muted">Chargement de la voix de bord…</p></div>;
  const moment = (id: Moment, patch: Partial<Phrase>) => { setT({ ...t, moments: { ...t.moments, [id]: { ...t.moments[id], ...patch } } }); setModifie(true); };
  const enregistrer = async () => {
    setOccupe(true);
    try { await adminPut('/admin/voix-bord', t); await charger(); avis('Voix de bord enregistrée : ORION Pro dira ce texte dès la prochaine course.'); }
    catch (e) { avis(message(e)); } finally { setOccupe(false); }
  };
  const origine = async () => {
    setOccupe(true);
    try { await adminDel('/admin/voix-bord'); await charger(); avis('Texte d’origine rétabli.'); } catch (e) { avis(message(e)); } finally { setOccupe(false); }
  };
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Voix de bord · accueil du client</h3></div>
      <p className="adm-muted">Le client donne son code à 4 chiffres, la course démarre : le téléphone du chauffeur (ORION Pro) l’accueille par sa civilité et son nom, avec la voix du GPS — féminine pour un client, masculine pour une cliente. Heure d’Abidjan.</p>
      <div className="adm-table-wrap">
        <table className="adm-table adm-voix-moments">
          <thead><tr><th>Moment</th><th>Salut</th><th>Vœu (après « {'{salut}'} Madame / Monsieur Nom, bienvenue à bord d’ORION. »)</th><th>Fin du message</th></tr></thead>
          <tbody>
            {MOMENTS.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.label}</strong><div className="adm-muted">{m.heures}</div></td>
                <td><input className="adm-input" value={t.moments[m.id].salut} disabled={!canWrite} onChange={(e) => moment(m.id, { salut: e.target.value })} aria-label={`Salut · ${m.label}`} /></td>
                <td><textarea className="adm-input adm-voix-texte" rows={2} value={t.moments[m.id].voeu} disabled={!canWrite} onChange={(e) => moment(m.id, { voeu: e.target.value })} aria-label={`Vœu · ${m.label}`} /></td>
                <td><input className="adm-input" value={t.moments[m.id].fin} disabled={!canWrite} onChange={(e) => moment(m.id, { fin: e.target.value })} aria-label={`Fin · ${m.label}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="adm-voix-champ">
        <span>Corps du message <span className="adm-muted">— repères : {'{salut} {civilite} {nom} {voeu} {assurance} {fin}'}</span></span>
        <textarea className="adm-input adm-voix-texte" rows={6} value={t.corps} disabled={!canWrite} onChange={(e) => { setT({ ...t, corps: e.target.value }); setModifie(true); }} />
      </label>
      <label className="adm-voix-champ"><span>Client couvert par ORION Assurance</span>
        <textarea className="adm-input adm-voix-texte" rows={2} value={t.assure} disabled={!canWrite} onChange={(e) => { setT({ ...t, assure: e.target.value }); setModifie(true); }} />
      </label>
      <label className="adm-voix-champ"><span>Client sans ORION Assurance</span>
        <textarea className="adm-input adm-voix-texte" rows={2} value={t.nonAssure} disabled={!canWrite} onChange={(e) => { setT({ ...t, nonAssure: e.target.value }); setModifie(true); }} />
      </label>
      <div className="adm-voix-exemples">
        {etat.exemples.map((x, i) => (
          <div key={i} className="adm-voix-exemple">
            <span className="adm-muted">{i === 0 ? 'Exemple · client, 8 h, assuré · voix féminine' : 'Exemple · cliente, 19 h, sans assurance · voix masculine'}</span>
            <p>{x.texte}</p>
          </div>
        ))}
      </div>
      {canWrite && (
        <div className="adm-orionpro-actions">
          <button type="button" className="adm-btn solid" disabled={!modifie || occupe} onClick={() => void enregistrer()}>Enregistrer la voix de bord</button>
          <button type="button" className="adm-btn" disabled={occupe} onClick={() => void origine()}>Revenir au texte d’origine</button>
          {etat.majLe && <span className="adm-muted">Retouché le {date(etat.majLe)}{etat.majPar ? ` par ${etat.majPar}` : ''}</span>}
        </div>
      )}
    </div>
  );
}
