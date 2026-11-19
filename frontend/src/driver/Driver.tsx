import { useState } from 'react';
import { LogoIcon } from '../components/Logo';
import { useDriver, type DriverApp } from './useDriver';
import { BottomNav, Modal, type Tab } from './ui';
import { dateTime } from './format';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { Rides } from './screens/Rides';
import { Earnings } from './screens/Earnings';
import { Green } from './screens/Green';
import { Profile } from './screens/Profile';
import { OfferSheet } from './screens/Offer';
import { RideScreen, SettledModal } from './screens/Ride';
import { Poste } from './screens/Poste';
import { SosLive, SosPill } from './screens/SosLive';

/**
 * APP CHAUFFEUR ORION — troisième page du projet (driver.html), à côté de l'app cliente
 * (index.html) et de la console (admin.html). Synchronisée en temps réel avec le backend
 * et la console : voir useDriver().
 */
export function DriverApp() {
  const app = useDriver();
  return (
    <div className="app-shell">
      <div className="phone">
        <Shell app={app} />
      </div>
    </div>
  );
}

function Shell({ app }: { app: DriverApp }) {
  const [tab, setTab] = useState<Tab>('home');
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [seen, setSeen] = useState(0);

  if (app.booting) {
    return (
      <div className="dv-login" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <LogoIcon size={84} />
        <div className="eyebrow" style={{ marginTop: 14 }}>ORION Chauffeur</div>
      </div>
    );
  }
  if (!app.session) return <><Login app={app} />{app.toast && <Toast app={app} />}</>;
  if (!app.driver) {
    return (
      <div className="dv-login" style={{ justifyContent: 'center' }}>
        <h1 className="h-title">Connexion au serveur impossible</h1>
        <p className="h-sub">Vérifiez votre réseau puis réessayez.</p>
        <button className="btn btn-primary" onClick={() => void app.actions.refresh()}>Réessayer</button>
        <button className="btn btn-ghost" onClick={() => void app.actions.logout()}>Se déconnecter</button>
      </div>
    );
  }

  const unread = Math.max(0, app.notices.length - seen);
  const openNotices = () => { setNoticesOpen(true); setSeen(app.notices.length); };
  const common = { app, unread, openNotices };
  const ride = app.activeRide;

  return (
    <div className="dv-app">
      {tab === 'home' && <Home {...common} onTab={setTab} />}
      {tab === 'rides' && <Rides {...common} />}
      {tab === 'earnings' && <Earnings {...common} />}
      {tab === 'poste' && <Poste {...common} />}
      {tab === 'green' && <Green {...common} />}
      {tab === 'profile' && <Profile {...common} />}
      <BottomNav tab={tab} onTab={setTab} alert={{
        profile: app.driver.kycStatus === 'draft',
        earnings: Boolean(app.finance?.cashBlocked),
        rides: app.rentals.some((r) => r.status === 'confirmee' && Date.parse(r.debut) - Date.now() < 86_400_000),
      }} />

      {ride && !ride.offer && <RideScreen app={app} ride={ride} />}
      {ride?.offer && <OfferSheet app={app} ride={ride} />}
      {app.settled && <SettledModal app={app} />}
      {noticesOpen && (
        <Modal title="Notifications" onClose={() => setNoticesOpen(false)}>
          {app.notices.length === 0 && app.announcements.length === 0 && <div className="dv-empty">Aucune notification pour l’instant.</div>}
          <div className="col" style={{ gap: 8 }}>
            {app.notices.map((n) => (
              <div key={`${n.kind}-${n.id}`} className="card dv-item" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="dv-item-title">{n.kind === 'announcement' ? '📢 ' : ''}{n.title}</div>
                  <div className="dv-item-sub" style={{ marginTop: 2 }}>{n.body}</div>
                  <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{dateTime(n.at)}</div>
                </div>
              </div>
            ))}
            {app.announcements.filter((a) => !app.notices.some((n) => n.id === a.id)).map((a) => (
              <div key={`ann-${a.id}`} className="card dv-item" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="dv-item-title">📢 {a.title}</div>
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
