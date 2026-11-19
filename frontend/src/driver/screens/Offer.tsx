import { useEffect, useRef, useState } from 'react';
import { IconCar, IconClock, IconPin, IconWallet } from '../../icons';
import type { DriverApp } from '../useDriver';
import type { ActiveRide } from '../types';
import { VehiculeChauffeur } from '../ui';
import { fcfa, haversine, km, methodLabel, minutes, pct, TAILLE_COLIS, TIER_LABEL, zoneAt } from '../format';

/** Bip d'alerte (WebAudio, sans fichier) à l'arrivée d'une offre. */
function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.55);
    window.setTimeout(() => { void ctx.close(); }, 800);
  } catch {
    /* audio indisponible */
  }
}

const REASONS = ['Trop loin', 'Batterie faible', 'Fin de service'];

/**
 * OFFRE DE COURSE : compte à rebours aligné sur le délai réglé en console. Sans réponse,
 * le serveur retire l'offre et met le chauffeur en pause (règle console).
 */
export function OfferSheet({ app, ride }: { app: DriverApp; ride: ActiveRide }) {
  const offer = ride.offer!;
  const total = offer.timeoutSec;
  const [left, setLeft] = useState(() => Math.min(total, Math.max(0, (Date.parse(offer.expiresAt) - Date.now()) / 1000)));
  const [declining, setDeclining] = useState(false);
  const resynced = useRef(false);
  const { refresh } = app.actions;

  useEffect(() => { beep(); }, [ride.id]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setLeft(Math.min(total, Math.max(0, (Date.parse(offer.expiresAt) - Date.now()) / 1000)));
    }, 200);
    return () => window.clearInterval(id);
  }, [offer.expiresAt, total]);
  // Filet de sécurité : si l'avis de retrait du serveur n'arrive pas, on se resynchronise.
  useEffect(() => {
    if (left > 0 || resynced.current) return;
    const t = window.setTimeout(() => { resynced.current = true; void refresh(); }, 2500);
    return () => window.clearTimeout(t);
  }, [left, refresh]);

  const toPickup = haversine(app.position, ride.origin);
  const coords = (p: { lat: number; lng: number }) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
  const fromName = ride.pickupZone?.name ?? zoneAt(ride.origin, app.driverConfig.zones)?.name ?? coords(ride.origin);
  const toName = zoneAt(ride.destination, app.driverConfig.zones)?.name ?? coords(ride.destination);
  const rate = app.finance?.commissionRate ?? app.driverConfig.commission.green;
  const net = Math.round(ride.amount * (1 - rate)) + (ride.pickupZone?.driverBonus ?? 0);
  const r = 32;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? left / total : 0;
  const urgent = left <= 4;
  const livraison = ride.serviceType === 'delivery';

  return (
    <div className="dv-offer-back">
      <div className="dv-offer" role="dialog" aria-label={livraison ? 'Nouvelle offre de livraison' : 'Nouvelle offre de course'}>
        <div className="dv-ride-grab" aria-hidden="true" />
        {/* Scène : l'appel arrive (ondes) sur le véhicule de la gamme demandée. */}
        <div className={`dv-stage on${livraison ? ' moto' : ''}`}>
          <span className="dv-onde" /><span className="dv-onde b" /><span className="dv-onde c" />
          <span className={`dv-stage-tag dv-pill ${livraison ? 'gold' : 'green'}`}>{livraison ? 'Livraison' : 'Course'} · {km(toPickup)} de vous</span>
          <VehiculeChauffeur category={livraison ? 'moto' : ride.category} largeur={150} />
        </div>
        <div className="row between">
          <div>
            <div className="eyebrow">{livraison ? `Nouvelle livraison moto · ${TAILLE_COLIS[ride.category] ?? ride.category}` : `Nouvelle course · ${TIER_LABEL[ride.category] ?? ride.category}`}</div>
            <div className="dv-price">{fcfa(ride.amount)}</div>
            <div className="muted" style={{ fontSize: 13 }}>≈ {fcfa(net)} nets pour vous · commission {pct(rate)}</div>
          </div>
          <div className="dv-ring" aria-label={`${Math.ceil(left)} secondes restantes`}>
            <svg width="74" height="74" viewBox="0 0 74 74">
              <circle cx="37" cy="37" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
              <circle cx="37" cy="37" r={r} fill="none" stroke={urgent ? 'var(--danger)' : 'var(--green)'} strokeWidth="7" strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} style={{ transition: 'stroke-dashoffset 0.2s linear' }} />
            </svg>
            <span className="dv-ring-n" style={{ color: urgent ? 'var(--danger)' : undefined }}>{Math.ceil(left)}</span>
          </div>
        </div>

        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <span className={`dv-pill ${ride.paymentMethod === 'cash' ? 'gold' : 'green'}`}><IconWallet size={13} /> {methodLabel(ride.paymentMethod)}</span>
          <span className="dv-pill"><IconPin size={13} /> {livraison ? 'Retrait du colis' : 'Prise en charge'} à {km(toPickup)}</span>
          <span className="dv-pill"><IconCar size={13} /> {km(ride.distanceMeters)}</span>
          <span className="dv-pill"><IconClock size={13} /> {minutes(ride.etaSeconds)}</span>
          {ride.pickupZone && ride.pickupZone.driverBonus > 0 && <span className="dv-pill green">Bonus {ride.pickupZone.name} +{fcfa(ride.pickupZone.driverBonus)}</span>}
        </div>

        <div className="dv-route card" style={{ padding: '12px 14px 12px 36px' }}>
          <div><strong>{livraison ? 'Retrait' : 'Départ'}</strong> <span className="muted">· {fromName}</span></div>
          <div><strong>{livraison ? 'Livraison' : 'Arrivée'}</strong> <span className="muted">· {toName}</span></div>
        </div>
        <div className="faint" style={{ fontSize: 12.5 }}>
          {livraison ? 'Expéditeur' : 'Client'} : {ride.client.name ?? (livraison ? 'Client ORION' : 'Passager ORION')}{ride.client.rides > 0 ? ` · ${ride.client.rides} course${ride.client.rides > 1 ? 's' : ''} ORION` : ''} · Prix fixe garanti, embouteillages inclus.
        </div>

        {declining ? (
          <div className="col" style={{ gap: 8 }}>
            <div className="muted" style={{ fontSize: 13 }}>Pourquoi refusez-vous ? (aide ORION à mieux vous proposer)</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {REASONS.map((reason) => (
                <button key={reason} className="dv-pill" onClick={() => void app.actions.decline(ride.id, reason)} disabled={app.busy}>{reason}</button>
              ))}
              <button className="dv-pill" onClick={() => void app.actions.decline(ride.id)} disabled={app.busy}>Autre</button>
            </div>
            <button className="btn btn-ghost" onClick={() => setDeclining(false)}>Retour à l’offre</button>
          </div>
        ) : (
          <div className="dv-grid2" style={{ gridTemplateColumns: '1fr 2fr' }}>
            <button className="btn btn-ghost" onClick={() => setDeclining(true)} disabled={app.busy || left <= 0}>Refuser</button>
            <button className="btn btn-primary" onClick={() => void app.actions.accept(ride.id)} disabled={app.busy || left <= 0}>
              {left <= 0 ? 'Offre expirée' : 'Accepter'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
