import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { dts } from 'rollup-plugin-dts';

export default [
  {
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
        tslib: {},
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
  },
  {
    input: './build/types/backend/index.d.ts',
    output: [{ file: 'build/backend/index.d.ts', format: 'esm' }],
    plugins: [dts()],
  },
  {
    input: './build/types/frontend/index.d.ts',
    output: [{ file: 'build/frontend/index.d.ts', format: 'esm' }],
    plugins: [dts()],
  },
];
