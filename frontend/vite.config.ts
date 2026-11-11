import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// L'URL de l'API backend est injectable (VITE_API_URL). En dev, proxy vers :3000.
// `base` permet le déploiement en sous-chemin (GitHub Pages) via VITE_BASE.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  // Multi-page : app cliente (index.html) + dashboard admin (admin.html)
  // + app chauffeur (driver.html).
  build: {
    // Compatibilité des apps natives : la WebView d'iOS 15 (Safari 15) et celle des
    // Android 7+ mis à jour. La syntaxe récente est convertie pour ces versions.
    target: ['es2020', 'safari15', 'chrome87', 'edge88', 'firefox91'],
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        admin: new URL('./admin.html', import.meta.url).pathname,
        driver: new URL('./driver.html', import.meta.url).pathname,
        // Pages publiques exigées par l'App Store et Google Play.
        confidentialite: new URL('./confidentialite.html', import.meta.url).pathname,
        suppression: new URL('./suppression-compte.html', import.meta.url).pathname,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
