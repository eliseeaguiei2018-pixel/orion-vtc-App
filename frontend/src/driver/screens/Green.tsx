import { useEffect, useState } from 'react';
import { IconBolt, IconCheck, IconLeaf } from '../../icons';
import type { ScreenProps } from '../Driver';
import type { RideHistory, Training, TrainingResult } from '../types';
import { Banner, BellButton, PageHeader, Progress, Section, Stat } from '../ui';
import { fcfa, inOffPeak, pct } from '../format';

/** Consommation moyenne d'une citadine électrique en ville (km par kWh). */
const KM_PER_KWH = 6;
/** CO₂ évité par km électrique vs thermique (≈ 150 g − 20 g), comme côté passager. */
const CO2_KG_PER_KM = 0.13;

/**
 * MOBILITÉ VERTE : batterie (SoC / SoH) transmise au dispatch, autonomie, recharge en
 * heures creuses (bonus console), fidélité électrique (commission réduite), CO₂ évité,
 * formation éco-conduite (vidéo + QCM validé côté serveur).
 */
export function Green({ app, unread, openNotices }: ScreenProps) {
  const driver = app.driver!;
  const cfg = app.driverConfig;
  const electric = (driver.engine ?? 'electric') === 'electric';
  const [soc, setSoc] = useState(driver.batteryPct ?? 80);
  const [soh, setSoh] = useState(driver.batteryHealthPct ?? 100);
  const [history, setHistory] = useState<RideHistory | null>(null);
  const [training, setTraining] = useState<Training | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<TrainingResult | null>(null);
  const [videoOk, setVideoOk] = useState(true);

  useEffect(() => { void app.backend.history().then(setHistory).catch(() => undefined); }, [app.backend, app.settled]);
  useEffect(() => { setSoc(driver.batteryPct ?? 80); setSoh(driver.batteryHealthPct ?? 100); }, [driver.batteryPct, driver.batteryHealthPct]);

  const capacity = driver.batteryKwh ?? 50;
  const rangeKm = Math.round((soc / 100) * capacity * (soh / 100) * KM_PER_KWH);
  // Le dispatch exclut les courses dont la distance dépasse l'autonomie (≈ 1 %/km + 10 % de réserve).
  const maxTripKm = Math.max(0, soc - 10);
  const offPeakNow = inOffPeak(cfg);
  const threshold = cfg.commission.loyaltyRideThreshold;
  const eRides = driver.electricRides ?? 0;
  const paidKm = (history?.rides ?? []).filter((r) => r.paidAmount !== null).reduce((s, r) => s + r.distanceMeters / 1000, 0);
  const co2 = electric ? Math.round(paidKm * CO2_KG_PER_KM * 10) / 10 : 0;

  const startTraining = async () => {
    try {
      const t = await app.backend.training();
      setTraining(t);
      setAnswers(new Array(t.questions.length).fill(-1));
      setResult(null);
    } catch {
      app.showToast('Module de formation indisponible', 'danger');
    }
  };
  const submit = async () => {
    try {
      const r = await app.backend.submitTraining(answers);
      setResult(r);
      if (r.passed) { app.showToast('Formation validée : vous êtes certifié éco-conduite 🌿', 'success'); void app.actions.refresh(); }
    } catch (e) {
      app.showToast(e instanceof Error ? e.message : 'Erreur', 'danger');
    }
  };

  return (
    <div className="dv-page">
      <PageHeader title="Mobilité verte" sub="Batterie, recharge, fidélité et éco-conduite" right={<BellButton count={unread} onClick={openNotices} />} />

      <Section title="Ma batterie">
        <div className="dv-stats three">
          <Stat accent label="Charge" value={`${soc} %`} sub={electric ? 'SoC' : 'Hybride'} />
          <Stat label="Autonomie" value={`${rangeKm} km`} sub={`${capacity} kWh`} />
          <Stat label="Santé" value={`${soh} %`} sub="SoH" />
        </div>
        <div className="card" style={{ padding: 14 }}>
          <label className="dv-label">Niveau de charge : {soc} %
            <input className="dv-range" type="range" min={0} max={100} value={soc} onChange={(e) => setSoc(Number(e.target.value))} />
          </label>
          <label className="dv-label" style={{ marginTop: 8 }}>Santé de la batterie : {soh} %
            <input className="dv-range" type="range" min={50} max={100} value={soh} onChange={(e) => setSoh(Number(e.target.value))} />
          </label>
          <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={app.busy}
            onClick={() => void app.actions.telemetry({ batteryPct: soc, batteryHealthPct: soh })}>Transmettre à ORION</button>
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            Le dispatch ne vous propose que des courses que votre batterie peut couvrir (environ {maxTripKm} km avec la charge actuelle, réserve de 10 % incluse).
          </div>
        </div>
        {electric && soc < 25 && <Banner tone="warn" icon={<IconBolt size={18} />} title="Batterie faible">Rechargez pour recevoir à nouveau des courses longues.</Banner>}
      </Section>

      <Section title="Recharge en heures creuses">
        <Banner tone={offPeakNow ? 'success' : 'info'} icon={<IconBolt size={18} />}
          title={offPeakNow ? 'C’est le moment de recharger !' : `Heures creuses : ${cfg.offPeak.start} h → ${cfg.offPeak.end} h`}>
          {cfg.offPeak.bonus > 0 ? `Bonus de ${fcfa(cfg.offPeak.bonus)} versé pour une recharge en heures creuses.` : 'Recharger la nuit soulage le réseau électrique.'}
        </Banner>
      </Section>

      <Section title="Fidélité électrique">
        <div className="card" style={{ padding: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong>{eRides.toLocaleString('fr-FR')} course{eRides > 1 ? 's' : ''} électrique{eRides > 1 ? 's' : ''}</strong>
            <span className="muted">objectif {threshold.toLocaleString('fr-FR')}</span>
          </div>
          <Progress value={eRides} max={threshold} tone={eRides >= threshold ? 'gold' : 'green'} />
          <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            {driver.commissionOverride !== undefined
              ? `Commission personnalisée ORION : ${pct(driver.commissionOverride)}.`
              : eRides >= threshold
                ? `Palier atteint : commission fidélité ${pct(cfg.commission.loyalty)} 🎉`
                : `Encore ${(threshold - eRides).toLocaleString('fr-FR')} courses pour passer à ${pct(cfg.commission.loyalty)} (vert actuel : ${pct(cfg.commission.green)}, thermique : ${pct(cfg.commission.standard)}).`}
          </div>
        </div>
        <div className="dv-stats">
          <Stat accent label="CO₂ évité" value={`${co2.toLocaleString('fr-FR')} kg`} sub="sur vos dernières courses" />
          <Stat label="Km électriques" value={`${Math.round(paidKm).toLocaleString('fr-FR')} km`} sub={electric ? '100 % électrique' : 'Hybride'} />
        </div>
      </Section>

      <Section title="Formation éco-conduite">
        {driver.trained ? (
          <Banner tone="success" icon={<IconCheck size={18} />} title="Certifié standards ORION & éco-conduite">Merci de faire rouler Abidjan plus propre.</Banner>
        ) : !training ? (
          <div className="card" style={{ padding: 14 }}>
            <div className="row" style={{ gap: 10 }}>
              <div className="dv-item-ico"><IconLeaf size={20} /></div>
              <div className="grow muted" style={{ fontSize: 13.5 }}>Regardez la vidéo des standards ORION puis répondez au QCM (3 bonnes réponses sur 4).</div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => void startTraining()}>Commencer</button>
          </div>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            <div className="card" style={{ padding: 14 }}>
              <strong>{training.title}</strong>
              {training.videoUrl && videoOk
                ? <video src={training.videoUrl} controls preload="metadata" onError={() => setVideoOk(false)} style={{ width: '100%', borderRadius: 12, marginTop: 10, background: '#000' }} />
                : <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Vidéo disponible en agence ORION.</div>}
            </div>
            {training.questions.map((q, qi) => (
              <div key={qi} className="col" style={{ gap: 6 }}>
                <strong style={{ fontSize: 14 }}>{qi + 1}. {q.q}</strong>
                {q.options.map((o, oi) => (
                  <button key={oi} className={`dv-qcm-opt${answers[qi] === oi ? ' on' : ''}`}
                    onClick={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}>{o}</button>
                ))}
              </div>
            ))}
            {result && !result.passed && <Banner tone="warn" title={`Score : ${result.score}/${result.total}`}>Il faut au moins {training.passScore} bonnes réponses. Réessayez !</Banner>}
            <button className="btn btn-primary" disabled={answers.some((a) => a < 0)} onClick={() => void submit()}>Valider mes réponses</button>
          </div>
        )}
      </Section>
    </div>
  );
}
