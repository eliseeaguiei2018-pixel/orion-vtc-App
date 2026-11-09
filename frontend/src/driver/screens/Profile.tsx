import type { ScreenProps } from '../Driver';
import { PageHeader } from '../ui';

/* Écran provisoire — remplacé dans un lot suivant. */
export function Profile({ app }: ScreenProps) {
  return <div className="dv-page"><PageHeader title="Profile" sub={app.driver?.name} /></div>;
}
