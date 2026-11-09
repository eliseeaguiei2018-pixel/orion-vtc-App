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
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        admin: new URL('./admin.html', import.meta.url).pathname,
        driver: new URL('./driver.html', import.meta.url).pathname,
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
