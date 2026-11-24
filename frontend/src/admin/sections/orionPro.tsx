import { useEffect, useState } from 'react';
import { AdminError, LIVE, adminDel, adminGet, adminPostSon, adminPut } from '../api';
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
      <MeteoAbidjan />
      <ServicesGoogle canWrite={canWrite} />
      <VoixHumaine canWrite={canWrite} />
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
      <p className="adm-muted">Le client donne son code à 4 chiffres, la course démarre : ORION Pro l’accueille par sa civilité et son nom, avec la voix humaine réglée ci-dessus (à défaut, la voix du téléphone) — féminine pour un client, masculine pour une cliente. Heure d’Abidjan.</p>
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

/* ------------------------------ Voix humaine (IA) ------------------------------ */

type Fournisseur = 'google' | 'gemini' | 'openai' | 'elevenlabs';
type Genre = 'feminine' | 'masculine';
interface VoixCat { id: string; nom: string; ton: string }
interface FicheFournisseur { nom: string; cle: string; obtenir: string; feminines: VoixCat[]; masculines: VoixCat[]; voixLibres?: boolean; defaut: Record<Genre, string>; modele: string; cout: string }
interface EtatCle { enregistree: boolean; source: 'console' | 'serveur' | 'compte_service' | null; fin: string | null }
interface EtatVoixHumaine {
  fournisseur: Fournisseur | 'aucun'; active: boolean; style: string; styleDefaut: string;
  voix: Record<Fournisseur, Record<Genre, string>>; modele: Record<Fournisseur, string>; cles: Record<Fournisseur, EtatCle>;
  catalogue: Record<Fournisseur, FicheFournisseur>;
  dernierEssai: { ok: boolean; at: string; fournisseur: Fournisseur; voix: string; modele?: string; erreur?: string } | null;
  majLe: string | null; majPar: string | null;
}
const ORDRE: Fournisseur[] = ['google', 'gemini', 'openai', 'elevenlabs'];
const COURT: Record<Fournisseur, string> = { google: 'Google · voix Gemini', gemini: 'Gemini (AI Studio)', openai: 'OpenAI · voix ChatGPT', elevenlabs: 'ElevenLabs' };
const SOURCE: Record<string, string> = { console: 'saisie dans la console', serveur: 'variable du serveur', compte_service: 'compte de service Google du serveur' };

/**
 * VOIX HUMAINE : la direction choisit la voix d'IA conversationnelle qui accueille les clients
 * (Google/Gemini, OpenAI/ChatGPT, ElevenLabs), colle la clé du fournisseur (chiffrée sur le
 * serveur, jamais réaffichée), choisit une voix féminine et une voix masculine, règle le ton,
 * et écoute un essai avant de la mettre en service.
 */
function VoixHumaine({ canWrite }: { canWrite: boolean }) {
  const [etat, setEtat] = useState<EtatVoixHumaine | null>(null);
  const [f, setF] = useState<Fournisseur | 'aucun'>('aucun');
  const [voix, setVoix] = useState<Record<Genre, string>>({ feminine: '', masculine: '' });
  const [style, setStyle] = useState('');
  const [modele, setModele] = useState('');
  const [cle, setCle] = useState('');
  const [occupe, setOccupe] = useState<string | null>(null);
  const [lecture, setLecture] = useState<HTMLAudioElement | null>(null);
  const [resultat, setResultat] = useState<{ ok: boolean; texte: string } | null>(null);
  const appliquer = (r: EtatVoixHumaine, choix?: Fournisseur | 'aucun') => {
    setEtat(r);
    const g = choix ?? (r.fournisseur === 'aucun' ? 'google' : r.fournisseur);
    setF(choix ?? r.fournisseur);
    if (g !== 'aucun') { setVoix(r.voix[g]); setModele(r.modele[g]); }
    setStyle(r.style);
  };
  const charger = () => adminGet<EtatVoixHumaine>('/admin/voix-humaine').then((r) => appliquer(r)).catch((e) => avis(message(e)));
  useEffect(() => { void charger(); }, []);
  useEffect(() => () => { lecture?.pause(); }, [lecture]);
  if (!etat) return <div className="adm-card"><p className="adm-muted">Chargement de la voix humaine…</p></div>;

  const choisir = (n: Fournisseur | 'aucun') => {
    setF(n); setCle(''); setResultat(null);
    if (n !== 'aucun') { setVoix(etat.voix[n]); setModele(etat.modele[n]); }
  };
  const fiche = f === 'aucun' ? null : etat.catalogue[f];
  const etatCle = f === 'aucun' ? null : etat.cles[f];

  const ecouter = async (genre: Genre) => {
    if (f === 'aucun') return;
    if (lecture) { lecture.pause(); setLecture(null); if (occupe === genre) { setOccupe(null); return; } }
    setOccupe(genre); setResultat(null);
    try {
      const r = await adminPostSon('/admin/voix-humaine/essai', { fournisseur: f, genre, voix: voix[genre] || undefined, style, modele: modele || undefined, ...(cle.trim() ? { cle: cle.trim() } : {}) });
      const el = new Audio(URL.createObjectURL(r.son));
      setLecture(el);
      el.onended = () => { setLecture(null); setOccupe(null); };
      setResultat({ ok: true, texte: `Essai réussi : ${COURT[f]}, voix ${voix[genre] || fiche?.defaut[genre]}${r.modele ? ` (${r.modele === 'chirp3-hd' ? 'Chirp 3 HD' : r.modele})` : ''}.` });
      await el.play();
    } catch (e) {
      setOccupe(null);
      setResultat({ ok: false, texte: message(e) });
    }
  };
  const enregistrer = async () => {
    setOccupe('enregistrer');
    try {
      const r = await adminPut<EtatVoixHumaine>('/admin/voix-humaine', {
        fournisseur: f,
        ...(f !== 'aucun' ? { voix, modele, ...(cle.trim() ? { cle: cle.trim() } : {}) } : {}),
        style,
      });
      setCle('');
      appliquer(r, f);
      avis(r.active ? 'Voix humaine en service : ORION Pro l’utilisera dès la prochaine course.' : f === 'aucun' ? 'Voix du téléphone rétablie.' : 'Réglage enregistré. Il manque la clé du fournisseur pour mettre la voix en service.');
    } catch (e) { avis(message(e)); } finally { setOccupe(null); }
  };
  const effacerCle = async () => {
    if (f === 'aucun') return;
    setOccupe('enregistrer');
    try { appliquer(await adminPut<EtatVoixHumaine>('/admin/voix-humaine', { fournisseur: f, cle: null }), f); avis('Clé effacée du serveur.'); }
    catch (e) { avis(message(e)); } finally { setOccupe(null); }
  };
  const enService = etat.active && etat.fournisseur !== 'aucun';
  const listeVoix = (genre: Genre) => (genre === 'feminine' ? fiche?.feminines : fiche?.masculines) ?? [];

  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>Voix humaine · accueil par une IA vocale</h3>
        <span className={`adm-pill ${enService ? 'hab-green' : 'hab-amber'}`}>
          {enService && etat.fournisseur !== 'aucun' ? `En service · ${COURT[etat.fournisseur]} · ${etat.voix[etat.fournisseur].feminine} / ${etat.voix[etat.fournisseur].masculine}` : 'Voix du téléphone'}
        </span>
      </div>
      <p className="adm-muted">L’accueil n’est plus lu par le moteur vocal du téléphone : il est dit par une voix d’IA conversationnelle, celle des assistants comme Gemini ou ChatGPT, avec l’intonation et le sourire d’une vraie personne. Le serveur fabrique le son, ORION Pro le télécharge pendant l’approche et le joue dès le code validé. Sans réseau, la voix du téléphone prend le relais.</p>

      <div className="adm-seg adm-vh-choix" role="radiogroup" aria-label="Fournisseur de la voix">
        {ORDRE.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={f === n} className={`adm-seg-b${f === n ? ' on' : ''}`} disabled={!canWrite} onClick={() => choisir(n)}>{COURT[n]}</button>
        ))}
        <button type="button" role="radio" aria-checked={f === 'aucun'} className={`adm-seg-b${f === 'aucun' ? ' on' : ''}`} disabled={!canWrite} onClick={() => choisir('aucun')}>Voix du téléphone</button>
      </div>

      {fiche && f !== 'aucun' && etatCle && (
        <div className="adm-vh-reglage">
          <label className="adm-voix-champ">
            <span>{fiche.cle}</span>
            <input className="adm-input" type="password" autoComplete="off" spellCheck={false} value={cle} disabled={!canWrite}
              placeholder={etatCle.enregistree ? `Clé enregistrée${etatCle.fin ? ` ••••${etatCle.fin}` : ''} (${SOURCE[etatCle.source ?? 'console']}) : laisser vide pour la garder` : 'Collez la clé ici'}
              onChange={(e) => setCle(e.target.value)} />
            <span className="adm-muted">Où l’obtenir : {fiche.obtenir}</span>
            {etatCle.enregistree && etatCle.source === 'console' && canWrite && (
              <button type="button" className="adm-btn adm-vh-effacer" disabled={occupe !== null} onClick={() => void effacerCle()}>Effacer la clé enregistrée</button>
            )}
          </label>

          {(['feminine', 'masculine'] as Genre[]).map((genre) => (
            <div key={genre} className="adm-vh-voix">
              <label className="adm-voix-champ">
                <span>{genre === 'feminine' ? 'Voix féminine · accueille les clients' : 'Voix masculine · accueille les clientes'}</span>
                {fiche.voixLibres
                  ? <input className="adm-input" value={voix[genre]} disabled={!canWrite} placeholder="Voice ID de la bibliothèque ElevenLabs" onChange={(e) => setVoix({ ...voix, [genre]: e.target.value.trim() })} />
                  : (
                    <select className="adm-select" value={voix[genre]} disabled={!canWrite} onChange={(e) => setVoix({ ...voix, [genre]: e.target.value })}>
                      {listeVoix(genre).map((v) => <option key={v.id} value={v.id}>{v.nom} · {v.ton}{v.id === fiche.defaut[genre] ? ' (conseillée)' : ''}</option>)}
                    </select>
                  )}
              </label>
              <button type="button" className="adm-btn" disabled={occupe === 'enregistrer' || (occupe !== null && occupe !== genre)} onClick={() => void ecouter(genre)}>
                {occupe === genre ? (lecture ? 'Arrêter' : 'Fabrication du son…') : 'Écouter l’accueil'}
              </button>
            </div>
          ))}

          <label className="adm-voix-champ adm-vh-modele">
            <span>Modèle <span className="adm-muted">(laisser celui proposé, sauf conseil du fournisseur)</span></span>
            <input className="adm-input" value={modele} disabled={!canWrite} onChange={(e) => setModele(e.target.value.trim())} />
          </label>
          <p className="adm-muted">Coût indicatif : {fiche.cout}. Un même accueil n’est fabriqué qu’une fois (préparé pendant l’approche, joué à bord).</p>
        </div>
      )}

      {f !== 'aucun' && f !== 'elevenlabs' && (
        <label className="adm-voix-champ">
          <span>Ton de la voix <span className="adm-muted">— consigne donnée à l’IA (chaleur, sourire, rythme)</span></span>
          <textarea className="adm-input adm-voix-texte" rows={3} value={style} disabled={!canWrite} onChange={(e) => setStyle(e.target.value)} />
          {canWrite && style !== etat.styleDefaut && <button type="button" className="adm-btn adm-vh-effacer" onClick={() => setStyle(etat.styleDefaut)}>Ton d’origine</button>}
        </label>
      )}

      {resultat && <p className={resultat.ok ? 'adm-vh-ok' : 'adm-vh-erreur'} role="status">{resultat.texte}</p>}
      {canWrite && (
        <div className="adm-orionpro-actions">
          <button type="button" className="adm-btn solid" disabled={occupe !== null} onClick={() => void enregistrer()}>
            {f === 'aucun' ? 'Revenir à la voix du téléphone' : 'Enregistrer et mettre en service'}
          </button>
          {etat.dernierEssai && !resultat && (
            <span className="adm-muted">Dernier son : {date(etat.dernierEssai.at)} · {etat.dernierEssai.ok ? 'réussi' : `échec (${etat.dernierEssai.erreur ?? 'erreur'})`}</span>
          )}
          {etat.majLe && <span className="adm-muted">Réglé le {date(etat.majLe)}{etat.majPar ? ` par ${etat.majPar}` : ''}</span>}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Services Google du serveur --------------------------- */

type ServiceG = 'meteo' | 'recalage' | 'cartes' | 'streetview';
interface EtatServiceG { actif: boolean; coupe: boolean; appelsDuJour: number; erreursDuJour: number; dernierAppel: string | null; derniereErreur: string | null }
interface EtatServicesG { cle: { presente: boolean; source: 'variable' | 'voix_humaine' | null; fin: string | null }; services: Record<ServiceG, EtatServiceG>; majLe: string | null; majPar: string | null }
const SERVICES_G: Array<{ id: ServiceG; nom: string; role: string }> = [
  { id: 'meteo', nom: 'Météo et pluie', role: 'Pluie attendue par commune : ORION Pro prévient les chauffeurs, la console voit la ville.' },
  { id: 'recalage', nom: 'Recalage GPS', role: 'À l’arrivée, le tracé de la course est collé aux routes : distance réelle, faux GPS repérés.' },
  { id: 'cartes', nom: 'Carte du trajet', role: 'Image du trajet dans l’historique du client et la fiche de course de la console.' },
  { id: 'streetview', nom: 'Point de prise en charge', role: 'Photo de la rue où attend le client (Street View), quand Google en a une.' },
];

/** Services Google du serveur : état, appels du jour, coupure ou remise en service. */
function ServicesGoogle({ canWrite }: { canWrite: boolean }) {
  const [etat, setEtat] = useState<EtatServicesG | null>(null);
  const [occupe, setOccupe] = useState(false);
  useEffect(() => { void adminGet<EtatServicesG>('/admin/services-google').then(setEtat).catch((e) => avis(message(e))); }, []);
  if (!etat) return <div className="adm-card"><p className="adm-muted">Chargement des services Google…</p></div>;
  const basculer = async (id: ServiceG, actif: boolean) => {
    setOccupe(true);
    try { setEtat(await adminPut<EtatServicesG>('/admin/services-google', { actifs: { [id]: actif } })); } catch (e) { avis(message(e)); } finally { setOccupe(false); }
  };
  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>Services Google du serveur</h3>
        <span className={`adm-pill ${etat.cle.presente ? 'hab-green' : 'hab-amber'}`}>{etat.cle.presente ? `Clé ••••${etat.cle.fin} · ${etat.cle.source === 'variable' ? 'variable du serveur' : 'celle de la voix humaine'}` : 'Aucune clé Google sur le serveur'}</span>
      </div>
      <p className="adm-muted">La clé Google reste sur le serveur : les applications reçoivent seulement les résultats (météo, images). Chaque service se coupe ici ; ses appels du jour sont comptés.</p>
      <div className="adm-gservices">
        {SERVICES_G.map((sv) => {
          const e = etat.services[sv.id];
          return (
            <div key={sv.id} className="adm-gservice">
              <div className="adm-gservice-h">
                <span>{sv.nom}</span>
                <span className={`adm-pill ${e.actif ? 'hab-green' : 'hab-amber'}`}>{e.actif ? 'En service' : e.coupe ? 'Coupé' : 'Sans clé'}</span>
              </div>
              <span className="adm-muted">{sv.role}</span>
              <span className="adm-muted">Aujourd’hui : {e.appelsDuJour} appel{e.appelsDuJour > 1 ? 's' : ''}{e.erreursDuJour ? ` · ${e.erreursDuJour} refus` : ''}</span>
              {e.derniereErreur && <span className="adm-vh-erreur" style={{ margin: 0 }}>Dernier refus : {e.derniereErreur}</span>}
              {canWrite && etat.cle.presente && (
                <button type="button" className="adm-btn" disabled={occupe} onClick={() => void basculer(sv.id, !e.actif)}>{e.actif ? 'Couper' : 'Remettre en service'}</button>
              )}
            </div>
          );
        })}
      </div>
      {etat.majLe && <p className="adm-muted" style={{ marginTop: 10 }}>Réglé le {date(etat.majLe)}{etat.majPar ? ` par ${etat.majPar}` : ''}</p>}
    </div>
  );
}

/* ------------------------------- Météo d'Abidjan ------------------------------- */

interface AlerteM { niveau: 'pluie' | 'forte_pluie' | 'orage'; heure: string; dansMinutes: number; description: string; probabilite: number }
interface MeteoM { type: string; description: string; temperature: number | null; ressenti: number | null; humidite: number | null; alerte: AlerteM | null; majLe: string }
const NIVEAU: Record<AlerteM['niveau'], string> = { pluie: 'Pluie', forte_pluie: 'Forte pluie', orage: 'Orage' };
const quand = (a: AlerteM) => (a.dansMinutes <= 10 ? 'en ce moment' : a.dansMinutes < 60 ? `dans ${a.dansMinutes} min` : `vers ${new Date(a.heure).getUTCHours()} h`);

/** Météo des communes (Google) : le temps qu'il fait et la pluie qui arrive, pour anticiper la demande. */
function MeteoAbidjan() {
  const [communes, setCommunes] = useState<Array<{ commune: string; meteo: MeteoM | null }> | null>(null);
  useEffect(() => {
    const charger = () => { void adminGet<{ communes: Array<{ commune: string; meteo: MeteoM | null }> }>('/admin/meteo').then((r) => setCommunes(r.communes)).catch(() => setCommunes([])); };
    charger();
    const id = window.setInterval(charger, 10 * 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (communes === null) return <div className="adm-card"><p className="adm-muted">Chargement de la météo…</p></div>;
  if (communes.length === 0) return null;
  const pluies = communes.filter((c) => c.meteo?.alerte && c.meteo.alerte.dansMinutes <= 180);
  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>Météo d’Abidjan</h3>
        <span className={`adm-pill ${pluies.length ? 'hab-amber' : 'hab-green'}`}>{pluies.length ? `Pluie attendue dans ${pluies.length} commune${pluies.length > 1 ? 's' : ''}` : 'Pas de pluie attendue (3 h)'}</span>
      </div>
      <p className="adm-muted">Prévision Google heure par heure, mise à jour toutes les 30 minutes. Quand il pleut, la demande monte : ORION Pro prévient les chauffeurs des communes concernées.</p>
      <div className="adm-table-wrap">
        <table className="adm-table sm">
          <thead><tr><th>Commune</th><th>Temps</th><th className="r">Température</th><th className="r">Humidité</th><th>Pluie attendue</th></tr></thead>
          <tbody>
            {communes.map((c) => (
              <tr key={c.commune}>
                <td><strong>{c.commune}</strong></td>
                <td>{c.meteo?.description || '—'}</td>
                <td className="r">{c.meteo?.temperature != null ? `${Math.round(c.meteo.temperature)} °C` : '—'}{c.meteo?.ressenti != null ? <span className="adm-muted"> · ressenti {Math.round(c.meteo.ressenti)}°</span> : null}</td>
                <td className="r">{c.meteo?.humidite != null ? `${c.meteo.humidite} %` : '—'}</td>
                <td>{c.meteo?.alerte ? <span className="adm-meteo-alerte">{NIVEAU[c.meteo.alerte.niveau]} {quand(c.meteo.alerte)} · {c.meteo.alerte.probabilite} %</span> : <span className="adm-muted">Non</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
