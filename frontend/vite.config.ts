import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// L'URL de l'API backend est injectable (VITE_API_URL). En dev, proxy vers :3000.
// `base` permet le déploiement en sous-chemin (GitHub Pages) via VITE_BASE.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
