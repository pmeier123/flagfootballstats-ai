import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await build({
  entryPoints: [`${root}supabase/functions-src/export-sheets/main.ts`],
  outfile: `${root}supabase/functions/export-sheets/index.ts`,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['npm:*'],
  mainFields: ['module', 'main'],
  legalComments: 'none',
  logLevel: 'info'
});
