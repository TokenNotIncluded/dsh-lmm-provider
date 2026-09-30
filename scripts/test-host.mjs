import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const home = await mkdtemp(join(tmpdir(), 'dsh-lmm-host-'));
const cli = process.env.LMM_DSH_CLI ?? resolve(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
const env = { ...process.env, DSH_HOME: home };
function run(args, extra = {}) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  const done = new Promise((res, rej) => child.on('exit', code => code === 0 ? res() : rej(new Error('DSH failed (credential-free exit code ' + code + ')'))));
  done.catch(() => {});
  return { child, done, output: () => output };
}
let host;
try {
  await run(['plugin', '--profile', 'web', 'add', root, '--ignore-scripts']).done;
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), '- insert:\n    - id: lmm-host-test-probe\n      name: ' + JSON.stringify(resolve(root, 'test/host-probe.mjs')) + '\n');
  host = run(['web', '--no-open', '--port', '0'], { NODE_OPTIONS: '--import=' + resolve(root, 'test/host-fixture.mjs') });
  let base;
  for (let n=0; n<300; n++) { const match = host.output().match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/); if (match) { base = new URL(match[0]); break; } await new Promise(r=>setTimeout(r,100)); }
  assert.ok(base, 'DSH must boot the actual web host');
  const launch = await fetch(base, { redirect: 'manual' }); const cookie = launch.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const headers = { cookie, origin: base.origin, 'content-type': 'application/json' };
  async function rpc(action, payload = {}) {
    const response = await fetch(base.origin + '/api/lmm-auth/' + action, { method: 'POST', headers, body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'lmm-auth/' + action, payload }) });
    assert.equal(response.status, 200, 'actual Connection route must load');
    const result = (await response.json()).result; assert.equal(result.ok, true); return result.value;
  }
  assert.equal((await fetch(base.origin + '/api/lmm-auth/status', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'})).status, 401, 'host must reject unauthenticated access');
  assert.equal((await rpc('status')).signedIn, false);
  const attempt = await rpc('begin'); let view;
  for (let n=0; n<100; n++) { view=await rpc('poll',{attempt:attempt.attempt}); if(view.notices?.some(n=>n.url))break; await new Promise(r=>setTimeout(r,50)); }
  const authorize = new URL(view.notices.find(n=>n.url).url); assert.equal(authorize.searchParams.get('client_id'), 'lmm-dsh');
  const callback = new URL(authorize.searchParams.get('redirect_uri')); callback.search = new URLSearchParams({ code:'test-code', state:authorize.searchParams.get('state'), iss:'https://api.lmm.best' }).toString();
  assert.equal((await fetch(callback)).status,200);
  for (let n=0; n<100; n++) { view=await rpc('poll',{attempt:attempt.attempt}); if(view.state!=='pending')break; await new Promise(r=>setTimeout(r,50)); }
  assert.equal(view.state,'authorized'); assert.equal((await rpc('status')).signedIn,true);
  const response = await fetch(base.origin + '/api/lmm-host-test', { method:'POST',headers });
  assert.equal(response.status,200); const {models,chunks}=await response.json();
  assert.ok(models.some(m=>m.id==='default / gpt-4o-mini'));
  assert.equal(chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join(''),'hello host');
  assert.ok(chunks.some(c=>c.type==='finish' && c.reason.kind==='stop'));
  await rpc('logout'); assert.equal((await rpc('status')).signedIn,false);
  console.log('Actual DSH web host: plugin boot, authenticated RPC, OAuth PKCE callback, durable credential, catalog, streaming model invocation, sign-out passed.');
} finally { if(host && host.child.exitCode === null && host.child.signalCode === null) { host.child.kill('SIGTERM'); await new Promise(r=>host.child.once('exit',r)); } await rm(home,{recursive:true,force:true}); }
