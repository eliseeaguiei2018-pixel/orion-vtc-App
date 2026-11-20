import { useEffect, useState } from 'react';
import { IconStar } from '../../icons';
import type { ScreenProps } from '../Driver';
import type { RideHistory, RideView } from '../types';
import { BellButton, PageHeader, Stat } from '../ui';
import { Rentals } from './Rentals';
import { dateTime, fcfa, km, methodLabel, STATUS_LABEL } from '../format';
import { tr } from '../i18n';

type Filter = 'all' | 'paid' | 'cancelled' | 'locations';

/** HISTORIQUE DES COURSES : statut, montant, gain net, moyen de paiement, note client. */
export function Rides({ app, unread, openNotices }: ScreenProps) {
  const [history, setHistory] = useState<RideHistory | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState(false);

  useEffect(() => {
    void app.backend.history().then((h) => { setHistory(h); setError(false); }).catch(() => setError(true));
  }, [app.backend, app.settled, app.activeRide?.status]);

  const rides = (history?.rides ?? []).filter((r) => filter === 'all'
    || (filter === 'paid' ? r.paidAmount !== null : r.status === 'cancelled'));

  return (
    <div className="dv-page">
      <PageHeader title={tr('Mes courses')} sub={history ? tr(history.total > 1 ? '{0} courses au total' : '{0} course au total', [history.total]) : tr('Historique')} right={<BellButton count={unread} onClick={openNotices} />} />
      <div className="dv-stats">
        <Stat accent label={tr('Aujourd’hui')} value={history?.today.rides ?? 0} sub={tr('{0} nets', [fcfa(history?.today.net ?? 0)])} />
        <Stat label={tr('7 jours')} value={history?.week.rides ?? 0} sub={tr('{0} nets', [fcfa(history?.week.net ?? 0)])} />
      </div>
      <div className="dv-seg" role="group" aria-label={tr('Filtre')}>
        {([['all', tr('Toutes')], ['paid', tr('Payées')], ['cancelled', tr('Annulées')], ['locations', `${tr('Locations')}${app.rentals.some((r) => r.status === 'confirmee' || r.status === 'en_cours' || r.status === 'reservee') ? ' •' : ''}`]] as Array<[Filter, string]>).map(([f, l]) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{l}</button>
        ))}
      </div>
      {filter === 'locations' && <Rentals app={app} />}
      {filter !== 'locations' && error && <div className="dv-empty">{tr('Historique indisponible — vérifiez votre connexion.')}</div>}
      {filter !== 'locations' && !error && rides.length === 0 && <div className="dv-empty">{filter === 'cancelled' ? tr('Aucune course annulée pour l’instant.') : filter === 'paid' ? tr('Aucune course payée pour l’instant.') : tr('Aucune course pour l’instant.')}</div>}
      <div className="col" style={{ gap: 8 }}>
        {filter !== 'locations' && rides.map((r) => <RideRow key={r.id} r={r} />)}
      </div>
    </div>
  );
}

function RideRow({ r }: { r: RideView }) {
  const net = r.earnings.net + r.earnings.bonus;
  const tone = r.status === 'cancelled' ? 'danger' : r.paidAmount !== null ? 'green' : 'gold';
  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row between">
        <span className={`dv-pill ${tone}`}>{STATUS_LABEL[r.status]}</span>
        <span className="faint" style={{ fontSize: 12 }}>{dateTime(r.createdAt)}</span>
      </div>
      <div className="row between">
        <div>
          <div className="dv-item-title">{fcfa(r.paidAmount ?? r.amount)}</div>
          <div className="dv-item-sub">{km(r.distanceMeters)} · {methodLabel(r.paymentMethod)}{r.waitMinutes ? tr(' · attente {0} min', [r.waitMinutes]) : ''}</div>
        </div>
        <div style={{ textAlign: 'end' }}>
          {r.paidAmount !== null && <div className="dv-amount pos">+ {fcfa(net)}</div>}
          {r.rating !== null && <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>{Array.from({ length: r.rating }, (_, i) => <IconStar key={i} size={13} color="var(--gold)" />)}</div>}
        </div>
      </div>
      {r.earnings.cashCollected > 0 && <div className="faint" style={{ fontSize: 12 }}>{tr('Espèces encaissées {0} · commission due {1}', [fcfa(r.earnings.cashCollected), fcfa(r.earnings.commission)])}</div>}
    </div>
  );
}
