import { useState } from 'react';
import { Kpi } from '../ui';
import type { SuiviFlotte, VehiculeSuivi } from '../types';

/**
 * TÉLÉMATIQUE DES VÉHICULES DE LOCATION.
 *
 * Confier une voiture à 900 000 F la journée à quelqu'un qu'on a vu une fois, sans
 * savoir où elle est, est un risque qu'aucun loueur sérieux ne prend.
 *
 * Mais l'écran doit dire la vérité sur ce qu'il fait : on suit un VÉHICULE, chaque
 * consultation est tracée, et une coupure moteur ne s'applique jamais en roulant ni
 * sur la décision d'une seule personne.
 */

const dt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const depuis = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
};

const ETAT_IMMO: Record<string, { label: string; cls: string }> = {
  armee: { label: 'Coupure armée', cls: 'lvl-orange' },
  appliquee: { label: 'Moteur coupé', cls: 'lvl-rouge' },
  levee: { label: 'Levée', cls: '' },
};

export function TelematiqueSection({ suivi, onRafraichir, onDeclarerVol, onImmobiliser, onConfirmer, onLever, onTransmis, onClore, onSignalement, peutAgir }: {
  suivi: SuiviFlotte | null;
  onRafraichir: () => void;
  onDeclarerVol: (reservationId: string, circonstances: string) => void;
  onImmobiliser: (vehiculeId: string, motif: string, commentaire: string, reservationId?: string) => void;
  onConfirmer: (id: string) => void;
  onLever: (id: string, motif: string) => void;
  onTransmis: (volId: string, a: string, reference: string) => void;
  onClore: (volId: string, statut: 'retrouve' | 'clos', note: string) => void;
  onSignalement: (volId: string) => void;
  peutAgir: boolean;
}) {
  const [ouvert, setOuvert] = useState<string | null>(null);

  if (!suivi) return <p className="adm-muted">Interrogation des boîtiers…</p>;

  const silencieux = suivi.vehicules.filter((v) => v.silencieux).length;

  return (
    <>
      <div className="adm-kpis">
        <Kpi label="Véhicules suivis" value={String(suivi.vehicules.length)} sub="locations en cours ou confirmées" tone="teal" />
        <Kpi label="Boîtiers silencieux" value={String(silencieux)} sub="aucune remontée depuis plus d’une heure" tone={silencieux ? 'red' : 'green'} />
        <Kpi label="Vols en cours" value={String(suivi.vols.length)} sub="déclarés ou transmis aux forces de l’ordre" tone={suivi.vols.length ? 'red' : 'green'} />
        <Kpi label="Immobilisations actives" value={String(suivi.immobilisations.length)} sub={`appliquées sous ${suivi.vitesseCoupureMax} km/h`} tone={suivi.immobilisations.length ? 'blue' : 'green'} />
      </div>

      {suivi.vols.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>🚨 Véhicules déclarés volés</h3><span className="adm-muted">{suivi.vols.length} dossier(s)</span></div>
          <div className="stack" style={{ gap: 10 }}>
            {suivi.vols.map((v) => (
              <div key={v.id} className="adm-constat critique">
                <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="adm-pill lvl-rouge">{v.statut === 'transmis' ? 'Transmis' : 'Déclaré'}</span>
                    <strong>{v.vehiculeId}</strong>
                    <span className="adm-muted" style={{ fontSize: 12 }}>déclaré {depuis(v.declareLe)} par {v.declarePar}</span>
                  </span>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <button className="adm-btn xs solid" onClick={() => onSignalement(v.id)}>⬇ Fiche de signalement (PDF)</button>
                    {peutAgir && v.statut === 'declare' && (
                      <button
                        className="adm-btn xs"
                        onClick={() => {
                          const a = prompt('Transmis à quel service ?', 'Commissariat du 1er arrondissement, Plateau');
                          if (!a) return;
                          onTransmis(v.id, a, prompt('Référence de plainte (si connue) :') ?? '');
                        }}
                      >
                        Marquer transmis
                      </button>
                    )}
                    {peutAgir && (v.statut === 'declare' || v.statut === 'transmis') && (
                      <button className="adm-btn xs" onClick={() => onClore(v.id, 'retrouve', prompt('Note de clôture :') ?? '')}>Véhicule retrouvé</button>
                    )}
                  </div>
                </div>
                <dl className="adm-constat-corps">
                  <dt>Circonstances</dt><dd>{v.circonstances}</dd>
                  {v.dernierePosition && (
                    <>
                      <dt>Dernière position</dt>
                      <dd>
                        {v.dernierePosition.zone ?? 'zone inconnue'} — {v.dernierePosition.lat.toFixed(5)}, {v.dernierePosition.lng.toFixed(5)}
                        {' · '}relevée {depuis(v.dernierePosition.at)}
                        {' · '}
                        <a className="adm-link" href={`https://maps.google.com/?q=${v.dernierePosition.lat},${v.dernierePosition.lng}`} target="_blank" rel="noreferrer">voir sur la carte</a>
                      </dd>
                    </>
                  )}
                  {v.transmisA && <><dt>Transmis à</dt><dd>{v.transmisA}{v.referencePlainte ? ` · plainte ${v.referencePlainte}` : ''}</dd></>}
                </dl>
                <p className="adm-muted" style={{ fontSize: 11.5, margin: 0 }}>
                  Appelez la police au <strong>170</strong> (ou le 111) et remettez la fiche de signalement :
                  elle porte la position, l’identité du locataire et les références du contrat.
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Flotte en location</h3>
          <div className="row" style={{ gap: 8 }}>
            <span className="adm-muted">position, locataire, état du véhicule</span>
            <button className="adm-btn xs" onClick={onRafraichir}>Actualiser</button>
          </div>
        </div>
        {suivi.vehicules.length === 0 ? (
          <p className="adm-empty">Aucune location en cours. Hors location, suivre un véhicule n’a aucun motif légitime.</p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {suivi.vehicules.map((v) => (
              <VehiculeLigne
                key={v.reservationId}
                v={v}
                ouvert={ouvert === v.reservationId}
                onBasculer={() => setOuvert(ouvert === v.reservationId ? null : v.reservationId)}
                motifs={suivi.motifs}
                vitesseCoupureMax={suivi.vitesseCoupureMax}
                peutAgir={peutAgir}
                onDeclarerVol={onDeclarerVol}
                onImmobiliser={onImmobiliser}
                onConfirmer={onConfirmer}
                onLever={onLever}
              />
            ))}
          </div>
        )}
      </div>

      <div className="adm-card">
        <div className="adm-card-h"><h3>Ce que fait — et ne fait pas — la télématique</h3></div>
        <p className="adm-muted" style={{ fontSize: 12.5, lineHeight: 1.7, margin: 0 }}>
          <strong>On suit un véhicule, pas un client.</strong> La position n’est consultable que pendant une
          location active ou un vol déclaré ; en dehors, le serveur refuse. Chaque consultation exige un
          motif et laisse une trace à votre nom. Regarder où dort un client le dimanche est une faute,
          pas une vérification.{' '}
          <strong>On n’arrête pas un moteur en roulant.</strong> L’ordre est <em>armé</em> ; le boîtier
          l’applique lorsque le véhicule est réellement sous {suivi.vitesseCoupureMax} km/h. Couper le moteur
          d’une voiture lancée supprime la direction et les freins assistés.{' '}
          <strong>Une immobilisation exige deux personnes</strong> : celui qui l’arme ne la confirme pas.
          Le client se retrouve à pied, parfois la nuit, parfois avec des enfants.
        </p>
      </div>
    </>
  );
}

function VehiculeLigne({ v, ouvert, onBasculer, motifs, vitesseCoupureMax, peutAgir, onDeclarerVol, onImmobiliser, onConfirmer, onLever }: {
  v: VehiculeSuivi;
  ouvert: boolean;
  onBasculer: () => void;
  motifs: Record<string, string>;
  vitesseCoupureMax: number;
  peutAgir: boolean;
  onDeclarerVol: (reservationId: string, circonstances: string) => void;
  onImmobiliser: (vehiculeId: string, motif: string, commentaire: string, reservationId?: string) => void;
  onConfirmer: (id: string) => void;
  onLever: (id: string, motif: string) => void;
}) {
  const [motif, setMotif] = useState('impaye');
  const [commentaire, setCommentaire] = useState('');
  const p = v.position;

  return (
    <div className={`adm-constat ${v.vol ? 'critique' : v.immobilisation ? 'eleve' : ''}`}>
      <div className="row between" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="row grow" style={{ gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14.5 }}>{v.vehiculeNom}</strong>
          <span className="adm-pill">{v.statut === 'en_cours' ? 'En cours' : 'Confirmée'}</span>
          {v.silencieux && <span className="adm-pill lvl-orange">Boîtier silencieux</span>}
          {v.immobilisation && <span className={`adm-pill ${ETAT_IMMO[v.immobilisation.etat]?.cls ?? ''}`}>{ETAT_IMMO[v.immobilisation.etat]?.label ?? v.immobilisation.etat}</span>}
          {v.vol && <span className="adm-pill lvl-rouge">Déclaré volé</span>}
        </div>
        <button className="adm-btn xs" onClick={onBasculer}>{ouvert ? 'Replier' : 'Agir'}</button>
      </div>

      <dl className="adm-constat-corps">
        <dt>Locataire</dt>
        <dd>
          <strong>{v.locataire.nom}</strong>{v.locataire.societe ? ` · ${v.locataire.societe}` : ''}
          <br />
          {/* On doit pouvoir appeler le locataire sans aller le chercher ailleurs. */}
          {v.locataire.telephone
            ? (
              <span className="row" style={{ gap: 6, marginTop: 4 }}>
                <a className="adm-btn xs solid" href={`tel:${v.locataire.telephone}`}>📞 Appeler</a>
                <a className="adm-btn xs" href={`sms:${v.locataire.telephone}`}>✉️ SMS</a>
                <span className="adm-muted mono" style={{ fontSize: 12 }}>{v.locataire.telephone}</span>
              </span>
            )
            : <span className="adm-muted">n° inconnu — à compléter sur le dossier</span>}
        </dd>
        <dt>Période</dt><dd>du {dt(v.debut)} au {dt(v.fin)}</dd>
        <dt>Position</dt>
        <dd>
          {p
            ? (
              <>
                {p.zone ?? 'zone inconnue'} — <span className="mono">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</span>
                {' · '}{p.vitesseKmh} km/h · contact {p.contact ? 'mis' : 'coupé'}
                {p.batteriePct !== undefined ? ` · batterie ${p.batteriePct} %` : ''}
                {p.autonomieKm !== undefined ? ` · ${p.autonomieKm} km d’autonomie` : ''}
                <br />
                <span className="adm-muted" style={{ fontSize: 11.5 }}>relevé {depuis(p.at)}</span>
                {' · '}
                <a className="adm-link" href={`https://maps.google.com/?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer">carte</a>
              </>
            )
            : <span className="adm-muted">Aucune remontée du boîtier.</span>}
        </dd>
      </dl>

      {ouvert && peutAgir && (
        <div className="stack" style={{ gap: 10, marginTop: 8 }}>
          {!v.vol && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <button
                className="adm-btn xs"
                onClick={() => {
                  const c = prompt('Circonstances du vol (au moins une phrase complète) :');
                  if (c && c.trim().length >= 10) onDeclarerVol(v.reservationId, c.trim());
                  else if (c !== null) alert('Décrivez les circonstances : le commissariat en a besoin.');
                }}
              >
                🚨 Déclarer un vol
              </button>
            </div>
          )}

          {v.immobilisation && (v.immobilisation.etat === 'armee' || v.immobilisation.etat === 'appliquee') ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {v.immobilisation.etat === 'armee' && (
                <>
                  <button className="adm-btn xs solid" onClick={() => onConfirmer(v.immobilisation!.id)}>
                    Confirmer l’immobilisation (seconde personne)
                  </button>
                  <span className="adm-muted" style={{ fontSize: 12 }}>
                    Motif : {v.immobilisation.motifLabel}. S’appliquera sous {vitesseCoupureMax} km/h.
                  </span>
                </>
              )}
              <button
                className="adm-btn xs"
                onClick={() => {
                  const m = prompt('Motif de la levée :');
                  if (m) onLever(v.immobilisation!.id, m);
                }}
              >
                Lever l’immobilisation
              </button>
            </div>
          ) : (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="field" style={{ minWidth: 190 }}>
                <span>Motif d’immobilisation</span>
                <select className="adm-select" value={motif} onChange={(e) => setMotif(e.target.value)}>
                  {Object.entries(motifs).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <label className="field grow" style={{ minWidth: 240 }}>
                <span>Justification (au moins une phrase)</span>
                <input className="adm-input" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Deuxième échéance non réglée malgré relance du 8 novembre." />
              </label>
              <button
                className="adm-btn"
                onClick={() => {
                  if (commentaire.trim().length < 10) { alert('Justifiez l’immobilisation : elle laisse quelqu’un à pied.'); return; }
                  onImmobiliser(v.vehiculeId, motif, commentaire.trim(), v.reservationId);
                  setCommentaire('');
                }}
              >
                Armer la coupure moteur
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
