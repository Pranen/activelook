import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const demoDir = r('./demo/');
const pages = readdirSync(demoDir).filter(f => f.endsWith('.html'));

// Demo site (multi-page). Imports of '@pranen/activelook' resolve to the local sources.
export default defineConfig({
  root: demoDir,
  base: './',
  resolve: { alias: { '@pranen/activelook': r('./src/index.ts') } },
  build: {
    outDir: r('./dist-demo'),
    emptyOutDir: true,
    rollupOptions: { input: Object.fromEntries(pages.map(f => [f.replace('.html', ''), demoDir + f])) },
  },
});
