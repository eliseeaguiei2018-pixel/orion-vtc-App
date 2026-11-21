import '../stockageSur';
import '../polices.css';
import { enregistrerServiceWorker } from '../pwa';
import { choisirServeur } from '../serveur';

// Le serveur d'abord : le principal s'il répond, sinon une adresse de secours. La console
// n'est chargée qu'ensuite, pour que tous ses appels partent vers le bon serveur.
void choisirServeur().then(() => import('./demarrage'));

// Application web installable (Windows, macOS, tablettes, téléphones) et accès de secours.
enregistrerServiceWorker();
