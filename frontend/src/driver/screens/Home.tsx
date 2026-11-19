import { useEffect, useMemo, useState } from 'react';
import { OrionMap } from '../../components/OrionMap';
import { IconBolt, IconBriefcase, IconCalendar, IconCar, IconClock, IconLeaf, IconPin, IconShield, IconWallet } from '../../icons';
import type { ScreenProps } from '../Driver';
import type { DemandCell, QueueInfo, RideHistory } from '../types';
import { BellButton, Banner, PageHeader, Section, Stat, VehiculeChauffeur, type Tab } from '../ui';
import { fcfa, inOffPeak, meetsStandard, pct, TIER_LABEL, zoneAt } from '../format';
import { Alerts } from './Alerts';

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

  const disabledReason = closed ? 'ORION est fermé (maintenance)'
    : driver.kycStatus === 'suspended' ? 'Compte suspendu'
      : !validated ? 'Dossier en attente de validation' : null;

  const toggle = () => {
    if (onTrip) return;
    if (online) void app.actions.goOffline();
    else void app.actions.goOnline();
  };

  return (
    <div className="dv-page">
      <PageHeader
        title={`Bonjour ${driver.name.split(' ')[0]} 👋`}
        sub={`${driver.matricule} · Gamme ${TIER_LABEL[driver.category] ?? driver.category}${driver.vip ? ' · ⭐ Top Driver' : ''}`}
        right={<>
          <LinkPill app={app} />
          <BellButton count={unread} onClick={openNotices} />
          <button className="dv-hero-photo" onClick={() => onTab('profile')} aria-label="Mon profil">
            {photo ? <img src={photo} alt="" /> : driver.name.charAt(0).toUpperCase()}
          </button>
        </>}
      >
        <div className="dv-hero-kpis">
          <div className="dv-hero-kpi"><strong>{fcfa(history?.today.net ?? 0)}</strong><span>Gains du jour</span></div>
          <div className="dv-hero-kpi"><strong>★ {driver.ratingCount ? driver.ratingAvg.toFixed(2) : '—'}</strong><span>{driver.ratingCount} avis</span></div>
          <div className="dv-hero-kpi"><strong>{acceptance === null ? '—' : pct(acceptance)}</strong><span>Acceptation</span></div>
        </div>
      </PageHeader>

      {/* Le véhicule du chauffeur sur sa scène, et l'interrupteur de service. */}
      <div className="dv-go-card">
        <div className={`dv-stage${driver.category === 'moto' ? ' moto' : ''}${online || onTrip ? ' on' : ' off'}`}>
          {online && <><span className="dv-onde" /><span className="dv-onde b" /><span className="dv-onde c" /></>}
          <span className="dv-stage-tag dv-pill">{driver.vehicleModel ?? (driver.category === 'moto' ? 'Scooter électrique' : `Gamme ${TIER_LABEL[driver.category] ?? driver.category}`)}{driver.vehiclePlate ? ` · ${driver.vehiclePlate}` : ''}</span>
          <VehiculeChauffeur category={driver.category} largeur={180} />
        </div>
        <div className="dv-go-row">
          <span className="grow">
            <span className="dv-go-titre">{onTrip ? 'En course' : online ? 'En ligne' : paused ? 'En pause' : 'Hors ligne'}</span>
            <span className="dv-go-detail">
              {onTrip ? 'Mission en cours'
                : online ? (queue?.inQueue && queue.position ? `Recherche de courses · ${queue.position}ᵉ sur ${queue.total} en file` : 'Recherche de courses autour de vous…')
                  : disabledReason ?? (paused ? 'Touchez pour reprendre les courses' : 'Touchez pour recevoir des courses')}
            </span>
          </span>
          <button className={`dv-switch${online ? ' on' : paused ? ' paused' : ''}`} role="switch" aria-checked={online} aria-label="En ligne"
            onClick={toggle} disabled={onTrip || app.busy || (!online && disabledReason !== null)} />
        </div>
      </div>

      <Alerts app={app} onFixDossier={() => onTab('profile')} />

      <div className="dv-quick">
        <button className="feature-card" onClick={() => onTab('rides')}>
          <i><IconCalendar size={19} /></i><span>Locations</span>
          {locations > 0 && <span className="dv-quick-n">{locations}</span>}
        </button>
        <button className="feature-card" onClick={() => onTab('poste')}><i><IconBriefcase size={19} /></i><span>Mon poste</span></button>
        <button className="feature-card" onClick={() => onTab('earnings')}><i><IconWallet size={19} /></i><span>Gains</span></button>
        <button className="feature-card" onClick={() => onTab('green')}><i><IconLeaf size={19} /></i><span>Éco</span></button>
        <button className="feature-card danger" onClick={() => setConfirmSos(true)}><i><IconShield size={19} /></i><span>SOS</span></button>
      </div>

      <div className="dv-home-map">
        <OrionMap origin={position} car={position} traffic={false} />
        <div className="dv-map-chip">
          <span className="dv-link"><IconPin size={13} /> {zone ? zone.name : 'Hors secteur tarifé'} · {app.gps === 'real' ? 'GPS' : 'GPS simulé'}</span>
        </div>
      </div>

      {lockedZone && <Banner tone="info" icon={<IconPin size={18} />} title={`Cantonné au secteur ${lockedZone.name}`}>Décision ORION : vous ne recevez que des courses de ce secteur.</Banner>}
      {zone && (zone.driverBonus > 0 || zone.minStandard || zone.surgeManual) && (
        <div className="card dv-item">
          <div className="dv-item-ico"><IconPin size={20} /></div>
          <div className="grow">
            <div className="dv-item-title">Secteur {zone.name}</div>
            <div className="dv-item-sub">
              {zone.driverBonus > 0 && `Bonus +${fcfa(zone.driverBonus)} par prise en charge`}
              {zone.minStandard && ` · Gamme ${TIER_LABEL[zone.minStandard]} minimum`}
              {zone.waitMaxMin && ` · Attente garantie ${zone.waitMaxMin} min`}
            </div>
          </div>
          {zone.minStandard && !meetsStandard(driver.category, zone.minStandard)
            ? <span className="dv-pill danger">Non éligible</span>
            : zone.surgeManual ? <span className="dv-pill gold">×{zone.surgeManual}</span> : <span className="dv-pill green">Éligible</span>}
        </div>
      )}

      <div className="dv-stats">
        <Stat label="Solde portefeuille" value={fcfa(finance?.balance ?? 0)} sub={finance && finance.cashDebt > 0 ? `Dette espèces ${fcfa(finance.cashDebt)}` : `Commission ${pct(finance?.commissionRate ?? driverConfig.commission.green)}`} />
        <Stat label="Courses du jour" value={history?.today.rides ?? 0} sub={`Note minimale ${driverConfig.quality.minRating} ★`} />
      </div>

      {offPeak && driverConfig.offPeak.bonus > 0 && (
        <Banner tone="success" icon={<IconLeaf size={18} />} title={`Heures creuses : +${fcfa(driverConfig.offPeak.bonus)} à la recharge`}>
          Rechargez entre {driverConfig.offPeak.start} h et {driverConfig.offPeak.end} h pour soulager le réseau et toucher le bonus.
        </Banner>
      )}
      {driver.engine !== 'hybrid' && driver.batteryPct !== undefined && driver.batteryPct < 25 && (
        <Banner tone="warn" icon={<IconBolt size={18} />} title={`Batterie faible : ${driver.batteryPct} %`}>Les longues courses ne vous seront pas proposées. Pensez à recharger.</Banner>
      )}

      <Section title="Zones à forte demande" right={<span className="faint" style={{ fontSize: 12 }}>10 dernières min</span>}>
        <Heatmap cells={cells} me={position} />
        {cells.length === 0 && <div className="faint" style={{ fontSize: 13 }}>Demande calme pour le moment.</div>}
      </Section>

      <Section title="Règles du moment (console ORION)">
        <div className="card" style={{ padding: 14, display: 'grid', gap: 8, fontSize: 13.5 }}>
          <Rule icon={<IconClock size={16} />} label="Délai pour accepter une offre" value={`${driverConfig.offer.timeoutSec} s`} />
          <Rule icon={<IconLeaf size={16} />} label="Commission flotte électrique" value={pct(driverConfig.commission.green)} />
          <Rule icon={<IconCar size={16} />} label="Commission standard" value={pct(driverConfig.commission.standard)} />
          <Rule icon={<IconClock size={16} />} label="Attente offerte puis facturée" value={`${driverConfig.wait.freeMinutes} min · ${fcfa(driverConfig.wait.feePerMin)}/min`} />
          <Rule icon={<IconShield size={16} />} label="Plafond dette espèces" value={fcfa(driverConfig.cashDebtLimit)} />
        </div>
      </Section>

      <button className="btn btn-danger" onClick={() => setConfirmSos(true)}>🚨 Urgence — alerter ORION et le SAMU</button>
      {confirmSos && (
        <Banner tone="danger" title="Confirmer l’alerte SOS ?" action={
          <div className="col" style={{ gap: 6 }}>
            <button className="dv-pill danger" onClick={() => { setConfirmSos(false); void app.actions.sos('Alerte depuis l’accueil chauffeur'); }}>Envoyer</button>
            <button className="dv-pill" onClick={() => setConfirmSos(false)}>Annuler</button>
          </div>
        }>Votre position part à la supervision ORION ; vous suivrez en direct la prise en charge.</Banner>
      )}
    </div>
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
  if (!app.live) return <span className="dv-link connecting"><i />Démo</span>;
  const label = app.link === 'online' ? 'Synchro' : app.link === 'connecting' ? 'Connexion…' : 'Hors ligne';
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
      <svg viewBox="0 0 400 210" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Zones à forte demande">
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
