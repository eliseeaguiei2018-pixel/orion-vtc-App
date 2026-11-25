/**
 * MODE ÉCRAN DE VÉHICULE.
 *
 * La même app Chauffeur s'ouvre sur l'écran large de la voiture (Android Automotive,
 * écran embarqué du constructeur, tablette de bord) en mode paysage, avec de grandes
 * cibles tactiles et la navigation guidée en grand. Le chauffeur n'y saisit jamais ses
 * identifiants : il appaire l'écran avec un code affiché sur son téléphone.
 *
 * Le mode s'active par l'adresse `?ecran=vehicule` (mémorisée ensuite sur l'appareil) ou
 * par la page dédiée vehicule.html.
 */
const CLE = 'orion.driver.ecran';

export function estEcranVehicule(): boolean {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('ecran') === 'vehicule') { localStorage.setItem(CLE, 'vehicule'); return true; }
    if (params.get('ecran') === 'telephone') { localStorage.removeItem(CLE); return false; }
    return localStorage.getItem(CLE) === 'vehicule';
  } catch {
    return new URLSearchParams(location.search).get('ecran') === 'vehicule';
  }
}

/** Force le mode écran de véhicule (page vehicule.html). */
export function activerEcranVehicule(): void {
  try { localStorage.setItem(CLE, 'vehicule'); } catch { /* stockage indisponible */ }
}
