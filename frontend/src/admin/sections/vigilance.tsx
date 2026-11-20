import { useMemo, useState } from 'react';
import { Kpi } from '../ui';
import type { Constat, SanteVigilance, Severite } from '../types';

/**
 * SESSION VIGILANCE — le contrôleur permanent d'ORION.
 *
 * Une console peut afficher des chiffres parfaits et laisser passer une faille :
 * personne ne regarde tous les écrans en même temps. Cette session rassemble tout ce
 * qui ne va pas, formulé de la même façon : ce qu'on observe, ce que cela produit si
 * on ne fait rien, ce qu'il faut faire, et où le faire.
 *
 * Il n'y a ici aucun modèle de langage : ce sont des règles explicites sur les données
 * réelles. C'est précisément ce qui en fait un outil fiable — un contrôle qui se
 * trompe ne serait jamais relu.
 */

const SEV_META: Record<Severite, { label: string; cls: string; poids: string }> = {
  critique: { label: 'Critique', cls: 'lvl-rouge', poids: 'à traiter maintenant' },
  eleve: { label: 'Élevé', cls: 'lvl-orange', poids: 'dans la journée' },
  moyen: { label: 'Moyen', cls: 'lvl-jaune', poids: 'cette semaine' },
  info: { label: 'Information', cls: '', poids: 'pour information' },
};

const DOMAINE_LABEL: Record<string, string> = {
  securite: 'Sécurité', conformite: 'Conformité', flotte: 'Flotte',
  exploitation: 'Exploitation', finance: 'Finance', configuration: 'Configuration',
  client: 'Client',
};

const ETAT_META: Record<string, { label: string; tone: string; phrase: string }> = {
  sain: { label: 'Sain', tone: 'green', phrase: 'Rien ne demande d’intervention.' },
  surveiller: { label: 'À surveiller', tone: 'blue', phrase: 'Quelques points à traiter, rien d’urgent.' },
  degrade: { label: 'Dégradé', tone: 'red', phrase: 'Plusieurs points pèsent sur le service.' },
  critique: { label: 'Critique', tone: 'red', phrase: 'Au moins un point met ORION en danger immédiat.' },
};

export function VigilanceSection({ sante, onAller, onRapportPdf, onRafraichir }: {
  sante: SanteVigilance | null;
  /** Ouvre la session où le constat se traite. */
  onAller: (section: string) => void;
  onRapportPdf: () => void;
  onRafraichir: () => void;
}) {
  const [severite, setSeverite] = useState<'' | Severite>('');
  const [domaine, setDomaine] = useState('');

  const vues = useMemo(
    () => (sante?.constats ?? []).filter(
      (c) => (!severite || c.severite === severite) && (!domaine || c.domaine === domaine),
    ),
    [sante, severite, domaine],
  );

  if (!sante) return <p className="adm-muted">Contrôle en cours…</p>;
  const etat = ETAT_META[sante.etat] ?? ETAT_META.surveiller!;
  const domaines = Object.keys(sante.parDomaine).sort();

  return (
    <>
      <div className="adm-kpis">
        <Kpi label="État de la plateforme" value={etat.label} sub={etat.phrase} tone={etat.tone} />
        <Kpi label="Score de contrôle" value={`${sante.score} / 100`} sub="100 = aucun constat" tone={sante.score >= 90 ? 'green' : sante.score >= 60 ? 'blue' : 'red'} />
        <Kpi label="À traiter maintenant" value={String(sante.parSeverite.critique)} sub="constats critiques" tone={sante.parSeverite.critique ? 'red' : 'green'} />
        <Kpi label="Dans la journée" value={String(sante.parSeverite.eleve)} sub={`${sante.parSeverite.moyen} point(s) moyen(s) en plus`} tone={sante.parSeverite.eleve ? 'blue' : 'green'} />
      </div>

      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Constats</h3>
          <div className="row" style={{ gap: 8 }}>
            <select className="adm-select" value={severite} onChange={(e) => setSeverite(e.target.value as '' | Severite)}>
              <option value="">Toutes gravités</option>
              {(['critique', 'eleve', 'moyen', 'info'] as Severite[]).map((s) => (
                <option key={s} value={s}>{SEV_META[s].label} ({sante.parSeverite[s]})</option>
              ))}
            </select>
            <select className="adm-select" value={domaine} onChange={(e) => setDomaine(e.target.value)}>
              <option value="">Tous domaines</option>
              {domaines.map((d) => <option key={d} value={d}>{DOMAINE_LABEL[d] ?? d} ({sante.parDomaine[d]})</option>)}
            </select>
            <button className="adm-btn xs" onClick={onRafraichir}>Relancer le contrôle</button>
            <button className="adm-btn xs solid" onClick={onRapportPdf}>⬇ Rapport de contrôle (PDF)</button>
          </div>
        </div>

        {vues.length === 0 ? (
          <p className="adm-empty">
            {sante.constats.length === 0
              ? 'Aucun constat : la plateforme est saine.'
              : 'Aucun constat pour ce filtre.'}
          </p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {vues.map((c: Constat) => (
              <div key={c.id} className={`adm-constat ${c.severite}`}>
                <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <div className="row grow" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className={`adm-pill ${SEV_META[c.severite].cls}`}>{SEV_META[c.severite].label}</span>
                    <span className="adm-pill">{DOMAINE_LABEL[c.domaine] ?? c.domaine}</span>
                    <strong style={{ fontSize: 14.5 }}>{c.titre}</strong>
                  </div>
                  <button className="adm-btn xs solid" style={{ flex: 'none' }} onClick={() => onAller(c.section)}>Traiter</button>
                </div>
                <dl className="adm-constat-corps">
                  <dt>Constat</dt><dd>{c.constat}</dd>
                  <dt>Conséquence</dt><dd>{c.consequence}</dd>
                  <dt>Action</dt><dd>{c.action}</dd>
                </dl>
                <div className="row between" style={{ fontSize: 11.5 }}>
                  <span className="adm-muted">{SEV_META[c.severite].poids}</span>
                  {c.elements && c.elements.length > 0 && (
                    <span className="adm-muted mono">{c.elements.length} élément(s) concerné(s)</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="adm-card">
        <div className="adm-card-h"><h3>Ce que le moteur surveille</h3></div>
        <p className="adm-muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
          <strong>Conformité</strong> — assurances expirées, dossiers KYC non validés chez des chauffeurs en service.{' '}
          <strong>Flotte</strong> — véhicules électriques en service sous 15 % de batterie.{' '}
          <strong>Exploitation</strong> — alertes SOS sans gestionnaire ou trop longues, zones ouvertes sans un seul
          véhicule, réservations et locations imminentes sans chauffeur, part de commandes restées sans réponse.{' '}
          <strong>Finance</strong> — prélèvements d’abonnement en échec, virements en attente depuis plus de 48 h,
          dettes espèces au-delà du plafond, couverture des retraits chauffeurs.{' '}
          <strong>Configuration</strong> — grille tarifaire incohérente, aucune passerelle de paiement active,
          incitation verte inversée, véhicule de location en vente sans stock, numéro de secours désactivé.{' '}
          <strong>Sécurité</strong> — tentatives d’accès à des sessions non autorisées.
        </p>
        <p className="adm-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Chaque règle est explicite et testée. Aucun modèle de langage n’intervient : un contrôle qui se tromperait
          ne serait jamais relu, et une alerte qu’on cesse de lire ne protège plus de rien.
        </p>
      </div>
    </>
  );
}
