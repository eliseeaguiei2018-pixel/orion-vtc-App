import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as AppNative } from '@capacitor/app';
import { LogoApp } from '../components/Logo';
import { useDriver, type DriverApp } from './useDriver';
import { BottomNav, Modal, type Tab } from './ui';
import { dateTime } from './format';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { Rides } from './screens/Rides';
import { Activite } from './screens/Activite';
import { Prime } from './screens/Prime';
import { Green } from './screens/Green';
import { Profile } from './screens/Profile';
import { OfferSheet } from './screens/Offer';
import { RideScreen, SettledModal } from './screens/Ride';
import { Poste } from './screens/Poste';
import { SosLive, SosPill } from './screens/SosLive';
import { tr, useLangueChauffeur } from './i18n';
import { estEcranVehicule } from './ecran';
import { Appairage } from './screens/Appairage';
import { LockScreen } from '../components/Verrou';
import { isBiometricEnabled } from '../security';

/**
 * APP CHAUFFEUR ORION — troisième page du projet (driver.html), à côté de l'app cliente
 * (index.html) et de la console (admin.html). Synchronisée en temps réel avec le backend
 * et la console : voir useDriver().
 */
export function DriverApp() {
  // La langue choisie est appliquée avant le rendu des écrans (toasts compris).
  useLangueChauffeur();
  const app = useDriver();
  // Écran de véhicule : plein écran paysage, sans le cadre « téléphone ».
  const vehicule = estEcranVehicule();
  if (typeof document !== 'undefined') document.documentElement.dataset.ecran = vehicule ? 'vehicule' : 'telephone';
  if (vehicule) {
    return (
      <div className="app-shell ecran-vehicule">
        <div className="veh-cadre">
          <Shell app={app} vehicule />
        </div>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <SuggestionEcranVehicule />
      <div className="phone">
        <Shell app={app} />
      </div>
    </div>
  );
}

/**
 * Écran tactile large et bas, en paysage (écran embarqué d'une voiture, tablette de bord) :
 * l'app « téléphone » n'y occupe qu'une bande étroite au centre. On propose le mode écran
 * de véhicule (plein écran, grandes cibles), sans jamais l'imposer.
 */
function SuggestionEcranVehicule() {
  const requete = '(orientation: landscape) and (max-height: 820px) and (min-width: 960px) and (pointer: coarse)';
  const [visible, setVisible] = useState(() => typeof matchMedia === 'function' && matchMedia(requete).matches);
  if (!visible) return null;
  return (
    <div className="dv-suggestion-veh" role="note">
      <span>{tr('Écran de voiture détecté : passez au mode écran de véhicule, en plein écran.')}</span>
      <a className="dv-btn-veh" href="./vehicule.html">{tr('Mode véhicule')}</a>
      <button className="dv-btn-fermer" aria-label={tr('Fermer')} onClick={() => setVisible(false)}>×</button>
    </div>
  );
}

function Shell({ app, vehicule = false }: { app: DriverApp; vehicule?: boolean }) {
  const [tab, setTabBrut] = useState<Tab>('home');
  // Empreinte ou visage liés dans le profil : demandés à l'ouverture (comme l'app client).
  // L'écran de véhicule s'appaire par code : pas de verrou par empreinte.
  const [verrouille, setVerrouille] = useState(() => !vehicule && isBiometricEnabled());

  /*
   * POSITION GARDÉE (comme le volet Compte de l'app client 1.5.8) : chaque onglet retient
   * où sa page était arrêtée et y revient ; toucher l'onglet déjà ouvert remonte en haut.
   */
  const positions = useRef<Partial<Record<Tab, number>>>({});
  const page = () => document.querySelector<HTMLElement>('.dv-app .dv-page');
  const setTab = (t: Tab) => {
    const courante = page();
    if (t === tab) { courante?.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (courante) positions.current[tab] = courante.scrollTop;
    setTabBrut(t);
  };
  useLayoutEffect(() => {
    const voulu = positions.current[tab] ?? 0;
    if (voulu <= 0) return;
    let essais = 0, image = 0;
    const replacer = () => {
      const el = page();
      if (!el) return;
      el.scrollTop = voulu;
      if (Math.abs(el.scrollTop - voulu) > 1 && ++essais < 40) image = requestAnimationFrame(replacer);
    };
    replacer();
    return () => cancelAnimationFrame(image);
  }, [tab]);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [seen, setSeen] = useState(0);

  // App native Android (ORION Chauffeur) : le bouton retour ferme les notifications, revient
  // à l'accueil, puis met l'app en arrière-plan — jamais de sortie en pleine course.
  const etatRetour = useRef({ tab, noticesOpen });
  etatRetour.current = { tab, noticesOpen };
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    const ecoute = AppNative.addListener('backButton', () => {
      const e = etatRetour.current;
      if (e.noticesOpen) { setNoticesOpen(false); return; }
      if (e.tab !== 'home') { setTabBrut('home'); return; }
      void AppNative.minimizeApp();
    });
    return () => { void ecoute.then((l) => l.remove()); };
  }, []);

  if (app.booting) {
    return (
      <div className="dv-login" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <LogoApp size={84} />
        <div className="eyebrow" style={{ marginTop: 14 }}>{tr('ORION Chauffeur')}</div>
      </div>
    );
  }
  if (!app.session) return <>{vehicule ? <Appairage app={app} /> : <Login app={app} />}{app.toast && <Toast app={app} />}</>;
  if (!app.driver) {
    return (
      <div className="dv-login" style={{ justifyContent: 'center' }}>
        <h1 className="h-title">{tr('Connexion au serveur impossible')}</h1>
        <p className="h-sub">{tr('Vérifiez votre réseau puis réessayez.')}</p>
        <button className="btn btn-primary" onClick={() => void app.actions.refresh()}>{tr('Réessayer')}</button>
        <button className="btn btn-ghost" onClick={() => void app.actions.logout()}>{tr('Se déconnecter')}</button>
      </div>
    );
  }

  const unread = Math.max(0, app.notices.length - seen);
  const openNotices = () => { setNoticesOpen(true); setSeen(app.notices.length); };
  const common = { app, unread, openNotices };
  const ride = app.activeRide;

  if (verrouille) return <div className="dv-app"><LockScreen onUnlock={() => setVerrouille(false)} /></div>;

  return (
    <div className="dv-app">
      {tab === 'home' && <Home {...common} onTab={setTab} />}
      {tab === 'rides' && <Rides {...common} />}
      {tab === 'activite' && <Activite {...common} />}
      {tab === 'prime' && <Prime {...common} />}
      {tab === 'poste' && <Poste {...common} />}
      {tab === 'green' && <Green {...common} />}
      {tab === 'profile' && <Profile {...common} />}
      <BottomNav tab={tab} onTab={setTab} alert={{
        profile: app.driver.kycStatus === 'draft',
        rides: app.rentals.some((r) => r.status === 'confirmee' && Date.parse(r.debut) - Date.now() < 86_400_000),
      }} />

      {ride && !ride.offer && <RideScreen app={app} ride={ride} />}
      {ride?.offer && <OfferSheet app={app} ride={ride} />}
      {app.settled && <SettledModal app={app} />}
      {noticesOpen && (
        <Modal title={tr('Notifications')} onClose={() => setNoticesOpen(false)}>
          {app.notices.length === 0 && app.announcements.length === 0 && <div className="dv-empty">{tr('Aucune notification pour l’instant.')}</div>}
          <div className="col" style={{ gap: 8 }}>
            {app.notices.map((n) => (
              <div key={`${n.kind}-${n.id}`} className="card dv-item" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="dv-item-title">{n.kind === 'announcement' ? '' : ''}{n.title}</div>
                  <div className="dv-item-sub" style={{ marginTop: 2 }}>{n.body}</div>
                  <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{dateTime(n.at)}</div>
                </div>
              </div>
            ))}
            {app.announcements.filter((a) => !app.notices.some((n) => n.id === a.id)).map((a) => (
              <div key={`ann-${a.id}`} className="card dv-item" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="dv-item-title">{a.title}</div>
                  <div className="dv-item-sub" style={{ marginTop: 2 }}>{a.body}</div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {app.sosLive && app.sosOuvert && <SosLive app={app} />}
      {app.sosLive && !app.sosOuvert && <SosPill app={app} />}
      {app.toast && <Toast app={app} />}
    </div>
  );
}

function Toast({ app }: { app: DriverApp }) {
  if (!app.toast) return null;
  return <div key={app.toast.id} className={`dv-toast ${app.toast.tone}`} role="status">{app.toast.message}</div>;
}

/** Propriétés communes des onglets. */
export interface ScreenProps { app: DriverApp; unread: number; openNotices: () => void }
