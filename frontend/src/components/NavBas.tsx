import { useI18n } from '../i18n';
import { IconGrid, IconHome, IconReceipt, IconUser } from '../icons';

/** Les quatre volets de l'application. Chaque valeur est l'écran racine du volet. */
export type Onglet = 'home' | 'services' | 'history' | 'settings';
export const ONGLETS: Onglet[] = ['home', 'services', 'history', 'settings'];

/**
 * BARRE DU BAS — Accueil, Services, Activité, Compte.
 *
 * Une pilule flottante, toujours au même endroit sur les quatre écrans racines. Le volet
 * ouvert est marqué par un fond et un texte plus dense, pas par une couleur.
 */
export function NavBas({ actif, onAller, nonLus = 0 }: { actif: Onglet; onAller: (o: Onglet) => void; nonLus?: number }) {
  const { t } = useI18n();
  const volets: Array<[Onglet, string, string, JSX.Element]> = [
    ['home', 'nav-accueil', t('nav_accueil'), <IconHome size={22} strokeWidth={1.9} key="a" />],
    ['services', 'nav-services', t('nav_services'), <IconGrid size={22} strokeWidth={1.9} key="s" />],
    ['history', 'nav-activite', t('nav_activite'), <IconReceipt size={22} strokeWidth={1.9} key="h" />],
    ['settings', 'nav-compte', t('nav_compte'), <IconUser size={22} strokeWidth={1.9} key="c" />],
  ];
  return (
    <nav className="nav-bas" aria-label={t('nav_titre')}>
      {volets.map(([cle, classe, nom, icone]) => (
        <button key={cle} className={`nav-onglet ${classe}${actif === cle ? ' actif' : ''}`} aria-current={actif === cle ? 'page' : undefined} onClick={() => onAller(cle)}>
          <span className="nav-ico">{icone}{cle === 'settings' && nonLus > 0 && <b>{nonLus > 9 ? '9+' : nonLus}</b>}</span>
          {nom}
        </button>
      ))}
    </nav>
  );
}
