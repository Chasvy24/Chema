import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { target: 'es2020', sourcemap: false, assetsInlineLimit: 0 },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
} as any);
