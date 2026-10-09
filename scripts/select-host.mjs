import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Test-only dependency selection. Never update the committed package manifest or lockfile.
// Individual DSH libraries have different `latest` tags; resolve the CLI tag once.
const selector = process.argv[2];
assert.ok(selector && /^(?:latest|next|alpha|\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.test(selector), 'Specify an official DSH version or release tag');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function view(spec, field) {
  return JSON.parse(execFileSync(npm, ['view', spec, field, '--json'], { encoding: 'utf8', timeout: 60_000 }));
}
const version = view(`@deepseek-ai/dsh@${selector}`, 'version');
assert.equal(typeof version, 'string', 'The host selector must resolve to one version');
const peers = view(`@deepseek-ai/dsh-llm-pi-ai@${version}`, 'peerDependencies');
const cordis = peers['@deepseek-ai/cordis'];
const adapterDependencies = view(`@deepseek-ai/dsh-llm-pi-ai@${version}`, 'dependencies');
const piAiRange = adapterDependencies['@earendil-works/pi-ai'];
assert.equal(typeof piAiRange, 'string', 'The official adapter must declare its pi-ai SDK version');
assert.equal(typeof cordis, 'string', 'The official adapter must declare its Cordis peer');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const names = new Set(['@deepseek-ai/dsh']);
for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
  for (const name of Object.keys(manifest[section] ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-')) names.add(name);
  }
}
const specs = [...names].sort().map(name => `${name}@${version}`);
specs.push(`@deepseek-ai/cordis@${cordis}`);
// The provider and the host adapter must use one pi-ai copy: 1.x and 0.87
// have different transcript brands even when the provider APIs look similar.
specs.push(`@earendil-works/pi-ai@${piAiRange}`);
console.log(`Testing DSH ${version} with official Cordis ${cordis} and pi-ai ${piAiRange}`);
const result = spawnSync(npm, ['install', '--no-save', '--package-lock=false', '--ignore-scripts', ...specs], {
  stdio: 'inherit', timeout: 300_000,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, 'Failed to install a consistent DSH host dependency set');
