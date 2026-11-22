import { useEffect, useRef, useState } from 'react';
import { IconCar, IconClock, IconPeage, IconPin, IconSablier, IconWallet } from '../../icons';
import type { DriverApp } from '../useDriver';
import type { ActiveRide } from '../types';
import type { PrimeMois } from '../salarie';
import { VehiculeChauffeur } from '../ui';
import { fcfa, haversine, km, methodLabel, minutes, TAILLE_COLIS, TIER_LABEL, zoneAt } from '../format';
import { aTraduire, tr } from '../i18n';

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

const REASONS = [aTraduire('Trop loin'), aTraduire('Batterie faible'), aTraduire('Fin de service')];

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
  // Le vrai quartier et la commune (serveur) ; à défaut, le secteur tarifé ou les coordonnées.
  const fromName = ride.lieux?.depart ?? ride.pickupZone?.name ?? zoneAt(ride.origin, app.driverConfig.zones)?.name ?? coords(ride.origin);
  const toName = ride.lieux?.arrivee ?? zoneAt(ride.destination, app.driverConfig.zones)?.name ?? coords(ride.destination);
  // Péage compris dans le prix : le chauffeur le règle au poste avec l'argent de la course.
  const peage = ride.itineraire?.peage ?? 0;
  // Prime du mois : combien de courses avant le prochain palier (motivation, pas un gain par course).
  const [prime, setPrime] = useState<PrimeMois | null>(null);
  useEffect(() => { void app.backend.prime().then(setPrime).catch(() => undefined); }, [app.backend, ride.id]);
  const r = 32;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? left / total : 0;
  const urgent = left <= 4;
  const livraison = ride.serviceType === 'delivery';

  return (
    <div className="dv-offer-back">
      <div className="dv-offer" role="dialog" aria-label={livraison ? tr('Nouvelle offre de livraison') : tr('Nouvelle offre de course')}>
        <div className="dv-ride-grab" aria-hidden="true" />
        {/* Scène : l'appel arrive (ondes) sur le véhicule de la gamme demandée. */}
        <div className={`dv-stage on${livraison ? ' moto' : ''}`}>
          <span className="dv-onde" /><span className="dv-onde b" /><span className="dv-onde c" />
          <span className={`dv-stage-tag dv-pill ${livraison ? 'gold' : 'green'}`}>{tr('{0} · {1} de vous', [livraison ? tr('Livraison') : tr('Course'), km(toPickup)])}</span>
          <VehiculeChauffeur category={livraison ? 'moto' : ride.category} largeur={150} />
        </div>
        <div className="row between">
          <div>
            <div className="eyebrow">{livraison ? tr('Nouvelle livraison moto · {0}', [TAILLE_COLIS[ride.category] ?? ride.category]) : tr('Nouvelle course · {0}', [TIER_LABEL[ride.category] ?? ride.category])}</div>
            <div className="dv-price">{fcfa(ride.amount)}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {ride.paymentMethod === 'cash' ? tr('Prix payé par le client, à encaisser pour ORION') : tr('Prix payé par le client à ORION')}
              {prime?.prochain ? ` · ${tr('{0} course(s) avant le palier de {1}', [prime.prochain.reste, fcfa(prime.prochain.montant)])}` : ''}
            </div>
          </div>
          <div className="dv-ring" aria-label={tr('{0} secondes restantes', [Math.ceil(left)])}>
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
          <span className="dv-pill"><IconPin size={13} /> {livraison ? tr('Retrait du colis à {0}', [km(toPickup)]) : tr('Prise en charge à {0}', [km(toPickup)])}</span>
          {ride.miseADisposition ? (
            <span className="dv-pill gold"><IconSablier size={13} /> {tr('À l’heure · {0} h', [ride.miseADisposition.heures])}</span>
          ) : (
            <>
              <span className="dv-pill"><IconCar size={13} /> {km(ride.distanceMeters)}</span>
              <span className="dv-pill"><IconClock size={13} /> {minutes(ride.etaSeconds)}</span>
            </>
          )}
          {ride.itineraire?.choix === 'peage' && <span className="dv-pill gold"><IconPeage size={13} /> {tr('Pont à péage · {0} inclus', [fcfa(peage)])}</span>}
          {ride.itineraire?.choix === 'normal' && <span className="dv-pill"><IconCar size={13} /> {tr('Voie normale (sans péage)')}</span>}
        </div>

        <div className="dv-route card" style={{ padding: '12px 14px 12px 36px' }}>
          <div><strong>{livraison ? tr('Retrait') : tr('Départ')}</strong> <span className="muted">· {fromName}</span></div>
          <div><strong>{livraison ? tr('Livraison') : tr('Arrivée')}</strong> <span className="muted">· {toName}</span></div>
        </div>
        <div className="faint" style={{ fontSize: 12.5 }}>
          {tr('{0} : {1}{2} · Prix fixe garanti, embouteillages inclus.', [livraison ? tr('Expéditeur') : tr('Client'), ride.client.name ?? (livraison ? tr('Client ORION') : tr('Passager ORION')), ride.client.rides > 0 ? tr(ride.client.rides > 1 ? ' · {0} courses ORION' : ' · {0} course ORION', [ride.client.rides]) : ''])}
        </div>

        {declining ? (
          <div className="col" style={{ gap: 8 }}>
            <div className="muted" style={{ fontSize: 13 }}>{tr('Pourquoi refusez-vous ? (aide ORION à mieux vous proposer)')}</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {REASONS.map((reason) => (
                <button key={reason} className="dv-pill" onClick={() => void app.actions.decline(ride.id, reason)} disabled={app.busy}>{tr(reason)}</button>
              ))}
              <button className="dv-pill" onClick={() => void app.actions.decline(ride.id)} disabled={app.busy}>{tr('Autre')}</button>
            </div>
            <button className="btn btn-ghost" onClick={() => setDeclining(false)}>{tr('Retour à l’offre')}</button>
          </div>
        ) : (
          <div className="dv-grid2" style={{ gridTemplateColumns: '1fr 2fr' }}>
            <button className="btn btn-ghost" onClick={() => setDeclining(true)} disabled={app.busy || left <= 0}>{tr('Refuser')}</button>
            <button className="btn btn-primary" onClick={() => void app.actions.accept(ride.id)} disabled={app.busy || left <= 0}>
              {left <= 0 ? tr('Offre expirée') : tr('Accepter')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
