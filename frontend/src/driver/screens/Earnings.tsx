import { Objet } from '../../components/Vehicules';
import { useEffect, useState } from 'react';
import { IconLeaf, IconWallet } from '../../icons';
import type { ScreenProps } from '../Driver';
import type { LedgerEntry, RideHistory, Wallet } from '../types';
import { Banner, BellButton, PageHeader, Progress, Section, Stat } from '../ui';
import { dateTime, fcfa, methodLabel, pct } from '../format';
import { libelles, tr } from '../i18n';

const LEDGER_LABEL: Record<LedgerEntry['type'], string> = libelles({
  ride_earning: 'Gain de course (net)', commission: 'Commission ORION', payout: 'Retrait de gains', adjustment: 'Bonus / ajustement',
  insurance_refund: 'Remboursement assurance', cash_collected: 'Espèces encaissées',
});
const PAYOUT_METHODS = ['wave', 'orange_money', 'mtn_momo', 'moov_money'];
const GOAL_KEY = 'orion.driver.goal';

/**
 * GAINS & PORTEFEUILLE : revenus du jour / 7 jours, commission appliquée (taux vert mis
 * en avant), dette espèces face au plafond console, objectif quotidien, retrait.
 */
export function Earnings({ app, unread, openNotices }: ScreenProps) {
  const { finance, driverConfig } = app;
  const [history, setHistory] = useState<RideHistory | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [amount, setAmount] = useState('');
  const gateways = app.appConfig?.gateways ?? {};
  const methods = PAYOUT_METHODS.filter((m) => gateways[m] !== false);
  const [method, setMethod] = useState(methods[0] ?? 'wave');
  const [goal, setGoal] = useState<number>(() => {
    try { return Number(localStorage.getItem(GOAL_KEY)) || 25_000; } catch { return 25_000; }
  });

  const load = () => {
    void app.backend.history().then(setHistory).catch(() => undefined);
    void app.backend.wallet().then(setWallet).catch(() => undefined);
  };
  useEffect(load, [app.backend, app.settled, finance?.balance]);
  useEffect(() => { if (!methods.includes(method) && methods[0]) setMethod(methods[0]); }, [methods, method]);

  const saveGoal = (v: number) => {
    setGoal(v);
    try { localStorage.setItem(GOAL_KEY, String(v)); } catch { /* ignore */ }
  };

  const rate = finance?.commissionRate ?? driverConfig.commission.green;
  const saved = history ? Math.max(0, Math.round(history.week.gross * (driverConfig.commission.standard - rate))) : 0;
  const balance = finance?.balance ?? 0;
  const value = Number(amount);
  const canPayout = !finance?.frozen && balance > 0 && value > 0 && value <= balance && methods.length > 0;

  return (
    <div className="dv-page">
      <PageHeader title={tr('Mes gains')} sub={tr('Portefeuille ORION en F CFA')} right={<BellButton count={unread} onClick={openNotices} />} />

      {/* Le solde en grande carte lumineuse, posée sur l'en-tête (comme la carte « En service »). */}
      <div className={`dv-solde dv-solde-pose${balance < 0 ? ' neg' : ''}`}>
        <span className="dv-stat-label"><IconWallet size={14} /> {tr('Solde disponible')}</span>
        <span className="dv-solde-montant">{fcfa(balance)}</span>
        <span className="dv-solde-sub">{tr('Commission appliquée :')} <strong>{pct(rate)}</strong>{rate < driverConfig.commission.standard ? tr(' (au lieu de {0} en thermique)', [pct(driverConfig.commission.standard)]) : ''}</span>
      </div>

      {finance && finance.cashDebt > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong>{tr('Dette espèces')}</strong>
            <span className={`dv-amount ${finance.cashBlocked ? 'neg' : ''}`}>{fcfa(finance.cashDebt)} / {fcfa(finance.cashDebtLimit)}</span>
          </div>
          <Progress value={finance.cashDebt} max={finance.cashDebtLimit} tone={finance.cashBlocked ? 'danger' : finance.cashDebt > finance.cashDebtLimit * 0.7 ? 'gold' : 'green'} />
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            {tr('Commissions dues sur les courses payées en espèces. Au-delà du plafond fixé par ORION, vous ne recevez plus de courses espèces ; elle se rembourse automatiquement avec vos gains mobile money.')}
          </div>
        </div>
      )}

      {(history?.aRegulariser?.length ?? 0) > 0 && (
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

      <Section title={tr('Aujourd’hui')}>
        <div className="dv-stats">
          <Stat accent label={tr('Gains nets')} value={fcfa(history?.today.net ?? 0)} sub={tr('{0} course(s)', [history?.today.rides ?? 0])} />
          <Stat label={tr('Chiffre brut')} value={fcfa(history?.today.gross ?? 0)} sub={tr('Commission {0}', [fcfa(history?.today.commission ?? 0)])} />
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong>{tr('Objectif du jour')}</strong>
            <span className="muted">{fcfa(history?.today.net ?? 0)} / {fcfa(goal)}</span>
          </div>
          <Progress value={history?.today.net ?? 0} max={goal} tone={(history?.today.net ?? 0) >= goal ? 'gold' : 'green'} />
          <div className="dv-seg" style={{ marginTop: 10 }}>
            {[15_000, 25_000, 40_000, 60_000].map((g) => <button key={g} className={goal === g ? 'on' : ''} onClick={() => saveGoal(g)}>{g / 1000} k</button>)}
          </div>
        </div>
      </Section>

      <Section title={tr('7 derniers jours')}>
        <div className="dv-stats three">
          <Stat label={tr('Courses')} value={history?.week.rides ?? 0} />
          <Stat label={tr('Nets')} value={fcfa(history?.week.net ?? 0)} />
          <Stat label={tr('Espèces')} value={fcfa(history?.week.cashCollected ?? 0)} />
        </div>
        {saved > 0 && (
          <Banner tone="success" icon={<IconLeaf size={18} />} title={tr('{0} économisés grâce à l’électrique', [fcfa(saved)])}>
            {tr('Commission verte de {0} au lieu de {1} sur vos courses de la semaine.', [pct(rate), pct(driverConfig.commission.standard)])}
          </Banner>
        )}
      </Section>

      <Section title={tr('Retirer mes gains')}>
        {finance?.frozen ? (
          <Banner tone="danger" icon={<IconWallet size={18} />} title={tr('Retraits bloqués')}>{tr('Portefeuille gelé le temps d’un litige.')}</Banner>
        ) : (
          <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void app.actions.payout(value, method).then((ok) => { if (ok) { setAmount(''); load(); } }); }}>
            <div className="dv-grid2">
              <label className="dv-label">{tr('Montant (F)')}
                <input className="dv-input" type="number" inputMode="numeric" min={0} max={Math.max(0, balance)} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(Math.max(0, balance))} />
              </label>
              <label className="dv-label">{tr('Vers')}
                <select className="dv-select" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {methods.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
                </select>
              </label>
            </div>
            {methods.length === 0 && <div className="faint" style={{ fontSize: 12 }}>{tr('Aucune passerelle mobile money active pour le moment (console ORION).')}</div>}
            <button className="btn btn-primary" disabled={!canPayout || app.busy}>{tr('Demander le virement')}</button>
          </form>
        )}
      </Section>

      <Section title={tr('Mouvements du portefeuille')}>
        {!wallet?.history.length && <div className="dv-empty">{tr('Aucun mouvement pour l’instant.')}</div>}
        <div className="col" style={{ gap: 8 }}>
          {wallet?.history.slice(0, 40).map((e) => (
            <div key={e.id} className="card dv-item">
              <div className="dv-item-ico"><Objet nom={e.type === 'ride_earning' ? 'mes-courses' : 'portefeuille'} taille={34} /></div>
              <div className="grow">
                <div className="dv-item-title">{LEDGER_LABEL[e.type] ?? e.type}</div>
                <div className="dv-item-sub">{e.note ?? ''}{e.note ? ' · ' : ''}{dateTime(e.at)}</div>
              </div>
              <span className={`dv-amount ${e.type === 'commission' ? '' : e.amount >= 0 ? 'pos' : 'neg'}`}>{e.amount >= 0 ? '+' : '−'} {fcfa(Math.abs(e.amount))}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
