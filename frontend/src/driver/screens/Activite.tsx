import { useEffect, useState } from 'react';
import { IconActivity, IconChevron, IconWallet } from '../../icons';
import type { ScreenProps } from '../Driver';
import type { RideHistory } from '../types';
import { Banner, BellButton, PageHeader, Progress, Section, Stat } from '../ui';
import { dateTime, fcfa, methodLabel } from '../format';
import { localeCourante, tr } from '../i18n';
import { decalerMois, libelleMois, moisCourant, type ActiviteMois } from '../salarie';

const kmTexte = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
const heuresTexte = (h: number) => `${h.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`;

/** Sélecteur de mois (‹ novembre 2026 ›) : on ne va pas au-delà du mois en cours. */
export function ChoixMois({ mois, onMois }: { mois: string; onMois: (m: string) => void }) {
  const courant = moisCourant();
  return (
    <div className="dv-mois" role="group" aria-label={tr('Mois affiché')}>
      <button type="button" className="dv-mois-b" aria-label={tr('Mois précédent')} onClick={() => onMois(decalerMois(mois, -1))}>
        <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><IconChevron size={16} /></span>
      </button>
      <span className="dv-mois-l">{libelleMois(mois, localeCourante())}</span>
      <button type="button" className="dv-mois-b" aria-label={tr('Mois suivant')} disabled={mois >= courant} onClick={() => onMois(decalerMois(mois, 1))}>
        <IconChevron size={16} />
      </button>
    </div>
  );
}

/**
 * MON ACTIVITÉ — chauffeur salarié d'ORION.
 *
 * Plus de commission ni de gains par course : le chauffeur est payé au mois. Il voit ce
 * qu'il a accompli (courses, kilomètres, heures en service), ce qu'il a encaissé pour
 * ORION (dont les espèces à remettre à la caisse), sa note et son taux d'acceptation.
 */
export function Activite({ app, unread, openNotices }: ScreenProps) {
  const [mois, setMois] = useState(moisCourant());
  const [activite, setActivite] = useState<ActiviteMois | null>(null);
  const [history, setHistory] = useState<RideHistory | null>(null);
  const [erreur, setErreur] = useState(false);

  const load = () => {
    void app.backend.activite(mois).then((a) => { setActivite(a); setErreur(false); }).catch(() => setErreur(true));
    void app.backend.history().then(setHistory).catch(() => undefined);
  };
  useEffect(load, [app.backend, app.settled, mois]);

  const a = activite;
  const estCeMois = mois === moisCourant();
  const jours = (a?.parJour ?? []).filter((j) => j.courses > 0 || j.heures > 0).slice().reverse();
  const maxCourses = Math.max(1, ...jours.map((j) => j.courses));

  return (
    <div className="dv-page">
      <PageHeader title={tr('Mon activité')} sub={tr('Chauffeur salarié ORION')} right={<BellButton count={unread} onClick={openNotices} />}>
        <ChoixMois mois={mois} onMois={setMois} />
      </PageHeader>

      <div className="dv-solde dv-solde-pose">
        <span className="dv-stat-label"><IconActivity size={14} /> {estCeMois ? tr('Courses ce mois-ci') : tr('Courses du mois')}</span>
        <span className="dv-solde-montant">{a ? a.courses.toLocaleString('fr-FR') : '—'}</span>
        <span className="dv-solde-sub">{a ? tr('{0} · {1} en service · {2} jour(s) actif(s)', [kmTexte(a.km), heuresTexte(a.heuresService), a.joursActifs]) : tr('Chargement…')}</span>
      </div>

      {erreur && !a && (
        <Banner tone="warn" icon={<IconActivity size={18} />} title={tr('Activité indisponible')}>
          {tr('Le serveur ORION ne répond pas pour le moment. Réessayez dans un instant.')}
        </Banner>
      )}

      {estCeMois && (
        <Section title={tr('Aujourd’hui')}>
          <div className="dv-stats three">
            <Stat accent label={tr('Courses')} value={a?.aujourdhui.courses ?? 0} />
            <Stat label={tr('Distance')} value={kmTexte(a?.aujourdhui.km ?? 0)} />
            <Stat label={tr('En service')} value={heuresTexte(a?.aujourdhui.heuresService ?? 0)} />
          </div>
        </Section>
      )}

      <Section title={tr('Encaissé pour ORION')}>
        <div className="dv-stats">
          <Stat label={tr('Recettes du mois')} value={fcfa(a?.recettes ?? 0)} sub={tr('Prix payés par vos clients')} />
          <Stat label={tr('Espèces à remettre')} value={fcfa(a?.especes ?? 0)} sub={tr('À déposer à la caisse ORION')} />
        </div>
        <div className="faint" style={{ fontSize: 12 }}>
          {tr('Vous êtes salarié d’ORION : votre salaire est versé chaque mois. Les montants des courses sont encaissés pour ORION, sans commission ni retenue sur vous.')}
        </div>
      </Section>

      <Section title={tr('Qualité de service')}>
        <div className="dv-stats three">
          <Stat label={tr('Note')} value={a?.note.moyenne != null ? `★ ${a.note.moyenne.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}` : '—'} sub={tr('{0} note(s)', [a?.note.nombre ?? 0])} />
          <Stat label={tr('Acceptation')} value={a?.offres.tauxAcceptation != null ? `${a.offres.tauxAcceptation} %` : '—'} sub={tr('{0} offre(s) reçue(s)', [a?.offres.recues ?? 0])} />
          <Stat label={tr('Annulations')} value={a?.annulations ?? 0} sub={tr('par vous')} />
        </div>
      </Section>

      {(history?.aRegulariser?.length ?? 0) > 0 && estCeMois && (
        <Section title={tr('À régulariser')}>
          <Banner tone="warn" icon={<IconWallet size={18} />} title={tr('Courses terminées sans paiement enregistré')}>
            {tr('ORION vous a remis en service après le délai d’encaissement. Si le client vous a payé en espèces, enregistrez-le ; sinon la supervision régularise.')}
          </Banner>
          {history!.aRegulariser!.map((r) => {
            const du = r.encaissement?.aEncaisser ?? r.amount;
            return (
              <div key={r.id} className="card dv-item">
                <div className="grow">
                  <div className="dv-item-title">{fcfa(du)} {r.encaissement?.abonnement ? `· ${tr('abonnement')}` : ''}</div>
                  <div className="dv-item-sub">{dateTime(r.updatedAt)} · {methodLabel(r.paymentMethod)}</div>
                </div>
                {du === 0
                  ? <button className="dv-pill green" disabled={app.busy} onClick={() => void app.actions.settleCovered(r.id, 'card').then(load)}>{tr('Valider')}</button>
                  : (app.appConfig?.gateways['cash'] !== false) && <button className="dv-pill green" disabled={app.busy} onClick={() => void app.actions.collectCash(r.id).then(load)}>{tr('Encaissé en espèces')}</button>}
              </div>
            );
          })}
        </Section>
      )}

      <Section title={tr('Jour par jour')}>
        {jours.length === 0 && <div className="dv-empty">{tr('Aucune course ni heure en service sur ce mois.')}</div>}
        <div className="col" style={{ gap: 8 }}>
          {jours.map((j) => (
            <div key={j.jour} className="card dv-jour">
              <div className="row between">
                <strong className="cap">{new Date(`${j.jour}T12:00:00Z`).toLocaleDateString(localeCourante(), { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}</strong>
                <span className="muted tnum">{tr('{0} course(s)', [j.courses])}</span>
              </div>
              <Progress value={j.courses} max={maxCourses} />
              <div className="dv-item-sub tnum">{kmTexte(j.km)} · {heuresTexte(j.heures)} {tr('en service')}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
