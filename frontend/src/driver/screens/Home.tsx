import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { OrionMap } from '../../components/OrionMap';
import { IconBolt, IconCar, IconClock, IconLeaf, IconPin, IconShield } from '../../icons';
import { Objet, type Icone3D, type ObjetService } from '../../components/Vehicules';
import type { ScreenProps } from '../Driver';
import type { DemandCell, QueueInfo, RideHistory } from '../types';
import { BellButton, Banner, PageHeader, Section, Stat, VehiculeChauffeur, type Tab } from '../ui';
import { fcfa, inOffPeak, meetsStandard, pct, TIER_LABEL, zoneAt } from '../format';
import { Alerts } from './Alerts';
import { tr } from '../i18n';

/**
 * ACCUEIL : mise en ligne / hors ligne / pause, position GPS, secteur courant (bonus,
 * standard minimal), file d'attente, gains du jour et zones à forte demande.
 */
export function Home({ app, unread, openNotices, onTab }: ScreenProps & { onTab: (t: Tab) => void }) {
  const { driverConfig, appConfig, position, finance } = app;
  // Le shell n'affiche les onglets qu'une fois la fiche chargée.
  const driver = app.driver!;
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [history, setHistory] = useState<RideHistory | null>(null);
  const [cells, setCells] = useState<DemandCell[]>([]);
  const [confirmSos, setConfirmSos] = useState(false);

  const online = driver.availability === 'online';
  const paused = driver.availability === 'paused';
  const onTrip = driver.availability === 'on_trip';
  const validated = driver.kycStatus === 'approved' || driver.kycStatus === 'active';
  const closed = appConfig ? !appConfig.open : false;
  const zone = useMemo(() => zoneAt(position, driverConfig.zones), [position, driverConfig.zones]);
  const lockedZone = driver.zoneLockId ? driverConfig.zones.find((z) => z.id === driver.zoneLockId) : null;
  const acceptance = (driver.offersReceived ?? 0) > 0 ? (driver.offersAccepted ?? 0) / (driver.offersReceived ?? 1) : null;
  const offPeak = inOffPeak(driverConfig);
  const photo = app.backend.photoSrc(driver);
  const locations = app.rentals.filter((r) => r.status === 'confirmee' || r.status === 'reservee' || r.status === 'en_cours').length;

  // Gains du jour (rafraîchis à chaque paiement reçu).
  useEffect(() => { void app.backend.history().then(setHistory).catch(() => undefined); }, [app.backend, app.settled, driver.availability]);
  // File d'attente FIFO (zones denses) tant que le chauffeur est en ligne.
  useEffect(() => {
    if (!online) { setQueue(null); return; }
    const load = () => { void app.backend.queue().then(setQueue); };
    load();
    const id = window.setInterval(load, 20_000);
    return () => window.clearInterval(id);
  }, [online, app.backend]);
  // Zones à forte demande (rafraîchies chaque minute).
  useEffect(() => {
    const load = () => { void app.backend.demand().then(setCells); };
    load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
  }, [app.backend]);

  const disabledReason = closed ? tr('ORION est fermé (maintenance)')
    : driver.kycStatus === 'suspended' ? tr('Compte suspendu')
      : !validated ? tr('Dossier en attente de validation') : null;

  const toggle = () => {
    if (onTrip) return;
    if (online) void app.actions.goOffline();
    else void app.actions.goOnline();
  };

  return (
    <div className="dv-page">
      <PageHeader
        title={tr('Bonjour {0}', [driver.name.split(' ')[0]])}
        sub={tr('{0} · Gamme {1}{2}', [driver.matricule, TIER_LABEL[driver.category] ?? driver.category, driver.vip ? tr(' · Top Driver') : ''])}
        right={<>
          <LinkPill app={app} />
          <BellButton count={unread} onClick={openNotices} />
          <button className="dv-hero-photo" onClick={() => onTab('profile')} aria-label={tr('Mon profil')}>
            {photo ? <img src={photo} alt="" /> : driver.name.charAt(0).toUpperCase()}
          </button>
        </>}
      >
        <div className="dv-hero-kpis">
          <div className="dv-hero-kpi"><strong>{fcfa(history?.today.net ?? 0)}</strong><span>{tr('Gains du jour')}</span></div>
          <div className="dv-hero-kpi"><strong>★ {driver.ratingCount ? driver.ratingAvg.toFixed(2) : '—'}</strong><span>{tr('{0} avis', [driver.ratingCount])}</span></div>
          <div className="dv-hero-kpi"><strong>{acceptance === null ? '—' : pct(acceptance)}</strong><span>{tr('Acceptation')}</span></div>
        </div>
      </PageHeader>

      {/* Le véhicule du chauffeur sur sa scène, et l'interrupteur de service. */}
      <div className="dv-go-card">
        <div className={`dv-stage${driver.category === 'moto' ? ' moto' : ''}${online || onTrip ? ' on' : ' off'}`}>
          {online && <><span className="dv-onde" /><span className="dv-onde b" /><span className="dv-onde c" /></>}
          <span className="dv-stage-tag dv-pill">{driver.vehicleModel ?? (driver.category === 'moto' ? tr('Scooter électrique') : tr('Gamme {0}', [TIER_LABEL[driver.category] ?? driver.category]))}{driver.vehiclePlate ? ` · ${driver.vehiclePlate}` : ''}</span>
          <VehiculeChauffeur category={driver.category} largeur={180} />
        </div>
        <div className="dv-go-row">
          <span className="grow">
            <span className="dv-go-titre">{onTrip ? tr('En course') : online ? tr('En ligne') : paused ? tr('En pause') : tr('Hors ligne')}</span>
            <span className="dv-go-detail">
              {onTrip ? tr('Mission en cours')
                : online ? (queue?.inQueue && queue.position ? tr('Recherche de courses · {0}ᵉ sur {1} en file', [queue.position, queue.total]) : tr('Recherche de courses autour de vous…'))
                  : disabledReason ?? (paused ? tr('Touchez pour reprendre les courses') : tr('Touchez pour recevoir des courses'))}
            </span>
          </span>
          <button className={`dv-switch${online ? ' on' : paused ? ' paused' : ''}`} role="switch" aria-checked={online} aria-label={tr('En ligne')}
            onClick={toggle} disabled={onTrip || app.busy || (!online && disabledReason !== null)} />
        </div>
      </div>

      <Alerts app={app} onFixDossier={() => onTab('profile')} />

      {/* Raccourcis : les mêmes tuiles que l'accueil de l'app cliente, objets en volume. */}
      <div className="tuiles cinq">
        <Raccourci objet="location" rang={0} label={tr('Locations')} n={locations} onClick={() => onTab('rides')} />
        <Raccourci objet="bureau" rang={1} label={tr('Mon poste')} onClick={() => onTab('poste')} />
        <Raccourci objet="portefeuille" rang={2} label={tr('Gains')} onClick={() => onTab('earnings')} />
        <Raccourci objet="eco" rang={3} label={tr('Éco')} onClick={() => onTab('green')} />
        <Raccourci objet="alertes-sos" rang={4} label={tr('SOS')} onClick={() => setConfirmSos(true)} />
      </div>

      <div className="dv-home-map">
        <OrionMap origin={position} car={position} traffic={false} />
        <div className="dv-map-chip">
          <span className="dv-link"><IconPin size={13} /> {zone ? zone.name : tr('Hors secteur tarifé')} · {app.gps === 'real' ? tr('GPS') : tr('GPS simulé')}</span>
        </div>
      </div>

      {lockedZone && <Banner tone="info" icon={<IconPin size={18} />} title={tr('Cantonné au secteur {0}', [lockedZone.name])}>{tr('Décision ORION : vous ne recevez que des courses de ce secteur.')}</Banner>}
      {zone && (zone.driverBonus > 0 || zone.minStandard || zone.surgeManual) && (
        <div className="card dv-item">
          <div className="dv-item-ico"><Objet nom="lieu" taille={34} /></div>
          <div className="grow">
            <div className="dv-item-title">{tr('Secteur {0}', [zone.name])}</div>
            <div className="dv-item-sub">
              {zone.driverBonus > 0 && tr('Bonus +{0} par prise en charge', [fcfa(zone.driverBonus)])}
              {zone.minStandard && tr(' · Gamme {0} minimum', [TIER_LABEL[zone.minStandard]])}
              {zone.waitMaxMin && tr(' · Attente garantie {0} min', [zone.waitMaxMin])}
            </div>
          </div>
          {zone.minStandard && !meetsStandard(driver.category, zone.minStandard)
            ? <span className="dv-pill danger">{tr('Non éligible')}</span>
            : zone.surgeManual ? <span className="dv-pill gold">×{zone.surgeManual}</span> : <span className="dv-pill green">{tr('Éligible')}</span>}
        </div>
      )}

      <div className="dv-stats">
        <Stat label={tr('Solde portefeuille')} value={fcfa(finance?.balance ?? 0)} sub={finance && finance.cashDebt > 0 ? tr('Dette espèces {0}', [fcfa(finance.cashDebt)]) : tr('Commission {0}', [pct(finance?.commissionRate ?? driverConfig.commission.green)])} />
        <Stat label={tr('Courses du jour')} value={history?.today.rides ?? 0} sub={tr('Note minimale {0} ★', [driverConfig.quality.minRating])} />
      </div>

      {offPeak && driverConfig.offPeak.bonus > 0 && (
        <Banner tone="success" icon={<IconLeaf size={18} />} title={tr('Heures creuses : +{0} à la recharge', [fcfa(driverConfig.offPeak.bonus)])}>
          {tr('Rechargez entre {0} h et {1} h pour soulager le réseau et toucher le bonus.', [driverConfig.offPeak.start, driverConfig.offPeak.end])}
        </Banner>
      )}
      {driver.engine !== 'hybrid' && driver.batteryPct !== undefined && driver.batteryPct < 25 && (
        <Banner tone="warn" icon={<IconBolt size={18} />} title={tr('Batterie faible : {0} %', [driver.batteryPct])}>{tr('Les longues courses ne vous seront pas proposées. Pensez à recharger.')}</Banner>
      )}

      <Section title={tr('Zones à forte demande')} right={<span className="faint" style={{ fontSize: 12 }}>{tr('10 dernières min')}</span>}>
        <Heatmap cells={cells} me={position} />
        {cells.length === 0 && <div className="faint" style={{ fontSize: 13 }}>{tr('Demande calme pour le moment.')}</div>}
      </Section>

      <Section title={tr('Règles du moment (console ORION)')}>
        <div className="card" style={{ padding: 14, display: 'grid', gap: 8, fontSize: 13.5 }}>
          <Rule icon={<IconClock size={16} />} label={tr('Délai pour accepter une offre')} value={`${driverConfig.offer.timeoutSec} s`} />
          <Rule icon={<IconLeaf size={16} />} label={tr('Commission flotte électrique')} value={pct(driverConfig.commission.green)} />
          <Rule icon={<IconCar size={16} />} label={tr('Commission standard')} value={pct(driverConfig.commission.standard)} />
          <Rule icon={<IconClock size={16} />} label={tr('Attente offerte puis facturée')} value={`${driverConfig.wait.freeMinutes} min · ${fcfa(driverConfig.wait.feePerMin)}/min`} />
          <Rule icon={<IconShield size={16} />} label={tr('Plafond dette espèces')} value={fcfa(driverConfig.cashDebtLimit)} />
        </div>
      </Section>

      <button className="btn btn-danger" onClick={() => setConfirmSos(true)}>{tr('Urgence — alerter ORION et le SAMU')}</button>
      {confirmSos && (
        <Banner tone="danger" title={tr('Confirmer l’alerte SOS ?')} action={
          <div className="col" style={{ gap: 6 }}>
            <button className="dv-pill danger" onClick={() => { setConfirmSos(false); void app.actions.sos('Alerte depuis l’accueil chauffeur'); }}>{tr('Envoyer')}</button>
            <button className="dv-pill" onClick={() => setConfirmSos(false)}>{tr('Annuler')}</button>
          </div>
        }>{tr('Votre position part à la supervision ORION ; vous suivrez en direct la prise en charge.')}</Banner>
      )}
    </div>
  );
}

/** Raccourci de l'accueil : objet en volume sur son carré, nom dessous, pastille de compte. */
function Raccourci({ objet, label, n = 0, rang, onClick }: { objet: ObjetService | Icone3D; label: string; n?: number; rang: number; onClick: () => void }) {
  return (
    <button className="tuile" style={{ '--i': rang } as CSSProperties} onClick={onClick}>
      <span className="tuile-fond"><Objet nom={objet} taille={64} />{n > 0 && <span className="dv-quick-n">{n}</span>}</span>
      <strong className="tuile-nom">{label}</strong>
    </button>
  );
}

function Rule({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return (
    <div className="row between">
      <span className="row muted" style={{ gap: 8 }}>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** Indicateur du lien temps réel avec ORION. */
export function LinkPill({ app }: { app: ScreenProps['app'] }) {
  if (!app.live) return <span className="dv-link connecting"><i />{tr('Démo')}</span>;
  const label = app.link === 'online' ? tr('Synchro') : app.link === 'connecting' ? tr('Connexion…') : tr('Hors ligne');
  return <span className={`dv-link ${app.link}`}><i />{label}</span>;
}

/** Carte de chaleur simplifiée : cellules de demande autour d'Abidjan + ma position. */
function Heatmap({ cells, me }: { cells: DemandCell[]; me: { lat: number; lng: number } }) {
  const pts = [...cells.map((c) => ({ lat: c.lat, lng: c.lng })), me];
  const minLat = Math.min(...pts.map((p) => p.lat)) - 0.01;
  const maxLat = Math.max(...pts.map((p) => p.lat)) + 0.01;
  const minLng = Math.min(...pts.map((p) => p.lng)) - 0.01;
  const maxLng = Math.max(...pts.map((p) => p.lng)) + 0.01;
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng || 1)) * 400;
  const y = (lat: number) => (1 - (lat - minLat) / (maxLat - minLat || 1)) * 210;
  const max = Math.max(1, ...cells.map((c) => c.demand));
  return (
    <div className="dv-heat">
      <svg viewBox="0 0 400 210" preserveAspectRatio="xMidYMid meet" role="img" aria-label={tr('Zones à forte demande')}>
        {cells.map((c) => {
          const r = 14 + (c.demand / max) * 30;
          const hot = c.surge > 1;
          return (
            <g key={c.cell}>
              <circle cx={x(c.lng)} cy={y(c.lat)} r={r} fill={hot ? 'rgba(255,77,94,0.35)' : 'rgba(245,196,81,0.3)'} />
              <circle cx={x(c.lng)} cy={y(c.lat)} r={r * 0.45} fill={hot ? 'rgba(255,77,94,0.6)' : 'rgba(245,196,81,0.55)'} />
              <text x={x(c.lng)} y={y(c.lat) + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">{hot ? `×${c.surge}` : c.demand}</text>
            </g>
          );
        })}
        <circle cx={x(me.lng)} cy={y(me.lat)} r="7" fill="var(--green)" stroke="#fff" strokeWidth="2" />
      </svg>
    </div>
  );
}
