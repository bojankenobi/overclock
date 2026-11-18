import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { devvit } from '@devvit/start/vite';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devvit(),
  ],
  assetsInclude: ['**/*.m4a'],
  build: {
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
