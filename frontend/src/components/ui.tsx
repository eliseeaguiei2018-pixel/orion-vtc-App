import type { ReactNode } from 'react';
import { IconArrowLeft } from '../icons';

export function TopBar({ onBack, title, right }: { onBack?: () => void; title?: string; right?: ReactNode }) {
  return (
    <div className="topbar">
      {onBack ? (
        <button className="avatar" onClick={onBack} aria-label="Retour">
          <IconArrowLeft size={20} />
        </button>
      ) : (
        <div className="brand">
          <span className="dot" />
          ORION
        </div>
      )}
      {title && <div className="h-title" style={{ fontSize: 17 }}>{title}</div>}
      {right ?? <span className="topbar-vide" aria-hidden="true" />}
    </div>
  );
}

export function Toast({ message, danger }: { message: string; danger?: boolean }) {
  return <div className={`toast${danger ? ' danger' : ''}`}>{message}</div>;
}

export function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="sheet">
      <div className="grabber" />
      {children}
    </div>
  );
}
