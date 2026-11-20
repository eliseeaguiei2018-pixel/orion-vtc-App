'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { application, adresses, originesAutorisees, destination, PERMISSIONS } = require('../src/applications.cjs');

/**
 * Règles de sécurité des applications de bureau : où l'application a le droit d'aller,
 * ce qui part vers le navigateur du poste, et ce qui est refusé.
 */
test('Deux applications séparées : identifiants, noms et stockages distincts', () => {
  const c = application('console');
  const t = application('tableau');
  assert.notEqual(c.appId, t.appId);
  assert.notEqual(c.partition, t.partition);
  assert.notEqual(c.nom, t.nom);
  assert.throws(() => application('autre'), /inconnue/);
});

test('Adresses : la principale puis les secours, HTTPS obligatoire hors essai local', () => {
  const config = { console: { url: 'https://console.orion.ci/admin.html', secours: ['https://secours.orion.ci/admin.html', 'http://pas-sur.exemple/admin.html', 'pas une adresse'] } };
  assert.deepEqual(adresses(config, 'console'), ['https://console.orion.ci/admin.html', 'https://secours.orion.ci/admin.html']);
  // Essai local : HTTP toléré sur localhost seulement, et placé en premier.
  assert.deepEqual(adresses(config, 'console', 'http://localhost:4500/admin.html')[0], 'http://localhost:4500/admin.html');
  assert.deepEqual(adresses({}, 'tableau'), []);
});

test('Navigation : interne sur les adresses ORION, externe vers le poste, le reste refusé', () => {
  const origines = originesAutorisees(['https://console.orion.ci/admin.html']);
  assert.equal(destination('https://console.orion.ci/dashboard.html', origines), 'interne');
  assert.equal(destination('https://wa.me/2250700000000', origines), 'externe');
  assert.equal(destination('tel:+2250701020304', origines), 'externe');
  assert.equal(destination('mailto:support@orion.ci', origines), 'externe');
  // Un site qui imite le nom de domaine n'est pas ORION.
  assert.equal(destination('https://console.orion.ci.exemple.com/admin.html', origines), 'externe');
  assert.equal(destination('file:///etc/passwd', origines), 'refuse');
  assert.equal(destination('javascript:alert(1)', origines), 'refuse');
  assert.equal(destination('smb://serveur/partage', origines), 'refuse');
  assert.equal(destination('pas un lien', origines), 'refuse');
});

test('Permissions : ni caméra, ni micro, ni position', () => {
  for (const interdite of ['media', 'geolocation', 'camera', 'microphone', 'openExternal', 'pointerLock', 'midi', 'hid', 'serial', 'usb']) {
    assert.equal(PERMISSIONS.has(interdite), false, interdite);
  }
  assert.equal(PERMISSIONS.has('notifications'), true);
});
