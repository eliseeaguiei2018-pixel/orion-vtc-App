import type { DriverApp } from '../useDriver';
import type { ActiveRide } from '../types';

/* Écrans provisoires — remplacés dans un lot suivant. */
export function RideScreen({ ride }: { app: DriverApp; ride: ActiveRide }) {
  return <div className="dv-ride"><div className="dv-page">{ride.status}</div></div>;
}
export function SettledModal({ app }: { app: DriverApp }) {
  return <div className="dv-modal-back" onClick={app.actions.dismissSettled} />;
}
