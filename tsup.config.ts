import { defineConfig } from 'tsup';

// A single multi-entry build (not two separate configs) so the `.d.ts` for
// `./react` references the core `SseClient`/types via an import instead of
// duplicating the class declaration — duplicated `declare class` output
// would make TypeScript treat the two `SseClient`s as nominally distinct
// (private fields aren't structurally comparable), breaking consumers that
// mix `@mmozer/sse-client` and `@mmozer/sse-client/react` imports.
export default defineConfig({
  entry: { index: 'src/index.ts', 'react/index': 'src/react/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  outDir: 'dist',
  external: ['react'],
});
