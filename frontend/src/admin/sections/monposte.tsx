import { useState } from 'react';
import { Kpi } from '../ui';
import type { MonPoste } from '../types';
import { lienTel } from '../../telephone';

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

/**
 * Le journal stocke des codes techniques (`caisse.decaisser`). Les afficher tels
 * quels à un employé revient à lui demander de lire le code source de son propre
 * travail. On les traduit, et on garde le code en dernier recours pour ne jamais
 * afficher une ligne vide.
 */
export const ACTION_LABEL: Record<string, string> = {
  'login.success': 'Connexion', 'login.failed': 'Échec de connexion',
  'account.password_changed': 'Changement de mot de passe',
  'account.create': 'Création d’un compte', 'account.reset': 'Réinitialisation d’un mot de passe',
  'account.disable': 'Désactivation d’un compte', 'account.enable': 'Réactivation d’un compte',
  'caisse.ouvrir': 'Ouverture de caisse', 'caisse.encaisser': 'Encaissement en caisse',
  'caisse.decaisser': 'Sortie de caisse', 'caisse.arreter': 'Arrêté de caisse',
  'caisse.valider': 'Validation d’un arrêté',
  'crew.request': 'Dépôt d’une requête chauffeur', 'crew.instruire': 'Avis sur une requête',
  'crew.accord': 'Requête accordée', 'crew.refus': 'Requête refusée',
  'crew.verser': 'Versement à un chauffeur', 'crew.rembourser': 'Remboursement enregistré',
  'sos.claim': 'Prise en charge d’une alerte SOS', 'sos.close': 'Clôture d’une alerte SOS',
  'support.reply': 'Réponse au support', 'rental.tarifs': 'Modification des tarifs de location',
  'rental.position': 'Consultation de position véhicule', 'rental.vol': 'Déclaration de vol',
  'rental.immobiliser.armer': 'Coupure moteur armée', 'rental.immobiliser.confirmer': 'Coupure moteur confirmée',
  'rental.immobiliser.lever': 'Coupure moteur levée', 'rental.signalement': 'Fiche de signalement éditée',
  'team.message': 'Message à un membre d’équipe', 'team.rapport.demande': 'Demande de rapport',
  'rapport.rendre': 'Rapport rendu', 'rapport.accepte': 'Rapport accepté', 'rapport.a_revoir': 'Rapport renvoyé',
  'message.repondre': 'Réponse à un message',
  'expense.approve': 'Note de frais approuvée', 'expense.reject': 'Note de frais refusée',
  'driver.kyc': 'Validation de dossier chauffeur', 'driver.warn': 'Avertissement chauffeur',
  'team.upsert': 'Équipe créée ou modifiée', 'team.fleet': 'Flotte d’équipe modifiée',
};
export const actionLisible = (a: string) => ACTION_LABEL[a] ?? a.replace(/[._]/g, ' ');

const SEV_CLS: Record<string, string> = { critique: 'lvl-rouge', eleve: 'lvl-orange', moyen: 'lvl-jaune', info: '' };
/** Jamais de code brut à l'écran : « eleve » ne veut rien dire pour un employé. */
const SEV_LABEL: Record<string, string> = { critique: 'Critique', eleve: 'Élevé', moyen: 'Moyen', info: 'Information' };

const dt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Depuis combien de temps un dossier attend — un chiffre parle plus qu'une date. */
function depuis(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} j`;
}

export function MonPosteSection({ poste, onAller, onLireMessage, onRepondre, onRendreRapport, onOuvrirChauffeur, onChangerMotDePasse, onDeposerRequete }: {
  poste: MonPoste | null;
  onAller: (section: string) => void;
  onLireMessage: (id: string) => void;
  onRepondre: (id: string, texte: string) => void;
  onRendreRapport: (id: string, texte: string) => void;
  onOuvrirChauffeur: (driverId: string) => void;
  onChangerMotDePasse: () => void;
  onDeposerRequete: (driverId: string, r: NouvelleRequete) => Promise<boolean>;
}) {
  if (!poste) return <p className="adm-muted">Chargement de votre poste…</p>;
  // Le chauffeur a SON poste : son travail, son argent, ses demandes. Rien d'autre.
  if (poste.identite.role === 'chauffeur' && poste.monDossier) {
    return <PosteChauffeur poste={poste} dossier={poste.monDossier} onChangerMotDePasse={onChangerMotDePasse} onDeposer={onDeposerRequete} />;
  }

  const rienAFaire = poste.mesDossiers.length === 0 && poste.aTraiter.length === 0
    && poste.messages.length === 0 && poste.rapports.length === 0
    && !poste.caisse && poste.equipes.length === 0 && !poste.monDossier;

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
          <Kpi label="Messages" value={String(poste.bilan.messagesNonLus)} sub={`${poste.messages.length} reçu(s) · non lus`} tone={poste.bilan.messagesNonLus ? 'blue' : 'green'} />
          <Kpi label="Rapports à rendre" value={String(poste.bilan.rapportsARendre)} sub={poste.rapports.some((r) => r.enRetard) ? 'dont au moins un en retard' : 'dans les délais'} tone={poste.rapports.some((r) => r.enRetard) ? 'red' : poste.bilan.rapportsARendre ? 'blue' : 'green'} />
          <Kpi label="Mes actions du jour" value={String(poste.bilan.actionsAujourdhui)} sub="enregistrées au journal" tone="green" />
        </div>
        {poste.identite.mustChangePassword && (
          <p className="adm-muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            Votre mot de passe est encore celui qu’on vous a communiqué — donc partagé.{' '}
            <button className="adm-btn xs solid" onClick={onChangerMotDePasse}>Le changer maintenant</button>
          </p>
        )}
      </div>

      {/* SA CAISSE : le poste de travail d'une trésorière commence ici. */}
      {poste.caisse && (
        <div className="adm-card">
          <div className="adm-card-h">
            <h3>Ma caisse</h3>
            <span className="adm-muted">{poste.caisse.emplacement ?? 'emplacement non précisé'} · ouverte le {dt(poste.caisse.ouverteLe)}</span>
          </div>
          <div className="row between" style={{ gap: 14, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
              <span><span className="adm-muted" style={{ fontSize: 12 }}>Fond</span><br /><strong>{fcfa(poste.caisse.fondDeCaisse)}</strong></span>
              <span><span className="adm-muted" style={{ fontSize: 12 }}>Encaissé</span><br /><strong className="pos">{fcfa(poste.caisse.entrees)}</strong></span>
              <span><span className="adm-muted" style={{ fontSize: 12 }}>Sorti</span><br /><strong className="neg">{fcfa(poste.caisse.sorties)}</strong></span>
              <span><span className="adm-muted" style={{ fontSize: 12 }}>Devrait être en caisse</span><br /><strong style={{ fontSize: 18 }}>{fcfa(poste.caisse.soldeTheorique)}</strong></span>
            </div>
            <button className="adm-btn solid" onClick={() => onAller('caisses')}>Ouvrir ma caisse</button>
          </div>
        </div>
      )}

      {/* SON DOSSIER : pour un chauffeur, c'est sa seule vue de la plateforme. */}
      {poste.monDossier && (
        <div className="adm-card">
          <div className="adm-card-h">
            <h3>Mon dossier</h3>
            <span className="adm-muted mono">{poste.monDossier.matricule}</span>
          </div>
          <div className="adm-kpis" style={{ margin: 0 }}>
            <Kpi label="Mes courses" value={String(poste.monDossier.courses)} sub="sur 30 jours" tone="teal" />
            <Kpi label="Mes revenus" value={fcfa(poste.monDossier.revenus)} sub="ma part, hors commission" tone="green" />
            <Kpi label="Mon solde" value={fcfa(poste.monDossier.solde)} sub="disponible au retrait" tone={poste.monDossier.solde < 0 ? 'red' : 'green'} />
            <Kpi label="Reste à rembourser" value={fcfa(poste.monDossier.resteDu)} sub="prêts et avances en cours" tone={poste.monDossier.resteDu > 0 ? 'blue' : 'green'} />
          </div>
          {poste.monDossier.alertes.length > 0 && (
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              {poste.monDossier.alertes.map((a, i) => (
                <div key={i} className="row" style={{ gap: 8 }}>
                  <span className={`adm-pill ${SEV_CLS[a.severite] ?? ''}`}>{SEV_LABEL[a.severite] ?? a.severite}</span>
                  <span style={{ fontSize: 13 }}>{a.texte}</span>
                </div>
              ))}
            </div>
          )}
          {poste.monDossier.requetes.length > 0 && (
            <table className="adm-table sm" style={{ marginTop: 10 }}>
              <thead><tr><th>Ma demande</th><th className="r">Montant</th><th>Où elle en est</th><th>Déposée le</th></tr></thead>
              <tbody>
                {poste.monDossier.requetes.map((r) => (
                  <tr key={r.id}>
                    <td>{r.type}</td>
                    <td className="r">{r.montant ? fcfa(r.montant) : '—'}</td>
                    <td><span className="adm-pill">{r.statut}</span></td>
                    <td className="adm-muted">{dt(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="adm-btn xs solid" style={{ marginTop: 10 }} onClick={() => onOuvrirChauffeur(poste.identite.driverId!)}>
            Ouvrir mon dossier complet
          </button>
        </div>
      )}

      {/* MESSAGES : un message qu'on ne voit pas n'est jamais lu. */}
      {poste.messages.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h">
            <h3>Mes messages</h3>
            <span className="adm-muted">{poste.bilan.messagesNonLus} non lu(s)</span>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {poste.messages.map((m) => (
              <div key={m.id} className={`adm-role-card ${m.lu ? '' : 'on'}`}>
                <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {m.urgent && <span className="adm-pill lvl-rouge">Urgent</span>}
                    {!m.lu && <span className="adm-pill lvl-jaune">Non lu</span>}
                    <strong>{m.sujet || 'Sans objet'}</strong>
                    <span className="adm-muted" style={{ fontSize: 12 }}>de {m.deNom}</span>
                  </span>
                  <span className="adm-muted" style={{ fontSize: 12 }}>{dt(m.at)}</span>
                </div>
                <p style={{ margin: '6px 0', fontSize: 13, whiteSpace: 'pre-line' }}>{m.texte}</p>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {!m.lu && <button className="adm-btn xs" onClick={() => onLireMessage(m.id)}>Marquer lu</button>}
                  {m.reponseAttendue && (
                    <button
                      className="adm-btn xs solid"
                      onClick={() => {
                        const t = prompt('Votre réponse :');
                        if (t) onRepondre(m.id, t);
                      }}
                    >
                      Répondre
                    </button>
                  )}
                  {m.reponses > 0 && <span className="adm-muted" style={{ fontSize: 12 }}>{m.reponses} réponse(s)</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RAPPORTS : un livrable daté, dont l'absence se voit. */}
      {poste.rapports.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h">
            <h3>Rapports à rendre</h3>
            <span className="adm-muted">{poste.rapports.filter((r) => r.enRetard).length} en retard</span>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {poste.rapports.map((r) => (
              <div key={r.id} className="adm-role-card">
                <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className={`adm-pill ${r.enRetard ? 'lvl-rouge' : r.statut === 'a_revoir' ? 'lvl-orange' : ''}`}>
                      {r.enRetard ? 'En retard' : r.statutLabel}
                    </span>
                    <strong>{r.titre}</strong>
                    <span className="adm-muted" style={{ fontSize: 12 }}>demandé par {r.demandeParNom} · échéance {new Date(r.echeance).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
                  </span>
                </div>
                <p className="adm-muted" style={{ margin: '4px 0', fontSize: 12.5 }}>{r.consigne}</p>
                {r.retour?.texte && <p style={{ margin: '4px 0', fontSize: 12.5 }}><strong>À revoir :</strong> {r.retour.texte}</p>}
                {r.rendu && <p className="adm-muted" style={{ margin: '4px 0', fontSize: 12 }}>Rendu le {dt(r.rendu.at)}</p>}
                {(r.statut === 'demande' || r.statut === 'a_revoir') && (
                  <button
                    className="adm-btn xs solid"
                    onClick={() => {
                      const t = prompt(`${r.titre}\n\n${r.consigne}\n\nVotre rapport :`, r.rendu?.texte ?? '');
                      if (t && t.trim().length >= 3) onRendreRapport(r.id, t.trim());
                    }}
                  >
                    {r.statut === 'a_revoir' ? 'Corriger et rendre' : 'Rendre le rapport'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SES ÉQUIPES : pour un chef, le raccourci vers son poste de direction. */}
      {poste.equipes.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Mes équipes</h3><span className="adm-muted">{poste.equipes.length} équipe(s) dirigée(s)</span></div>
          <table className="adm-table sm">
            <thead><tr><th>Équipe</th><th>Mission</th><th className="r">Membres</th><th className="r">Flotte</th><th>À traiter</th><th>Ouvrir</th></tr></thead>
            <tbody>
              {poste.equipes.map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.name}</strong></td>
                  <td className="adm-muted">{e.mission ?? '—'}</td>
                  <td className="r">{e.membres}</td>
                  <td className="r">{e.flotte}</td>
                  <td>
                    {e.rapportsEnRetard > 0 && <span className="adm-pill lvl-rouge">{e.rapportsEnRetard} rapport(s) en retard</span>}
                    {e.requetesOuvertes > 0 && <> <span className="adm-pill tr-pending">{e.requetesOuvertes} requête(s)</span></>}
                    {e.alertesFlotte > 0 && <> <span className="adm-pill lvl-orange">{e.alertesFlotte} alerte(s)</span></>}
                    {e.rapportsEnRetard + e.requetesOuvertes + e.alertesFlotte === 0 && <span className="adm-muted">rien</span>}
                  </td>
                  <td><button className="adm-btn xs solid" onClick={() => onAller('posteEquipe')}>Mon équipe</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SA FLOTTE : triée par ce qui demande une attention. */}
      {poste.flotte.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h">
            <h3>Ma flotte accréditée</h3>
            <span className="adm-muted">{poste.flotte.length} chauffeur(s) — les plus urgents en tête</span>
          </div>
          <table className="adm-table sm">
            <thead><tr><th>Matricule</th><th>Chauffeur</th><th>État</th><th>À traiter</th><th>Joindre</th><th>Dossier</th></tr></thead>
            <tbody>
              {poste.flotte.map((f) => (
                <tr key={f.driverId}>
                  <td className="mono"><strong>{f.matricule}</strong></td>
                  <td>{f.name}</td>
                  <td className="adm-muted">{f.availability === 'online' ? 'En ligne' : f.availability === 'on_trip' ? 'En course' : 'Hors-ligne'}</td>
                  <td>
                    {f.alertes > 0 && <span className="adm-pill lvl-orange">{f.alertes} alerte(s)</span>}
                    {f.requetesOuvertes > 0 && <> <span className="adm-pill tr-pending">{f.requetesOuvertes} requête(s)</span></>}
                    {f.alertes === 0 && f.requetesOuvertes === 0 && <span className="adm-muted">—</span>}
                  </td>
                  <td>{f.phone ? <a className="adm-btn xs solid" href={lienTel(f.phone) ?? undefined}>📞 Appeler</a> : <span className="adm-muted">n° inconnu</span>}</td>
                  <td><button className="adm-btn xs" onClick={() => onOuvrirChauffeur(f.driverId)}>Ouvrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                <span>{actionLisible(a.action)}</span>
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

/* =========================== POSTE DU CHAUFFEUR =========================== */

export interface NouvelleRequete {
  type: string; montant?: number; echeances?: number; du?: string; au?: string; motif: string;
}

const PAIEMENT: Record<string, string> = {
  cash: 'Espèces', orange_money: 'Orange Money', wave: 'Wave', mtn_momo: 'MTN MoMo', moov_money: 'Moov Money', card: 'Carte',
};
const STATUT_COURSE: Record<string, string> = {
  searching: 'Recherche', accepted: 'Acceptée', driver_en_route: 'En approche', arrived: 'Sur place', in_progress: 'En course',
  completed: 'Terminée · à encaisser', paid: 'Payée', rated: 'Payée et notée', cancelled: 'Annulée', no_driver: 'Sans chauffeur',
};
const DISPO: Record<string, string> = { online: 'En ligne', on_trip: 'En course', offline: 'Hors ligne', paused: 'En pause' };
const GAMME = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
/** Libellés des écritures du portefeuille chauffeur (types du grand livre). */
const ECRITURE: Record<string, string> = {
  ride_earning: 'Gain de course', commission: 'Commission ORION', cash_collected: 'Espèces encaissées',
  payout: 'Retrait', adjustment: 'Ajustement', insurance_refund: 'Remboursement assurance',
};

/**
 * Le poste de travail d'un chauffeur dans la console. Avant, il restait bloqué
 * sur « Chargement de la console… » : l'écran attendait des chiffres d'entreprise
 * qu'un chauffeur n'a pas le droit de lire. Ici, tout ce qui le concerne, et la
 * possibilité de faire ses demandes lui-même — elles arrivent chez son chef
 * d'équipe, puis au DAF, puis à la trésorerie.
 */
function PosteChauffeur({ poste, dossier: d, onChangerMotDePasse, onDeposer }: {
  poste: MonPoste;
  dossier: NonNullable<MonPoste['monDossier']>;
  onChangerMotDePasse: () => void;
  onDeposer: (driverId: string, r: NouvelleRequete) => Promise<boolean>;
}) {
  const prenom = d.profil.name.split(' ')[0];
  const detteRatio = d.argent.plafondDette > 0 ? d.argent.detteEspeces / d.argent.plafondDette : 0;
  return (
    <>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Bonjour {prenom}</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className={`adm-pill av-${d.profil.availability}`}>{DISPO[d.profil.availability] ?? d.profil.availability}</span>
            <span className="adm-pill">Gamme {GAMME(d.profil.category)}</span>
            <span className="adm-pill mono">{d.matricule}</span>
          </div>
        </div>
        <p className="adm-muted" style={{ margin: '0 0 12px' }}>
          ★ {d.profil.rating.toFixed(1)} · {d.profil.trips.toLocaleString('fr-FR')} courses au total
          {d.equipe ? <> · équipe <strong>{d.equipe.name}</strong></> : ' · sans équipe'}
        </p>
        <div className="adm-kpis" style={{ margin: 0 }}>
          <Kpi label="Mes courses" value={String(d.courses)} sub={`sur ${d.activite.periodeJours} jours · ${d.activite.joursTravailles} jour(s) travaillé(s)`} tone="teal" />
          <Kpi label="Mes revenus" value={fcfa(d.revenus)} sub={`ma part · ${fcfa(d.activite.commissionVersee)} de commission`} tone="green" />
          <Kpi label="Ma note" value={d.activite.nbNotes ? `${d.activite.noteMoyenne.toFixed(1)} ★` : '—'} sub={`${d.activite.nbNotes} note(s) sur la période`} tone="blue" />
          <Kpi label="Mon solde" value={fcfa(d.solde)} sub="disponible au retrait" tone={d.solde < 0 ? 'danger' : 'green'} />
          <Kpi label="Espèces à reverser" value={fcfa(d.argent.detteEspeces)} sub={`plafond ${fcfa(d.argent.plafondDette)}${detteRatio >= 0.8 ? ' · bientôt bloqué' : ''}`} tone={detteRatio >= 1 ? 'danger' : detteRatio >= 0.8 ? 'blue' : 'green'} />
          <Kpi label="Reste à rembourser" value={fcfa(d.resteDu)} sub="prêts et avances en cours" tone={d.resteDu > 0 ? 'blue' : 'green'} />
        </div>
        {poste.identite.mustChangePassword && (
          <p className="adm-muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            Votre mot de passe est encore celui qu’on vous a remis.{' '}
            <button className="adm-btn xs solid" onClick={onChangerMotDePasse}>Le changer maintenant</button>
          </p>
        )}
      </div>

      {d.alertes.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>À régler de mon côté</h3><span className="adm-muted">{d.alertes.length} point(s)</span></div>
          <div className="stack" style={{ gap: 6 }}>
            {d.alertes.map((a, i) => (
              <div key={i} className="row" style={{ gap: 8 }}>
                <span className={`adm-pill ${SEV_CLS[a.severite] ?? ''}`}>{SEV_LABEL[a.severite] ?? a.severite}</span>
                <span style={{ fontSize: 13 }}>{a.texte}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="adm-grid2">
        <div className="adm-card">
          <div className="adm-card-h"><h3>Mes dernières courses</h3><span className="adm-muted">{d.activite.kilometres.toLocaleString('fr-FR')} km sur la période</span></div>
          {d.dernieresCourses.length === 0 ? <p className="adm-empty">Aucune course pour l’instant.</p> : (
            <table className="adm-table sm">
              <thead><tr><th>Quand</th><th>Trajet</th><th className="r">Montant</th><th>Paiement</th><th>État</th></tr></thead>
              <tbody>
                {d.dernieresCourses.map((c) => (
                  <tr key={c.id}>
                    <td className="adm-muted">{dt(c.at)}</td>
                    <td>{c.trajet}</td>
                    <td className="r">{fcfa(c.montant)}</td>
                    <td>{PAIEMENT[c.paiement] ?? c.paiement}</td>
                    <td><span className="adm-pill">{STATUT_COURSE[c.statut] ?? c.statut}</span>{c.note ? <span className="adm-muted"> · {c.note} ★</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="stack" style={{ gap: 14 }}>
          <div className="adm-card" style={{ margin: 0 }}>
            <div className="adm-card-h"><h3>Mon véhicule</h3><span className="adm-pill">{d.vehicule.engine === 'electric' ? '100 % électrique' : d.vehicule.engine}</span></div>
            <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
              <span><span className="adm-muted" style={{ fontSize: 12 }}>Modèle</span><br /><strong>{d.vehicule.model ?? 'non renseigné'}</strong></span>
              <span><span className="adm-muted" style={{ fontSize: 12 }}>Immatriculation</span><br /><strong className="mono">{d.vehicule.plate ?? d.matricule}</strong></span>
              {d.vehicule.batteryPct !== undefined && <span><span className="adm-muted" style={{ fontSize: 12 }}>Batterie</span><br /><strong>{d.vehicule.batteryPct} %</strong></span>}
              <span><span className="adm-muted" style={{ fontSize: 12 }}>Assurance</span><br /><strong>{d.profil.insuranceExpiry ? `jusqu’au ${new Date(d.profil.insuranceExpiry).toLocaleDateString('fr-FR')}` : 'à fournir'}</strong></span>
            </div>
          </div>
          <div className="adm-card" style={{ margin: 0 }}>
            <div className="adm-card-h"><h3>Mon équipe</h3>{d.equipe?.mission && <span className="adm-muted">{d.equipe.mission}</span>}</div>
            {d.equipe ? (
              <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
                <span><strong>{d.equipe.name}</strong><br /><span className="adm-muted">Chef d’équipe : {d.equipe.managerName ?? 'non désigné'}</span></span>
                {d.equipe.managerPhone && <a className="adm-btn solid" href={lienTel(d.equipe.managerPhone) ?? undefined}>📞 Appeler mon chef d’équipe</a>}
              </div>
            ) : <p className="adm-muted" style={{ margin: 0 }}>Vous n’êtes rattaché(e) à aucune équipe. Vos demandes vont directement à la direction.</p>}
          </div>
        </div>
      </div>

      <div className="adm-grid2">
        <div className="adm-card">
          <div className="adm-card-h"><h3>Mes demandes</h3><span className="adm-muted">chef d’équipe → DAF → trésorerie</span></div>
          {d.requetes.length === 0 ? <p className="adm-empty">Aucune demande déposée.</p> : (
            <table className="adm-table sm">
              <thead><tr><th>Demande</th><th className="r">Montant</th><th>Où elle en est</th><th>Déposée le</th></tr></thead>
              <tbody>
                {d.requetes.map((r) => (
                  <tr key={r.id}>
                    <td>{r.type}</td>
                    <td className="r">{r.montant ? fcfa(r.montant) : '—'}</td>
                    <td><span className="adm-pill">{r.statut}</span></td>
                    <td className="adm-muted">{dt(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {d.argent.dernieresEcritures.length > 0 && (
            <>
              <h4 className="adm-drawer-sec" style={{ marginTop: 14 }}>Mes derniers mouvements</h4>
              <table className="adm-table sm">
                <tbody>
                  {d.argent.dernieresEcritures.map((e, i) => (
                    <tr key={i}>
                      <td className="adm-muted">{dt(e.at)}</td>
                      <td>{ECRITURE[e.type] ?? e.type}{e.note ? <span className="adm-muted"> · {e.note}</span> : null}</td>
                      <td className={`r ${e.amount < 0 ? 'neg' : 'pos'}`}>{e.amount > 0 ? '+' : ''}{fcfa(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <FormulaireRequete dossier={d} onDeposer={onDeposer} />
      </div>
    </>
  );
}

function FormulaireRequete({ dossier: d, onDeposer }: {
  dossier: NonNullable<MonPoste['monDossier']>;
  onDeposer: (driverId: string, r: NouvelleRequete) => Promise<boolean>;
}) {
  const [type, setType] = useState(d.typesRequete[0]?.code ?? 'avance');
  const [montant, setMontant] = useState('');
  const [echeances, setEcheances] = useState('3');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [motif, setMotif] = useState('');
  const [envoi, setEnvoi] = useState<'repos' | 'envoi' | 'ok'>('repos');
  const financiere = d.typesRequete.find((x) => x.code === type)?.financiere ?? false;
  const plafond = type === 'avance' ? d.plafonds.avance : type === 'pret' ? d.plafonds.pret : undefined;
  const m = Number(montant.replace(/\s/g, ''));
  const montantOk = !financiere || (m > 0 && (plafond === undefined || m <= plafond));
  const pret = motif.trim().length >= 3 && montantOk && (type !== 'conge' || (du && au));

  const envoyer = async () => {
    setEnvoi('envoi');
    const ok = await onDeposer(d.driverId, {
      type, motif: motif.trim(),
      ...(financiere ? { montant: m } : {}),
      ...(type === 'pret' ? { echeances: Number(echeances) } : {}),
      ...(type === 'conge' ? { du, au } : {}),
    });
    setEnvoi(ok ? 'ok' : 'repos');
    if (ok) { setMontant(''); setMotif(''); setDu(''); setAu(''); }
  };

  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Faire une demande</h3><span className="adm-muted">traitée par mon chef d’équipe, puis la direction</span></div>
      <div className="stack" style={{ gap: 10 }}>
        <label className="field"><span>Type de demande</span>
          <select className="adm-input" value={type} onChange={(e) => { setType(e.target.value); setEnvoi('repos'); }}>
            {d.typesRequete.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>
        </label>
        {financiere && (
          <label className="field"><span>Montant (F CFA){plafond ? ` — plafond ${fcfa(plafond)}` : ''}</span>
            <input className="adm-input" inputMode="numeric" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="ex. 50 000" />
          </label>
        )}
        {type === 'pret' && (
          <label className="field"><span>Remboursement en</span>
            <select className="adm-input" value={echeances} onChange={(e) => setEcheances(e.target.value)}>
              {Array.from({ length: d.plafonds.echeancesMax }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} mensualité{n > 1 ? 's' : ''}</option>)}
            </select>
          </label>
        )}
        {type === 'conge' && (
          <div className="row" style={{ gap: 10 }}>
            <label className="field grow"><span>Du</span><input className="adm-input" type="date" value={du} onChange={(e) => setDu(e.target.value)} /></label>
            <label className="field grow"><span>Au</span><input className="adm-input" type="date" value={au} onChange={(e) => setAu(e.target.value)} /></label>
          </div>
        )}
        <label className="field"><span>Pourquoi ?</span>
          <textarea className="adm-input" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Expliquez simplement votre besoin." />
        </label>
        {financiere && montant && !montantOk && <p className="adm-muted" style={{ margin: 0, color: 'var(--a-danger)' }}>Montant au-dessus du plafond autorisé.</p>}
        <button className="adm-btn solid" disabled={!pret || envoi === 'envoi'} onClick={() => void envoyer()}>
          {envoi === 'envoi' ? 'Envoi…' : 'Envoyer ma demande'}
        </button>
        {envoi === 'ok' && <p className="adm-muted" style={{ margin: 0 }}>✅ Demande enregistrée : votre chef d’équipe est prévenu. Vous suivez son avancement ci-contre.</p>}
      </div>
    </div>
  );
}
