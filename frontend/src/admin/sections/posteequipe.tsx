import { useState } from 'react';
import { avis, demander } from '../dialogues';
import { AvatarChauffeur, ContactRapide, Kpi, availLabel } from '../ui';
import { actionLisible } from './monposte';
import type { ContactHandler, PosteEquipe } from '../types';

/**
 * POSTE DE TRAVAIL DU CHEF D'ÉQUIPE.
 *
 * La session Équipes montrait des équipes : un nom, un manager, des chauffeurs. On
 * pouvait la regarder, pas y travailler. Diriger une équipe, c'est savoir ce que
 * chacun a fait aujourd'hui, pouvoir l'appeler, lui écrire, lui demander un bilan —
 * et voir ce qui n'a pas été rendu.
 */

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
const dt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const jour = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
const SLOT: Record<string, string> = { matin: 'Matin', soir: 'Soir', nuit: 'Nuit' };
const STATUT_CLS: Record<string, string> = { demande: 'tr-pending', rendu: 'tr-pending', accepte: 'tr-approved', a_revoir: 'tr-rejected' };
const STATUT_LABEL: Record<string, string> = {
  demande: 'Attendu', rendu: 'Rendu, à lire', accepte: 'Accepté', a_revoir: 'À revoir',
};

export function PosteEquipeSection({ poste, equipes, equipeId, onChoisir, onContact, onEcrire, onDemanderRapport, onStatuerRapport, onOuvrirChauffeur }: {
  poste: PosteEquipe | null;
  equipes: Array<{ id: string; name: string }>;
  equipeId: string;
  onChoisir: (id: string) => void;
  onContact: ContactHandler;
  onEcrire: (teamId: string, a: string, sujet: string, texte: string, urgent: boolean) => void;
  onDemanderRapport: (teamId: string, destinataire: string, titre: string, consigne: string, echeance: string) => void;
  onStatuerRapport: (id: string, decision: 'accepte' | 'a_revoir', texte: string) => void;
  onOuvrirChauffeur: (driverId: string) => void;
}) {
  const [cible, setCible] = useState('');
  const [sujet, setSujet] = useState('');
  const [texte, setTexte] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [rTitre, setRTitre] = useState('');
  const [rConsigne, setRConsigne] = useState('');
  const [rEcheance, setREcheance] = useState('');

  if (equipes.length === 0) {
    return (
      <div className="adm-card">
        <p className="adm-empty">Aucune équipe ne vous est rattachée.</p>
      </div>
    );
  }

  return (
    <>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Équipe</h3>
          <select className="adm-select" value={equipeId} onChange={(e) => onChoisir(e.target.value)}>
            {equipes.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        {poste?.equipe.mission
          ? <p style={{ margin: 0, fontSize: 13.5 }}><strong>Mission :</strong> {poste.equipe.mission}</p>
          : <p className="adm-muted" style={{ margin: 0, fontSize: 12.5 }}>Aucune mission écrite. Sans mission, une équipe est une liste de noms et personne ne sait à qui adresser quoi.</p>}
      </div>

      {!poste ? <p className="adm-muted">Chargement du poste…</p> : (
        <>
          <div className="adm-kpis">
            <Kpi label="Courses de l’équipe" value={String(poste.bilan.courses)} sub={`sur ${poste.bilan.periodeJours} jours · note ${poste.bilan.noteMoyenne || '—'}`} tone="teal" />
            <Kpi label="Revenus chauffeurs" value={fcfa(poste.bilan.revenusChauffeurs)} sub={`${fcfa(poste.bilan.commissionOrion)} de commission ORION`} tone="green" />
            <Kpi label="En service" value={`${poste.bilan.chauffeursEnService} / ${poste.flotte.length}`} sub={`${poste.bilan.requetesOuvertes} requête(s) chauffeur ouverte(s)`} tone="blue" />
            <Kpi label="Rapports en retard" value={String(poste.bilan.rapportsEnRetard)} sub={`${poste.bilan.ticketsMaintenance} ticket(s) de maintenance`} tone={poste.bilan.rapportsEnRetard ? 'red' : 'green'} />
          </div>

          {/* Les membres : qui est là, ce qu'il a fait, et comment le joindre. */}
          <div className="adm-card">
            <div className="adm-card-h"><h3>Mes membres</h3><span className="adm-muted">{poste.membres.length} personne(s)</span></div>
            {poste.membres.length === 0 ? (
              <p className="adm-empty">Aucun membre rattaché. Créez-leur un accès depuis Rôles &amp; accès.</p>
            ) : (
              <table className="adm-table">
                <thead>
                  <tr><th>Membre</th><th>Rôle</th><th>Service du jour</th><th className="r">Actions aujourd’hui</th><th>Rapports</th><th>Messages</th><th>Dernière connexion</th></tr>
                </thead>
                <tbody>
                  {poste.membres.map((m) => (
                    <tr key={m.username}>
                      <td>
                        <strong>{m.name}</strong>
                        {!m.active && <> <span className="adm-pill tr-rejected">Désactivé</span></>}
                        {m.mustChangePassword && <> <span className="adm-pill lvl-jaune">Mot de passe provisoire</span></>}
                        <br />
                        <ContactRapide type="support" id={m.username} numero={m.phone ?? null} nom={m.name} onContact={onContact} />
                      </td>
                      <td className="adm-muted">{m.roleLabel}</td>
                      <td>{m.service_du_jour ? <span className="adm-pill av-online">{SLOT[m.service_du_jour.slot] ?? m.service_du_jour.slot}{m.service_du_jour.zoneId ? ` · ${m.service_du_jour.zoneId}` : ''}</span> : <span className="adm-muted">—</span>}</td>
                      <td className="r">
                        {m.actionsAujourdhui}
                        {m.derniereAction && <><br /><span className="adm-muted" style={{ fontSize: 11 }}>{actionLisible(m.derniereAction.action)}</span></>}
                      </td>
                      <td>
                        {m.rapportsEnRetard > 0
                          ? <span className="adm-pill tr-rejected">{m.rapportsEnRetard} en retard</span>
                          : m.rapportsAttendus > 0
                            ? <span className="adm-pill tr-pending">{m.rapportsAttendus} attendu(s)</span>
                            : <span className="adm-muted">à jour</span>}
                      </td>
                      <td>{m.messagesNonLus > 0 ? <span className="adm-pill tr-pending">{m.messagesNonLus} non lu(s)</span> : <span className="adm-muted">—</span>}</td>
                      <td className="adm-muted">{m.lastLoginAt ? dt(m.lastLoginAt) : 'jamais'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Écrire et demander, côte à côte : c'est le geste quotidien du chef. */}
          <div className="adm-card">
            <div className="adm-card-h"><h3>Écrire · Demander un rapport</h3><span className="adm-muted">dans la console, pas sur un téléphone personnel</span></div>
            <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 300 }}>
                <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>MESSAGE</p>
                <div className="stack" style={{ gap: 8 }}>
                  <label className="field">
                    <span>Destinataire</span>
                    <select className="adm-select" value={cible} onChange={(e) => setCible(e.target.value)}>
                      <option value="">Choisir…</option>
                      {poste.membres.length > 0 && <optgroup label="Membres de l’équipe">{poste.membres.map((m) => <option key={m.username} value={m.username}>{m.name}</option>)}</optgroup>}
                      {poste.flotte.some((f) => f.identifiant) && <optgroup label="Chauffeurs de la flotte">{poste.flotte.filter((f) => f.identifiant).map((f) => <option key={f.identifiant!} value={f.identifiant!}>{f.name} · {f.matricule}</option>)}</optgroup>}
                    </select>
                  </label>
                  <label className="field"><span>Sujet</span><input className="adm-input" value={sujet} onChange={(e) => setSujet(e.target.value)} /></label>
                  <label className="field"><span>Message</span><textarea className="adm-input" rows={3} value={texte} onChange={(e) => setTexte(e.target.value)} /></label>
                  <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                    <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
                    <span>Urgent — à traiter avant le reste de la journée</span>
                  </label>
                  <button
                    className="adm-btn solid"
                    onClick={() => {
                      if (!cible || texte.trim().length < 2) { avis('Choisissez un destinataire et écrivez le message.'); return; }
                      onEcrire(poste.equipe.id, cible, sujet, texte.trim(), urgent);
                      setSujet(''); setTexte(''); setUrgent(false);
                    }}
                  >
                    Envoyer
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 300 }}>
                <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>DEMANDE DE RAPPORT</p>
                <div className="stack" style={{ gap: 8 }}>
                  <label className="field">
                    <span>À qui</span>
                    <select className="adm-select" value={cible} onChange={(e) => setCible(e.target.value)}>
                      <option value="">Choisir…</option>
                      {poste.membres.length > 0 && <optgroup label="Membres de l’équipe">{poste.membres.map((m) => <option key={m.username} value={m.username}>{m.name}</option>)}</optgroup>}
                      {poste.flotte.some((f) => f.identifiant) && <optgroup label="Chauffeurs de la flotte">{poste.flotte.filter((f) => f.identifiant).map((f) => <option key={f.identifiant!} value={f.identifiant!}>{f.name} · {f.matricule}</option>)}</optgroup>}
                    </select>
                  </label>
                  <label className="field"><span>Titre</span><input className="adm-input" value={rTitre} onChange={(e) => setRTitre(e.target.value)} placeholder="Bilan hebdomadaire flotte Nord" /></label>
                  <label className="field">
                    <span>Consigne</span>
                    <textarea className="adm-input" rows={2} value={rConsigne} onChange={(e) => setRConsigne(e.target.value)} placeholder="État des véhicules, incidents, kilométrage." />
                  </label>
                  <label className="field" style={{ maxWidth: 190 }}><span>Échéance</span><input className="adm-input" type="date" value={rEcheance} onChange={(e) => setREcheance(e.target.value)} /></label>
                  <button
                    className="adm-btn solid"
                    onClick={() => {
                      if (!cible || rTitre.trim().length < 3 || rConsigne.trim().length < 3 || !rEcheance) {
                        avis('Destinataire, titre, consigne et échéance sont nécessaires — sans consigne, on reçoit n’importe quoi.');
                        return;
                      }
                      onDemanderRapport(poste.equipe.id, cible, rTitre.trim(), rConsigne.trim(), rEcheance);
                      setRTitre(''); setRConsigne(''); setREcheance('');
                    }}
                  >
                    Demander
                  </button>
                </div>
              </div>
            </div>
          </div>

          {poste.rapports.length > 0 && (
            <div className="adm-card">
              <div className="adm-card-h"><h3>Rapports de l’équipe</h3><span className="adm-muted">{poste.rapports.length} au total</span></div>
              <div className="stack" style={{ gap: 10 }}>
                {poste.rapports.map((r) => {
                  const retard = r.statut === 'demande' && Date.parse(r.echeance) < Date.now();
                  return (
                    <div key={r.id} className="adm-role-card">
                      <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
                        <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <strong>{r.titre}</strong>
                          <span className={`adm-pill ${retard ? 'tr-rejected' : STATUT_CLS[r.statut] ?? ''}`}>{retard ? 'En retard' : STATUT_LABEL[r.statut] ?? r.statut}</span>
                          <span className="adm-muted" style={{ fontSize: 12 }}>{r.destinataireNom} · échéance {jour(r.echeance)}</span>
                        </span>
                      </div>
                      <p className="adm-muted" style={{ margin: '4px 0', fontSize: 12.5 }}>{r.consigne}</p>
                      {r.rendu && (
                        <div style={{ borderLeft: '2px solid var(--adm-line)', paddingLeft: 10, margin: '8px 0' }}>
                          <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-line' }}>{r.rendu.texte}</p>
                          <span className="adm-muted" style={{ fontSize: 11.5 }}>rendu le {dt(r.rendu.at)}</span>
                        </div>
                      )}
                      {r.retour?.texte && <p className="adm-muted" style={{ margin: '4px 0', fontSize: 12 }}>Retour : {r.retour.texte}</p>}
                      {r.statut === 'rendu' && (
                        <div className="row" style={{ gap: 6, marginTop: 6 }}>
                          <button className="adm-btn xs solid" onClick={() => onStatuerRapport(r.id, 'accepte', '')}>Accepter</button>
                          <button className="adm-btn xs" onClick={async () => onStatuerRapport(r.id, 'a_revoir', await demander('Que faut-il reprendre ?') ?? '')}>À revoir</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="adm-card">
            <div className="adm-card-h">
              <h3>Ma flotte</h3>
              <span className="adm-muted">{poste.flotte.length} chauffeur(s) accrédité(s)</span>
            </div>
            {poste.flotte.length === 0 ? (
              <p className="adm-empty">Aucun chauffeur rattaché à cette équipe.</p>
            ) : (
              <table className="adm-table">
                <thead><tr><th>Matricule</th><th>Chauffeur</th><th>État</th><th className="r">Courses</th><th className="r">Revenus</th><th className="r" title="Courses annulées par le chauffeur">Annul.</th><th>À traiter</th><th>Dossier</th></tr></thead>
                <tbody>
                  {poste.flotte.map((f) => (
                    <tr key={f.driverId}>
                      <td className="mono"><strong>{f.matricule}</strong></td>
                      <td><span className="row" style={{ gap: 8, alignItems: 'center' }}><AvatarChauffeur photoUrl={f.photoUrl} name={f.name} />{f.name}</span><ContactRapide type="chauffeur" id={f.driverId} numero={f.phone} nom={f.name} onContact={onContact} /></td>
                      <td><span className={`adm-status ${f.availability}`}>{availLabel(f.availability)}</span></td>
                      <td className="r">{f.coursesPeriode}</td>
                      <td className="r">{fcfa(f.revenusPeriode)}</td>
                      <td className="r">{f.annulations ?? 0}</td>
                      <td>
                        {f.alertes > 0 && <span className="adm-pill lvl-orange">{f.alertes} alerte(s)</span>}
                        {f.requetesOuvertes > 0 && <> <span className="adm-pill tr-pending">{f.requetesOuvertes} requête(s)</span></>}
                        {f.alertes === 0 && f.requetesOuvertes === 0 && <span className="adm-muted">—</span>}
                      </td>
                      <td><button className="adm-btn xs" onClick={() => onOuvrirChauffeur(f.driverId)}>Ouvrir</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
