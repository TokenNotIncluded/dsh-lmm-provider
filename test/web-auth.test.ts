import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import type { AuthorizationRequest } from '@deepseek-ai/dsh-authorization';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import type { ConnectionFetchRoute, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection';
import { mountBrowserAuth } from '../src/web-auth.ts';
import * as plugin from '../src/index.ts';
const key = credentialKey('dsh-lmm-provider', 'lmm');
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness(run: (request: AuthorizationRequest) => Promise<{ status: 'authorized' | 'cancelled' }>) {
  const routes = new Map<string, ConnectionFetchRoute>();
  let record: unknown;
  const cleanup: (() => unknown)[] = [];
  const web = {
    credentials: { readRecord: async () => record, deleteRecord: async (received: unknown) => { assert.equal(received, key); record = undefined; } },
    authorization: { begin: run },
    connection: { fetch: { register(route: ConnectionFetchRoute) { routes.set(route.path, route); return async () => {}; } } },
    effect(callback: () => () => unknown) { cleanup.push(callback()); },
  };
  const ctx = { inject(dependencies: string[], callback: (ctx: unknown) => void) { assert.deepEqual(dependencies, ['connection', 'authorization', 'credentials', 'webServer']); callback(web); } } as unknown as Context;
  mountBrowserAuth(ctx, key);
  return { async call(action: string, payload: unknown = {}): Promise<ConnectionRpcResult<unknown>> { const route = routes.get('/api/lmm-auth/' + action); if (!route) return { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown action', details: {} } }; const response = await route.fetch(new Request('http://localhost/api/lmm-auth/' + action, {method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'lmm-auth/' + action, payload })})); return (await response.json()).result; }, record(value: unknown) { record = value; }, close() { for (const fn of cleanup) fn(); } };
}
function value(result: ConnectionRpcResult<unknown>): Record<string, any> { assert.equal(result.ok, true); return (result as { ok: true; value: Record<string, any> }).value; }
test('Cordis loader gets namespace dependency declarations instead of a bare default function', () => {
  assert.equal('default' in plugin, false); assert.deepEqual(plugin.inject, ['llm', 'credentials']);
});
test('status and logout never expose stored OAuth credentials', async () => {
  const h = harness(async () => ({ status: 'authorized' }));
  h.record({ kind: 'grant', payload: { access: 'secret-access', refresh: 'secret-refresh' } });
  assert.deepEqual(value(await h.call('status')), { signedIn: true, busy: false });
  assert.equal(JSON.stringify(await h.call('status')).includes('secret'), false);
  assert.equal((await h.call('arbitrary-provider')).ok, false);
  await h.call('logout'); assert.equal(value(await h.call('status')).signedIn, false); h.close();
});
test('login relays prompts only to its attempt and reports credential commit without token material', async () => {
  const h = harness(async (request) => {
    assert.equal(request.key, key); assert.equal(request.method, 'oauth');
    request.interaction.notify({ message: 'Open browser', url: 'https://api.lmm.best/api/oauth2/authorize' });
    assert.equal(await request.interaction.prompt({ kind: 'text', message: 'Code' }), 'fixture-code');
    h.record({ kind: 'grant', payload: { access: 'do-not-return' } });
    return { status: 'authorized' };
  });
  const started = value(await h.call('begin'));
  assert.equal((await h.call('begin')).ok, false);
  assert.equal((await h.call('poll', { attempt: 'different-tab' })).ok, false);
  const polled = value(await h.call('poll', { attempt: started.attempt }));
  assert.equal(polled.notices.length, 1);
  assert.equal((await h.call('answer', { attempt: started.attempt, prompt: 'old', value: 'bad' })).ok, false);
  await h.call('answer', { attempt: started.attempt, prompt: polled.prompt.id, value: 'fixture-code' });
  await tick(); const done = value(await h.call('poll', { attempt: started.attempt }));
  assert.equal(done.state, 'authorized'); assert.deepEqual(done.notices, []); assert.equal(done.prompt, undefined);
  assert.equal(value(await h.call('status')).signedIn, true); assert.equal(JSON.stringify(done).includes('do-not-return'), false); h.close();
});
test('cancel and unload abort prompts; errors cannot leak provider response bodies', async () => {
  const h = harness(async (request) => { await request.interaction.prompt({ kind: 'secret', message: 'Code', signal: request.signal }); throw new Error('access_token=never-echo-this'); });
  const first = value(await h.call('begin'));
  await h.call('cancel', { attempt: first.attempt }); await tick();
  assert.equal(value(await h.call('poll', { attempt: first.attempt })).state, 'cancelled');
  const second = value(await h.call('begin'));
  const prompt = value(await h.call('poll', { attempt: second.attempt })).prompt;
  await h.call('answer', { attempt: second.attempt, prompt: prompt.id, value: 'x' }); await tick();
  const failed = value(await h.call('poll', { attempt: second.attempt }));
  assert.equal(failed.state, 'failed'); assert.equal(JSON.stringify(failed).includes('never-echo'), false);
  assert.match(failed.error, /DSH Host log/);
  const third = value(await h.call('begin')); h.close(); await tick();
  assert.equal(value(await h.call('poll', { attempt: third.attempt })).state, 'cancelled');
});
test('known callback failures get a useful message without returning private error text', async () => {
  const h = harness(async () => { throw Object.assign(new Error('state=private-value'), { code: 'callback_unavailable' }); });
  const started = value(await h.call('begin'));
  await tick();
  const failed = value(await h.call('poll', { attempt: started.attempt }));
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /127\.0\.0\.1/);
  assert.equal(JSON.stringify(failed).includes('private-value'), false);
  h.close();
});
