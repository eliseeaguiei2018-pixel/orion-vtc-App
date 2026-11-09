import type { ReactNode } from 'react';
import { IconBell, IconCar, IconHome, IconLeaf, IconSettings, IconWallet } from '../icons';

export type Tab = 'home' | 'rides' | 'earnings' | 'green' | 'profile';

/** Barre d'onglets du bas (pouce-friendly). */
export function BottomNav({ tab, onTab, alert }: { tab: Tab; onTab: (t: Tab) => void; alert?: Partial<Record<Tab, boolean>> }) {
  const items: Array<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: 'home', label: 'Accueil', icon: <IconHome size={21} /> },
    { id: 'rides', label: 'Courses', icon: <IconCar size={21} /> },
    { id: 'earnings', label: 'Gains', icon: <IconWallet size={21} /> },
    { id: 'green', label: 'Éco', icon: <IconLeaf size={21} /> },
    { id: 'profile', label: 'Profil', icon: <IconSettings size={21} /> },
  ];
  return (
    <nav className="dv-tabs" aria-label="Navigation">
      {items.map((it) => (
        <button key={it.id} className={`dv-tab${tab === it.id ? ' on' : ''}`} onClick={() => onTab(it.id)} aria-current={tab === it.id}>
          <span className="dv-tab-ico">{it.icon}{alert?.[it.id] && <i className="dv-dot" />}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** En-tête de page : titre + action à droite (cloche des notifications…). */
export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="dv-header">
      <div>
        <h1 className="h-title">{title}</h1>
        {sub && <div className="faint" style={{ fontSize: 13, marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </header>
  );
}

export function BellButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button className="avatar dv-bell" onClick={onClick} aria-label={`Notifications (${count})`}>
      <IconBell size={20} />
      {count > 0 && <span className="dv-bell-n">{count > 9 ? '9+' : count}</span>}
    </button>
  );
}

/** Bandeau d'information (maintenance, suspension, dette…). */
export function Banner({ tone = 'info', icon, title, children, action }: {
  tone?: 'info' | 'warn' | 'danger' | 'success'; icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className={`dv-banner ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon && <div className="dv-banner-ico">{icon}</div>}
      <div className="grow">
        <strong>{title}</strong>
        {children && <div className="dv-banner-body">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** Tuile de statistique. */
export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`dv-stat card${accent ? ' accent' : ''}`}>
      <span className="dv-stat-label">{label}</span>
      <span className="dv-stat-value">{value}</span>
      {sub && <span className="dv-stat-sub">{sub}</span>}
    </div>
  );
}

/** Jauge horizontale (0..max). */
export function Progress({ value, max, tone = 'green' }: { value: number; max: number; tone?: 'green' | 'gold' | 'danger' }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div className="dv-bar"><span className={tone} style={{ width: `${w}%` }} /></div>;
}

/** Section titrée dans une page défilante. */
export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="dv-section">
      <div className="row between"><h2 className="dv-section-title">{title}</h2>{right}</div>
      {children}
    </section>
  );
}

/** Panneau modal en bas d'écran. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="dv-modal-back" onClick={onClose}>
      <div className="dv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 className="h-title" style={{ fontSize: 19 }}>{title}</h2>
          <button className="dv-x" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
