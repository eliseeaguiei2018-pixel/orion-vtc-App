import type { Recuperer } from './acces.js';
import { ClesGoogle, JetonRefuse, verifierJetonGoogle } from './jetons.js';

/**
 * IDENTITY PLATFORM — la preuve du numéro de téléphone est faite par Google.
 *
 * L'application ouvre une session Identity Platform (connexion par SMS) et reçoit un jeton
 * d'identité signé par Google. Elle le présente au serveur ORION, qui le vérifie ici :
 * signature, projet, dates, et présence d'un numéro vérifié. Le serveur ouvre alors le compte
 * ORION de ce numéro, exactement comme après son propre code SMS.
 *
 * Ce que cela apporte : l'envoi des SMS, la limitation des abus (reCAPTCHA intégré), le
 * blocage des numéros surtaxés et la révocation des sessions sont assurés par Google.
 */
export interface IdentiteVerifiee {
  uid: string; telephone?: string; email?: string; emailVerifie: boolean; fournisseur?: string;
}

export class IdentitePlateforme {
  private readonly cles: ClesGoogle;

  constructor(private readonly o: { projet: string; locataire?: string; recuperer?: Recuperer; maintenant?: () => number }) {
    this.cles = new ClesGoogle('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', o.recuperer, o.maintenant);
  }

  async verifier(jeton: string): Promise<IdentiteVerifiee> {
    const c = await verifierJetonGoogle(jeton, {
      cles: this.cles, maintenant: this.o.maintenant,
      emetteurs: [`https://securetoken.google.com/${this.o.projet}`], destinataires: [this.o.projet],
    });
    // La connexion elle-même ne peut pas dater du futur.
    const t = Math.floor((this.o.maintenant ?? Date.now)() / 1000);
    if (typeof c.auth_time === 'number' && c.auth_time - 60 > t) throw new JetonRefuse('date de connexion dans le futur');
    // Projet à plusieurs locataires : seul celui d'ORION est accepté.
    if (this.o.locataire && c.firebase?.tenant !== this.o.locataire) throw new JetonRefuse('locataire');
    return {
      uid: c.sub!, telephone: typeof c.phone_number === 'string' ? c.phone_number : undefined,
      email: typeof c.email === 'string' ? c.email : undefined, emailVerifie: c.email_verified === true,
      fournisseur: c.firebase?.sign_in_provider,
    };
  }
}
