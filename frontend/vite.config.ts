import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// L'URL de l'API backend est injectable (VITE_API_URL). En dev, proxy vers :3000.
// `base` : RELATIF par défaut pour les versions publiées. Les pages appellent alors leurs
// fichiers par « ./assets/… » et s'ouvrent partout : à la racine d'un domaine, dans un
// sous-dossier, dans l'app Android/iOS, dans une page partagée. Avec des chemins absolus
// (« /assets/… »), une publication en sous-dossier affichait un écran vide. VITE_BASE
// reste possible (GitHub Pages) ; en développement, la base est « / ».
// App native « ORION Chauffeur » (ORION_APP=chauffeur) : seule l'app chauffeur est
// construite, dans dist-chauffeur (voir scripts/construire-app-chauffeur.mjs).
const appChauffeur = process.env.ORION_APP === 'chauffeur';

export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? (command === 'build' ? './' : '/'),
  plugins: [react()],
  // Multi-page : app cliente (index.html) + dashboard admin (admin.html)
  // + app chauffeur (driver.html).
  build: {
    // Compatibilité des apps natives : la WebView d'iOS 15 (Safari 15) et celle des
    // Android 7+ mis à jour. La syntaxe récente est convertie pour ces versions.
    target: ['es2020', 'safari15', 'chrome87', 'edge88', 'firefox91'],
    ...(appChauffeur ? { outDir: 'dist-chauffeur', emptyOutDir: true } : {}),
    rollupOptions: {
      input: appChauffeur ? { driver: new URL('./driver.html', import.meta.url).pathname } : {
        main: new URL('./index.html', import.meta.url).pathname,
        admin: new URL('./admin.html', import.meta.url).pathname,
        // Tableau de bord ORION : écran de supervision à part, synchronisé en direct.
        dashboard: new URL('./dashboard.html', import.meta.url).pathname,
        driver: new URL('./driver.html', import.meta.url).pathname,
        // Écran embarqué du véhicule : même app Chauffeur, mode paysage plein écran.
        vehicule: new URL('./vehicule.html', import.meta.url).pathname,
        // Pages publiques exigées par l'App Store et Google Play.
        confidentialite: new URL('./confidentialite.html', import.meta.url).pathname,
        suppression: new URL('./suppression-compte.html', import.meta.url).pathname,
      },
      output: {
        // Le « worker » de la carte (MapLibre) est publié en .js : la WebView d'iOS ne
        // reconnaît pas toujours .mjs et refuserait de le charger comme script.
        assetFileNames: (asset) => (asset.names?.[0] ?? asset.name ?? '').endsWith('.mjs')
          ? 'assets/[name]-[hash].js'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
}));
