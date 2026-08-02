import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { sseMockPlugin } from './sseMockPlugin';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(harnessDir, '../..');

export default defineConfig({
  root: harnessDir,
  plugins: [react(), sseMockPlugin()],
  resolve: {
    alias: {
      '@mmozer/sse-client/react': path.resolve(packageRoot, 'src/react/index.ts'),
      '@mmozer/sse-client': path.resolve(packageRoot, 'src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
