import '../polices.css';
import { activerEcranVehicule } from './ecran';

// Page dédiée à l'écran embarqué du véhicule : on fixe le mode avant de charger l'app,
// puis on réutilise exactement la même application Chauffeur (main.tsx).
activerEcranVehicule();
void import('./main');
