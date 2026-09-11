import cloudflare from '@astrojs/cloudflare';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import base from '../astro.config.mjs';
import { buildDir, configPath, port, runDir, stateDir } from './runtime.mjs';

// Production pages, middleware and session configuration; isolated local bindings.
export default {
  ...base,
  root: runDir,
  srcDir: fileURLToPath(new URL('../src', import.meta.url)),
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  outDir: buildDir,
  cacheDir: join(runDir, 'astro'),
  adapter: cloudflare({
    imageService: 'compile', configPath, persistState: { path: stateDir },
    inspectorPort: false, remoteBindings: false,
  }),
  server: { host: '127.0.0.1', port },
  vite: {
    ...base.vite,
    cacheDir: join(runDir, 'vite'),
    server: { strictPort: true },
    preview: { strictPort: true },
  },
};
