import type { DriverApp } from '../useDriver';
import type { ActiveRide } from '../types';

/* Écran provisoire — remplacé dans un lot suivant. */
export function OfferSheet({ app, ride }: { app: DriverApp; ride: ActiveRide }) {
  return (
    <div className="dv-offer-back"><div className="dv-offer">
      <button className="btn btn-primary" onClick={() => void app.actions.accept(ride.id)}>Accepter</button>
      <button className="btn btn-ghost" onClick={() => void app.actions.decline(ride.id)}>Refuser</button>
    </div></div>
  );
}
