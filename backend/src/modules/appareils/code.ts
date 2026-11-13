import { randomBytes, scrypt as scryptRappel, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * CODE DE SYNCHRONISATION ORION : jamais conservé en clair.
 *
 * Le serveur ne connaît que son EMPREINTE scrypt (variable ORION_CODE_SYNCHRO_EMPREINTE),
 * produite une fois par `npm run code-synchro`. Une fuite du dépôt, d'une sauvegarde ou
 * des variables d'environnement ne révèle donc pas le code. scrypt est volontairement
 * coûteux (environ 0,1 s et 32 Mo par essai) : tester des millions de codes devient
 * impraticable, d'autant que le serveur limite les essais.
 *
 * Saisie tolérante : majuscules, espaces et tirets sont ignorés. Un clavier de tablette
 * qui met une majuscule d'office, ou un code dicté par groupes, passent quand même.
 */
const N = 32768;
const R = 8;
const P = 1;
const LONGUEUR = 32;
const MEMOIRE = 64 * 1024 * 1024;

const scrypt = (code: string, sel: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((ok, ko) => {
    const options: ScryptOptions = { N: n, r, p, maxmem: MEMOIRE };
    scryptRappel(code, sel, LONGUEUR, options, (err, cle) => (err ? ko(err) : ok(cle)));
  });

/** Forme canonique du code : sans espaces ni tirets, en minuscules. */
export const normaliserCode = (code: string): string => code.normalize('NFKC').replace(/[\s\-_.]/g, '').toLowerCase();

/** Empreinte à placer dans ORION_CODE_SYNCHRO_EMPREINTE : scrypt$N$r$p$sel$cle (base64). */
export async function empreinteCodeSynchro(code: string): Promise<string> {
  const sel = randomBytes(16);
  const cle = await scrypt(normaliserCode(code), sel, N, R, P);
  return `scrypt$${N}$${R}$${P}$${sel.toString('base64')}$${cle.toString('base64')}`;
}

/** Vérifie un code saisi contre l'empreinte, en temps constant. */
export async function verifierCodeSynchro(code: string, empreinte: string): Promise<boolean> {
  const [algo, n, r, p, sel, cle] = empreinte.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !sel || !cle) return false;
  const attendue = Buffer.from(cle, 'base64');
  const obtenue = await scrypt(normaliserCode(code), Buffer.from(sel, 'base64'), Number(n), Number(r), Number(p));
  return attendue.length === obtenue.length && timingSafeEqual(attendue, obtenue);
}

/** Une empreinte est-elle bien formée ? (refus au démarrage sinon) */
export const empreinteValide = (e: string): boolean => /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(e);
