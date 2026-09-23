import { join } from 'node:path';
import type {
  AuthContext, AuthEvent, AuthOperationOptions, AuthPrompt, Credential, CredentialInfo, CredentialStore, Models,
} from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai';
import type { Context } from '@deepseek-ai/cordis';
import type { AuthorizationPrompt, AuthorizationSession } from '@deepseek-ai/dsh-authorization';
import { credentialKey, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { LlmAdapter, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import type {
  GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, PreparedAdapterCall,
  ResolvedRetryPolicy, StreamChunk,
} from '@deepseek-ai/dsh-llm';
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai';
import type {} from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-authorization';
import type {} from '@deepseek-ai/dsh-credentials';
import { LmmIntegration } from '../vendor/pi-lmm-provider/src/provider.ts';
import { PROVIDER_ID } from '../vendor/pi-lmm-provider/src/protocol.ts';
import { mountBrowserAuth } from './web-auth.ts';

export const name = 'dsh-lmm-provider';
export const inject = ['llm', 'credentials'];
export const DSH_CLIENT_ID = 'lmm-dsh';
export const RECORD_KEY = credentialKey(name, PROVIDER_ID);

const REFRESH_TTL_MS = 60_000;
const STREAM_IDLE_TIMEOUT_MS = 300_000;
const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;
const REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048;
const REQUEST_IMAGE_MAX_BYTES = 1024 * 1024;

async function waitWithSignal(task: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return task;
  signal.throwIfAborted();
  let abort = (): void => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try { await Promise.race([task, aborted]); }
  finally { signal.removeEventListener('abort', abort); }
}

function jsonImage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => entry === undefined ? null : jsonImage(entry));
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      if (member !== undefined) result[key] = jsonImage(member);
    }
    return result;
  }
  return value;
}

function fromRecord(record: CredentialRecord | undefined): Credential | undefined {
  if (record === undefined) return undefined;
  if (record.kind === 'api-key') {
    return {
      type: 'api_key',
      ...(record.key === undefined ? {} : { key: record.key }),
      ...(record.env === undefined ? {} : { env: { ...record.env } }),
    };
  }
  return record.payload as Credential;
}

function toRecord(value: Credential): CredentialRecord {
  if (value.type === 'api_key') {
    return {
      kind: 'api-key',
      ...(value.key === undefined ? {} : { key: value.key }),
      ...(value.env === undefined ? {} : { env: { ...value.env } }),
    };
  }
  return { kind: 'grant', payload: jsonImage(value) };
}

/** Bridge pi-ai's OAuth store into DSH's durable credential record. */
export function credentialStoreFrom(ctx: Context, key: CredentialKey = RECORD_KEY): CredentialStore {
  const assertProvider = (providerId: string): void => {
    if (providerId !== PROVIDER_ID) throw new Error(`LMM credential store does not own provider ${JSON.stringify(providerId)}.`);
  };
  const checkSignal = (options?: AuthOperationOptions): void => options?.signal?.throwIfAborted();
  return {
    async read(providerId, options) {
      assertProvider(providerId);
      checkSignal(options);
      const value = fromRecord(await ctx.credentials.readRecord(key));
      checkSignal(options);
      return value;
    },
    async list(options): Promise<readonly CredentialInfo[]> {
      checkSignal(options);
      const record = await ctx.credentials.readRecord(key);
      checkSignal(options);
      return record === undefined ? [] : [{ providerId: PROVIDER_ID, type: record.kind === 'api-key' ? 'api_key' : 'oauth' }];
    },
    async modify(providerId, mutate, options) {
      assertProvider(providerId);
      checkSignal(options);
      const stored = await ctx.credentials.modifyRecord(key, async (current) => {
        checkSignal(options);
        const next = await mutate(fromRecord(current));
        checkSignal(options);
        return next === undefined ? undefined : toRecord(next);
      });
      checkSignal(options);
      return fromRecord(stored);
    },
    async delete(providerId, options) {
      assertProvider(providerId);
      checkSignal(options);
      await ctx.credentials.deleteRecord(key);
      checkSignal(options);
    },
  };
}

function relay(event: AuthEvent, session: AuthorizationSession): void {
  switch (event.type) {
    case 'info': {
      const link = event.links?.[0];
      session.notify({ message: event.message, ...(link === undefined ? {} : { url: link.url }) });
      return;
    }
    case 'auth_url':
      session.notify({ message: event.instructions ?? 'Open this page to continue signing in.', url: event.url });
      return;
    case 'device_code':
      session.notify({
        message: 'Enter this code on the verification page to finish signing in.',
        url: event.verificationUri,
        code: event.userCode,
      });
      return;
    case 'progress':
      session.notify({ message: event.message });
  }
}

function restate(prompt: AuthPrompt): AuthorizationPrompt {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal };
  if (prompt.type === 'select') return { ...signal, kind: 'select', message: prompt.message, options: prompt.options };
  return {
    ...signal,
    kind: prompt.type === 'secret' ? 'secret' : 'text',
    message: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
  };
}

export function lmmProfile(integration: LmmIntegration): ResolvedPiAiProviderProfile {
  return {
    provider: PROVIDER_ID,
    displayName: 'LMM',
    streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
    maxRequestImageBytes: MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: REQUEST_IMAGE_MAX_BYTES,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-lmm-provider retryPolicy'),
    piProvider: integration.provider,
    modelErrors: new Map(),
    configuredMaxTokens: new Map(),
  };
}

class CatalogCoordinator {
  private pending: Promise<void> | undefined;
  private checkedAt = 0;
  private readonly models: Models;

  constructor(models: Models) { this.models = models; }

  invalidate(): void { this.checkedAt = 0; }

  async refresh(signal?: AbortSignal, force = false, allowNetwork = true): Promise<void> {
    signal?.throwIfAborted();
    if (!force && Date.now() - this.checkedAt < REFRESH_TTL_MS) return;
    if (this.pending === undefined) {
      const task = this.models.refresh({
        providers: [PROVIDER_ID],
        allowNetwork,
        force: allowNetwork ? force : undefined,
        signal: AbortSignal.timeout(30_000),
      }).then((result) => {
        const error = result.errors.get(PROVIDER_ID);
        if (error !== undefined) throw error;
        if (!result.aborted) this.checkedAt = Date.now();
      });
      const pending = task.finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
      this.pending = pending;
    }
    await waitWithSignal(this.pending, signal);
  }
}

class RefreshingAdapter extends LlmAdapter {
  private readonly adapter: PiAiAdapter;
  private readonly catalog: CatalogCoordinator;

  constructor(adapter: PiAiAdapter, catalog: CatalogCoordinator) {
    super();
    this.adapter = adapter;
    this.catalog = catalog;
  }

  override providerInfo(provider: string): LlmProviderInfo { return this.adapter.providerInfo(provider); }
  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.adapter.providerRetryPolicy(provider);
  }
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    await this.catalog.refresh();
    return this.adapter.listModels(provider);
  }
  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    await this.catalog.refresh(signal);
    return this.adapter.resolveModel(provider, model, signal);
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    await this.catalog.refresh(signal);
    return this.adapter.prepareCall(provider, model, signal);
  }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> { return this.streamAfterRefresh(options); }
  private async * streamAfterRefresh(options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.catalog.refresh(options.signal);
    yield* this.adapter.stream(options);
  }
}

const authContext: AuthContext = {
  env: () => Promise.resolve(undefined),
  fileExists: () => Promise.resolve(false),
};

/** Mount the fixed LMM route and its browser OAuth flow into DSH. */
export function apply(ctx: Context): void {
  const integration = new LmmIntegration({
    clientId: DSH_CLIENT_ID,
    hostName: 'DSH',
    loginTimeoutMs: 5 * 60_000,
    refreshJournalDirectory: join(resolveDshHome(), 'lmm-refresh-journal'),
  });
  const credentials = credentialStoreFrom(ctx);
  const models = createModels({ credentials, authContext });
  models.setProvider(integration.provider);
  const catalog = new CatalogCoordinator(models);
  const profiles = new Map([[PROVIDER_ID, lmmProfile(integration)]]);
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: () => Promise.resolve(undefined),
    auth: { credentials, authContext },
    resolveAttachments: () => ctx.get('attachments'),
  });
  const registration = ctx.llm.registerAdapter([PROVIDER_ID], new RefreshingAdapter(adapter, catalog));

  ctx.inject(['authorization'], (authorized) => {
    authorized.authorization.registerFlow({
      key: RECORD_KEY,
      label: 'LMM',
      methods: [{ id: 'oauth', label: 'Sign in with LMM' }],
      async run(session) {
        await models.login(PROVIDER_ID, 'oauth', {
          signal: session.signal,
          notify: (event) => relay(event, session),
          prompt: (prompt) => session.prompt(restate(prompt)),
        });
        catalog.invalidate();
        await catalog.refresh(session.signal, true, false);
      },
    });
  });

  ctx.on('credentials/record-updated', (key) => {
    if (key === RECORD_KEY) {
      catalog.invalidate();
      registration.replace([PROVIDER_ID]);
    }
  });
  mountBrowserAuth(ctx, RECORD_KEY);
  ctx.effect(() => () => { integration.dispose(); });
}
