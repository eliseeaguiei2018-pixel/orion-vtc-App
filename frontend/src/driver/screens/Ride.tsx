import { useEffect, useState } from 'react';
import { OrionMap } from '../../components/OrionMap';
import { IconCar, IconClock, IconPeage, IconPhone, IconPin, IconSablier, IconWallet } from '../../icons';
import type { DriverApp } from '../useDriver';
import type { ActiveRide, MotifAnnulationChauffeur, RideStatus, RideView } from '../types';
import { Banner, Modal } from '../ui';
import { BandeauGuidage } from './Guidage';
import { fcfa, haversine, km, methodLabel, navLinks, statutLabel, TAILLE_COLIS } from '../format';
import { lienTel, numeroLisible } from '../../telephone';
import { aTraduire, tr } from '../i18n';

const STEPS: RideStatus[] = ['driver_en_route', 'arrived', 'in_progress', 'completed'];

/**
 * MISSION EN COURS : navigation, étapes (en route → arrivé → en course → paiement),
 * attente facturée, appel du client, SOS, annulation et encaissement.
 * Chaque étape passe par la machine à états du serveur (refus des transitions illégales).
 */
export function RideScreen({ app, ride }: { app: DriverApp; ride: ActiveRide }) {
  const [sos, setSos] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [suivi, setSuivi] = useState(true);
  // MODE NAVIGATION (comme les autres apps VTC) : en conduite, la carte occupe l'écran et la
  // fiche de course se réduit à une barre en bas (client, distance, minutes, bouton d'étape).
  // Un toucher sur la barre la déplie ; elle se replie d'elle-même à chaque nouvelle étape.
  const [deplie, setDeplie] = useState(false);
  useEffect(() => { setDeplie(false); }, [ride.status]);
  const nav = app.navigation;
  const step = STEPS.indexOf(ride.status);
  const toPickup = ride.status === 'accepted' || ride.status === 'driver_en_route';
  const target = toPickup || ride.status === 'arrived' ? ride.origin : ride.destination;
  const links = navLinks(target);
  const { wait } = app.driverConfig;
  const billable = Math.max(0, ride.waitMinutes - wait.freeMinutes);
  const brut = ride.amount + billable * wait.feePerMin;
  // Abonnement ORION : ce que le client paie VRAIMENT (le chauffeur est payé sur le brut).
  const prisEnCharge = Math.min(brut, ride.encaissement?.prisEnCharge ?? 0);
  const totalDue = Math.max(0, brut - prisEnCharge);
  const abonnement = ride.encaissement?.abonnement ?? null;
  const gateways = app.appConfig?.gateways ?? {};
  const cashAllowed = gateways['cash'] !== false;
  const electronic = ride.paymentMethod !== null && ride.paymentMethod !== 'cash';
  const t = (to: RideStatus) => void app.actions.transition(ride.id, to);
  // Livraison à moto : mêmes étapes, mots du coursier (colis à retirer puis à livrer).
  const livraison = ride.serviceType === 'delivery';
  // Guidage actif tant qu'il y a un point à rejoindre (client, puis destination).
  const enNavigation = toPickup || ride.status === 'in_progress';
  const reduite = enNavigation && !deplie;
  const resteMin = nav.guidage ? Math.max(1, Math.round(nav.guidage.resteSecondes / 60)) : null;
  const resteDistance = nav.guidage ? nav.guidage.reste : haversine(app.position, target);
  const boutonEtape = ride.status === 'accepted'
    ? <button className="btn btn-primary" disabled={app.busy} onClick={() => t('driver_en_route')}>{livraison ? tr('Je pars chercher le colis') : tr('Je pars vers le client')}</button>
    : ride.status === 'driver_en_route'
      ? <button className="btn btn-primary" disabled={app.busy} onClick={() => t('arrived')}>{livraison ? tr('Je suis au point de retrait') : tr('Je suis arrivé')}</button>
      : ride.status === 'in_progress'
        ? <button className="btn btn-primary" disabled={app.busy} onClick={() => t('completed')}>{livraison ? tr('Colis livré') : tr('Terminer la course')}</button>
        : null;

  return (
    <div className={`dv-ride${reduite ? ' navigation' : ''}`}>
      <div className="dv-ride-map">
        {/* Vraie carte de Côte d'Ivoire + navigation guidée : la carte suit le véhicule sur
            l'itinéraire réel (ponts, échangeurs, voies nouvelles), vers le client puis la destination. */}
        {enNavigation
          ? <OrionMap origin={ride.origin} destination={toPickup ? null : ride.destination} car={app.position} vehicle={livraison ? 'moto' : 'car'} traffic
              trace={nav.guidage?.restant ?? null} ponts={nav.guidage?.ponts} suivi={suivi} basCouvert={0} libelleRecentrer={tr('Recentrer')} />
          : <OrionMap origin={ride.origin} destination={ride.destination} car={app.position} vehicle={livraison ? 'moto' : 'car'} traffic basCouvert={0} />}
        <BandeauGuidage guidage={nav.guidage} recalcul={nav.recalcul} actif={enNavigation}
          arrivee={toPickup ? (livraison ? tr('Arrivée au point de retrait du colis') : tr('Arrivée au point de prise en charge')) : (livraison ? tr('Arrivée au point de livraison') : tr('Arrivée à destination'))} />
        <div className={`dv-map-chip${enNavigation ? ' bas' : ''}`}>
          <span className="dv-link online"><i />{statutLabel(ride.status, livraison)}</span>
          {enNavigation && (
            <button type="button" className="dv-link dv-vue" onClick={() => setSuivi((v) => !v)}>{suivi ? tr('Vue d’ensemble') : tr('Navigation')}</button>
          )}
        </div>
        <button className="sos" style={{ bottom: 40 }} onClick={() => setSos(true)} aria-label={tr('SOS')}>{tr('SOS')}</button>
      </div>

      {reduite ? (
        <div className="dv-ride-sheet reduite">
          <button type="button" className="dv-ride-resume" onClick={() => setDeplie(true)} aria-expanded={false} aria-label={tr('Afficher les détails de la course')}>
            <span className="dv-ride-grab" />
            <span className="row between" style={{ width: '100%', gap: 12 }}>
              <span className="col grow" style={{ minWidth: 0, alignItems: 'flex-start' }}>
                <strong className="dv-ride-resume-titre">{resteMin !== null ? `${resteMin} min` : '…'} · {km(resteDistance)}</strong>
                <span className="faint dv-ride-resume-sous">
                  {(toPickup ? (livraison ? tr('Retrait du colis') : tr('Prise en charge')) : tr('Destination'))} · {ride.client.name ?? (livraison ? tr('Client ORION') : tr('Passager ORION'))}
                </span>
              </span>
              <span className="dv-price" style={{ fontSize: 19 }}>{fcfa(brut)}</span>
            </span>
          </button>
          <div className="dv-ride-resume-actions">
            {lienTel(ride.client.phone) && (
              <a className="dv-act compact" href={lienTel(ride.client.phone)!} aria-label={tr('Appeler le passager {0}', [numeroLisible(ride.client.phone)])}><IconPhone size={18} /></a>
            )}
            {boutonEtape}
          </div>
        </div>
      ) : (
      <div className="dv-ride-sheet">
        {enNavigation && (
          <button type="button" className="dv-ride-replier" onClick={() => setDeplie(false)} aria-expanded aria-label={tr('Réduire pour voir la carte')}>
            <span className="dv-ride-grab" />
          </button>
        )}
        <div className="dv-steps" aria-label={livraison ? tr('Étapes de la livraison') : tr('Étapes de la course')}>
          {STEPS.map((s, i) => <span key={s} className={i <= step ? 'done' : ''} />)}
        </div>
        {/* Étapes nommées sous la jauge : le chauffeur voit où il en est d'un coup d'œil. */}
        <div className="dv-steps-labels" aria-hidden="true">
          {(livraison ? [tr('Retrait'), tr('Sur place'), tr('Livraison'), tr('Paiement')] : [tr('En route'), tr('Arrivé'), tr('En course'), tr('Paiement')]).map((l, i) => (
            <span key={l} className={i === Math.max(0, step) ? 'on' : ''}>{l}</span>
          ))}
        </div>

        <div className="row between">
          {!livraison && <PhotoPassager photo={ride.client.photo ?? null} prenom={ride.client.name} />}
          <div className="grow">
            <div className="eyebrow">{livraison
              ? (toPickup ? tr('Retrait du colis') : ride.status === 'arrived' ? tr('Colis à récupérer · {0}', [TAILLE_COLIS[ride.category] ?? ride.category]) : tr('Livraison du colis'))
              : (toPickup ? tr('Prise en charge') : ride.status === 'arrived' ? tr('Client attendu') : tr('Destination'))}</div>
            <div className="h-title" style={{ fontSize: 19 }}>{ride.client.name ?? (livraison ? tr('Client ORION') : tr('Passager ORION'))}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>
              {km(haversine(app.position, target))} · {methodLabel(ride.paymentMethod)}
              {(toPickup ? ride.lieux?.depart : ride.lieux?.arrivee) ?? ride.pickupZone?.name ? ` · ${(toPickup ? ride.lieux?.depart : ride.lieux?.arrivee) ?? ride.pickupZone?.name}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <div className="dv-price" style={{ fontSize: 24 }}>{fcfa(brut)}</div>
            <div className="faint" style={{ fontSize: 12 }}>{billable > 0 ? tr('Prix fixe + attente {0}', [fcfa(billable * wait.feePerMin)]) : tr('Prix fixe')}</div>
          </div>
        </div>
        {/* Choix du client : itinéraire (pont à péage ou voie normale) et mise à disposition. */}
        {(ride.itineraire || ride.miseADisposition) && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 2px' }}>
            {ride.miseADisposition && <span className="dv-pill gold"><IconSablier size={13} /> {tr('Mise à disposition · {0} h', [ride.miseADisposition.heures])}</span>}
            {ride.itineraire?.choix === 'peage' && <span className="dv-pill gold"><IconPeage size={13} /> {tr('Itinéraire du client : pont à péage ({0} compris)', [fcfa(ride.itineraire.peage)])}</span>}
            {ride.itineraire?.choix === 'normal' && <span className="dv-pill"><IconCar size={13} /> {tr('Itinéraire du client : voie normale (sans péage)')}</span>}
          </div>
        )}
        {abonnement && (
          <Banner tone="success" icon={<IconWallet size={18} />} title={totalDue === 0 ? tr('Course incluse dans l’abonnement du client') : tr('Abonnement du client : {0} pris en charge', [fcfa(prisEnCharge)])}>
            {tr('{0} · le client paie {1}. Vous êtes rémunéré sur le prix complet ({2}).', [abonnement.plan, fcfa(totalDue), fcfa(brut)])}
          </Banner>
        )}

        <div className="dv-actions">
          <a className="dv-act" href={links.google} target="_blank" rel="noreferrer"><IconPin size={18} />{tr('Google Maps')}</a>
          <a className="dv-act" href={links.waze} target="_blank" rel="noreferrer"><IconPin size={18} />{tr('Waze')}</a>
          {/* Un toucher ouvre le clavier du téléphone avec le numéro du passager composé
              (indicatif +225 ajouté au besoin) ; le chauffeur n'a plus qu'à appuyer. */}
          {lienTel(ride.client.phone)
            ? <a className="dv-act" href={lienTel(ride.client.phone)!} data-testid="appeler-passager" aria-label={tr('Appeler le passager {0}', [numeroLisible(ride.client.phone)])}><IconPhone size={18} />{tr('Appeler')}</a>
            : <span className="dv-act" style={{ opacity: 0.5 }}><IconPhone size={18} />{tr('Numéro masqué')}</span>}
        </div>

        {(ride.status === 'arrived' || ride.status === 'in_progress') && (
          <div className="card" style={{ padding: 12 }}>
            <div className="row between">
              <span className="row" style={{ gap: 8 }}><IconClock size={16} /><strong>{tr('Attente : {0} min', [ride.waitMinutes])}</strong></span>
              <span className="faint" style={{ fontSize: 12 }}>{tr('{0} min offertes · {1}/min ensuite', [wait.freeMinutes, fcfa(wait.feePerMin)])}</span>
            </div>
            <div className="dv-grid2" style={{ marginTop: 10 }}>
              <button className="btn btn-ghost" style={{ padding: 10 }} onClick={() => void app.actions.wait(ride.id, 1)} disabled={app.busy}>+1 min</button>
              <button className="btn btn-ghost" style={{ padding: 10 }} onClick={() => void app.actions.wait(ride.id, 5)} disabled={app.busy}>+5 min</button>
            </div>
          </div>
        )}

        {ride.status !== 'in_progress' && ride.status !== 'arrived' && boutonEtape}
        {ride.status === 'arrived' && !livraison && ride.codeRequis
          ? <SaisieCode app={app} rideId={ride.id} />
          : ride.status === 'arrived' && <button className="btn btn-primary" disabled={app.busy} onClick={() => t('in_progress')}>{livraison ? tr('Colis récupéré, je livre') : tr('Client à bord — démarrer')}</button>}
        {ride.status === 'in_progress' && boutonEtape}

        {ride.status === 'completed' && totalDue === 0 && (
          <div className="col" style={{ gap: 10 }}>
            <button className="btn btn-primary" disabled={app.busy}
              onClick={() => void app.actions.settleCovered(ride.id, [ride.paymentMethod ?? 'card', 'card', 'cash', 'wave', 'orange_money'].find((m) => gateways[m] !== false) ?? 'card')}>
              {tr('Valider la fin de course — rien à encaisser')}
            </button>
          </div>
        )}
        {ride.status === 'completed' && totalDue > 0 && (
          <div className="col" style={{ gap: 10 }}>
            {electronic && (
              <Banner tone="info" icon={<IconWallet size={18} />} title={tr('Paiement {0} en attente', [methodLabel(ride.paymentMethod)])}>
                {tr('Le client règle {0} depuis son app. Vous serez notifié dès réception.', [fcfa(totalDue)])}
              </Banner>
            )}
            {cashAllowed ? (
              <button className={`btn ${electronic ? 'btn-ghost' : 'btn-primary'}`} disabled={app.busy} onClick={() => void app.actions.collectCash(ride.id)}>
                {electronic ? tr('Le client paie finalement en espèces') : tr('J’ai encaissé {0} en espèces', [fcfa(totalDue)])}
              </button>
            ) : (
              <Banner tone="warn" title={tr('Espèces désactivées par ORION')}>{tr('Le paiement doit se faire par mobile money ou carte.')}</Banner>
            )}
            {!electronic && cashAllowed && <div className="faint" style={{ fontSize: 12, textAlign: 'center' }}>{tr('Espèces : remettez ce montant à la caisse ORION.')}</div>}
          </div>
        )}

        {(ride.status === 'accepted' || ride.status === 'driver_en_route' || ride.status === 'arrived') && (
          <button className="btn btn-ghost" onClick={() => setCancel(true)} disabled={app.busy}>{livraison ? tr('Annuler la livraison') : tr('Annuler la course')}</button>
        )}
      </div>
      )}

      {sos && (
        <Modal title={tr('Alerte SOS')} onClose={() => setSos(false)}>
          <p className="muted" style={{ marginBottom: 12 }}>{tr('Votre position et la course partent à la supervision ORION. Vous suivrez en direct qui prend votre alerte et quels secours sont appelés.')}</p>
          <div className="col" style={{ gap: 8 }}>
            {/* Le motif part en français à la supervision (console) ; seul l'affichage est traduit. */}
            {[aTraduire('Agression / menace'), aTraduire('Accident'), aTraduire('Malaise passager')].map((note) => (
              <button key={note} className="btn btn-danger" onClick={() => { setSos(false); void app.actions.sos(note); }}>{tr(note)}</button>
            ))}
            <button className="btn btn-ghost" onClick={() => setSos(false)}>{tr('Annuler')}</button>
          </div>
        </Modal>
      )}
      {cancel && <AnnulationModal app={app} ride={ride} livraison={livraison} onClose={() => setCancel(false)} onSos={() => { setCancel(false); setSos(true); }} />}
    </div>
  );
}

/** Photo du passager (prénom + photo pendant la mission, politique de confidentialité). */
function PhotoPassager({ photo, prenom }: { photo: string | null; prenom: string | null }) {
  const initiale = (prenom ?? '?').charAt(0).toUpperCase();
  return (
    <span className="driver-photo dv-passager-photo" style={{ width: 48, height: 48, fontSize: 18, overflow: 'hidden', marginInlineEnd: 12, flexShrink: 0 }}>
      {photo ? <img src={photo} alt={prenom ?? tr('Passager')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initiale}
    </span>
  );
}

const MOTIFS: Array<{ id: MotifAnnulationChauffeur; label: string; aide: string }> = [
  { id: 'client_injoignable', label: aTraduire('Client injoignable'), aide: aTraduire('Appelé sans réponse') },
  { id: 'adresse_introuvable', label: aTraduire('Adresse introuvable'), aide: aTraduire('Point de prise en charge inaccessible') },
  { id: 'vehicule_panne', label: aTraduire('Véhicule en panne'), aide: aTraduire('Vous passez hors ligne') },
  { id: 'securite', label: aTraduire('Je ne me sens pas en sécurité'), aide: aTraduire('Tracé à la supervision') },
  { id: 'autre', label: aTraduire('Autre raison'), aide: aTraduire('Précisez-la ci-dessous') },
];

/**
 * ANNULATION PAR LE CHAUFFEUR — motif obligatoire. Avant la prise en charge, le passager
 * garde sa course : elle part vers un autre chauffeur, sans frais pour lui. « Client
 * absent » n'est possible qu'une fois arrivé, après les minutes d'attente offertes.
 * Demander au passager d'annuler lui-même est interdit (signalé à la console).
 */
function AnnulationModal({ app, ride, livraison, onClose, onSos }: {
  app: DriverApp; ride: ActiveRide; livraison: boolean; onClose: () => void; onSos: () => void;
}) {
  const [motif, setMotif] = useState<MotifAnnulationChauffeur | null>(null);
  const [details, setDetails] = useState('');
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setMaintenant(Date.now()), 5000); return () => window.clearInterval(t); }, []);
  const offertes = app.driverConfig.wait.freeMinutes;
  const arrivee = [...ride.events].reverse().find((e) => e.type === 'arrived');
  const attente = arrivee ? (maintenant - Date.parse(arrivee.at)) / 60_000 : 0;
  const absentPossible = ride.status === 'arrived' && attente >= offertes;
  const reste = Math.max(0, Math.ceil(offertes - attente));
  const confirmer = async () => {
    if (!motif) return;
    if (await app.actions.cancelRide(ride.id, motif, details.trim() || undefined)) onClose();
  };
  return (
    <Modal title={livraison ? tr('Annuler la livraison ?') : tr('Annuler la course ?')} onClose={onClose}>
      <p className="muted" style={{ marginBottom: 12, fontSize: 13.5 }}>
        {livraison
          ? tr('Le client garde sa livraison : elle est confiée à un autre coursier, sans frais pour lui. Vos annulations comptent dans votre taux de service.')
          : tr('Le passager garde sa course : elle est confiée à un autre chauffeur, sans frais pour lui. Vos annulations comptent dans votre taux de service.')}
      </p>
      <div className="col" style={{ gap: 8 }}>
        {ride.status === 'arrived' && (
          <button className={`dv-qcm-opt${motif === 'client_absent' ? ' on' : ''}`} disabled={!absentPossible} onClick={() => setMotif('client_absent')}>
            <strong>{livraison ? tr('Expéditeur absent') : tr('Passager absent')}</strong>
            <div className="faint" style={{ fontSize: 12 }}>{absentPossible ? tr('Annulation, frais d’absence ({0})', [fcfa(app.driverConfig.cancel.fee)]) : tr('Possible dans {0} min (attente offerte : {1} min)', [reste, offertes])}</div>
          </button>
        )}
        {MOTIFS.map((m) => (
          <button key={m.id} className={`dv-qcm-opt${motif === m.id ? ' on' : ''}`} onClick={() => setMotif(m.id)}>
            <strong>{tr(m.label)}</strong>
            <div className="faint" style={{ fontSize: 12 }}>{tr(m.aide)}</div>
          </button>
        ))}
        {motif === 'securite' && (
          <Banner tone="danger" title={tr('En danger ?')} action={<button className="dv-pill danger" onClick={onSos}>{tr('SOS')}</button>}>{tr('Déclenchez le SOS : un agent ORION vous prend en charge.')}</Banner>
        )}
        {motif && (
          <textarea className="dv-input" rows={2} maxLength={300} placeholder={tr('Précision (facultatif)')} value={details} onChange={(e) => setDetails(e.target.value)} />
        )}
        <button className="btn btn-danger" disabled={!motif || app.busy} onClick={() => void confirmer()}>{tr('Confirmer l’annulation')}</button>
        <button className="btn btn-ghost" onClick={onClose}>{livraison ? tr('Continuer la livraison') : tr('Continuer la course')}</button>
      </div>
    </Modal>
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
      <label className="dv-code-titre" htmlFor="dv-code-champ">{tr('Code du passager')}</label>
      <p className="dv-code-aide">{tr('Demandez au passager le code à 4 chiffres affiché dans son application.')}</p>
      <div className="dv-code-saisie">
        <input id="dv-code-champ" className="dv-code-champ" inputMode="numeric" autoComplete="one-time-code" maxLength={4}
          value={code} placeholder="••••" aria-invalid={erreur ? true : undefined}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 4)); setErreur(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 4) void valider(); }} />
      </div>
      {erreur && <p className="dv-code-erreur" role="alert">{erreur}</p>}
      <button className="btn btn-primary" disabled={app.busy || code.length !== 4} onClick={() => void valider()}>{tr('Vérifier le code et démarrer')}</button>
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
  return (
    <Modal title={view?.serviceType === 'delivery' ? tr('Livraison payée') : tr('Course payée')} onClose={app.actions.dismissSettled}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row between">
          <span className="muted">{settled.amount === 0 ? tr('Payé par le client') : tr('Montant payé ({0})', [methodLabel(settled.method)])}</span>
          <strong>{settled.amount === 0 ? tr('Inclus dans son abonnement') : fcfa(settled.amount)}</strong>
        </div>
        {view && <div className="row between"><span className="muted">{tr('Distance')}</span><strong>{km(view.distanceMeters)}</strong></div>}
        <div className="divider" />
        <div className="row between"><strong>{tr('Comptée dans votre activité du mois')}</strong><span className="dv-pill green">+1 {tr('course')}</span></div>
        {settled.method === 'cash' && settled.amount > 0 && (
          <Banner tone="info" icon={<IconWallet size={18} />} title={tr('Payé en espèces')}>
            {tr('Vous avez encaissé {0} pour ORION : remettez-les à la caisse ORION.', [fcfa(settled.amount)])}
          </Banner>
        )}
        <button className="btn btn-primary" onClick={app.actions.dismissSettled}>{tr('Continuer')}</button>
      </div>
    </Modal>
  );
}
