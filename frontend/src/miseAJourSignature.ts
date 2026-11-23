/**
 * Vérification des mises à jour à chaud (sans dépendance native : testée côté serveur aussi).
 * Le serveur ORION signe chaque manifeste (backend/src/modules/mises-a-jour/service.ts) ;
 * l'application ne télécharge une version que si la signature est valide.
 */
/** Clé publique ORION de vérification des mises à jour (ECDSA P-256, SPKI). */
const CLE_PUBLIQUE = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEzvC6h7+tdFIAKZCXzRdGhJP8b0ZmTa+vWhNdZgzALLQbYXjUtflHiLevI07ZFdHrQZmPhXtDElqdVaWGW+jqRw==';

export type AppOrion = 'client' | 'chauffeur' | 'console';
export interface ManifesteMaj {
  app: AppOrion; version: string; sha256: string; taille: number; natifMin: number;
  chemin: string; signature: string; notes?: string; publieLe?: string;
}

/** Message signé par le serveur (même calcul que backend/src/modules/mises-a-jour). */
export const messageMaj = (m: Pick<ManifesteMaj, 'app' | 'version' | 'sha256' | 'natifMin' | 'taille'>): string =>
  `ORION-MAJ\n${m.app}\n${m.version}\n${m.sha256}\n${m.natifMin}\n${m.taille}`;

const octets = (b64: string): Uint8Array<ArrayBuffer> => {
  const s = atob(b64);
  const o = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
  return o;
};

/** La signature du manifeste est-elle bien celle d'ORION ? */
export async function signatureValide(m: ManifesteMaj, clePublique = CLE_PUBLIQUE): Promise<boolean> {
  try {
    const cle = await crypto.subtle.importKey('spki', octets(clePublique), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, cle, octets(m.signature), new TextEncoder().encode(messageMaj(m)));
  } catch {
    return false;
  }
}

