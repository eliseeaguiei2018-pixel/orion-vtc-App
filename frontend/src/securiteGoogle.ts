/**
 * SÉCURITÉ GOOGLE CÔTÉ APPLICATION — trois protections, chacune sur le besoin qui lui correspond.
 *
 *  - reCAPTCHA Enterprise : avant de demander un code SMS ou d'ouvrir la console, l'application
 *    obtient un jeton qui atteste qu'un humain agit ; le serveur le fait évaluer par Google et
 *    refuse les robots (pas de SMS envoyés à la chaîne aux frais d'ORION).
 *  - API Gateway : chaque appel à l'API porte la clé de l'application ; la passerelle écarte ce
 *    qui ne vient pas d'une application ORION et applique les quotas.
 *  - Identity Platform : la vérification du numéro de téléphone est confiée à Google (envoi et
 *    contrôle du code SMS) ; l'application présente ensuite au serveur le jeton d'identité reçu.
 *
 * Rien n'est actif sans réglage : chaque protection s'allume par une variable de construction
 * (VITE_RECAPTCHA_SITE_KEY, VITE_ORION_API_KEY, VITE_IDENTITY_PLATFORM_KEY). Ces trois valeurs
 * sont publiques par nature (elles vivent dans l'application) ; leur protection est leur
 * restriction dans Google Cloud (voir deploy/gcp/).
 */
const lire = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const CLE_SITE = lire(import.meta.env.VITE_RECAPTCHA_SITE_KEY);
const CLE_PASSERELLE = lire(import.meta.env.VITE_ORION_API_KEY);
const CLE_IDENTITE = lire(import.meta.env.VITE_IDENTITY_PLATFORM_KEY);

/**
 * Adresse de base des canaux temps réel. Quand l'API passe par API Gateway, le suivi en direct
 * peut aller droit à l'équilibreur (VITE_WS_URL, protégé par Cloud Armor) : une connexion
 * ouverte pendant toute une course n'a rien à faire dans les quotas d'appels de la passerelle.
 * Sans ce réglage, les canaux suivent l'adresse de l'API, comme avant.
 */
export function baseTempsReel(api: string): string | null {
  try {
    const u = new URL(lire(import.meta.env.VITE_WS_URL) || api);
    return `${u.protocol === 'https:' || u.protocol === 'wss:' ? 'wss:' : 'ws:'}//${u.host}`;
  } catch {
    return null;
  }
}

/** En-tête demandé par API Gateway (vide si la passerelle n'est pas utilisée). */
export function enTetesPasserelle(): Record<string, string> {
  return CLE_PASSERELLE ? { 'x-api-key': CLE_PASSERELLE } : {};
}

interface Recaptcha { ready(f: () => void): void; execute(cle: string, o: { action: string }): Promise<string> }
let chargement: Promise<Recaptcha | null> | null = null;

function chargerRecaptcha(): Promise<Recaptcha | null> {
  chargement ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(CLE_SITE)}`;
    s.async = true;
    const lu = () => (window as unknown as { grecaptcha?: { enterprise?: Recaptcha } }).grecaptcha?.enterprise ?? null;
    s.onload = () => { const g = lu(); if (g) g.ready(() => resolve(g)); else resolve(null); };
    // Sans réseau vers Google : on réessaiera à la prochaine demande.
    s.onerror = () => { chargement = null; s.remove(); resolve(null); };
    document.head.appendChild(s);
  });
  return chargement;
}

/**
 * Jeton reCAPTCHA Enterprise pour une action (« connexion_client », « connexion_chauffeur »,
 * « connexion_console »). Rien si reCAPTCHA n'est pas réglé ou si Google ne répond pas en
 * quatre secondes : le serveur décide alors (il refuse quand la vérification est obligatoire).
 */
export async function jetonRecaptcha(action: string): Promise<string | undefined> {
  if (!CLE_SITE) return undefined;
  const delai = new Promise<undefined>((r) => setTimeout(() => r(undefined), 4000));
  const jeton = chargerRecaptcha().then((g) => g?.execute(CLE_SITE, { action })).catch(() => undefined);
  return Promise.race([jeton, delai]);
}

/** En-tête à joindre à une demande protégée par reCAPTCHA. */
export async function enTeteRecaptcha(action: string): Promise<Record<string, string>> {
  const jeton = await jetonRecaptcha(action);
  return jeton ? { 'x-recaptcha-token': jeton } : {};
}

/* ------------------------------- Identity Platform ------------------------------- */

/** Vrai quand la vérification du numéro est confiée à Identity Platform. */
export const identiteGoogleActive = Boolean(CLE_IDENTITE);

const IDENTITE = 'https://identitytoolkit.googleapis.com/v1';
const MESSAGES: Record<string, string> = {
  INVALID_PHONE_NUMBER: 'Numéro de téléphone invalide.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Trop de demandes pour ce numéro. Réessayez plus tard.',
  QUOTA_EXCEEDED: 'Service momentanément saturé. Réessayez dans quelques minutes.',
  INVALID_CODE: 'Code incorrect.',
  INVALID_VERIFICATION_CODE: 'Code incorrect.',
  SESSION_EXPIRED: 'Code expiré — demandez un nouveau code.',
  CAPTCHA_CHECK_FAILED: 'Vérification de sécurité refusée. Réessayez.',
};

async function identite<T>(methode: string, corps: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${IDENTITE}/${methode}?key=${encodeURIComponent(CLE_IDENTITE)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps), signal: AbortSignal.timeout(12000),
    });
    const j = (await res.json()) as T & { error?: { message?: string } };
    if (res.ok) return { ok: true, data: j };
    const code = (j.error?.message ?? '').split(/[ :]/)[0] ?? '';
    return { ok: false, error: MESSAGES[code] ?? 'Vérification du numéro impossible pour le moment.' };
  } catch {
    return { ok: false, error: 'Connexion impossible. Vérifiez votre réseau et réessayez.' };
  }
}

/** Sessions d'envoi en cours, par numéro : le code saisi se vérifie contre celle de son numéro. */
const sessions = new Map<string, string>();

/** Demande à Identity Platform d'envoyer le code SMS (protégé par reCAPTCHA Enterprise). */
export async function envoyerCodeGoogle(phone: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const captcha = await jetonRecaptcha('sendVerificationCode');
  const r = await identite<{ sessionInfo: string }>('accounts:sendVerificationCode', {
    phoneNumber: phone,
    ...(captcha ? { captchaResponse: captcha, clientType: 'CLIENT_TYPE_WEB', recaptchaVersion: 'RECAPTCHA_ENTERPRISE' } : {}),
  });
  if (!r.ok) return r;
  sessions.set(phone, r.data.sessionInfo);
  return { ok: true };
}

/** Vérifie le code auprès d'Identity Platform ; rend le jeton d'identité à présenter au serveur ORION. */
export async function confirmerCodeGoogle(phone: string, code: string): Promise<{ ok: true; idToken: string } | { ok: false; error: string }> {
  const session = sessions.get(phone);
  if (!session) return { ok: false, error: 'Code expiré — demandez un nouveau code.' };
  const r = await identite<{ idToken: string }>('accounts:signInWithPhoneNumber', { sessionInfo: session, code });
  if (!r.ok) return r;
  sessions.delete(phone);
  return { ok: true, idToken: r.data.idToken };
}
