#!/usr/bin/env node
/**
 * TEST DE FUMÉE MULTI-NAVIGATEURS (CI) — les 5 interfaces ORION s'ouvrent-elles sans
 * erreur, sans débordement, dans le moteur de chaque plateforme cible ?
 *
 *   NAVIGATEUR=webkit   → Safari (iPhone, iPad, Mac : même moteur que les WKWebView iOS)
 *   NAVIGATEUR=firefox  → Firefox
 *   NAVIGATEUR=msedge   → Microsoft Edge (Windows : console et tableau de bord)
 *   NAVIGATEUR=chromium → Chrome / WebView Android / ArkWeb (même moteur Blink)
 *
 * Construit en mode démonstration (sans serveur) : on teste le rendu et le code, pas le
 * réseau. Captures dans fumee-captures/ (publiées comme artefact par la CI).
 */
import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium, firefox, webkit } from 'playwright';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAV = process.env.NAVIGATEUR || 'chromium';
const SORTIE = path.join(racine, 'fumee-captures', NAV);
mkdirSync(SORTIE, { recursive: true });

const serveur = await preview({ root: racine, build: { outDir: process.env.FUMEE_DIST || 'dist' }, preview: { port: 4173, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
const BASE = 'http://127.0.0.1:4173';

const moteur = NAV === 'webkit' ? webkit : NAV === 'firefox' ? firefox : chromium;
const navigateur = await moteur.launch(NAV === 'msedge' ? { channel: 'msedge' } : {});

const TELEPHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: NAV !== 'firefox' };
const PC = { viewport: { width: 1366, height: 768 } };
const VOITURE = { viewport: { width: 1280, height: 720 }, hasTouch: true };
const CAS = [
  ['client', '/index.html', TELEPHONE, /Commencer|Get started|ORION/],
  ['chauffeur', '/driver.html', TELEPHONE, /ORION/],
  ['chauffeur-voiture', '/driver.html', VOITURE, /ORION/],
  ['console', '/admin.html', PC, /ORION/],
  ['console-telephone', '/admin.html', TELEPHONE, /ORION/],
  ['tableau-de-bord', '/dashboard.html', PC, /ORION/],
  ['ecran-vehicule', '/vehicule.html', VOITURE, /ORION/],
];

let echecs = 0;
for (const [nom, url, options, attendu] of CAS) {
  const ctx = await navigateur.newContext({ ...options, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  try {
    await page.goto(BASE + url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(3500);
    const etat = await page.evaluate(() => ({
      texte: document.body.innerText.length,
      debord: document.documentElement.scrollWidth - innerWidth,
      corps: document.body.innerText.slice(0, 4000),
    }));
    const problemes = [];
    if (erreurs.length) problemes.push(`erreurs JS : ${erreurs.slice(0, 3).join(' | ')}`);
    if (etat.texte < 20) problemes.push('page vide');
    if (etat.debord > 1) problemes.push(`débordement horizontal de ${etat.debord} px`);
    if (!attendu.test(etat.corps)) problemes.push(`contenu attendu absent (${attendu})`);
    await page.screenshot({ path: path.join(SORTIE, `${nom}.png`) });
    if (problemes.length) { echecs += 1; console.error(`✗ ${NAV} · ${nom} : ${problemes.join(' ; ')}`); }
    else console.log(`✓ ${NAV} · ${nom}`);
  } catch (e) {
    echecs += 1;
    console.error(`✗ ${NAV} · ${nom} : ${String(e.message).split('\n')[0]}`);
  }
  await ctx.close();
}

/**
 * 2e PASSE — PUBLICATION EN SOUS-DOSSIER, DANS UN CADRE, STOCKAGE REFUSÉ.
 *
 * C'est la situation d'une page partagée ou d'un hébergement mutualisé : l'application
 * n'est pas à la racine du domaine, elle est affichée dans un cadre, et certains
 * navigateurs y refusent le stockage local. Deux pannes déjà rencontrées y mènent à un
 * écran vide : des fichiers appelés par chemin absolu (« /assets/… ») et la lecture de
 * `localStorage` qui lève une erreur. Tout chemin hors du sous-dossier répond 404.
 */
const DIST = path.join(racine, process.env.FUMEE_DIST || 'dist');
const PREFIXE = '/partage/v1/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const sousDossier = http.createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const fichier = chemin.startsWith(PREFIXE) ? path.join(DIST, path.normalize(chemin.slice(PREFIXE.length))) : '';
  if (!fichier || !fichier.startsWith(DIST) || !existsSync(fichier) || statSync(fichier).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not Found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(fichier)] ?? 'application/octet-stream' });
  res.end(readFileSync(fichier));
});
await new Promise((r) => sousDossier.listen(4174, '127.0.0.1', r));
const hote = http.createServer((req, res) => {
  const cible = new URL(req.url, 'http://x').searchParams.get('page') ?? 'index.html';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Hôte</title><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style><iframe src="http://127.0.0.1:4174${PREFIXE}${cible.replace(/[^a-z.-]/g, '')}"></iframe>`);
});
await new Promise((r) => hote.listen(4175, '127.0.0.1', r));

for (const [nom, url, options, attendu] of CAS.filter(([n]) => !/telephone|voiture/.test(n))) {
  const ctx = await navigateur.newContext({ ...options, locale: 'fr-FR' });
  // Le cadre refuse le stockage : la lecture lève une erreur, comme en navigation privée.
  await ctx.addInitScript(() => {
    if (!location.pathname.startsWith('/partage/')) return;
    const refus = () => { throw new DOMException('Access is denied for this document.', 'SecurityError'); };
    for (const n of ['localStorage', 'sessionStorage']) Object.defineProperty(window, n, { get: refus, configurable: true });
  });
  const page = await ctx.newPage();
  const erreurs = []; const introuvables = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('response', (r) => { if (r.status() === 404 && r.url().startsWith('http://127.0.0.1:4174')) introuvables.push(new URL(r.url()).pathname); });
  try {
    await page.goto(`http://localhost:4175/?page=${url.slice(1)}`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(3500);
    const cadre = page.frames().find((f) => f.url().includes(PREFIXE));
    const corps = cadre ? await cadre.evaluate(() => document.body.innerText.slice(0, 4000)) : '';
    const problemes = [];
    if (introuvables.length) problemes.push(`fichiers introuvables hors du sous-dossier : ${[...new Set(introuvables)].slice(0, 3).join(', ')}`);
    if (erreurs.length) problemes.push(`erreurs JS : ${erreurs.slice(0, 3).join(' | ')}`);
    if (corps.length < 20) problemes.push('écran vide');
    else if (!attendu.test(corps)) problemes.push(`contenu attendu absent (${attendu})`);
    await page.screenshot({ path: path.join(SORTIE, `sous-dossier-${nom}.png`) });
    if (problemes.length) { echecs += 1; console.error(`✗ ${NAV} · ${nom} en sous-dossier : ${problemes.join(' ; ')}`); }
    else console.log(`✓ ${NAV} · ${nom} en sous-dossier, dans un cadre, stockage refusé`);
  } catch (e) {
    echecs += 1;
    console.error(`✗ ${NAV} · ${nom} en sous-dossier : ${String(e.message).split('\n')[0]}`);
  }
  await ctx.close();
}
await new Promise((r) => sousDossier.close(r));
await new Promise((r) => hote.close(r));

await navigateur.close();
await new Promise((r) => serveur.httpServer.close(r));
if (echecs) { console.error(`\n${echecs} interface(s) en échec sur ${NAV}.`); process.exit(1); }
console.log(`\nLes ${CAS.length} interfaces s'ouvrent correctement sur ${NAV}.`);
