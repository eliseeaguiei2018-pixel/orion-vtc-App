import { useEffect, useRef, useState, type PointerEvent as PointeurReact } from 'react';
import { OrionMap } from '../../components/OrionMap';
import { IconCar, IconChevronDown, IconClock, IconMessage, IconPackage, IconPeage, IconPhone, IconPin, IconSablier, IconWallet } from '../../icons';
import type { DriverApp } from '../useDriver';
import type { ActiveRide, MotifAnnulationChauffeur, RideStatus, RideView } from '../types';
import { Banner, Modal } from '../ui';
import { BandeauGuidage } from './Guidage';
import { fcfa, haversine, km, methodLabel, navLinks, nomDelaiLivraison as nomDelai, nomFormuleLivraison as nomFormule, statutLabel, TAILLE_COLIS } from '../format';
import { lienTel, numeroLisible } from '../../telephone';
import { aTraduire, localeCourante, tr } from '../i18n';
import { AvisNouvelArret, BoutonEspeces, BoutonsCourse, EcranAppel, FenetreChat, PanneauArrets, useCourseLive } from '../../CourseLiveUI';
import { isLiveBackend } from '../../api';
import { connexionCourse, type SonServeur } from '../../courseLive';
import { definirVoixDeBord, deverrouillerAudio, direAccueil, parler } from '../../voix';
import { loadSession } from '../session';

const STEPS: RideStatus[] = ['driver_en_route', 'arrived', 'in_progress', 'completed'];

/**
 * MISSION EN COURS : navigation, étapes (en route → arrivé → en course → paiement),
 * attente facturée, appel du client, SOS, annulation et encaissement.
 * Chaque étape passe par la machine à états du serveur (refus des transitions illégales).
 */
/** Jeton du chauffeur (chat, appel, arrêts, espèces) : lu à chaque appel. */
const jetonChauffeur = (): string | null => loadSession()?.token ?? null;
const cxChauffeur = connexionCourse(jetonChauffeur);
const CLE_ACCUEIL = 'orion.driver.accueil';

/**
 * VOIX DE BORD : le client est à bord (code donné), la voix du GPS lui souhaite la bienvenue,
 * une seule fois par course ; puis elle garde, jusqu'à la fin, la voix choisie pour ce client
 * (féminine pour un client, masculine pour une cliente) pour tout le guidage.
 */
function useVoixDeBord(rideId: string, actif: boolean, approche: boolean) {
  // VOIX HUMAINE : dès la course acceptée, le son de l'accueil se prépare sur le serveur et se
  // télécharge pendant l'approche ; à bord, il part sans attendre.
  useEffect(() => {
    if (!approche || !isLiveBackend()) return;
    prechargerAccueil(rideId);
  }, [rideId, approche]);
  useEffect(() => {
    if (!actif || !isLiveBackend()) return;
    let annule = false;
    let deja = false;
    try { deja = localStorage.getItem(CLE_ACCUEIL) === rideId; } catch { /* mémoire indisponible */ }
    void cxChauffeur.bienvenue(rideId).then((b) => {
      if (annule) return;
      definirVoixDeBord(b.voix);
      if (deja) return;
      try { localStorage.setItem(CLE_ACCUEIL, rideId); } catch { /* accueil redit au besoin */ }
      // Le son préparé sert s'il correspond à cet accueil ; sinon (heure qui a basculé, réglage
      // changé), on le redemande. Sans voix humaine, la voix du téléphone parle.
      const son = b.voixHumaine ? sonAccueil(rideId, b.voixHumaine.empreinte) : null;
      void direAccueil(b.texte, b.voix, 'fr-FR', son, b.voixHumaine?.pret ? 12_000 : 8_000);
    }).catch(() => undefined);
    return () => { annule = true; };
  }, [rideId, actif]);
  // Fin de course (écran quitté) : la voix reprend celle du chauffeur.
  useEffect(() => () => definirVoixDeBord(null), [rideId]);
}

/**
 * POINT DE PRISE EN CHARGE : quand Google a photographié la rue (Street View), le chauffeur
 * voit l'endroit où attend le client avant d'y arriver. Rien ne s'affiche s'il n'y a pas de photo.
 */
function PointDeRencontre({ rideId }: { rideId: string }) {
  const [info, setInfo] = useState<{ disponible: boolean; date: string | null } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => { void cxChauffeur.pointDeRencontre(rideId).then(setInfo).catch(() => setInfo(null)); }, [rideId]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
  if (!info?.disponible) return null;
  const ouvrir = async () => {
    setOuvert(true);
    if (!photo) { const b = await cxChauffeur.photoPointDeRencontre(rideId); if (b) setPhoto(URL.createObjectURL(b)); }
  };
  return (
    <>
      <button type="button" className="dv-link dv-point-rencontre" onClick={() => void ouvrir()}><IconPin size={14} /> {tr('Voir le point de prise en charge')}</button>
      {ouvert && (
        <Modal title={tr('Point de prise en charge')} onClose={() => setOuvert(false)}>
          {photo
            ? <img className="dv-point-photo" src={photo} alt={tr('Photo de la rue où attend le client')} />
            : <div className="dv-point-photo vide">{tr('Chargement de la photo…')}</div>}
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>{tr('Photo Google Street View · {0}', [info.date ?? '—'])}</p>
        </Modal>
      )}
    </>
  );
}

/** Sons d'accueil téléchargés pendant l'approche (un par course). */
const sonsAccueil = new Map<string, Promise<SonServeur | null>>();
function prechargerAccueil(rideId: string): void {
  if (sonsAccueil.has(rideId)) return;
  const p = cxChauffeur.sonBienvenue(rideId);
  sonsAccueil.set(rideId, p);
  // Échec (réseau, voix non réglée) : on pourra réessayer à l'étape suivante.
  void p.then((s) => { if (!s) sonsAccueil.delete(rideId); });
  for (const k of sonsAccueil.keys()) if (k !== rideId) sonsAccueil.delete(k);
}
async function sonAccueil(rideId: string, empreinte: string): Promise<SonServeur | null> {
  const prepare = await (sonsAccueil.get(rideId) ?? Promise.resolve(null));
  if (prepare && prepare.empreinte === empreinte) return prepare;
  return cxChauffeur.sonBienvenue(rideId);
}

export function RideScreen({ app, ride }: { app: DriverApp; ride: ActiveRide }) {
  // Course en direct avec le client : chat, appel par internet, arrêts facturés, espèces de secours.
  const direct = useCourseLive({
    rideId: ride.id, moi: 'chauffeur', jeton: jetonChauffeur,
    actif: isLiveBackend() && ['accepted', 'driver_en_route', 'arrived', 'in_progress', 'completed'].includes(ride.status),
    nomAutre: ride.client.name ?? tr('Passager'),
  });
  const [sos, setSos] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [suivi, setSuivi] = useState(true);
  // MODE NAVIGATION (comme les autres apps VTC) : en conduite, la carte occupe l'écran et la
  // fiche de course se réduit à une barre en bas (client, distance, minutes, bouton d'étape).
  // Un toucher sur la barre la déplie ; elle se replie d'elle-même à chaque nouvelle étape.
  const [deplie, setDeplie] = useState(false);
  useEffect(() => { setDeplie(false); }, [ride.status]);
  // Client à bord (course commencée, pas une livraison) : accueil vocal et voix de bord.
  useVoixDeBord(ride.id, ride.status === 'in_progress' && ride.serviceType !== 'delivery',
    ['accepted', 'driver_en_route', 'arrived'].includes(ride.status) && ride.serviceType !== 'delivery');
  // ARRÊTS DU TRAJET (prévus à la commande ou ajoutés par le client) : le guidage passe par le
  // prochain arrêt non marqué, puis rejoint la destination.
  const prochainArret = ride.status === 'in_progress' ? (direct.arrets?.prevus ?? []).find((p) => !p.fait) ?? null : null;
  const { definirEtape } = app.actions;
  useEffect(() => { definirEtape(prochainArret ? { lat: prochainArret.lat, lng: prochainArret.lng } : null); }, [prochainArret?.lat, prochainArret?.lng, definirEtape]);
  useEffect(() => () => definirEtape(null), [definirEtape]);
  // Le client vient d'ajouter un arrêt : le chauffeur l'entend, sans quitter la route des yeux.
  useEffect(() => {
    const a = direct.nouvelArret;
    if (a) void parler(tr('Le client a ajouté un arrêt : {0}', [a.nom]), localeCourante().replace('-u-nu-latn', ''));
  }, [direct.nouvelArret]);
  // « CONTINUER L'ITINÉRAIRE » : l'arrêt se termine (ses minutes sont comptées) et le guidage
  // repart vers la suite — l'arrêt suivant, sinon la destination. Le chauffeur l'entend.
  const arretEnCours = direct.arrets?.enCours ?? null;
  const arretAvant = useRef(arretEnCours?.id ?? null);
  useEffect(() => {
    const avant = arretAvant.current;
    arretAvant.current = arretEnCours?.id ?? null;
    if (!avant || arretEnCours || ride.status !== 'in_progress') return;
    const suite = prochainArret?.nom ?? (ride.serviceType === 'delivery' ? tr('le point de livraison') : tr('la destination'));
    void parler(tr('Itinéraire vers : {0}', [suite]), localeCourante().replace('-u-nu-latn', ''));
    setDeplie(false);
  }, [arretEnCours?.id, ride.status]);
  // La fiche se tire comme une vraie feuille : vers le haut pour l'ouvrir, vers le bas pour
  // la refermer, ou un simple toucher sur la poignée (toujours visible, même fiche défilée).
  const feuille = useGlisserFeuille(deplie, setDeplie);
  const nav = app.navigation;
  const step = STEPS.indexOf(ride.status);
  const toPickup = ride.status === 'accepted' || ride.status === 'driver_en_route';
  const target = toPickup || ride.status === 'arrived' ? ride.origin : ride.destination;
  const restants = (direct.arrets?.prevus ?? []).filter((p) => !p.fait).map((p) => ({ lat: p.lat, lng: p.lng }));
  const links = navLinks(target);
  const { wait } = app.driverConfig;
  const billable = Math.max(0, ride.waitMinutes - wait.freeMinutes);
  // Arrêts en course (prévus ou demandés) : chaque minute facturée, ajoutée au prix fixe.
  const brut = ride.amount + billable * wait.feePerMin + (direct.arrets?.montant ?? ride.arrets?.montant ?? 0);
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
  // Livraison : au retrait on appelle l'expéditeur (un tiers, ou le client qui a commandé),
  // pendant la livraison le destinataire.
  const enRetrait = livraison && (toPickup || ride.status === 'arrived');
  const contact = !livraison ? { nom: ride.client.name, tel: ride.client.phone }
    : enRetrait ? { nom: ride.livraison?.expediteur?.nom ?? ride.client.name, tel: ride.livraison?.expediteur?.telephone ?? ride.client.phone }
      : { nom: ride.livraison?.destinataire?.nom ?? ride.client.name, tel: ride.livraison?.destinataire?.telephone ?? ride.client.phone };
  const appelLabel = (n: string | null | undefined) => !livraison ? tr('Appeler le passager {0}', [numeroLisible(n)])
    : enRetrait ? tr('Appeler l’expéditeur {0}', [numeroLisible(n)]) : tr('Appeler le destinataire {0}', [numeroLisible(n)]);
  const vehiculeCarte = livraison ? (ride.livraison?.formule === 'cargo' ? 'car' : 'moto') : 'car';
  // Le colis ne se déclare livré qu'avec le code de remise que le destinataire donne au livreur.
  const remiseRequise = livraison && Boolean(ride.livraison?.codeRemiseRequis);
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
        // Arrêt en cours : le bouton « Continuer l'itinéraire » est dans le panneau des arrêts.
        // Arrêt encore à rejoindre : le geste suivant est « Je suis à l'arrêt », pas la fin de course.
        ? (arretEnCours ? null
          : prochainArret && direct.actif
            ? <button className="btn btn-primary" disabled={app.busy || direct.occupe} onClick={() => void direct.debutArret('prevu', prochainArret.index, app.position)}>{tr('Je suis à l’arrêt')}</button>
            : remiseRequise
              ? <button className="btn btn-primary" disabled={app.busy} onClick={() => setDeplie(true)}>{tr('Remettre le colis')}</button>
              : <button className="btn btn-primary" disabled={app.busy} onClick={() => t('completed')}>{livraison ? tr('Colis livré') : tr('Terminer la course')}</button>)
        : null;
  // Fiche dépliée : la fin de course reste possible pendant un arrêt ou avant le dernier arrêt
  // (client qui renonce), mais en bouton discret, sous les gestes d'arrêt.
  const finDiscrete = ride.status === 'in_progress' && !remiseRequise && (arretEnCours || (prochainArret && direct.actif))
    ? <button className="btn btn-ghost" disabled={app.busy} onClick={() => t('completed')}>{livraison ? tr('Colis livré') : tr('Terminer la course')}</button>
    : null;

  return (
    <div className={`dv-ride${reduite ? ' navigation' : ''}`}>
      <div className="dv-ride-map">
        {/* Vraie carte de Côte d'Ivoire + navigation guidée : la carte suit le véhicule sur
            l'itinéraire réel (ponts, échangeurs, voies nouvelles), vers le client puis la destination. */}
        {enNavigation
          ? <OrionMap origin={ride.origin} destination={toPickup ? null : ride.destination} stops={toPickup ? undefined : restants} car={app.position} vehicle={vehiculeCarte} traffic
              trace={nav.guidage?.restant ?? null} ponts={nav.guidage?.ponts} suivi={suivi} basCouvert={0} libelleRecentrer={tr('Recentrer')} />
          : <OrionMap origin={ride.origin} destination={ride.destination} stops={restants} car={app.position} vehicle={vehiculeCarte} traffic basCouvert={0} />}
        <BandeauGuidage guidage={nav.guidage} recalcul={nav.recalcul} actif={enNavigation}
          arrivee={toPickup ? (livraison ? tr('Arrivée au point de retrait du colis') : tr('Arrivée au point de prise en charge'))
            : prochainArret ? tr('Arrivée à l’arrêt : {0}', [prochainArret.nom])
              : (livraison ? tr('Arrivée au point de livraison') : tr('Arrivée à destination'))} />
        <div className={`dv-map-chip${enNavigation ? ' bas' : ''}`}>
          <span className="dv-link online"><i />{statutLabel(ride.status, livraison)}</span>
          {enNavigation && (
            <button type="button" className="dv-link dv-vue" onClick={() => setSuivi((v) => !v)}>{suivi ? tr('Vue d’ensemble') : tr('Navigation')}</button>
          )}
        </div>
        <button className="sos" style={{ bottom: 40 }} onClick={() => setSos(true)} aria-label={tr('SOS')}>{tr('SOS')}</button>
      </div>

      {reduite ? (
        <div className="dv-ride-sheet reduite" ref={feuille.ref}>
          <button type="button" className="dv-poignee" {...feuille.poignee} aria-expanded={false} aria-label={tr('Tirer vers le haut pour ouvrir la fiche')}>
            <span className="dv-ride-grab" />
            <span className="dv-poignee-fleche haut" aria-hidden="true"><IconChevronDown size={16} /></span>
          </button>
          <AvisNouvelArret live={direct} />
          {/* Arrêt en cours : le compteur et « Continuer l'itinéraire » restent sous la main. */}
          {direct.arrets?.enCours && <PanneauArrets live={direct} role="chauffeur" enCourse position={app.position} />}
          <button type="button" className="dv-ride-resume" {...feuille.zone} onClick={feuille.toucher(() => setDeplie(true))} aria-expanded={false} aria-label={tr('Afficher les détails de la course')}>
            <span className="row between" style={{ width: '100%', gap: 12 }}>
              <span className="col grow" style={{ minWidth: 0, alignItems: 'flex-start' }}>
                <strong className="dv-ride-resume-titre">{resteMin !== null ? `${resteMin} min` : '…'} · {km(resteDistance)}</strong>
                <span className="faint dv-ride-resume-sous">
                  {(toPickup ? (livraison ? tr('Retrait du colis') : tr('Prise en charge')) : prochainArret ? tr('Arrêt : {0}', [prochainArret.nom]) : tr('Destination'))} · {contact.nom ?? (livraison ? tr('Client ORION') : tr('Passager ORION'))}
                </span>
              </span>
              <span className="dv-price" style={{ fontSize: 19 }}>{fcfa(brut)}</span>
            </span>
          </button>
          <div className="dv-ride-resume-actions">
            {direct.actif && (
              <button type="button" className="dv-act compact dv-act-chat" onClick={direct.ouvrirChat} aria-label={tr('Chat')}>
                <IconMessage size={18} />{direct.nonLus > 0 && <span className="cl-pastille">{direct.nonLus}</span>}
              </button>
            )}
            {ride.status === 'in_progress' && direct.actif && !direct.arrets?.enCours && (
              <button type="button" className="dv-act compact" onClick={() => setDeplie(true)} aria-label={tr('Arrêts')}><IconSablier size={18} /></button>
            )}
            {lienTel(contact.tel) && (
              <a className="dv-act compact" href={lienTel(contact.tel)!} aria-label={appelLabel(contact.tel)}><IconPhone size={18} /></a>
            )}
            {boutonEtape}
          </div>
        </div>
      ) : (
      <div className={`dv-ride-sheet${enNavigation ? ' depliee' : ''}`} ref={enNavigation ? feuille.ref : undefined}>
        {enNavigation && (
          <button type="button" className="dv-poignee" {...feuille.poignee} aria-expanded aria-label={tr('Réduire pour voir la carte')}>
            <span className="dv-ride-grab" />
            <span className="dv-poignee-fleche" aria-hidden="true"><IconChevronDown size={16} /></span>
          </button>
        )}
        <AvisNouvelArret live={direct} />
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
              ? (toPickup ? tr('Retrait du colis') : ride.status === 'arrived' ? tr('Colis à récupérer · {0}', [ride.livraison?.formule ? nomFormule(ride.livraison.formule) : TAILLE_COLIS[ride.category] ?? ride.category]) : tr('Livraison du colis'))
              : (toPickup ? tr('Prise en charge') : ride.status === 'arrived' ? tr('Client attendu') : tr('Destination'))}</div>
            <div className="h-title" style={{ fontSize: 19 }}>{contact.nom ?? (livraison ? tr('Client ORION') : tr('Passager ORION'))}</div>
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
        {(toPickup || ride.status === 'arrived') && isLiveBackend() && <PointDeRencontre rideId={ride.id} />}
        {livraison && <CarteColis ride={ride} enRetrait={enRetrait} />}
        {livraison && ride.status === 'arrived' && (
          <p className="faint dv-colis-conseil">{tr('Vérifiez que le colis est bien fermé et correspond à la description avant de partir.')}</p>
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
          {lienTel(contact.tel)
            ? <a className="dv-act" href={lienTel(contact.tel)!} data-testid="appeler-passager" aria-label={appelLabel(contact.tel)}><IconPhone size={18} />{!livraison ? tr('Appeler') : enRetrait ? tr('Expéditeur') : tr('Destinataire')}</a>
            : <span className="dv-act" style={{ opacity: 0.5 }}><IconPhone size={18} />{tr('Numéro masqué')}</span>}
        </div>

        {/* Chat et appel par internet avec le client (sans unités). */}
        <BoutonsCourse live={direct} />
        {/* Arrêts : « Je suis à l'arrêt » (arrêt prévu), « Arrêt demandé par le client », « Continuer l'itinéraire ». */}
        <PanneauArrets live={direct} role="chauffeur" enCourse={ride.status === 'in_progress'} position={app.position} />
        {ride.status === 'arrived' && (
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
          : ride.status === 'arrived' && <button className="btn btn-primary" disabled={app.busy} onClick={() => { deverrouillerAudio(); t('in_progress'); }}>{livraison ? tr('Colis récupéré, je livre') : tr('Client à bord — démarrer')}</button>}
        {ride.status === 'in_progress' && (remiseRequise ? <SaisieRemise app={app} rideId={ride.id} /> : (finDiscrete ?? boutonEtape))}

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
            {/* Le moyen choisi ne passe pas : le chauffeur autorise les espèces côté client. */}
            {electronic && cashAllowed && <BoutonEspeces live={direct} />}
            {cashAllowed ? (
              <button className={`btn ${electronic && !direct.especes.autorise ? 'btn-ghost' : 'btn-primary'}`} disabled={app.busy} onClick={() => void app.actions.collectCash(ride.id)}>
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

      {/* Discussion et appel : par-dessus l'écran, même carte réduite (appel entrant). */}
      <FenetreChat live={direct} moi="chauffeur" nomAutre={ride.client.name ?? tr('Passager')} />
      <EcranAppel live={direct} moi="chauffeur" nomAutre={ride.client.name ?? tr('Passager')} />
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

/** Immeuble · étage · porte · repère, sur une ligne ; vide si le client n'a rien précisé. */
function adresseLisible(a?: { batiment?: string; etage?: string; porte?: string; repere?: string } | null): string {
  if (!a) return '';
  return [a.batiment, a.etage && tr('Étage {0}', [a.etage]), a.porte && tr('Porte {0}', [a.porte]), a.repere].filter(Boolean).join(' · ');
}

/**
 * LE COLIS : formule, délai, options, consignes, puis les deux personnes de la livraison :
 * l'EXPÉDITEUR à appeler au retrait (un tiers quand le client commande pour quelqu'un) et le
 * DESTINATAIRE à la remise, chacun avec son adresse précise et un appel direct. L'étape en
 * cours est mise en avant.
 */
function CarteColis({ ride, enRetrait }: { ride: ActiveRide; enRetrait: boolean }) {
  const liv = ride.livraison ?? null;
  const exp = liv?.expediteur ?? (ride.client.name || ride.client.phone ? { nom: ride.client.name ?? tr('Client ORION'), telephone: ride.client.phone ?? '' } : null);
  const dest = liv?.destinataire ?? null;
  const pourAutrui = Boolean(liv?.expediteur);
  const avant = liv?.livrerAvant ? new Date(liv.livrerAvant) : null;
  const heure = avant && !Number.isNaN(avant.getTime()) ? avant.toLocaleTimeString(localeCourante(), { hour: '2-digit', minute: '2-digit' }) : null;
  const partie = (role: 'exp' | 'dest', p: { nom: string; telephone: string } | null, adresse: string, actif: boolean) => {
    if (!p) return null;
    const appel = lienTel(p.telephone);
    return (
      <div className={`dv-colis-partie${actif ? ' actif' : ''}`}>
        <span className={`dv-colis-pastille ${role}`} aria-hidden="true">{role === 'exp' ? <IconPackage size={15} /> : <IconPin size={15} />}</span>
        <span className="col grow" style={{ minWidth: 0 }}>
          <span className="faint">{role === 'exp' ? tr('Expéditeur') : tr('Destinataire')}{role === 'exp' && pourAutrui && ride.client.name ? ` · ${tr('Commandé par {0}', [ride.client.name])}` : ''}</span>
          <strong>{p.nom}</strong>
          {adresse && <span className="dv-colis-adresse">{adresse}</span>}
          {p.telephone && <span className="faint dv-colis-tel">{numeroLisible(p.telephone)}</span>}
        </span>
        {appel && <a className="dv-act compact" href={appel} aria-label={role === 'exp' ? tr('Appeler l’expéditeur {0}', [numeroLisible(p.telephone)]) : tr('Appeler le destinataire {0}', [numeroLisible(p.telephone)])}><IconPhone size={18} /></a>}
      </div>
    );
  };
  return (
    <div className="card dv-colis">
      <div className="dv-colis-tete">
        <span className="dv-colis-ico" aria-hidden="true"><IconPackage size={18} /></span>
        <span className="col grow" style={{ minWidth: 0 }}>
          <strong>{liv?.description ?? tr('Colis')}</strong>
          <span className="faint">{liv?.formule ? nomFormule(liv.formule) : tr('Taille : {0}', [TAILLE_COLIS[ride.category] ?? ride.category])} · {methodLabel(ride.paymentMethod)}</span>
        </span>
      </div>
      <div className="dv-colis-pilules">
        {liv?.delai && <span className={`dv-pill${liv.delai === 'express' ? ' gold' : ''}`}><IconClock size={13} /> {nomDelai(liv.delai)}{heure ? ` · ${tr('À livrer avant {0}', [heure])}` : ''}</span>}
        {liv && <span className="dv-pill">{liv.portePorte ? tr('Porte-à-porte') : tr('À l’entrée')}</span>}
        {liv?.isotherme && <span className="dv-pill">{tr('Sac isotherme')}</span>}
        {liv?.fragile && <span className="dv-pill gold">{tr('Fragile')}</span>}
      </div>
      {liv?.instructions && <p className="dv-colis-consigne">{liv.instructions}</p>}
      <div className="dv-colis-parties">
        {partie('exp', exp, adresseLisible(liv?.retrait), enRetrait)}
        {partie('dest', dest, adresseLisible(liv?.depot), !enRetrait)}
      </div>
      {!enRetrait && liv && <p className="faint dv-colis-conseil">{liv.portePorte ? tr('Montez jusqu’à la porte du destinataire.') : tr('Le destinataire vous rejoint à l’entrée.')}</p>}
    </div>
  );
}

/**
 * CODE DE REMISE : l'expéditeur l'a transmis au destinataire, qui le donne au livreur. Bon code :
 * le colis est remis à la bonne personne et la livraison se termine. Cinq erreurs bloquent.
 */
function SaisieRemise({ app, rideId }: { app: DriverApp; rideId: string }) {
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = async () => {
    setErreur(null);
    const e = await app.actions.livrer(rideId, code);
    if (e) { setErreur(e); setCode(''); }
  };
  return (
    <div className="dv-code">
      <label className="dv-code-titre" htmlFor="dv-remise-champ">{tr('Code de remise')}</label>
      <p className="dv-code-aide">{tr('Demandez au destinataire le code à 4 chiffres que l’expéditeur lui a transmis.')}</p>
      <div className="dv-code-saisie">
        <input id="dv-remise-champ" className="dv-code-champ" inputMode="numeric" autoComplete="one-time-code" maxLength={4}
          value={code} placeholder="••••" aria-invalid={erreur ? true : undefined}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 4)); setErreur(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 4) void valider(); }} />
      </div>
      {erreur && <p className="dv-code-erreur" role="alert">{erreur}</p>}
      <button className="btn btn-primary" disabled={app.busy || code.length !== 4} onClick={() => void valider()}>{tr('Vérifier le code et remettre le colis')}</button>
      <p className="faint" style={{ fontSize: 12, textAlign: 'center', margin: 0 }}>{tr('Le destinataire n’a pas le code ? Appelez l’expéditeur : il le lit dans son application ORION.')}</p>
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
    // Le toucher qui démarre la course ouvre aussi le son : l'accueil du client pourra partir.
    deverrouillerAudio();
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

/**
 * FEUILLE DE COURSE GLISSABLE (mode navigation). La poignée suit le doigt : tirée vers le haut,
 * la fiche s'ouvre ; tirée vers le bas, elle se replie et rend toute la carte. Un geste rapide
 * suffit, un simple toucher bascule aussi. Le reste de la barre réduite s'ouvre en la tirant
 * vers le haut ; ses boutons (chat, appel, étape) restent de vrais boutons.
 */
export function useGlisserFeuille(deplie: boolean, setDeplie: (v: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const geste = useRef<{ y: number; t: number; bouge: boolean } | null>(null);
  const ignorerClic = useRef(false);
  // Un geste n'est pas toujours suivi d'un clic : la consigne d'ignorer s'efface d'elle-même.
  const ignorer = () => { ignorerClic.current = true; window.setTimeout(() => { ignorerClic.current = false; }, 450); };
  const deplacer = (dy: number | null) => {
    const el = ref.current;
    if (!el) return;
    if (dy === null) { el.style.transition = ''; el.style.transform = ''; return; }
    // Ouverte : elle ne suit que vers le bas ; réduite : un peu vers le haut (amorti).
    const v = deplie ? Math.max(0, dy) : Math.max(-140, Math.min(0, dy)) * 0.6;
    el.style.transition = 'none';
    el.style.transform = `translateY(${Math.round(v)}px)`;
  };
  const debut = (e: PointeurReact<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    geste.current = { y: e.clientY, t: performance.now(), bouge: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture indisponible */ }
  };
  const mouvement = (e: PointeurReact<HTMLElement>) => {
    const g = geste.current;
    if (!g) return;
    const dy = e.clientY - g.y;
    if (!g.bouge && Math.abs(dy) > 8) g.bouge = true;
    if (g.bouge) deplacer(dy);
  };
  /** `tap` : ce qu'un simple toucher fait (la poignée bascule ; la barre réduite laisse le clic agir). */
  const fin = (tap: boolean) => (e: PointeurReact<HTMLElement>) => {
    const g = geste.current;
    geste.current = null;
    deplacer(null);
    if (!g) return;
    const dy = e.clientY - g.y;
    const vitesse = Math.abs(dy) / Math.max(1, performance.now() - g.t);
    if (!g.bouge) {
      if (tap) { ignorer(); setDeplie(!deplie); }
      return;
    }
    ignorer();
    if (deplie && (dy > 56 || (vitesse > 0.45 && dy > 16))) setDeplie(false);
    else if (!deplie && (dy < -28 || (vitesse > 0.45 && dy < -12))) setDeplie(true);
  };
  const annuler = () => { geste.current = null; deplacer(null); };
  // Le clic qui suit un geste (ou un toucher déjà traité) ne rebascule pas la feuille.
  const toucher = (action: () => void) => () => {
    if (ignorerClic.current) { ignorerClic.current = false; return; }
    action();
  };
  return {
    ref,
    poignee: {
      onPointerDown: debut, onPointerMove: mouvement, onPointerUp: fin(true), onPointerCancel: annuler,
      onClick: toucher(() => setDeplie(!deplie)),
    },
    zone: { onPointerDown: debut, onPointerMove: mouvement, onPointerUp: fin(false), onPointerCancel: annuler },
    toucher,
  };
}
