'use strict';
/**
 * Les deux applications de bureau ORION. Une seule base de code, deux applications
 * SÉPARÉES : chacune a son nom, son icône, son identifiant et son propre espace de
 * stockage (sessions et clé d'appareil ne se mélangent pas).
 */
const APPLICATIONS = {
  console: {
    id: 'console',
    nom: 'ORION Console',
    appId: 'ci.orion.console',
    icone: 'console',
    fond: '#f2f6f3',
    partition: 'persist:orion-console',
    largeur: 1440,
    hauteur: 900,
  },
  tableau: {
    id: 'tableau',
    nom: 'ORION Tableau de bord',
    appId: 'ci.orion.tableau',
    icone: 'tableau',
    fond: '#eef2ef',
    partition: 'persist:orion-tableau',
    largeur: 1600,
    hauteur: 900,
  },
};

/** Schémas qu'on confie au système (navigateur, téléphone, messagerie), jamais chargés dans l'application. */
const SCHEMAS_EXTERNES = new Set(['http:', 'https:', 'tel:', 'sms:', 'mailto:']);

function application(id) {
  const a = APPLICATIONS[id];
  if (!a) throw new Error(`Application ORION inconnue : « ${id} » (console ou tableau)`);
  return a;
}

/**
 * Adresses à essayer au lancement, dans l'ordre : la principale, puis les secours.
 * `surcharge` (variable ORION_URL) sert aux essais ; elle est ignorée dans une application
 * installée, pour qu'une variable d'environnement ne puisse pas rediriger un poste.
 */
function adresses(config, id, surcharge) {
  const c = (config && config[id]) || {};
  const liste = [surcharge, c.url, ...(Array.isArray(c.secours) ? c.secours : [])]
    .filter((u) => typeof u === 'string' && u.length > 0);
  const valides = [];
  for (const u of liste) {
    try {
      const url = new URL(u);
      // HTTPS partout ; le HTTP n'est toléré que pour un serveur local d'essai.
      const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) valides.push(url.toString());
    } catch { /* adresse mal formée : ignorée */ }
  }
  return [...new Set(valides)];
}

/** Origines dans lesquelles l'application a le droit de naviguer : celles de ses adresses. */
function originesAutorisees(urls) {
  return new Set(urls.map((u) => new URL(u).origin));
}

/**
 * Que faire d'un lien ? « interne » : il reste dans l'application ; « externe » : il part
 * vers le navigateur, le téléphone ou la messagerie du poste ; « refuse » : ignoré
 * (file:, javascript:, protocoles inconnus).
 */
function destination(lien, origines) {
  let url;
  try { url = new URL(lien); } catch { return 'refuse'; }
  if ((url.protocol === 'https:' || url.protocol === 'http:') && origines.has(url.origin)) return 'interne';
  if (SCHEMAS_EXTERNES.has(url.protocol)) return 'externe';
  return 'refuse';
}

/** Permissions du navigateur accordées à l'application. Tout le reste est refusé. */
const PERMISSIONS = new Set(['notifications', 'fullscreen', 'clipboard-sanitized-write']);

module.exports = { APPLICATIONS, application, adresses, originesAutorisees, destination, PERMISSIONS };
