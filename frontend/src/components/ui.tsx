import type { ReactNode } from 'react';
import { IconArrowLeft, IconLeaf } from '../icons';

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
      {right ?? <div className="avatar"><IconLeaf size={20} /></div>}
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
