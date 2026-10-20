/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The browser talks only to our BFF (AISEC-01). There is no provider endpoint or key here.
    proxy: { '/api': { target: 'http://localhost:3000', rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  build: {
    sourcemap: false,
    // Nothing is inlined as a data: URL: the page policy allows fonts and scripts from 'self' only,
    // so an inlined font (a small Manrope subset) would be refused in production (found by e2e).
    assetsInlineLimit: 0,
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
});
