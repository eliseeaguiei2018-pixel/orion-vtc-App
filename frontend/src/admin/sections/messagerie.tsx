/**
 * MESSAGES CLIENTS : la console écrit aux clients dans l'app ORION.
 *
 * Trois usages : une information, une consigne à appliquer (« évitez le pont HKB,
 * accident »), et le contrôle de sécurité (« votre course se passe-t-elle bien ? »)
 * auquel le client répond d'un geste. « Je ne me sens pas en sécurité » lève aussitôt
 * une alerte dans la file SAMU : la réponse apparaît ici en rouge.
 */
import { useCallback, useEffect, useState } from 'react';
import { LIVE, adminGet, adminPost } from '../api';
import type { RideRow } from '../types';
import { Kpi } from '../ui';
import { ago } from './organisation';

type TypeMsg = 'info' | 'consigne' | 'controle';
type Cible = 'client' | 'en_course' | 'tous';

interface MessageConsole {
  id: string; clientId: string; type: TypeMsg; titre: string; texte: string; auteur: string; rideId?: string;
  reponses: { code: string; libelle: string; alerte?: boolean }[];
  reponse?: { code: string; libelle: string; le: string };
  envoyeLe: string; luLe?: string;
  client: { name: string | null; phone: string | null } | null;
}
interface Etat { messages: MessageConsole[]; stats: { envoyes: number; lus: number; reponses: number; alertes: number } }

const TYPE_LIBELLE: Record<TypeMsg, string> = { info: 'Information', consigne: 'Consigne', controle: 'Contrôle de sécurité' };

/** Modèles prêts à l'emploi : l'agent n'a qu'à choisir. */
const MODELES: Array<{ type: TypeMsg; titre: string; texte: string }> = [
  { type: 'controle', titre: 'Votre course se passe-t-elle bien ?', texte: 'La supervision ORION veille sur votre trajet. Tout va bien à bord ?' },
  { type: 'consigne', titre: 'Pont HKB fermé', texte: 'Accident sur le pont Houphouët-Boigny : votre chauffeur passe par le pont Henri Konan Bédié. Restez attaché, merci de votre patience.' },
  { type: 'consigne', titre: 'Fortes pluies sur Abidjan', texte: 'Fortes pluies annoncées ce soir. Prévoyez quelques minutes de plus et restez attaché pendant tout le trajet.' },
  { type: 'info', titre: 'Votre chauffeur arrive', texte: 'Votre chauffeur est à deux minutes. Il porte le badge ORION et sa plaque est affichée dans l’app.' },
];

const DEMO_ETAT: Etat = {
  messages: [
    { id: 'm1', clientId: 'c-demo-1', type: 'controle', titre: 'Votre course se passe-t-elle bien ?', texte: 'La supervision ORION veille sur votre trajet. Tout va bien à bord ?', auteur: 'ORION', rideId: 'r-1', reponses: [{ code: 'ok', libelle: 'Tout va bien, merci' }, { code: 'appel', libelle: 'Appelez-moi' }, { code: 'danger', libelle: 'Je ne me sens pas en sécurité', alerte: true }], reponse: { code: 'ok', libelle: 'Tout va bien, merci', le: new Date(Date.now() - 4 * 60e3).toISOString() }, envoyeLe: new Date(Date.now() - 6 * 60e3).toISOString(), luLe: new Date(Date.now() - 5 * 60e3).toISOString(), client: { name: 'Awa Koné', phone: '+225 07 48 21 33 90' } },
    { id: 'm2', clientId: 'c-demo-2', type: 'consigne', titre: 'Pont HKB fermé', texte: 'Accident sur le pont Houphouët-Boigny : votre chauffeur passe par le pont Henri Konan Bédié.', auteur: 'Aïcha Diallo', reponses: [{ code: 'lu', libelle: 'Bien reçu' }, { code: 'question', libelle: 'J’ai une question' }], envoyeLe: new Date(Date.now() - 18 * 60e3).toISOString(), luLe: new Date(Date.now() - 15 * 60e3).toISOString(), client: { name: 'Yao Kouassi', phone: '+225 05 66 10 72 18' } },
  ],
  stats: { envoyes: 2, lus: 2, reponses: 1, alertes: 0 },
};

const EN_COURSE = ['accepted', 'driver_en_route', 'arrived', 'in_progress'];

export function MessagesClientsSection({ canWrite, canControle, rides, onAlerte }: {
  canWrite: boolean;
  /** Le contrôle d'UNE course relève de la supervision (alerts:write). */
  canControle: boolean;
  rides: RideRow[];
  /** Une réponse « pas en sécurité » est arrivée : ouvrir la file SAMU. */
  onAlerte: () => void;
}) {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [cible, setCible] = useState<Cible>('en_course');
  const [client, setClient] = useState('');
  const [type, setType] = useState<TypeMsg>('controle');
  const [titre, setTitre] = useState(MODELES[0]!.titre);
  const [texte, setTexte] = useState(MODELES[0]!.texte);
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(async () => {
    if (!LIVE) { setEtat(DEMO_ETAT); return; }
    try { setEtat(await adminGet<Etat>('/admin/messages')); } catch { /* signalé par le puits d'erreurs */ }
  }, []);
  useEffect(() => {
    void charger();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void charger(); }, 5000);
    return () => window.clearInterval(id);
  }, [charger]);

  const modele = (i: number) => { const m = MODELES[i]!; setType(m.type); setTitre(m.titre); setTexte(m.texte); };

  const envoyer = async () => {
    if (titre.trim().length < 3 || texte.trim().length < 3) { setRetour({ ok: false, texte: 'Titre et message : 3 caractères au moins.' }); return; }
    if (cible === 'client' && !client.trim()) { setRetour({ ok: false, texte: 'Indiquez le numéro ou l’identifiant du client.' }); return; }
    setEnvoi(true); setRetour(null);
    try {
      const c = client.trim();
      const corps = {
        cible, type, titre: titre.trim(), texte: texte.trim(),
        ...(cible === 'client' ? (/^[+\d\s]+$/.test(c) ? { telephone: c } : { clientId: c }) : {}),
      };
      const r = LIVE ? await adminPost<{ envoyes: number }>('/admin/messages', corps) : { envoyes: cible === 'client' ? 1 : 3 };
      setRetour({ ok: r.envoyes > 0, texte: r.envoyes > 0 ? `Message envoyé à ${r.envoyes} client${r.envoyes > 1 ? 's' : ''}.` : type === 'controle' ? 'Aucun client en course : le contrôle de sécurité ne vise que les courses en cours.' : 'Aucun destinataire.' });
      void charger();
    } catch (e) {
      setRetour({ ok: false, texte: e instanceof Error ? e.message : 'Envoi impossible.' });
    } finally { setEnvoi(false); }
  };

  const controler = async (rideId: string) => {
    try {
      if (LIVE) await adminPost(`/admin/rides/${rideId}/controle`, {});
      setRetour({ ok: true, texte: `Contrôle de sécurité envoyé (course ${rideId.slice(0, 8)}).` });
      void charger();
    } catch (e) { setRetour({ ok: false, texte: e instanceof Error ? e.message : 'Envoi impossible.' }); }
  };

  const enCours = rides.filter((r) => EN_COURSE.includes(r.status));
  const s = etat?.stats;
  const alerte = (m: MessageConsole) => Boolean(m.reponse && m.reponses.find((r) => r.code === m.reponse!.code)?.alerte);

  return (
    <>
      <div className="adm-kpis">
        <Kpi label="Messages envoyés" value={String(s?.envoyes ?? '—')} sub="150 derniers messages" tone="teal" />
        <Kpi label="Lus" value={s ? `${s.lus}` : '—'} sub={s && s.envoyes ? `${Math.round((s.lus / s.envoyes) * 100)} % des messages` : 'aucun envoi'} tone="green" />
        <Kpi label="Réponses" value={String(s?.reponses ?? '—')} sub="réponses rapides des clients" tone="mint" />
        <Kpi label="« Pas en sécurité »" value={String(s?.alertes ?? '—')} sub="alertes SAMU levées par une réponse" tone={s?.alertes ? 'danger' : 'muted'} />
      </div>

      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>✉️ Écrire aux clients</h3><span className="adm-muted">Le message s’affiche dans l’app, bouton « Messages »</span></div>
          <div className="msg-modeles">
            {MODELES.map((m, i) => (
              <button key={m.titre} className={`msg-modele${titre === m.titre ? ' on' : ''}`} onClick={() => modele(i)}>
                {m.type === 'controle' ? '🛡️' : m.type === 'consigne' ? '⚠️' : 'ℹ️'} {m.titre}
              </button>
            ))}
          </div>
          <div className="price-grid">
            <label className="price-field"><span>Destinataires</span>
              <select className="adm-select" value={cible} onChange={(e) => setCible(e.target.value as Cible)}>
                <option value="en_course">Clients en course ({enCours.length})</option>
                <option value="client">Un client précis</option>
                <option value="tous">Tous les clients</option>
              </select>
            </label>
            <label className="price-field"><span>Type</span>
              <select className="adm-select" value={type} onChange={(e) => setType(e.target.value as TypeMsg)}>
                <option value="controle">🛡️ Contrôle de sécurité (réponses rapides)</option>
                <option value="consigne">⚠️ Consigne à appliquer</option>
                <option value="info">ℹ️ Information</option>
              </select>
            </label>
            {cible === 'client' && (
              <label className="price-field"><span>Téléphone ou identifiant du client</span>
                <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="07 48 21 33 90" />
              </label>
            )}
          </div>
          <label className="price-field" style={{ marginTop: 12 }}><span>Titre</span><input value={titre} maxLength={80} onChange={(e) => setTitre(e.target.value)} /></label>
          <label className="price-field" style={{ marginTop: 12 }}><span>Message</span><textarea className="adm-select" rows={3} maxLength={500} value={texte} onChange={(e) => setTexte(e.target.value)} /></label>
          <p className="adm-muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            {type === 'controle'
              ? 'Le client répond d’un geste : « Tout va bien », « Appelez-moi » ou « Je ne me sens pas en sécurité ». La dernière réponse lève une alerte SAMU.'
              : type === 'consigne' ? 'Le client confirme « Bien reçu » ou signale qu’il a une question.' : 'Simple information, sans réponse attendue.'}
          </p>
          <div className="row" style={{ gap: 10, marginTop: 12, alignItems: 'center' }}>
            <button className="adm-btn solid" disabled={envoi} onClick={() => void envoyer()}>{envoi ? 'Envoi…' : '✉️ Envoyer'}</button>
            {retour && <span className={retour.ok ? 'msg-retour ok' : 'msg-retour ko'} role="status">{retour.texte}</span>}
          </div>
        </div>
      )}

      {canControle && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>🛡️ Courses en cours</h3><span className="adm-muted">L’app envoie aussi un contrôle automatique pendant chaque course</span></div>
          {enCours.length === 0
            ? <p className="adm-muted">Aucune course en cours.</p>
            : (
              <table className="adm-table">
                <thead><tr><th>Course</th><th>Client</th><th>Chauffeur</th><th>Statut</th><th /></tr></thead>
                <tbody>
                  {enCours.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.id.slice(0, 8)}</td>
                      <td>{r.clientName ?? r.clientId.slice(0, 8)}</td>
                      <td>{r.driverName ?? '—'}</td>
                      <td>{r.status === 'in_progress' ? 'En course' : 'Approche'}</td>
                      <td><button className="adm-btn xs solid" onClick={() => void controler(r.id)}>Demander « tout va bien ? »</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}

      <div className="adm-card">
        <div className="adm-card-h"><h3>Messages et réponses</h3><span className="adm-muted">actualisé toutes les 5 s</span></div>
        {!etat || etat.messages.length === 0
          ? <p className="adm-muted">Aucun message envoyé pour l’instant.</p>
          : (
            <ul className="msg-fil">
              {etat.messages.map((m) => (
                <li key={m.id} className={alerte(m) ? 'alerte' : ''}>
                  <div className="row between">
                    <strong>{m.client?.name ?? m.clientId.slice(0, 8)}</strong>
                    <span className="adm-muted" style={{ fontSize: 12 }}>{TYPE_LIBELLE[m.type]} · {ago(m.envoyeLe)} · {m.auteur}</span>
                  </div>
                  <div className="msg-titre">{m.titre}</div>
                  <div className="msg-etat">
                    {m.reponse
                      ? <span className={alerte(m) ? 'msg-rep danger' : 'msg-rep'}>{alerte(m) ? '🚨' : '💬'} « {m.reponse.libelle} » · {ago(m.reponse.le)}</span>
                      : <span className="adm-muted">{m.luLe ? `Lu ${ago(m.luLe)}` : 'Pas encore lu'}{m.reponses.length ? ' · en attente de réponse' : ''}</span>}
                    {alerte(m) && <button className="adm-btn xs msg-btn-alerte" onClick={onAlerte}>Ouvrir la file SAMU</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </>
  );
}
