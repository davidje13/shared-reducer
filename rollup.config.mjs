import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';

export default {
  input: { backend: 'backend/index.ts', frontend: 'frontend/index.ts' },
  output: [
    {
      dir: 'build',
      format: 'esm',
      entryFileNames: '[name]/index.mjs',
      chunkFileNames: '[name]-[hash].mjs',
    },
    {
      dir: 'build',
      format: 'cjs',
      entryFileNames: '[name]/index.js',
      chunkFileNames: '[name]-[hash].js',
    },
  ],
  external: [/node:.*/],
  plugins: [
    typescript({
      compilerOptions: {
        noEmit: false,
        declaration: true,
        rootDir: '.',
        declarationDir: './build/types',
      },
      exclude: ['**/*.test.*', 'test-helpers/**'],
    }),
    terser({
      format: { ascii_only: true },
      mangle: { properties: { regex: /^_/ } },
    }),
  ],
};
