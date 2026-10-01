import assert from 'node:assert/strict';
const realFetch = globalThis.fetch;
const issuer = 'https://api.lmm.best', resource = issuer + '/api/oauth2';
const scope = 'catalog:read balance:read usage:read models:invoke group:ZGVmYXVsdA';
const json = (value) => Response.json(value);
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== issuer) return realFetch(input, init);
  if (url.pathname === '/.well-known/oauth-authorization-server') return json({ issuer, authorization_endpoint: resource + '/authorize', token_endpoint: resource + '/token', revocation_endpoint: resource + '/revoke', code_challenge_methods_supported: ['S256'], response_types_supported: ['code'], authorization_response_iss_parameter_supported: true });
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json({ resource, authorization_servers: [issuer] });
  if (url.pathname === '/api/oauth2/token') {
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.get('client_id'), 'lmm-dsh');
    assert.equal(body.get('code'), 'test-code');
    assert.ok(body.get('code_verifier')?.length >= 43);
    return json({ token_type: 'Bearer', access_token: 'lmm_at_host_fixture', refresh_token: 'fixture-refresh', expires_in: 900, scope });
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
  assert.equal(headers.get('authorization'), 'Bearer lmm_at_host_fixture');
  if (url.pathname === '/api/oauth2/balance') return json({ schema_version: 1, currency: 'USD', balance: 1, quota: 1, quota_per_unit: 1, updated_at: 1789240000, authorization_limit: null });
  if (url.pathname === '/api/oauth2/catalog') return json({ schema_version: 1, resource, updated_at: 1789240000, groups: [{ id: 'ZGVmYXVsdA', name: 'default', scope: 'group:ZGVmYXVsdA', multiplier: 1 }], models: [{ id: 'lmm:ZGVmYXVsdA:Z3B0LTRvLW1pbmk', group_id: 'ZGVmYXVsdA', group: 'default', upstream_model: 'gpt-4o-mini', name: 'default / gpt-4o-mini', apis: ['openai-completions'], pricing: { currency: 'USD', unit: 'million_tokens', price_basis: 'configured_base_rates', group_multiplier: 1, trust_multiplier: 1, input: 1, output: 2, cache_read: 0, cache_write: 0, request: null, final_cost_depends_on_usage: true, updated_at: 1789240000 }, native_cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] });
  if (url.pathname === '/v1/chat/completions') {
    assert.equal(headers.get('x-lmm-group'), 'ZGVmYXVsdA');
    assert.equal(headers.get('session_id'), 'dsh-host-fixture-session');
    assert.equal(headers.has('x-api-key'), false);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gpt-4o-mini');
    assert.ok(body.messages.some((m) => m.role === 'system' && m.content.includes('host system')));
    assert.ok(body.messages.some((m) => m.role === 'user' && JSON.stringify(m.content).includes('host test')));
    return new Response(['data: {"id":"chat-1","object":"chat.completion.chunk","created":1789240000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"hello host"},"finish_reason":null}]}', 'data: {"id":"chat-1","object":"chat.completion.chunk","created":1789240000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}', 'data: [DONE]', ''].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } });
  }
  throw new Error('Unexpected fixture route: ' + url.pathname);
};
