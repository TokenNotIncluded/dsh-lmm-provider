export const name = 'lmm-host-test-probe';
export const inject = ['llm', 'connection'];
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/lmm-host-test', methods: ['POST'], requestBody: 'buffered', async fetch() {
    const models = await ctx.llm.listModels('lmm');
    const chunks = [];
    for await (const chunk of ctx.llm.stream({ provider: 'lmm', model: 'default / gpt-4o-mini', sessionId: 'dsh-host-fixture-session', system: 'host system', messages: [{ role: 'user', content: [{ type: 'text', text: 'host test' }] }], maxTokens: 4 })) chunks.push(chunk);
    return Response.json({ models, chunks });
  } }));
}
