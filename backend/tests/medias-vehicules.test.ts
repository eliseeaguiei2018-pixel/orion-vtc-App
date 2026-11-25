import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * VITRINE DES VÉHICULES : la liste des photos et vidéos réelles se règle depuis la console
 * et se lit sans compte depuis l'application (Mariage, Location Signature).
 */
test('vitrine vide par défaut, lisible sans compte', async () => {
  const { app } = await buildApp();
  const r = await app.inject({ method: 'GET', url: '/rental/medias-vehicules' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { version: 1, medias: [] });
  await app.close();
});

test('la console remplace la liste ; les adresses dangereuses sont refusées', async () => {
  const { app, container } = await buildApp();
  // Écriture réservée à la console : sans session, refus.
  const sans = await app.inject({ method: 'PUT', url: '/admin/medias/vehicules', payload: { medias: [] } });
  assert.ok(sans.statusCode === 401 || sans.statusCode === 403, `sans session : ${sans.statusCode}`);

  const medias = [
    { service: 'mariage', vehicule: 'or', options: { decoration: true }, type: 'image', src: 'https://cdn.orion.ci/mariage/or-1.webp', legende: 'Berline Or fleurie' },
    { service: 'location', vehicule: '*', type: 'video', src: 'medias/location/presentation.mp4', affiche: 'medias/location/presentation.webp' },
  ];
  container.mediasVehicules.remplacer(medias as never);
  const lu = await app.inject({ method: 'GET', url: '/rental/medias-vehicules' });
  assert.equal((lu.json() as { medias: unknown[] }).medias.length, 2);

  const { mediasSchema } = await import('../src/modules/rental/medias.js');
  assert.ok(mediasSchema.safeParse(medias).success, 'liste valide acceptée');
  for (const src of ['javascript:alert(1)', 'http://sans-chiffrement.example/a.jpg', '../../etc/passwd', 'data:text/html,<script>']) {
    assert.equal(mediasSchema.safeParse([{ service: 'mariage', vehicule: 'or', type: 'image', src }]).success, false, `refusée : ${src}`);
  }
  assert.equal(mediasSchema.safeParse([{ service: 'food', vehicule: 'or', type: 'image', src: 'medias/a.webp' }]).success, false, 'service inconnu refusé');
  await app.close();
});
