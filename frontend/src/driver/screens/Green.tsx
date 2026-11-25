import { Objet } from '../../components/Vehicules';
import { useEffect, useState } from 'react';
import { IconBolt, IconCheck } from '../../icons';
import type { ScreenProps } from '../Driver';
import type { RideHistory, Training, TrainingResult } from '../types';
import { Banner, BellButton, PageHeader, Progress, Section, Stat } from '../ui';
import { fcfa, inOffPeak, pct } from '../format';
import { tr } from '../i18n';

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
  const soc = driver.batteryPct ?? 80;
  const soh = driver.batteryHealthPct ?? 100;
  const [history, setHistory] = useState<RideHistory | null>(null);
  const [training, setTraining] = useState<Training | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<TrainingResult | null>(null);
  const [videoOk, setVideoOk] = useState(true);

  useEffect(() => { void app.backend.history().then(setHistory).catch(() => undefined); }, [app.backend, app.settled]);

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
      app.showToast(tr('Module de formation indisponible'), 'danger');
    }
  };
  const submit = async () => {
    try {
      const r = await app.backend.submitTraining(answers);
      setResult(r);
      if (r.passed) { app.showToast(tr('Formation validée : vous êtes certifié éco-conduite'), 'success'); void app.actions.refresh(); }
    } catch (e) {
      app.showToast(e instanceof Error ? e.message : tr('Erreur'), 'danger');
    }
  };

  return (
    <div className="dv-page">
      <PageHeader title={tr('Mobilité verte')} sub={tr('Batterie, recharge, fidélité et éco-conduite')} right={<BellButton count={unread} onClick={openNotices} />} />

      <Section title={tr('Ma batterie')}>
        <div className="dv-stats three">
          <Stat accent label={tr('Charge')} value={`${soc} %`} sub={electric ? tr('SoC') : tr('Hybride')} />
          <Stat label={tr('Autonomie')} value={`${rangeKm} km`} sub={tr('{0} kWh', [capacity])} />
          <Stat label={tr('Santé')} value={`${soh} %`} sub={tr('SoH')} />
        </div>
        {/* Véhicule d'ORION : la batterie est relevée par la télématique du véhicule et
            suivie par ORION. Le chauffeur n'a rien à saisir. */}
        <div className="card" style={{ padding: 14 }}>
          <div className="faint" style={{ fontSize: 12.5 }}>
            {tr('Relevé transmis par votre véhicule ORION. La recharge et l’entretien sont pris en charge par ORION.')}
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            {tr('Le dispatch ne vous propose que des courses que votre batterie peut couvrir (environ {0} km avec la charge actuelle, réserve de 10 % incluse).', [maxTripKm])}
          </div>
        </div>
        {electric && soc < 25 && <Banner tone="warn" icon={<IconBolt size={18} />} title={tr('Batterie faible')}>{tr('Rechargez pour recevoir à nouveau des courses longues.')}</Banner>}
      </Section>

      <Section title={tr('Recharge en heures creuses')}>
        <Banner tone={offPeakNow ? 'success' : 'info'} icon={<IconBolt size={18} />}
          title={offPeakNow ? tr('C’est le moment de recharger') : tr('Heures creuses : {0} h → {1} h', [cfg.offPeak.start, cfg.offPeak.end])}>
          {cfg.offPeak.bonus > 0 ? tr('Bonus de {0} versé pour une recharge en heures creuses.', [fcfa(cfg.offPeak.bonus)]) : tr('Recharger la nuit soulage le réseau électrique.')}
        </Banner>
      </Section>

      <Section title={tr('Fidélité électrique')}>
        <div className="card" style={{ padding: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong>{tr(eRides > 1 ? '{0} courses électriques' : '{0} course électrique', [eRides.toLocaleString('fr-FR')])}</strong>
            <span className="muted">{tr('objectif {0}', [threshold.toLocaleString('fr-FR')])}</span>
          </div>
          <Progress value={eRides} max={threshold} tone={eRides >= threshold ? 'gold' : 'green'} />
          <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            {driver.commissionOverride !== undefined
              ? tr('Commission personnalisée ORION : {0}.', [pct(driver.commissionOverride)])
              : eRides >= threshold
                ? tr('Palier atteint : commission fidélité {0}', [pct(cfg.commission.loyalty)])
                : tr('Encore {0} courses pour passer à {1} (vert actuel : {2}, thermique : {3}).', [(threshold - eRides).toLocaleString('fr-FR'), pct(cfg.commission.loyalty), pct(cfg.commission.green), pct(cfg.commission.standard)])}
          </div>
        </div>
        <div className="dv-stats">
          <Stat accent label={tr('CO₂ évité')} value={`${co2.toLocaleString('fr-FR')} kg`} sub={tr('sur vos dernières courses')} />
          <Stat label={tr('Km électriques')} value={`${Math.round(paidKm).toLocaleString('fr-FR')} km`} sub={electric ? tr('100 % électrique') : tr('Hybride')} />
        </div>
      </Section>

      <Section title={tr('Formation éco-conduite')}>
        {driver.trained ? (
          <Banner tone="success" icon={<IconCheck size={18} />} title={tr('Certifié standards ORION & éco-conduite')}>{tr('Merci de faire rouler Abidjan plus propre.')}</Banner>
        ) : !training ? (
          <div className="card" style={{ padding: 14 }}>
            <div className="row" style={{ gap: 10 }}>
              <div className="dv-item-ico"><Objet nom="eco" taille={34} /></div>
              <div className="grow muted" style={{ fontSize: 13.5 }}>{tr('Regardez la vidéo des standards ORION puis répondez au QCM (3 bonnes réponses sur 4).')}</div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => void startTraining()}>{tr('Commencer')}</button>
          </div>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            <div className="card" style={{ padding: 14 }}>
              <strong>{training.title}</strong>
              {training.videoUrl && videoOk
                ? <video src={training.videoUrl} controls preload="metadata" onError={() => setVideoOk(false)} style={{ width: '100%', borderRadius: 12, marginTop: 10, background: '#000' }} />
                : <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>{tr('Vidéo disponible en agence ORION.')}</div>}
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
            {result && !result.passed && <Banner tone="warn" title={tr('Score : {0}/{1}', [result.score, result.total])}>{tr('Il faut au moins {0} bonnes réponses. Réessayez', [training.passScore])}</Banner>}
            <button className="btn btn-primary" disabled={answers.some((a) => a < 0)} onClick={() => void submit()}>{tr('Valider mes réponses')}</button>
          </div>
        )}
      </Section>
    </div>
  );
}
