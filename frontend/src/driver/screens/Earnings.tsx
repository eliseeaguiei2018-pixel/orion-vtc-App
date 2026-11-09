import type { ScreenProps } from '../Driver';
import { PageHeader } from '../ui';

/* Écran provisoire — remplacé dans un lot suivant. */
export function Earnings({ app }: ScreenProps) {
  return <div className="dv-page"><PageHeader title="Earnings" sub={app.driver?.name} /></div>;
}
