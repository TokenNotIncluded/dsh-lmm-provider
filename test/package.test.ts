import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
test('shared DSH services must be host-owned peers, not independently installed runtime dependencies', () => {
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    assert.ok(!name.startsWith('@deepseek-ai/') && name !== '@earendil-works/pi-ai', `Host-owned dependency ${name} must not shadow the active DSH runtime`);
  }
  assert.equal(manifest.peerDependencies['@earendil-works/pi-ai'], '^0.87.1 || ^1.0.2');
  assert.equal(manifest.devDependencies['@earendil-works/pi-ai'], '0.87.1');
  for (const name of ['@deepseek-ai/dsh-authorization', '@deepseek-ai/dsh-home-paths', '@deepseek-ai/dsh-llm-pi-ai']) {
    assert.equal(manifest.peerDependencies[name], '>=0.2.0-rc.2 || >=0.2.1-alpha.1');
    assert.equal(manifest.devDependencies[name], '0.2.0-rc.2');
  }
});
