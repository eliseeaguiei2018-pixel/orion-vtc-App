import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MISES À JOUR À CHAUD des applications ORION (client, chauffeur, console).
 *
 * Les APK contiennent un moteur natif (Android) et une application web (écrans, règles,
 * textes). Ici, le serveur héberge la DERNIÈRE application web de chaque app, sous forme d'un
 * paquet zip. Les téléphones la téléchargent et l'installent d'eux-mêmes, au bon moment (jamais
 * en pleine course) : plus besoin de réinstaller une APK pour un changement d'écran ou de règle.
 * Seul un changement du moteur natif (nouvelle permission, nouveau module) demande encore une
 * APK ; le paquet l'indique (natifMin) et les téléphones trop anciens l'ignorent.
 *
 * Sécurité : chaque paquet est décrit par un MANIFESTE signé par le serveur (ECDSA P-256). La clé
 * privée ne quitte jamais le serveur : créée au premier démarrage sur son disque persistant
 * (lisible par lui seul), ou fournie par OTA_SIGNING_KEY ; jamais écrite dans le dépôt. L'application vérifie la signature avec
 * la clé publique intégrée à l'APK, puis le module natif vérifie l'empreinte SHA-256 du zip :
 * un paquet modifié en route, ou déposé sans passer par la direction, n'est jamais installé.
 * La publication est réservée à la direction (droit services:write) et journalisée.
 */
export const APPS = ['client', 'chauffeur', 'console'] as const;
export type AppOrion = (typeof APPS)[number];
export const estApp = (a: string): a is AppOrion => (APPS as readonly string[]).includes(a);

export interface Manifeste {
  app: AppOrion;
  version: string;
  /** Empreinte SHA-256 (hexadécimal) du paquet zip. */
  sha256: string;
  taille: number;
  /** Numéro de version native minimal (versionCode Android) pour installer ce paquet. */
  natifMin: number;
  notes: string;
  publieLe: string;
  /** Chemin du paquet sur ce serveur. */
  chemin: string;
  /** Signature ECDSA P-256 / SHA-256 (r‖s, base64) du message canonique (`messageASigner`). */
  signature: string;
}

export const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,47}$/;
export const TAILLE_MAX = 60 * 1024 * 1024;
const GARDER = 3;

/** Message signé : tout ce qui décide de l'installation. Même calcul dans l'application. */
export function messageASigner(m: Pick<Manifeste, 'app' | 'version' | 'sha256' | 'natifMin' | 'taille'>): string {
  return `ORION-MAJ\n${m.app}\n${m.version}\n${m.sha256}\n${m.natifMin}\n${m.taille}`;
}

/** Clé privée de signature depuis OTA_SIGNING_KEY (PKCS#8 en base64 ou PEM). */
export function lireCleSignature(valeur: string | undefined): KeyObject | null {
  const v = valeur?.trim();
  if (!v) return null;
  try {
    const cle = v.includes('BEGIN') ? createPrivateKey(v) : createPrivateKey({ key: Buffer.from(v, 'base64'), format: 'der', type: 'pkcs8' });
    if (cle.asymmetricKeyType !== 'ec') return null;
    return cle;
  } catch {
    return null;
  }
}

export class ErreurMiseAJour extends Error {
  constructor(readonly code: 'APP_INCONNUE' | 'VERSION_INVALIDE' | 'PAQUET_INVALIDE' | 'SIGNATURE_INDISPONIBLE' | 'DEJA_PUBLIEE', message: string) {
    super(message);
  }
}

export class MisesAJour {
  private readonly ecouteurs: Array<(m: Manifeste) => void> = [];
  private readonly cle: KeyObject | null;

  constructor(
    private readonly dossier: string,
    cleSignature: string | undefined,
    o: { creerCle?: boolean; maintenant?: () => Date } = {},
  ) {
    mkdirSync(dossier, { recursive: true });
    this.maintenant = o.maintenant ?? (() => new Date());
    this.cle = lireCleSignature(cleSignature) ?? (o.creerCle ? this.cleDuDisque() : null);
  }

  private readonly maintenant: () => Date;

  /** Clé du serveur sur son disque persistant, créée au premier démarrage (lisible par lui seul). */
  private cleDuDisque(): KeyObject | null {
    const f = join(this.dossier, 'cle-signature.pk8');
    try {
      if (!existsSync(f)) {
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        writeFileSync(f, privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), { mode: 0o600, flag: 'wx' });
      }
      return lireCleSignature(readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  }

  /** La publication est-elle possible (clé de signature présente) ? */
  get signatureDisponible(): boolean { return this.cle !== null; }

  /** Clé publique (SPKI, base64) : celle que les APK doivent porter. */
  clePublique(): string | null {
    if (!this.cle) return null;
    return createPublicKey(this.cle).export({ format: 'der', type: 'spki' }).toString('base64');
  }

  onPublication(f: (m: Manifeste) => void): void { this.ecouteurs.push(f); }

  manifeste(app: AppOrion): Manifeste | null {
    const f = join(this.dossier, app, 'manifeste.json');
    if (!existsSync(f)) return null;
    try { return JSON.parse(readFileSync(f, 'utf8')) as Manifeste; } catch { return null; }
  }

  /** Versions publiées de chaque app (console). */
  etat(): Record<AppOrion, Manifeste | null> {
    return Object.fromEntries(APPS.map((a) => [a, this.manifeste(a)])) as Record<AppOrion, Manifeste | null>;
  }

  /** Chemin disque d'un paquet publié, ou null (nom contrôlé : aucune sortie du dossier). */
  fichier(app: AppOrion, nom: string): string | null {
    if (!/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,47}\.zip$/.test(nom)) return null;
    const f = join(this.dossier, app, nom);
    return existsSync(f) ? f : null;
  }

  publier(app: string, zip: Buffer, o: { version: string; natifMin?: number; notes?: string }): Manifeste {
    if (!estApp(app)) throw new ErreurMiseAJour('APP_INCONNUE', `Application inconnue : ${app}`);
    if (!VERSION_RE.test(o.version)) throw new ErreurMiseAJour('VERSION_INVALIDE', 'Numéro de version invalide');
    if (!this.cle) throw new ErreurMiseAJour('SIGNATURE_INDISPONIBLE', 'Clé de signature des mises à jour absente du serveur (OTA_SIGNING_KEY)');
    if (zip.length < 22 || zip.length > TAILLE_MAX || zip[0] !== 0x50 || zip[1] !== 0x4b) {
      throw new ErreurMiseAJour('PAQUET_INVALIDE', 'Le paquet doit être un fichier zip de 60 Mo au plus');
    }
    // Le paquet doit contenir la page d'accueil de l'app à sa racine.
    if (!zip.includes(Buffer.from('index.html'))) throw new ErreurMiseAJour('PAQUET_INVALIDE', 'Le paquet ne contient pas index.html');
    const actuel = this.manifeste(app);
    if (actuel?.version === o.version) throw new ErreurMiseAJour('DEJA_PUBLIEE', `La version ${o.version} est déjà publiée`);

    const sha256 = createHash('sha256').update(zip).digest('hex');
    const natifMin = Math.max(0, Math.floor(o.natifMin ?? 0));
    const base = { app, version: o.version, sha256, natifMin, taille: zip.length };
    const signature = sign('sha256', Buffer.from(messageASigner(base)), { key: this.cle, dsaEncoding: 'ieee-p1363' }).toString('base64');
    const nom = `${o.version}.zip`;
    const m: Manifeste = { ...base, notes: (o.notes ?? '').slice(0, 500), publieLe: this.maintenant().toISOString(), chemin: `/apps/${app}/paquets/${nom}`, signature };

    const dossierApp = join(this.dossier, app);
    mkdirSync(dossierApp, { recursive: true });
    writeFileSync(join(dossierApp, `${nom}.part`), zip);
    renameSync(join(dossierApp, `${nom}.part`), join(dossierApp, nom));
    writeFileSync(join(dossierApp, 'manifeste.json.part'), JSON.stringify(m, null, 2));
    renameSync(join(dossierApp, 'manifeste.json.part'), join(dossierApp, 'manifeste.json'));
    this.nettoyer(dossierApp, nom);
    for (const f of this.ecouteurs) { try { f(m); } catch { /* un écouteur en échec ne bloque pas la publication */ } }
    return m;
  }

  /** Garde les derniers paquets (un téléphone peut être en train de télécharger le précédent). */
  private nettoyer(dossierApp: string, garde: string): void {
    const zips = readdirSync(dossierApp).filter((f) => f.endsWith('.zip') && f !== garde)
      .map((f) => ({ f, t: statSync(join(dossierApp, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of zips.slice(GARDER - 1)) rmSync(join(dossierApp, f), { force: true });
  }
}
