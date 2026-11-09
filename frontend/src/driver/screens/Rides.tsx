import type { ScreenProps } from '../Driver';
import { PageHeader } from '../ui';

/* Écran provisoire — remplacé dans un lot suivant. */
export function Rides({ app }: ScreenProps) {
  return <div className="dv-page"><PageHeader title="Rides" sub={app.driver?.name} /></div>;
}
