import { useEffect, useState } from 'react';
import { IconCar, IconLeaf, IconWallet } from '../../icons';
import type { ScreenProps } from '../Driver';
import type { LedgerEntry, RideHistory, Wallet } from '../types';
import { Banner, BellButton, PageHeader, Progress, Section, Stat } from '../ui';
import { dateTime, fcfa, methodLabel, pct } from '../format';

const LEDGER_LABEL: Record<LedgerEntry['type'], string> = {
  ride_earning: 'Gain de course (net)', commission: 'Commission ORION', payout: 'Retrait', adjustment: 'Bonus / ajustement',
  insurance_refund: 'Remboursement assurance', cash_collected: 'Espèces encaissées',
};
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
      <PageHeader title="Mes gains" sub="Portefeuille ORION en F CFA" right={<BellButton count={unread} onClick={openNotices} />} />

      <div className="card dv-stat accent" style={{ padding: 18 }}>
        <span className="dv-stat-label">Solde disponible</span>
        <span className="dv-stat-value" style={{ fontSize: 30, color: balance < 0 ? 'var(--danger)' : undefined }}>{fcfa(balance)}</span>
        <span className="dv-stat-sub">Commission appliquée : <strong>{pct(rate)}</strong>{rate < driverConfig.commission.standard ? ` (au lieu de ${pct(driverConfig.commission.standard)} en thermique)` : ''}</span>
      </div>

      {finance && finance.cashDebt > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong>Dette espèces</strong>
            <span className={`dv-amount ${finance.cashBlocked ? 'neg' : ''}`}>{fcfa(finance.cashDebt)} / {fcfa(finance.cashDebtLimit)}</span>
          </div>
          <Progress value={finance.cashDebt} max={finance.cashDebtLimit} tone={finance.cashBlocked ? 'danger' : finance.cashDebt > finance.cashDebtLimit * 0.7 ? 'gold' : 'green'} />
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            Commissions dues sur les courses payées en espèces. Au-delà du plafond fixé par ORION, vous ne recevez plus de courses espèces ; elle se rembourse automatiquement avec vos gains mobile money.
          </div>
        </div>
      )}

      <Section title="Aujourd’hui">
        <div className="dv-stats">
          <Stat accent label="Gains nets" value={fcfa(history?.today.net ?? 0)} sub={`${history?.today.rides ?? 0} course(s)`} />
          <Stat label="Chiffre brut" value={fcfa(history?.today.gross ?? 0)} sub={`Commission ${fcfa(history?.today.commission ?? 0)}`} />
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong>Objectif du jour</strong>
            <span className="muted">{fcfa(history?.today.net ?? 0)} / {fcfa(goal)}</span>
          </div>
          <Progress value={history?.today.net ?? 0} max={goal} tone={(history?.today.net ?? 0) >= goal ? 'gold' : 'green'} />
          <div className="dv-seg" style={{ marginTop: 10 }}>
            {[15_000, 25_000, 40_000, 60_000].map((g) => <button key={g} className={goal === g ? 'on' : ''} onClick={() => saveGoal(g)}>{g / 1000} k</button>)}
          </div>
        </div>
      </Section>

      <Section title="7 derniers jours">
        <div className="dv-stats three">
          <Stat label="Courses" value={history?.week.rides ?? 0} />
          <Stat label="Nets" value={fcfa(history?.week.net ?? 0)} />
          <Stat label="Espèces" value={fcfa(history?.week.cashCollected ?? 0)} />
        </div>
        {saved > 0 && (
          <Banner tone="success" icon={<IconLeaf size={18} />} title={`${fcfa(saved)} économisés grâce à l’électrique`}>
            Commission verte de {pct(rate)} au lieu de {pct(driverConfig.commission.standard)} sur vos courses de la semaine.
          </Banner>
        )}
      </Section>

      <Section title="Retirer mes gains">
        {finance?.frozen ? (
          <Banner tone="danger" icon={<IconWallet size={18} />} title="Retraits bloqués">Portefeuille gelé le temps d’un litige.</Banner>
        ) : (
          <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void app.actions.payout(value, method).then((ok) => { if (ok) { setAmount(''); load(); } }); }}>
            <div className="dv-grid2">
              <label className="dv-label">Montant (F)
                <input className="dv-input" type="number" inputMode="numeric" min={0} max={Math.max(0, balance)} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(Math.max(0, balance))} />
              </label>
              <label className="dv-label">Vers
                <select className="dv-select" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {methods.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
                </select>
              </label>
            </div>
            {methods.length === 0 && <div className="faint" style={{ fontSize: 12 }}>Aucune passerelle mobile money active pour le moment (console ORION).</div>}
            <button className="btn btn-primary" disabled={!canPayout || app.busy}>Demander le virement</button>
          </form>
        )}
      </Section>

      <Section title="Mouvements du portefeuille">
        {!wallet?.history.length && <div className="dv-empty">Aucun mouvement pour l’instant.</div>}
        <div className="col" style={{ gap: 8 }}>
          {wallet?.history.slice(0, 40).map((e) => (
            <div key={e.id} className="card dv-item">
              <div className="dv-item-ico">{e.type === 'ride_earning' ? <IconCar size={18} /> : <IconWallet size={18} />}</div>
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
