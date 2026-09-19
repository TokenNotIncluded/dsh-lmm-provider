import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const result = await build({
  entryPoints: ['src/client.tsx'], bundle: true, platform: 'browser', format: 'cjs',
  target: 'es2022', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], write: false,
});
await writeFile('lib/client.js', 'window.__ModuleLoader__.load({id:"@tokennotincluded/dsh-lmm-provider",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n' + result.outputFiles[0].text + '\nreturn module.exports;}});\n');
