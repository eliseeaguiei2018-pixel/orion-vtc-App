import { useCallback, useEffect, useState } from 'react';
import { AdminError, LIVE, adminGet, adminPost } from '../api';

/**
 * HABILITATIONS AU TABLEAU DE BORD (console).
 *
 * Le tableau de bord est réservé de droit à la direction, à la trésorerie, à la
 * comptabilité et au service informatique. Un manager n'y accède que sur habilitation :
 *  - le service informatique inscrit le manager, ou transmet la demande qu'il a faite ;
 *  - la direction accorde ou refuse (jamais la personne qui a transmis) ;
 *  - l'habilitation se révoque à tout moment, et peut avoir une date de fin.
 */

interface Etape { at: string; par: string; action: string; detail?: string }
interface Habilitation {
  id: string; username: string; nom: string; roleLabel: string;
  statut: 'demandee' | 'transmise' | 'accordee' | 'refusee' | 'revoquee'; statutLabel: string; expiree: boolean;
  motif: string; expireLe?: string; demandeLe: string; demandePar: string;
  transmisePar?: string; decisionPar?: string; raison?: string; historique: Etape[];
}
interface Donnees {
  habilitations: Habilitation[];
  managers: Array<{ username: string; nom: string; roleLabel: string; service?: string }>;
  deDroit: string[];
}

const DEMO: Donnees = {
  deDroit: ['Super Admin (technique)', 'CEO — Président Directeur Général', 'Directeur Général', 'Dir. des Affaires Administratives', 'Directeur des Opérations', 'Directeur Financier (CFO)', 'Directeur Administratif et Financier (DAF)', 'Trésorier(ère)', 'Service informatique', 'Comptable'],
  managers: [{ username: 'serge.kouadio', nom: 'Serge Kouadio', roleLabel: 'Chef d’équipe', service: 'Opérations' }, { username: 'awa.bamba', nom: 'Awa Bamba', roleLabel: 'Gestionnaire de Flotte', service: 'Flotte' }],
  habilitations: [
    { id: 'h1', username: 'serge.kouadio', nom: 'Serge Kouadio', roleLabel: 'Chef d’équipe', statut: 'transmise', statutLabel: 'Transmise à la direction', expiree: false, motif: 'Suivre les commandes de son équipe aux heures de pointe', demandeLe: new Date(Date.now() - 86_400_000).toISOString(), demandePar: 'Serge Kouadio (Chef d’équipe)', transmisePar: 'Ibrahim Traoré (Service informatique)', historique: [] },
    { id: 'h2', username: 'awa.bamba', nom: 'Awa Bamba', roleLabel: 'Gestionnaire de Flotte', statut: 'accordee', statutLabel: 'Accordée', expiree: false, motif: 'Pilotage de la flotte électrique', expireLe: new Date(Date.now() + 20 * 86_400_000).toISOString(), demandeLe: new Date(Date.now() - 9 * 86_400_000).toISOString(), demandePar: 'Ibrahim Traoré (Service informatique)', transmisePar: 'Ibrahim Traoré (Service informatique)', decisionPar: 'Directeur Général (Directeur Général)', historique: [] },
  ],
};

const jour = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const TON: Record<Habilitation['statut'], string> = { demandee: 'amber', transmise: 'amber', accordee: 'green', refusee: 'red', revoquee: 'red' };

export function HabilitationsSection({ can }: { can: (p: string) => boolean }) {
  const [d, setD] = useState<Donnees | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [cible, setCible] = useState('');
  const [motif, setMotif] = useState('');
  const [fin, setFin] = useState('');
  const [saisie, setSaisie] = useState<{ id: string; action: 'refuser' | 'revoquer' | 'transmettre'; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const informatique = can('habilitations:write');
  const direction = can('habilitations:approve');

  const charger = useCallback(async () => {
    if (!LIVE) { setD(DEMO); return; }
    try { setD(await adminGet<Donnees>('/admin/habilitations')); } catch { setMessage({ ok: false, texte: 'Liste des habilitations illisible pour le moment.' }); }
  }, []);
  useEffect(() => { void charger(); }, [charger]);

  const agir = async (chemin: string, corps: unknown, succes: string) => {
    setEnvoi(true); setMessage(null);
    try {
      if (LIVE) await adminPost(chemin, corps);
      setMessage({ ok: true, texte: LIVE ? succes : `${succes} (démonstration)` });
      setSaisie(null);
      await charger();
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof AdminError ? e.message : 'Action impossible. Réessayez.' });
    }
    setEnvoi(false);
  };

  if (!d) return <p className="adm-muted">Chargement des habilitations…</p>;
  // Ce qui attend la personne connectée : transmettre (informatique) ou décider (direction).
  const enAttente = d.habilitations.filter((h) => (informatique && h.statut === 'demandee') || (direction && h.statut === 'transmise'));

  return (
    <>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>🔐 Accès au tableau de bord</h3>
          <a className="adm-btn ghost" style={{ textDecoration: 'none' }} href="./dashboard.html" target="_blank" rel="noopener">📺 Ouvrir le tableau de bord</a>
        </div>
        <p className="adm-muted" style={{ marginBottom: 10 }}>
          Accès de droit, sans démarche : {d.deDroit.join(', ')}. Un manager n’y accède que sur habilitation :
          le service informatique la prépare et la transmet, la direction l’accorde ou la refuse.
        </p>
        <div className="hab-etapes" aria-label="Circuit d’une habilitation">
          <span>1 · Demande du manager ou inscription par l’informatique</span>
          <span>2 · Transmission à la direction (informatique)</span>
          <span>3 · Décision d’un directeur, jamais celui qui a transmis</span>
        </div>
        {enAttente.length > 0 && <p style={{ marginTop: 10, color: 'var(--a-amber-txt)' }}>⏳ {enAttente.length} demande{enAttente.length > 1 ? 's' : ''} attend{enAttente.length > 1 ? 'ent' : ''} votre action.</p>}
      </div>

      {informatique && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Inscrire un manager</h3><span className="adm-muted">part directement à la direction</span></div>
          <div className="price-grid">
            <label className="price-field"><span>Manager</span>
              <select className="adm-select" value={cible} onChange={(e) => setCible(e.target.value)}>
                <option value="">Choisir…</option>
                {d.managers.map((m) => <option key={m.username} value={m.username}>{m.nom} · {m.roleLabel}{m.service ? ` · ${m.service}` : ''}</option>)}
              </select>
            </label>
            <label className="price-field"><span>Motif (pourquoi il en a besoin)</span>
              <input value={motif} maxLength={500} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. : intérim de la direction des opérations" />
            </label>
            <label className="price-field"><span>Fin de l’habilitation (facultatif)</span>
              <input type="date" value={fin} min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} onChange={(e) => setFin(e.target.value)} />
            </label>
          </div>
          <button className="adm-btn solid" style={{ marginTop: 12 }} disabled={envoi || !cible || motif.trim().length < 10}
            onClick={() => void agir('/admin/habilitations', { username: cible, motif: motif.trim(), ...(fin ? { expireLe: fin } : {}) }, 'Demande transmise à la direction.').then(() => { setCible(''); setMotif(''); setFin(''); })}>
            Transmettre à la direction
          </button>
        </div>
      )}

      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Demandes et habilitations</h3>
          {message && <span role="status" style={{ color: message.ok ? 'var(--a-green)' : 'var(--a-danger)' }}>{message.texte}</span>}
        </div>
        {d.habilitations.length === 0 ? <p className="adm-empty">Aucune demande pour le moment.</p> : (
          <table className="adm-table">
            <thead><tr><th>Manager</th><th>Motif</th><th>Statut</th><th>Fin</th><th>Circuit</th><th>Action</th></tr></thead>
            <tbody>
              {d.habilitations.map((h) => {
                const ouverte = h.statut === 'demandee' || h.statut === 'transmise' || (h.statut === 'accordee' && !h.expiree);
                const edition = saisie?.id === h.id ? saisie : null;
                return (
                  <tr key={h.id}>
                    <td><strong>{h.nom}</strong><div className="adm-muted">{h.roleLabel}</div></td>
                    <td style={{ maxWidth: 280 }}>{h.motif}{h.raison && <div className="adm-muted">Motif de décision : {h.raison}</div>}</td>
                    <td><span className={`adm-pill hab-${h.expiree ? 'red' : TON[h.statut]}`}>{h.expiree ? 'Échue' : h.statutLabel}</span></td>
                    <td>{h.expireLe ? jour(h.expireLe) : 'Sans fin'}</td>
                    <td className="adm-muted" style={{ fontSize: 12 }}>
                      Demandée le {jour(h.demandeLe)} par {h.demandePar}
                      {h.transmisePar && <><br />Transmise par {h.transmisePar}</>}
                      {h.decisionPar && <><br />Décidée par {h.decisionPar}</>}
                    </td>
                    <td>
                      {edition ? (
                        <div style={{ display: 'grid', gap: 6, minWidth: 220 }}>
                          {edition.action === 'transmettre'
                            ? <input className="adm-input" type="date" aria-label="Fin de l’habilitation (facultatif)" value={edition.texte} onChange={(e) => setSaisie({ ...edition, texte: e.target.value })} />
                            : <input className="adm-input" autoFocus placeholder={edition.action === 'refuser' ? 'Motif du refus' : 'Motif de la révocation'} value={edition.texte} onChange={(e) => setSaisie({ ...edition, texte: e.target.value })} />}
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="adm-btn solid" disabled={envoi || (edition.action !== 'transmettre' && edition.texte.trim().length < 5)}
                              onClick={() => void (edition.action === 'transmettre'
                                ? agir(`/admin/habilitations/${h.id}/transmettre`, edition.texte ? { expireLe: edition.texte } : {}, 'Demande transmise à la direction.')
                                : edition.action === 'refuser'
                                  ? agir(`/admin/habilitations/${h.id}/decision`, { accorder: false, raison: edition.texte.trim() }, 'Demande refusée.')
                                  : agir(`/admin/habilitations/${h.id}/revoquer`, { raison: edition.texte.trim() }, 'Habilitation révoquée.'))}>
                              Confirmer
                            </button>
                            <button className="adm-btn ghost" onClick={() => setSaisie(null)}>Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {informatique && h.statut === 'demandee' && <button className="adm-btn solid" disabled={envoi} onClick={() => setSaisie({ id: h.id, action: 'transmettre', texte: '' })}>Transmettre</button>}
                          {direction && h.statut === 'transmise' && <button className="adm-btn solid" disabled={envoi} onClick={() => void agir(`/admin/habilitations/${h.id}/decision`, { accorder: true }, 'Accès accordé.')}>Accorder</button>}
                          {direction && h.statut === 'transmise' && <button className="adm-btn ghost" disabled={envoi} onClick={() => setSaisie({ id: h.id, action: 'refuser', texte: '' })}>Refuser</button>}
                          {(informatique || direction) && ouverte && <button className="adm-btn ghost" disabled={envoi} onClick={() => setSaisie({ id: h.id, action: 'revoquer', texte: '' })}>Révoquer</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
