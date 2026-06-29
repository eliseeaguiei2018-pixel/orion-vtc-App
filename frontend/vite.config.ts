import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// L'URL de l'API backend est injectable (VITE_API_URL). En dev, proxy vers :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
