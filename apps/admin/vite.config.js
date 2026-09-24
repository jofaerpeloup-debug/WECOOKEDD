import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // This private workspace package stays at version 0.0.0, so edits to its
    // CommonJS entry do not change Vite's lockfile/config cache key.
    force: true,
    include: ['@wecooked/contracts'],
  },
  build: {
    commonjsOptions: {
      include: [
        /node_modules/,
        /packages[\\/]contracts[\\/]/,
      ],
    },
  },
});
