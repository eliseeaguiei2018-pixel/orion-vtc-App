import type { ScreenProps } from '../Driver';
import { PageHeader } from '../ui';

/* Écran provisoire — remplacé dans un lot suivant. */
export function Green({ app }: ScreenProps) {
  return <div className="dv-page"><PageHeader title="Green" sub={app.driver?.name} /></div>;
}
