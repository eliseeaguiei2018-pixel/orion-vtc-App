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

/**
 * Feuille du bas. `pied` reste collé en bas de la feuille pendant que le reste défile :
 * l'action principale (confirmer, payer) est toujours sous le pouce, sans faire défiler.
 */
export function Sheet({ children, pied }: { children: ReactNode; pied?: ReactNode }) {
  return (
    <div className={`sheet${pied ? ' a-pied' : ''}`}>
      <div className="grabber" />
      {children}
      {pied && <div className="sheet-pied">{pied}</div>}
    </div>
  );
}
