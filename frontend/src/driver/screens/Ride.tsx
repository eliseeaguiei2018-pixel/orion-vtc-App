import { useEffect, useState } from 'react';
import { OrionMap } from '../../components/OrionMap';
import { IconClock, IconPhone, IconPin, IconWallet } from '../../icons';
import type { DriverApp } from '../useDriver';
import type { ActiveRide, RideStatus, RideView } from '../types';
import { Banner, Modal } from '../ui';
import { fcfa, haversine, km, methodLabel, navLinks, statutLabel, TAILLE_COLIS } from '../format';
import { lienTel, numeroLisible } from '../../telephone';

const STEPS: RideStatus[] = ['driver_en_route', 'arrived', 'in_progress', 'completed'];

/**
 * MISSION EN COURS : navigation, étapes (en route → arrivé → en course → paiement),
 * attente facturée, appel du client, SOS, annulation et encaissement.
 * Chaque étape passe par la machine à états du serveur (refus des transitions illégales).
 */
export function RideScreen({ app, ride }: { app: DriverApp; ride: ActiveRide }) {
  const [sos, setSos] = useState(false);
  const [cancel, setCancel] = useState(false);
  const step = STEPS.indexOf(ride.status);
  const toPickup = ride.status === 'accepted' || ride.status === 'driver_en_route';
  const target = toPickup || ride.status === 'arrived' ? ride.origin : ride.destination;
  const links = navLinks(target);
  const { wait } = app.driverConfig;
  const billable = Math.max(0, ride.waitMinutes - wait.freeMinutes);
  const totalDue = ride.amount + billable * wait.feePerMin;
  const gateways = app.appConfig?.gateways ?? {};
  const cashAllowed = gateways['cash'] !== false;
  const electronic = ride.paymentMethod !== null && ride.paymentMethod !== 'cash';
  const t = (to: RideStatus) => void app.actions.transition(ride.id, to);
  // Livraison à moto : mêmes étapes, mots du coursier (colis à retirer puis à livrer).
  const livraison = ride.serviceType === 'delivery';

  return (
    <div className="dv-ride">
      <div className="dv-ride-map">
        {toPickup
          ? <OrionMap origin={app.position} destination={ride.origin} car={app.position} vehicle={livraison ? 'moto' : 'car'} traffic />
          : <OrionMap origin={ride.origin} destination={ride.destination} car={app.position} vehicle={livraison ? 'moto' : 'car'} traffic />}
        <div className="dv-map-chip"><span className="dv-link online"><i />{statutLabel(ride.status, livraison)}</span></div>
        <button className="sos" style={{ bottom: 40 }} onClick={() => setSos(true)} aria-label="SOS">SOS</button>
      </div>

      <div className="dv-ride-sheet">
        <div className="dv-steps" aria-label={livraison ? 'Étapes de la livraison' : 'Étapes de la course'}>
          {STEPS.map((s, i) => <span key={s} className={i <= step ? 'done' : ''} />)}
        </div>

        <div className="row between">
          <div>
            <div className="eyebrow">{livraison
              ? (toPickup ? 'Retrait du colis' : ride.status === 'arrived' ? `Colis à récupérer · ${TAILLE_COLIS[ride.category] ?? ride.category}` : 'Livraison du colis')
              : (toPickup ? 'Prise en charge' : ride.status === 'arrived' ? 'Client attendu' : 'Destination')}</div>
            <div className="h-title" style={{ fontSize: 19 }}>{ride.client.name ?? (livraison ? 'Client ORION' : 'Passager ORION')}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>
              {km(haversine(app.position, target))} · {methodLabel(ride.paymentMethod)}{ride.pickupZone ? ` · ${ride.pickupZone.name}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <div className="dv-price" style={{ fontSize: 24 }}>{fcfa(totalDue)}</div>
            <div className="faint" style={{ fontSize: 12 }}>Prix fixe{billable > 0 ? ` + attente ${fcfa(billable * wait.feePerMin)}` : ''}</div>
          </div>
        </div>

        <div className="dv-actions">
          <a className="dv-act" href={links.google} target="_blank" rel="noreferrer"><IconPin size={18} />Google Maps</a>
          <a className="dv-act" href={links.waze} target="_blank" rel="noreferrer"><IconPin size={18} />Waze</a>
          {/* Un toucher ouvre le clavier du téléphone avec le numéro du passager composé
              (indicatif +225 ajouté au besoin) ; le chauffeur n'a plus qu'à appuyer. */}
          {lienTel(ride.client.phone)
            ? <a className="dv-act" href={lienTel(ride.client.phone)!} data-testid="appeler-passager" aria-label={`Appeler le passager ${numeroLisible(ride.client.phone)}`}><IconPhone size={18} />Appeler</a>
            : <span className="dv-act" style={{ opacity: 0.5 }}><IconPhone size={18} />Numéro masqué</span>}
        </div>

        {(ride.status === 'arrived' || ride.status === 'in_progress') && (
          <div className="card" style={{ padding: 12 }}>
            <div className="row between">
              <span className="row" style={{ gap: 8 }}><IconClock size={16} /><strong>Attente : {ride.waitMinutes} min</strong></span>
              <span className="faint" style={{ fontSize: 12 }}>{wait.freeMinutes} min offertes · {fcfa(wait.feePerMin)}/min ensuite</span>
            </div>
            <div className="dv-grid2" style={{ marginTop: 10 }}>
              <button className="btn btn-ghost" style={{ padding: 10 }} onClick={() => void app.actions.wait(ride.id, 1)} disabled={app.busy}>+1 min</button>
              <button className="btn btn-ghost" style={{ padding: 10 }} onClick={() => void app.actions.wait(ride.id, 5)} disabled={app.busy}>+5 min</button>
            </div>
          </div>
        )}

        {ride.status === 'accepted' && <button className="btn btn-primary" disabled={app.busy} onClick={() => t('driver_en_route')}>{livraison ? 'Je pars chercher le colis' : 'Je pars vers le client'}</button>}
        {ride.status === 'driver_en_route' && <button className="btn btn-primary" disabled={app.busy} onClick={() => t('arrived')}>{livraison ? 'Je suis au point de retrait' : 'Je suis arrivé'}</button>}
        {ride.status === 'arrived' && !livraison && ride.codeRequis
          ? <SaisieCode app={app} rideId={ride.id} />
          : ride.status === 'arrived' && <button className="btn btn-primary" disabled={app.busy} onClick={() => t('in_progress')}>{livraison ? 'Colis récupéré, je livre' : 'Client à bord — démarrer'}</button>}
        {ride.status === 'in_progress' && <button className="btn btn-primary" disabled={app.busy} onClick={() => t('completed')}>{livraison ? 'Colis livré' : 'Terminer la course'}</button>}

        {ride.status === 'completed' && (
          <div className="col" style={{ gap: 10 }}>
            {electronic && (
              <Banner tone="info" icon={<IconWallet size={18} />} title={`Paiement ${methodLabel(ride.paymentMethod)} en attente`}>
                Le client règle {fcfa(totalDue)} depuis son app. Vous serez notifié dès réception.
              </Banner>
            )}
            {cashAllowed ? (
              <button className={`btn ${electronic ? 'btn-ghost' : 'btn-primary'}`} disabled={app.busy} onClick={() => void app.actions.collectCash(ride.id)}>
                {electronic ? 'Le client paie finalement en espèces' : `J’ai encaissé ${fcfa(totalDue)} en espèces`}
              </button>
            ) : (
              <Banner tone="warn" title="Espèces désactivées par ORION">Le paiement doit se faire par mobile money ou carte.</Banner>
            )}
            {!electronic && cashAllowed && <div className="faint" style={{ fontSize: 12, textAlign: 'center' }}>Espèces : la commission ORION est inscrite en dette sur votre portefeuille.</div>}
          </div>
        )}

        {(ride.status === 'accepted' || ride.status === 'driver_en_route' || ride.status === 'arrived') && (
          <button className="btn btn-ghost" onClick={() => setCancel(true)} disabled={app.busy}>{livraison ? 'Annuler la livraison' : 'Annuler la course'}</button>
        )}
      </div>

      {sos && (
        <Modal title="Alerte SOS" onClose={() => setSos(false)}>
          <p className="muted" style={{ marginBottom: 12 }}>Le poste de supervision ORION et le SAMU (185) reçoivent votre position et la course en cours.</p>
          <div className="col" style={{ gap: 8 }}>
            {['Agression / menace', 'Accident', 'Malaise passager'].map((note) => (
              <button key={note} className="btn btn-danger" onClick={() => { setSos(false); void app.actions.sos(note); }}>{note}</button>
            ))}
            <button className="btn btn-ghost" onClick={() => setSos(false)}>Annuler</button>
          </div>
        </Modal>
      )}
      {cancel && (
        <Modal title="Annuler la course ?" onClose={() => setCancel(false)}>
          <p className="muted" style={{ marginBottom: 12 }}>
            {ride.status === 'arrived' ? 'Client absent ? Vérifiez l’avoir appelé avant d’annuler.' : 'Le client sera prévenu immédiatement. Les annulations répétées dégradent votre taux de service.'}
          </p>
          <div className="col" style={{ gap: 8 }}>
            <button className="btn btn-danger" onClick={() => { setCancel(false); t('cancelled'); }}>Confirmer l’annulation</button>
            <button className="btn btn-ghost" onClick={() => setCancel(false)}>Continuer la course</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * CODE DE PRISE EN CHARGE : le passager lit son code à 4 chiffres dans son app, le
 * chauffeur le saisit ici. Bon code : la course démarre et l'identité est confirmée.
 * Mauvais code : le serveur dit combien d'essais il reste ; au cinquième, c'est bloqué.
 */
function SaisieCode({ app, rideId }: { app: DriverApp; rideId: string }) {
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = async () => {
    setErreur(null);
    const e = await app.actions.start(rideId, code);
    if (e) { setErreur(e); setCode(''); }
  };
  return (
    <div className="dv-code">
      <label className="dv-code-titre" htmlFor="dv-code-champ">Code du passager</label>
      <p className="dv-code-aide">Demandez au passager le code à 4 chiffres affiché dans son application.</p>
      <div className="dv-code-saisie">
        <input id="dv-code-champ" className="dv-code-champ" inputMode="numeric" autoComplete="one-time-code" maxLength={4}
          value={code} placeholder="••••" aria-invalid={erreur ? true : undefined}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 4)); setErreur(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 4) void valider(); }} />
      </div>
      {erreur && <p className="dv-code-erreur" role="alert">{erreur}</p>}
      <button className="btn btn-primary" disabled={app.busy || code.length !== 4} onClick={() => void valider()}>Vérifier le code et démarrer</button>
    </div>
  );
}

/** Récapitulatif après paiement : ce que la course a rapporté (ledger serveur). */
export function SettledModal({ app }: { app: DriverApp }) {
  const settled = app.settled!;
  const [view, setView] = useState<RideView | null>(null);
  useEffect(() => {
    void app.backend.history().then((h) => setView(h.rides.find((r) => r.id === settled.rideId) ?? null)).catch(() => undefined);
  }, [app.backend, settled.rideId]);
  const e = view?.earnings;
  return (
    <Modal title={view?.serviceType === 'delivery' ? 'Livraison payée ✅' : 'Course payée ✅'} onClose={app.actions.dismissSettled}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row between"><span className="muted">Montant payé ({methodLabel(settled.method)})</span><strong>{fcfa(settled.amount)}</strong></div>
        {e && (
          <>
            <div className="row between"><span className="muted">Commission ORION</span><span className="dv-amount neg">− {fcfa(e.commission)}</span></div>
            {e.bonus > 0 && <div className="row between"><span className="muted">Bonus (secteur, approche)</span><span className="dv-amount pos">+ {fcfa(e.bonus)}</span></div>}
            <div className="divider" />
            <div className="row between"><strong>Votre gain net</strong><span className="dv-amount pos" style={{ fontSize: 20 }}>{fcfa(e.net + e.bonus)}</span></div>
            {e.cashCollected > 0 && (
              <Banner tone="info" icon={<IconWallet size={18} />} title="Payé en espèces">
                Vous avez encaissé {fcfa(e.cashCollected)} : la commission ({fcfa(e.commission)}) est due à ORION et déduite de votre portefeuille.
              </Banner>
            )}
          </>
        )}
        <button className="btn btn-primary" onClick={app.actions.dismissSettled}>Continuer</button>
      </div>
    </Modal>
  );
}
