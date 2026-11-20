'use strict';
/**
 * APPLICATIONS DE BUREAU ORION (Windows, macOS) : Console et Tableau de bord.
 *
 * Une enveloppe volontairement mince : une fenêtre dédiée qui ouvre l'application web
 * ORION à son adresse. Il n'y a donc qu'UNE version de la console à maintenir ; une
 * correction publiée sur le site arrive dans l'application au lancement suivant, sans
 * réinstaller. Et si l'application de bureau pose problème, la même adresse s'ouvre dans
 * n'importe quel navigateur.
 *
 * Sécurité : la page n'a accès ni à Node.js ni aux fichiers du poste ; elle ne peut
 * naviguer que dans les adresses ORION configurées ; tout autre lien part vers le
 * navigateur du poste ; les permissions (caméra, micro, position…) sont refusées.
 */
const { app, BrowserWindow, Menu, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { application, adresses, originesAutorisees, destination, PERMISSIONS } = require('./applications.cjs');

const paquet = require('../package.json');
// Application installée : son identité est inscrite à la construction. En développement :
// variable ORION_APP (npm run console, npm run tableau).
const ID = app.isPackaged ? (paquet.orion && paquet.orion.app) : (process.env.ORION_APP || 'console');
const APP = application(ID);
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'orion.config.json'), 'utf8'));
const URLS = adresses(config, ID, app.isPackaged ? undefined : process.env.ORION_URL);
const ORIGINES = originesAutorisees(URLS);
const HORS_LIGNE = path.join(__dirname, 'hors-ligne.html');

app.setName(APP.nom);
// Chaque application garde ses données dans son propre dossier (deux applications séparées).
app.setPath('userData', path.join(app.getPath('appData'), APP.nom));
if (process.platform === 'win32') app.setAppUserModelId(APP.appId);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let fenetre = null;
  /** Indice de l'adresse en cours d'essai (principale, puis secours). */
  let essai = 0;

  const ouvrirDehors = (lien) => {
    if (destination(lien, ORIGINES) === 'externe') void shell.openExternal(lien);
  };

  /** Charge l'adresse `essai` ; à l'échec, `did-fail-load` passe à la suivante. */
  const charger = () => {
    if (!fenetre) return;
    if (essai >= URLS.length) {
      void fenetre.loadFile(HORS_LIGNE, { query: { adresse: URLS[0] || '' } });
      return;
    }
    void fenetre.loadURL(URLS[essai]).catch(() => { /* géré par did-fail-load */ });
  };
  const recommencer = () => { essai = 0; charger(); };

  /** Règles de navigation, communes à la fenêtre principale et aux fenêtres ouvertes par la page. */
  const proteger = (contenu) => {
    contenu.on('will-navigate', (evenement, lien) => {
      if (lien.startsWith('orion-action://')) {
        evenement.preventDefault();
        if (lien.includes('navigateur')) { if (URLS[0]) void shell.openExternal(URLS[0]); } else recommencer();
        return;
      }
      if (lien.startsWith('file:') && contenu.getURL().startsWith('file:')) return; // page locale « hors ligne »
      if (destination(lien, ORIGINES) === 'interne') return;
      evenement.preventDefault();
      ouvrirDehors(lien);
    });
    contenu.setWindowOpenHandler(({ url }) => {
      // Même site ORION (ex. « Tableau de bord » ouvert depuis la console) : nouvelle
      // fenêtre de l'application, avec les mêmes protections.
      if (destination(url, ORIGINES) === 'interne') {
        return { action: 'allow', overrideBrowserWindowOptions: optionsFenetre({ width: 1280, height: 820 }) };
      }
      ouvrirDehors(url);
      return { action: 'deny' };
    });
    contenu.on('did-create-window', (enfant) => proteger(enfant.webContents));
  };

  const optionsFenetre = (taille = {}) => ({
    width: taille.width || APP.largeur,
    height: taille.height || APP.hauteur,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: APP.fond,
    title: APP.nom,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'ressources', `${APP.icone}.png`),
    webPreferences: {
      preload: path.join(__dirname, 'prechargement.cjs'),
      additionalArguments: [`--orion-app=${APP.id}`, `--orion-version=${app.getVersion()}`],
      partition: APP.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      // Le tableau de bord vit sur un écran mural : il continue de s'actualiser même
      // quand sa fenêtre n'a pas le focus.
      backgroundThrottling: APP.id !== 'tableau',
    },
  });

  const creerFenetre = () => {
    fenetre = new BrowserWindow(optionsFenetre());
    const contenu = fenetre.webContents;
    contenu.setUserAgent(`${contenu.getUserAgent()} ORIONBureau/${app.getVersion()} (${APP.id})`);
    proteger(contenu);

    contenu.on('did-fail-load', (_e, code, _description, lien, cadrePrincipal) => {
      // -3 : chargement interrompu par une autre navigation, ce n'est pas une panne.
      if (!cadrePrincipal || code === -3 || lien.startsWith('file:')) return;
      essai += 1;
      charger();
    });
    fenetre.on('page-title-updated', (e) => e.preventDefault()); // le titre de la fenêtre reste le nom de l'application
    fenetre.on('closed', () => { fenetre = null; });
    charger();

    // Essai automatisé (jamais dans une application installée) : capture d'écran puis sortie.
    if (!app.isPackaged && process.env.ORION_CAPTURE) {
      const attente = Number(process.env.ORION_CAPTURE_DELAI || 6000);
      setTimeout(async () => {
        const image = await contenu.capturePage();
        fs.writeFileSync(process.env.ORION_CAPTURE, image.toPNG());
        const etat = await contenu.executeJavaScript('({ url: location.href, bureau: window.orionBureau ?? null, node: typeof require, titre: document.title })').catch((e) => ({ erreur: String(e) }));
        fs.writeFileSync(`${process.env.ORION_CAPTURE}.json`, JSON.stringify({ ...etat, adresses: URLS, essai, userAgent: contenu.getUserAgent() }, null, 1));
        app.quit();
      }, attente);
    }
  };

  const menu = () => Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: APP.nom, submenu: [{ role: 'about', label: `À propos de ${APP.nom}` }, { type: 'separator' }, { role: 'hide', label: 'Masquer' }, { role: 'quit', label: 'Quitter' }] }] : []),
    {
      label: 'Fichier',
      submenu: [
        { label: 'Recharger', accelerator: 'CmdOrCtrl+R', click: recommencer },
        { label: 'Ouvrir dans le navigateur', click: () => { if (URLS[0]) void shell.openExternal(URLS[0]); } },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close', label: 'Fermer la fenêtre' } : { role: 'quit', label: 'Quitter' },
      ],
    },
    { label: 'Édition', submenu: [{ role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' }, { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' }] },
    { label: 'Affichage', submenu: [{ role: 'togglefullscreen', label: 'Plein écran' }, { type: 'separator' }, { role: 'zoomIn', label: 'Agrandir' }, { role: 'zoomOut', label: 'Réduire' }, { role: 'resetZoom', label: 'Taille réelle' }] },
  ]);

  app.on('second-instance', () => {
    if (!fenetre) return;
    if (fenetre.isMinimized()) fenetre.restore();
    fenetre.focus();
  });

  app.whenReady().then(() => {
    const s = session.fromPartition(APP.partition);
    // Aucune permission sensible : ni caméra, ni micro, ni position. Notifications et
    // plein écran seulement, et uniquement pour les adresses ORION.
    s.setPermissionRequestHandler((contenu, permission, repondre) => {
      let origine = '';
      try { origine = new URL(contenu.getURL()).origin; } catch { /* page locale */ }
      repondre(PERMISSIONS.has(permission) && ORIGINES.has(origine));
    });
    s.setPermissionCheckHandler((_contenu, permission, origine) => {
      // L'origine arrive parfois avec une barre finale : on la ramène à sa forme canonique.
      let canonique = '';
      try { canonique = new URL(origine).origin; } catch { /* origine vide ou opaque */ }
      return PERMISSIONS.has(permission) && ORIGINES.has(canonique);
    });
    Menu.setApplicationMenu(menu());
    creerFenetre();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) creerFenetre(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  // Aucune page ne peut attacher de « webview » ni ouvrir une fenêtre hors des règles ci-dessus.
  app.on('web-contents-created', (_e, contenu) => {
    contenu.on('will-attach-webview', (evenement) => evenement.preventDefault());
  });
}
