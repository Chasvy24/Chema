import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  build: {
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Le moteur PDF.js est livré en .mjs : renommé en .js pour être servi avec le bon type
        // par tous les hébergeurs statiques (GitHub Pages compris).
        assetFileNames: (info: { name?: string; names?: string[] }) => ((info.names?.[0] ?? info.name ?? '').endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
} as any);
