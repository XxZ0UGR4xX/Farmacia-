import { defineConfig } from 'tsup';

export default defineConfig({
  // seed.js permite sembrar datos en producción/Docker sin herramientas de desarrollo
  entry: { server: 'src/server.ts', seed: 'prisma/seed/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  // El paquete compartido es TypeScript fuente: se incluye en el bundle
  noExternal: ['@farmacia/shared'],
});
