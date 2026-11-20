/**
 * SERVEUR ORION : adresse principale et adresses de secours.
 *
 *   VITE_API_URL=https://api.orion.ci
 *   VITE_API_URLS_SECOURS=https://api2.orion.ci,https://orion-backend.onrender.com
 *
 * Au lancement, la console et le tableau de bord vérifient que le serveur principal
 * répond. S'il ne répond pas en 2,5 s, ils essaient les adresses de secours dans l'ordre
 * et travaillent avec la première qui répond. Sans adresse de secours configurée, rien
 * n'est vérifié : le lancement ne perd pas une milliseconde.
 *
 * Une adresse de secours sur un autre domaine demande de se reconnecter (et d'enrôler
 * l'appareil sur ce domaine) : les cookies de session ne voyagent pas d'un domaine à l'autre.
 */
const propre = (u: string | undefined) => (u ?? '').trim().replace(/\/$/, '');
const PRINCIPAL = propre(import.meta.env.VITE_API_URL as string | undefined);
const SECOURS = ((import.meta.env.VITE_API_URLS_SECOURS as string | undefined) ?? '').split(',').map(propre).filter(Boolean);
const CLE = 'orion.serveur';

/** Les adresses connues, la principale d'abord. */
export const serveursConnus = (): string[] => [PRINCIPAL, ...SECOURS.filter((s) => s !== PRINCIPAL)];

/** L'adresse en service pour cette fenêtre (choisie au lancement). */
export function serveurActif(): string {
  try {
    const choisi = sessionStorage.getItem(CLE);
    if (choisi !== null && serveursConnus().includes(choisi)) return choisi;
  } catch { /* stockage indisponible */ }
  return PRINCIPAL;
}

/** Travaille-t-on sur une adresse de secours ? */
export const surServeurDeSecours = (): boolean => serveurActif() !== PRINCIPAL;

async function repond(url: string, delaiMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), delaiMs);
  try {
    const r = await fetch(`${url}/health/live`, { signal: ctrl.signal, cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Choisit le serveur de cette fenêtre : le principal s'il répond, sinon le premier
 * secours qui répond. À appeler AVANT de charger l'application.
 */
export async function choisirServeur(delaiMs = 2500): Promise<string> {
  if (!PRINCIPAL || SECOURS.length === 0) return PRINCIPAL;
  let choisi = PRINCIPAL;
  for (const url of serveursConnus()) {
    if (await repond(url, delaiMs)) { choisi = url; break; }
  }
  try { sessionStorage.setItem(CLE, choisi); } catch { /* stockage indisponible */ }
  return choisi;
}
