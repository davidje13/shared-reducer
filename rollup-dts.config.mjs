import { dts } from 'rollup-plugin-dts';

export default [
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
