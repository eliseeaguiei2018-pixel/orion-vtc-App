/*
 * SERVICE WORKER ORION : console, tableau de bord et application chauffeur installables
 * depuis le navigateur (Windows, macOS, Android, iPhone, iPad, HarmonyOS).
 *
 * Ce qu'il fait : il garde l'ENVELOPPE de l'application (pages, scripts, styles, polices,
 * icônes) pour qu'elle s'ouvre tout de suite, même sur un réseau lent ou coupé.
 *
 * Ce qu'il ne fait JAMAIS : garder une réponse du serveur ORION. Courses, alertes SOS,
 * soldes et sessions passent toujours par le réseau : une donnée périmée serait
 * dangereuse, et une donnée personnelle n'a rien à faire dans un cache.
 */
const VERSION = 'orion-enveloppe-v1';
const PAGES = ['admin.html', 'dashboard.html', 'driver.html'];
const HORS_LIGNE = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ORION — hors connexion</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f6f3;color:#0c1f17;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px">
<div><h1 style="font-size:22px;margin:0 0 8px">Hors connexion</h1>
<p style="margin:0 0 18px;color:#4d6359">ORION a besoin du réseau pour afficher des données à jour.</p>
<button onclick="location.reload()" style="font:600 15px system-ui;padding:12px 20px;border-radius:12px;border:0;background:#0f9d6b;color:#fff">Réessayer</button></div>`;

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) if (nom !== VERSION) await caches.delete(nom);
    await self.clients.claim();
  })());
});

/** Fichiers de l'enveloppe : nom unique par version (hachage), donc jamais périmés. */
const estFichierFige = (url) => /\/assets\/[^/]+\.(js|css|woff2?|png|jpg|jpeg|webp|svg)$/.test(url.pathname)
  || /\/(icones|polices)\//.test(url.pathname);
const estPage = (url) => PAGES.some((p) => url.pathname.endsWith('/' + p));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // serveur ORION, cartes, tout le reste : réseau direct

  if (estFichierFige(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const garde = await cache.match(req);
      if (garde) return garde;
      const rep = await fetch(req);
      if (rep.ok) cache.put(req, rep.clone());
      return rep;
    })());
    return;
  }

  if (req.mode === 'navigate' && estPage(url)) {
    // La page : le réseau d'abord (une mise à jour arrive tout de suite), la copie sinon.
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const rep = await fetch(req);
        if (rep.ok) cache.put(url.pathname, rep.clone());
        return rep;
      } catch {
        return (await cache.match(url.pathname)) ?? new Response(HORS_LIGNE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    })());
  }
  // Tout le reste (dont les appels au serveur quand il partage le domaine) : non intercepté.
});
