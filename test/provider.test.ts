import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import type { Context } from '@deepseek-ai/cordis';
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import type { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { AuthorizationFlow } from '@deepseek-ai/dsh-authorization';
import { apply, credentialStoreFrom, DSH_CLIENT_ID, RECORD_KEY } from '../src/index.ts';
import { LmmIntegration } from '../vendor/pi-lmm-provider/src/provider.ts';

const issuer = 'https://api.lmm.best';
const resource = `${issuer}/api/oauth2`;
const scope = 'catalog:read balance:read models:invoke mcp:bounties mcp:drawing';

function oauth(access = 'lmm_at_fixture'): OAuthCredential & Record<string, unknown> {
  return {
    type: 'oauth', access, refresh: 'refresh_fixture', expires: Date.now() + 60_000,
    lmm_issuer: issuer, lmm_resource: resource, lmm_session: 'session_fixture', scope,
  };
}

class MemoryCredentials {
  current?: CredentialRecord;
  reads = 0;
  writes = 0;
  deletes = 0;

  async readRecord(): Promise<CredentialRecord | undefined> { this.reads++; return this.current; }
  async listRecords() { return this.current === undefined ? [] : [{ key: RECORD_KEY, kind: this.current.kind }]; }
  async modifyRecord(_key: typeof RECORD_KEY, mutate: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    this.writes++;
    const next = await mutate(this.current);
    if (next !== undefined) this.current = next;
    return this.current;
  }
  async deleteRecord() { this.deletes++; this.current = undefined; }
}

function context(credentials: MemoryCredentials): Context {
  return { credentials } as unknown as Context;
}

test('bridges DSH credential records without exposing unrelated providers', async () => {
  const backing = new MemoryCredentials();
  const store = credentialStoreFrom(context(backing));
  await assert.rejects(() => store.read('other'), /does not own provider/);
  assert.equal(await store.read('lmm'), undefined);

  const value = oauth();
  const saved = await store.modify('lmm', async () => value);
  assert.equal(saved?.type, 'oauth');
  assert.deepEqual(await store.read('lmm'), value);
  assert.deepEqual(await store.list(), [{ providerId: 'lmm', type: 'oauth' }]);
  await store.delete('lmm');
  assert.equal(await store.read('lmm'), undefined);
  assert.equal(backing.writes, 1);
  assert.equal(backing.deletes, 1);
});

test('DSH OAuth uses its registered native client id', async () => {
  let authUrl: URL | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return new Response(JSON.stringify({
        issuer, authorization_endpoint: `${resource}/authorize`, token_endpoint: `${resource}/token`,
        revocation_endpoint: `${resource}/revoke`, code_challenge_methods_supported: ['S256'],
        response_types_supported: ['code'], authorization_response_iss_parameter_supported: true,
      }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/.well-known/oauth-protected-resource/api/oauth2')) {
      return new Response(JSON.stringify({ resource, authorization_servers: [issuer] }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/api/oauth2/token')) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('client_id'), DSH_CLIENT_ID);
      return new Response(JSON.stringify({ token_type: 'Bearer', access_token: 'lmm_at_dsh', refresh_token: 'refresh_dsh', expires_in: 900, scope: 'catalog:read balance:read usage:read models:invoke' }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const integration = new LmmIntegration({ issuer, fetch, clientId: DSH_CLIENT_ID, hostName: 'DSH' });
  try {
    const interaction: ProviderAuthInteraction = {
      signal: new AbortController().signal,
      notify(event) {
        if (event.type !== 'auth_url') return;
        authUrl = new URL(event.url);
        const callback = new URL(authUrl.searchParams.get('redirect_uri')!);
        callback.search = new URLSearchParams({ code: 'code_fixture', state: authUrl.searchParams.get('state')!, iss: issuer }).toString();
        void globalThis.fetch(callback).catch(() => {});
      },
      prompt: async () => { throw new Error('unexpected prompt'); },
    };
    const result = await integration.oauth.login(interaction);
    assert.equal(result.access, 'lmm_at_dsh');
    assert.equal(authUrl?.searchParams.get('client_id'), DSH_CLIENT_ID);
    assert.match(authUrl?.searchParams.get('scope') ?? '', /catalog:read/);
  } finally {
    integration.dispose();
  }
});

test('credential key is namespaced to the DSH plugin', () => {
  assert.equal(RECORD_KEY, credentialKey('dsh-lmm-provider', 'lmm'));
});

test('mounts the fixed LMM adapter and browser authorization flow', () => {
  const backing = new MemoryCredentials();
  let adapter: LlmAdapter | undefined;
  let flow: AuthorizationFlow | undefined;
  const ctx = {
    credentials: backing,
    llm: {
      registerAdapter(providers: string[], value: LlmAdapter) {
        assert.deepEqual(providers, ['lmm']);
        adapter = value;
        return Object.assign(() => {}, { replace() {} });
      },
    },
    inject(_dependencies: string[], callback: (ctx: { authorization: { registerFlow(value: AuthorizationFlow): void } }) => void) {
      callback({ authorization: { registerFlow(value) { flow = value; } } });
    },
    get() { return undefined; },
    on() { return () => {}; },
    effect(callback: () => () => void) { callback(); },
  } as unknown as Context;

  apply(ctx);
  assert.equal(adapter?.providerInfo('lmm').name, 'LMM');
  assert.equal(flow?.key, RECORD_KEY);
  assert.deepEqual(flow?.methods, [{ id: 'oauth', label: 'Sign in with LMM' }]);
});
