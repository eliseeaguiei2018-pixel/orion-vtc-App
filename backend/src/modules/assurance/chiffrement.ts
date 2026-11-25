import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * CHIFFREMENT DU DOSSIER MÉDICAL (ORION Assurance).
 *
 * AES-256-GCM : chiffrement authentifié. Une donnée modifiée en base, même d'un seul
 * octet, est refusée au déchiffrement au lieu de renvoyer une information médicale
 * fausse. Chaque dossier a son propre vecteur d'initialisation aléatoire.
 *
 * Le dossier est LIÉ À SON TITULAIRE : l'identifiant du client entre dans le calcul
 * d'authentification (AAD). Recopier le dossier chiffré d'un client sur la fiche d'un
 * autre le rend illisible.
 *
 * La clé vient de MEDICAL_DATA_KEY (32 octets en base64), jamais du code ni de la
 * base. En développement seulement, une clé de test est dérivée d'une constante.
 * En production sans clé, le service est désactivé plutôt que de chiffrer avec une
 * clé connue de tous.
 */

export const VERSION_CHIFFREMENT = 'v1';

export interface DonneeChiffree {
  v: string;
  iv: string;
  tag: string;
  data: string;
}

export class CleMedicaleAbsente extends Error {
  constructor() {
    super('ORION Assurance indisponible : la clé de chiffrement du dossier médical n’est pas configurée sur le serveur.');
    this.name = 'CleMedicaleAbsente';
  }
}

export function chargerCle(brute: string | undefined, production: boolean): Buffer | null {
  if (brute) {
    const cle = Buffer.from(brute, 'base64');
    if (cle.length !== 32) throw new Error('MEDICAL_DATA_KEY doit contenir exactement 32 octets encodés en base64');
    return cle;
  }
  if (production) return null;
  return scryptSync('orion-dev-dossier-medical-ne-pas-utiliser-en-production', 'orion-assurance', 32);
}

export class CoffreMedical {
  constructor(private readonly cle: Buffer | null) {}

  get disponible(): boolean {
    return this.cle !== null;
  }

  chiffrer(titulaire: string, valeur: unknown): DonneeChiffree {
    if (!this.cle) throw new CleMedicaleAbsente();
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.cle, iv);
    c.setAAD(Buffer.from(`orion-assurance:${titulaire}`, 'utf8'));
    const data = Buffer.concat([c.update(JSON.stringify(valeur), 'utf8'), c.final()]);
    return { v: VERSION_CHIFFREMENT, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  dechiffrer<T>(titulaire: string, d: DonneeChiffree): T {
    if (!this.cle) throw new CleMedicaleAbsente();
    if (d.v !== VERSION_CHIFFREMENT) throw new Error(`Version de chiffrement inconnue : ${d.v}`);
    const dc = createDecipheriv('aes-256-gcm', this.cle, Buffer.from(d.iv, 'base64'));
    dc.setAAD(Buffer.from(`orion-assurance:${titulaire}`, 'utf8'));
    dc.setAuthTag(Buffer.from(d.tag, 'base64'));
    const clair = Buffer.concat([dc.update(Buffer.from(d.data, 'base64')), dc.final()]);
    return JSON.parse(clair.toString('utf8')) as T;
  }
}
