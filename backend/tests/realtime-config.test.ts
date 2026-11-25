import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Canal WebSocket `config` : diffusion TEMPS RÉEL de la configuration publique.
 *
 * Quand la console Admin change un réglage qui concerne les apps clientes
 * (maintenance, services activés, passerelles de paiement), toutes les apps
 * connectées doivent recevoir la nouvelle config sans redémarrer.
 *
 * On utilise le client WebSocket natif de Node 22 (global) : aucune dépendance.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };

interface ConfigPayload {
  city?: string; open?: boolean; currency?: string;
  services?: Record<string, boolean>; gateways?: Record<string, boolean>;
}
interface Frame { type: string; config?: ConfigPayload; data?: ConfigPayload }

/** Config portée par une trame : `connected` → config, `config.update` → data. */
const payload = (f: Frame): ConfigPayload | undefined => (f.type === 'connected' ? f.config : f.data);

test('WS /ws/config : état initial à la connexion puis diffusion des changements console', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };

  const frames: Frame[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/config`);
  t.after(async () => { ws.close(); await app.close(); });

  ws.addEventListener('message', (ev) => frames.push(JSON.parse(String(ev.data)) as Frame));
  await new Promise((r) => ws.addEventListener('open', () => r(null), { once: true }));

  /** Attend qu'une trame satisfaisant le prédicat arrive (sinon échoue au bout du délai). */
  const waitFor = async (pred: (f: Frame) => boolean, label: string) => {
    for (let i = 0; i < 40; i++) {
      if (frames.some(pred)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail(`trame attendue non reçue : ${label}`);
  };

  // 1) À la connexion, le serveur pousse l'état courant (pas besoin d'appeler /config).
  await waitFor((f) => f.type === 'connected', 'connected');
  const initial = payload(frames.find((f) => f.type === 'connected')!)!;
  assert.equal(initial.open, true, 'ORION ouvert au départ');
  assert.equal(initial.gateways?.wave, true, 'Wave active au départ');
  assert.equal(initial.currency, 'XOF');

  // 2) La console coupe la passerelle Wave (panne opérateur) → diffusion immédiate.
  const g = await app.inject({ method: 'POST', url: '/admin/finance/gateways', headers: AUTH, payload: { method: 'wave', enabled: false } });
  assert.equal(g.statusCode, 200);
  await waitFor((f) => f.type === 'config.update' && payload(f)?.gateways?.wave === false, 'wave coupée');

  // 3) La console ferme ORION (maintenance) → diffusion immédiate.
  const s = await app.inject({ method: 'PUT', url: '/admin/services', headers: AUTH, payload: { open: false } });
  assert.equal(s.statusCode, 200);
  await waitFor((f) => f.type === 'config.update' && payload(f)?.open === false, 'maintenance');

  // 4) Réouverture : l'app cliente repasse en service sans redémarrage.
  await app.inject({ method: 'PUT', url: '/admin/services', headers: AUTH, payload: { open: true } });
  await waitFor((f) => f.type === 'config.update' && payload(f)?.open === true, 'réouverture');

  // La trame de diffusion garde exactement la forme de GET /config (contrat client).
  const update = frames.filter((f) => f.type === 'config.update').pop()!;
  const body = payload(update)!;
  assert.deepEqual(Object.keys(body).sort(), ['city', 'codeWhatsApp', 'currency', 'gateways', 'open', 'prix', 'services']);
});

test('GET /config et le canal WS exposent la même forme (contrat app cliente)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const http = (await app.inject({ method: 'GET', url: '/config' })).json();
  assert.deepEqual(Object.keys(http).sort(), ['city', 'codeWhatsApp', 'currency', 'gateways', 'open', 'prix', 'services']);
  assert.equal(http.currency, 'XOF');
});
