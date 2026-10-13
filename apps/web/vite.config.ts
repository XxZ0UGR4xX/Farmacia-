import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// La API de destino se puede cambiar (las pruebas E2E la levantan en otro puerto)
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // En desarrollo la API se sirve en el mismo origen (cookies SameSite=Strict sin CORS)
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  // Sin mapas de código en producción: no se publica el código fuente con sus comentarios
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
