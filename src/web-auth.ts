import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization';
import type { CredentialKey } from '@deepseek-ai/dsh-credentials';
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-client-connection';

export const AUTH_CHANNEL = '/api';
const ATTEMPT_MS = 5 * 60_000;
type PromptView = Omit<AuthorizationPrompt, 'signal'> & { id: string; options?: readonly { id: string; label: string }[] };
type Attempt = {
  id: string;
  state: 'pending' | 'authorized' | 'cancelled' | 'failed';
  controller: AbortController;
  notices: AuthorizationNotice[];
  error?: string;
  prompt?: PromptView;
  answer?: (value: string) => void;
};
const fail = (code: string, message: string): ConnectionRpcResult<never> => ({ ok: false, error: { code, message, details: {} } });
const ok = (value: unknown): ConnectionRpcResult<unknown> => ({ ok: true, value });

/** Only fixed, credential-free messages may cross the browser RPC boundary. */
function publicAuthError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'callback_unavailable': return 'DSH could not listen for the browser callback on 127.0.0.1. Check the local firewall and try again.';
    case 'oauth_denied': return 'LMM access was denied. Start sign-in again to retry.';
    case 'transport_error': return 'DSH could not reach LMM. Check your connection and try again.';
    case 'invalid_response': return 'LMM returned an invalid authorization response. Update the plugin and try again.';
    case 'NOT_COMMITTED': return 'DSH did not save the LMM login. Restart DSH and try again.';
    case 'ALREADY_IN_FLIGHT': return 'Another LMM sign-in is already running. Finish or cancel that attempt first.';
    default: return 'LMM sign-in failed. Try again; if it persists, check the DSH Host log.';
  }
}

/** The host's authenticated Connection transport owns Host/Origin/cookie checks. */
export function mountBrowserAuth(ctx: Context, key: CredentialKey): void {
  ctx.inject(['connection', 'authorization', 'credentials', 'webServer'], (web) => {
    let current: Attempt | undefined;
    const owned = (payload: unknown): Attempt | undefined => {
      if (payload === null || typeof payload !== 'object') return;
      return 'attempt' in payload && payload.attempt === current?.id ? current : undefined;
    };
    const view = (attempt: Attempt) => ({
      attempt: attempt.id, state: attempt.state, notices: attempt.notices,
      ...(attempt.prompt === undefined ? {} : { prompt: attempt.prompt }),
      ...(attempt.error === undefined ? {} : { error: attempt.error }),
    });
    const stop = () => { current?.controller.abort(); };
    web.effect(() => stop);
    const dispatch = async (endpoint: string, payload: unknown): Promise<ConnectionRpcResult<unknown>> => {
      if (endpoint === 'status') {
        return ok({ signedIn: (await web.credentials.readRecord(key))?.kind === 'grant', busy: current?.state === 'pending' });
      }
      if (endpoint === 'begin') {
        if (current?.state === 'pending') return fail('BUSY', 'LMM sign-in is already running.');
        const attempt: Attempt = { id: randomUUID(), state: 'pending', controller: new AbortController(), notices: [] };
        current = attempt;
        const timer = setTimeout(() => attempt.controller.abort(), ATTEMPT_MS);
        timer.unref();
        void web.authorization.begin({
          key, method: 'oauth', signal: attempt.controller.signal,
          interaction: {
            notify(notice) { attempt.notices = [...attempt.notices.slice(-7), notice]; },
            prompt(prompt) {
              const signal = prompt.signal === undefined ? attempt.controller.signal : AbortSignal.any([prompt.signal, attempt.controller.signal]);
              signal.throwIfAborted();
              return new Promise<string>((resolve, reject) => {
                const id = randomUUID();
                const { signal: _signal, ...rest } = prompt;
                void _signal;
                attempt.prompt = { ...rest, id };
                const clear = () => {
                  signal.removeEventListener('abort', abort);
                  if (attempt.prompt?.id === id) { delete attempt.prompt; delete attempt.answer; }
                };
                const abort = () => { clear(); reject(new Error('LMM sign-in prompt withdrawn.')); };
                attempt.answer = (answer) => { clear(); resolve(answer); };
                signal.addEventListener('abort', abort, { once: true });
              });
            },
          },
        }).then((outcome) => { attempt.state = outcome.status; }).catch((error: unknown) => {
          // Never reflect provider error text or token exchange response bodies into a browser.
          attempt.state = attempt.controller.signal.aborted ? 'cancelled' : 'failed';
          if (attempt.state === 'failed') attempt.error = publicAuthError(error);
        }).finally(() => {
          clearTimeout(timer);
          delete attempt.prompt;
          delete attempt.answer;
          attempt.notices = [];
        });
        return ok(view(attempt));
      }
      if (endpoint === 'logout') {
        if (current?.state === 'pending') return fail('BUSY', 'Cancel sign-in before signing out.');
        await web.credentials.deleteRecord(key);
        return ok({ signedIn: false });
      }
      if (!['poll', 'answer', 'cancel'].includes(endpoint)) return fail('NOT_FOUND', 'Unknown LMM action.');
      const attempt = owned(payload);
      if (attempt === undefined) return fail('NOT_FOUND', 'This sign-in attempt is unavailable. Start again.');
      if (endpoint === 'answer') {
        const body = payload as Record<string, unknown>;
        const prompt = attempt.prompt;
        if (attempt.state !== 'pending' || prompt === undefined || body.prompt !== prompt.id || typeof body.value !== 'string' || body.value.length > 4096) {
          return fail('INVALID_PROMPT', 'The sign-in question has changed.');
        }
        if (prompt.kind === 'select' && !prompt.options?.some((option) => option.id === body.value)) return fail('INVALID_ANSWER', 'Choose an offered option.');
        attempt.answer?.(body.value);
      } else if (endpoint === 'cancel') {
        attempt.controller.abort();
      }
      return ok(view(attempt));
    };
    for (const action of ['status', 'begin', 'poll', 'answer', 'cancel', 'logout']) {
      web.effect(() => web.connection.fetch.register({
        path: `${AUTH_CHANNEL}/lmm-auth/${action}`, methods: ['POST'], requestBody: 'buffered',
        async fetch(request) {
          let envelope: unknown;
          try { envelope = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
          if (envelope === null || typeof envelope !== 'object') return new Response('Invalid request', { status: 400 });
          const message = envelope as Record<string, unknown>;
          if (message.type !== 'client-request' || typeof message.rpcId !== 'string' || message.rpcId.length > 256 || message.method !== `lmm-auth/${action}`) return new Response('Invalid request', { status: 400 });
          let result: ConnectionRpcResult<unknown>;
          try { result = await dispatch(action, message.payload); } catch { result = fail('INTERNAL', 'LMM sign-in could not complete. Please try again.'); }
          return Response.json({ type: 'server-response', rpcId: message.rpcId, result }, { headers: { 'Cache-Control': 'no-store' } });
        },
      }));
    }
  });
}
