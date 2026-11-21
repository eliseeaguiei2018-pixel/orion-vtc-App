import type { AccesGoogle } from './acces.js';

/**
 * API KEYS — contrôle des clés d'API du projet.
 *
 * Une clé d'API circule forcément (celle de Google Maps est dans l'application) : sa seule
 * protection est sa restriction. Une clé sans restriction ouvre toutes les API activées du
 * projet à qui la copie, aux frais d'ORION. Ce contrôle lit les clés du projet (API Keys API,
 * `projects.locations.keys.list`) et signale celles qui ne sont pas restreintes :
 *  - à une liste d'API (`apiTargets`) ;
 *  - à une application : paquet Android et empreinte de signature, identifiant iOS, sites web
 *    autorisés ou adresses de serveurs.
 * La valeur des clés n'est jamais lue : seuls leur nom et leurs restrictions le sont.
 */
interface CleGoogle {
  name?: string; uid?: string; displayName?: string; createTime?: string;
  restrictions?: {
    apiTargets?: { service?: string }[];
    browserKeyRestrictions?: { allowedReferrers?: string[] };
    androidKeyRestrictions?: { allowedApplications?: { packageName?: string; sha1Fingerprint?: string }[] };
    iosKeyRestrictions?: { allowedBundleIds?: string[] };
    serverKeyRestrictions?: { allowedIps?: string[] };
  };
}

export interface ConstatCle {
  nom: string; identifiant: string; creee?: string;
  api: string[]; application: 'android' | 'ios' | 'web' | 'serveur' | 'aucune';
  /** Ce qui manque ; vide quand la clé est correctement restreinte. */
  alertes: string[];
}

export function constatCle(k: CleGoogle): ConstatCle {
  const r = k.restrictions ?? {};
  const api = (r.apiTargets ?? []).map((t) => t.service ?? '').filter(Boolean);
  const application = r.androidKeyRestrictions?.allowedApplications?.length ? 'android'
    : r.iosKeyRestrictions?.allowedBundleIds?.length ? 'ios'
    : r.browserKeyRestrictions?.allowedReferrers?.length ? 'web'
    : r.serverKeyRestrictions?.allowedIps?.length ? 'serveur' : 'aucune';
  const alertes: string[] = [];
  if (api.length === 0) alertes.push('aucune restriction d’API : la clé ouvre toutes les API activées du projet');
  if (application === 'aucune') alertes.push('aucune restriction d’application : la clé fonctionne depuis n’importe quel appareil, site ou serveur');
  if ((r.browserKeyRestrictions?.allowedReferrers ?? []).some((s) => s === '*' || s === '*/*')) alertes.push('sites autorisés : « * » revient à ne rien restreindre');
  return { nom: k.displayName ?? '(sans nom)', identifiant: k.uid ?? k.name?.split('/').pop() ?? '', creee: k.createTime, api, application, alertes };
}

/** Lit toutes les clés du projet et rend un constat par clé. */
export async function auditerCles(acces: AccesGoogle): Promise<ConstatCle[]> {
  const projet = await acces.projet();
  const constats: ConstatCle[] = [];
  let page = '';
  do {
    const r = await acces.appel<{ keys?: CleGoogle[]; nextPageToken?: string }>(
      'API Keys', `https://apikeys.googleapis.com/v2/projects/${projet}/locations/global/keys?pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`,
    );
    for (const k of r.keys ?? []) constats.push(constatCle(k));
    page = r.nextPageToken ?? '';
  } while (page);
  return constats;
}
