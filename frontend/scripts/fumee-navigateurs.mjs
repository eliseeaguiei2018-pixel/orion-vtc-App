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
import { mkdirSync } from 'node:fs';
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
await navigateur.close();
await new Promise((r) => serveur.httpServer.close(r));
if (echecs) { console.error(`\n${echecs} interface(s) en échec sur ${NAV}.`); process.exit(1); }
console.log(`\nLes ${CAS.length} interfaces s'ouvrent correctement sur ${NAV}.`);
