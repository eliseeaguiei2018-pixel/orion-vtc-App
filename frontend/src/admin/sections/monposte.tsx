import { Kpi } from '../ui';
import type { MonPoste } from '../types';

/**
 * SESSION « MON POSTE » — la journée de travail de l'employé connecté.
 *
 * La console est organisée par sujet : les courses d'un côté, les litiges de l'autre,
 * le support ailleurs. Logique pour la plateforme, inutilisable pour la personne —
 * il fallait ouvrir dix sessions pour découvrir ce qui vous attendait, et un dossier
 * pris en charge la veille se perdait dans une liste commune.
 *
 * Cette vue est organisée par PERSONNE : ce qui porte votre nom, ce que vous avez
 * demandé, ce que vous pouvez traiter, ce que vous avez fait aujourd'hui.
 */

const TYPE_META: Record<string, { icone: string; label: string }> = {
  sos: { icone: '🚨', label: 'Alerte SOS' },
  support: { icone: '💬', label: 'Conversation' },
  litige: { icone: '⚖️', label: 'Litige' },
  location: { icone: '💎', label: 'Location' },
  maintenance: { icone: '🔧', label: 'Maintenance' },
};

const SLOT_LABEL: Record<string, string> = { matin: 'Matin', soir: 'Soir', nuit: 'Nuit' };

const SEV_CLS: Record<string, string> = { critique: 'lvl-rouge', eleve: 'lvl-orange', moyen: 'lvl-jaune', info: '' };
/** Jamais de code brut à l'écran : « eleve » ne veut rien dire pour un employé. */
const SEV_LABEL: Record<string, string> = { critique: 'Critique', eleve: 'Élevé', moyen: 'Moyen', info: 'Information' };

const dt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Depuis combien de temps un dossier attend — un chiffre parle plus qu'une date. */
function depuis(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} j`;
}

export function MonPosteSection({ poste, onAller }: {
  poste: MonPoste | null;
  onAller: (section: string) => void;
}) {
  if (!poste) return <p className="adm-muted">Chargement de votre poste…</p>;

  const rienAFaire = poste.mesDossiers.length === 0 && poste.aTraiter.length === 0;

  return (
    <>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Bonjour {poste.identite.nom}</h3>
          <div className="row" style={{ gap: 10 }}>
            <span className="adm-pill">{poste.identite.roleLabel}</span>
            {poste.service
              ? <span className="adm-pill av-online">Service {SLOT_LABEL[poste.service.slot] ?? poste.service.slot}{poste.service.zoneId ? ` · ${poste.service.zoneId}` : ''}</span>
              : <span className="adm-muted" style={{ fontSize: 12 }}>Aucun service programmé aujourd’hui</span>}
          </div>
        </div>
        <div className="adm-kpis" style={{ margin: 0 }}>
          <Kpi label="Mes dossiers" value={String(poste.bilan.dossiers)} sub="pris en charge, en attente de votre geste" tone={poste.bilan.dossiers ? 'teal' : 'green'} />
          <Kpi label="À traiter" value={String(poste.bilan.aTraiter)} sub="constats relevant de vos droits" tone={poste.bilan.aTraiter ? 'blue' : 'green'} />
          <Kpi label="Mes demandes" value={String(poste.bilan.demandes)} sub="en attente de la décision d’un autre" tone="blue" />
          <Kpi label="Mes actions du jour" value={String(poste.bilan.actionsAujourdhui)} sub="enregistrées au journal" tone="green" />
        </div>
      </div>

      {rienAFaire && (
        <div className="adm-card">
          <p className="adm-empty">Rien ne vous attend pour le moment. ✅</p>
        </div>
      )}

      {poste.mesDossiers.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h">
            <h3>Mes dossiers</h3>
            <span className="adm-muted">ce que vous avez pris en charge</span>
          </div>
          <table className="adm-table">
            <thead><tr><th>Type</th><th>Dossier</th><th>En cours depuis</th><th>Reprendre</th></tr></thead>
            <tbody>
              {poste.mesDossiers.map((d) => (
                <tr key={`${d.type}-${d.id}`}>
                  <td>{TYPE_META[d.type]?.icone ?? '•'} {TYPE_META[d.type]?.label ?? d.type}</td>
                  <td><strong>{d.titre}</strong><br /><span className="adm-muted">{d.detail}</span></td>
                  <td className="adm-muted" style={{ whiteSpace: 'nowrap' }}>{depuis(d.depuis)}<br /><span style={{ fontSize: 11 }}>{dt(d.depuis)}</span></td>
                  <td><button className="adm-btn xs solid" onClick={() => onAller(d.section)}>Ouvrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {poste.aTraiter.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h">
            <h3>Ce que vous pouvez traiter</h3>
            <span className="adm-muted">constats dans votre périmètre</span>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {poste.aTraiter.map((c) => (
              <div key={c.id} className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
                <span className="row grow" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className={`adm-pill ${SEV_CLS[c.severite] ?? ''}`}>{SEV_LABEL[c.severite] ?? c.severite}</span>
                  <strong style={{ fontSize: 13.5 }}>{c.titre}</strong>
                  <span className="adm-muted" style={{ fontSize: 12.5 }}>— {c.action}</span>
                </span>
                <button className="adm-btn xs" style={{ flex: 'none' }} onClick={() => onAller(c.section)}>Traiter</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {poste.mesDemandes.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h">
            <h3>Mes demandes</h3>
            <span className="adm-muted">en attente de la décision d’un autre</span>
          </div>
          <table className="adm-table sm">
            <thead><tr><th>Type</th><th>Objet</th><th className="r">Montant</th><th>État</th><th>Depuis</th><th>Suivre</th></tr></thead>
            <tbody>
              {poste.mesDemandes.map((d) => (
                <tr key={`${d.type}-${d.id}`}>
                  <td>{d.type === 'virement' ? '🏦 Virement' : '🧾 Note de frais'}</td>
                  <td>{d.libelle}</td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>{d.montant.toLocaleString('fr-FR')} F</td>
                  <td><span className="adm-pill">{d.statut}</span></td>
                  <td className="adm-muted">{depuis(d.depuis)}</td>
                  <td><button className="adm-btn xs" onClick={() => onAller(d.section)}>Voir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Mon activité d’aujourd’hui</h3>
          <span className="adm-muted">{poste.monActivite.length} action(s) · tracées à votre nom</span>
        </div>
        {poste.monActivite.length === 0 ? (
          <p className="adm-muted">Aucune action enregistrée aujourd’hui.</p>
        ) : (
          <ul className="adm-conv-list">
            {poste.monActivite.map((a, i) => (
              <li key={i}>
                <span className="mono">{a.action}{a.target ? ` · ${a.target.slice(0, 12)}` : ''}</span>
                <span className="adm-muted">{heure(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>
          Toute action sensible est enregistrée au journal avec votre nom. Cette liste vous montre
          exactement ce que la direction voit de votre travail — rien de plus, rien de moins.
        </p>
      </div>
    </>
  );
}
