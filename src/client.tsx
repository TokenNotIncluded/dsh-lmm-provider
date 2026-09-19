import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';

type Result = { ok: true; value: unknown } | { ok: false; error: { message: string } };
type Caller = (action: string, payload?: unknown) => Promise<unknown>;
type View = {
  attempt: string;
  state: 'pending' | 'authorized' | 'cancelled' | 'failed';
  notices: { message: string; url?: string; code?: string }[];
  prompt?: { id: string; kind: 'text' | 'secret' | 'select'; message: string; placeholder?: string; options?: { id: string; label: string }[] };
};
interface ClientContext {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<Result> } };
  slots: {
    inject(name: string, callback: () => unknown): void;
    register(options: { name: string; id: string; order: number; inject: () => { call: Caller } }, component: ComponentType<{ call: Caller }>): unknown;
  };
}
const buttonStyle = { padding: '8px 14px', border: '1px solid currentColor', borderRadius: 6, background: 'transparent', color: 'inherit', cursor: 'pointer' };

function LoginCard({ call }: { call: Caller }) {
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>();
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const active = useRef<string>();
  const refresh = useCallback(async () => {
    const status = await call('status') as { signedIn: boolean; busy: boolean };
    setSignedIn(status.signedIn); setBusy(status.busy);
  }, [call]);
  useEffect(() => { let disposed = false; void refresh().catch(() => { if (!disposed) setError('Cannot read LMM sign-in status. Reopen Settings to retry.'); }); return () => { disposed = true; }; }, [refresh]);
  useEffect(() => () => { if (active.current) void call('cancel', { attempt: active.current }).catch(() => {}); }, [call]);
  useEffect(() => {
    if (view?.state !== 'pending') return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await call('poll', { attempt: view.attempt }) as View;
        if (disposed) return;
        setView(next);
        if (next.state === 'pending') timer = setTimeout(() => void poll(), 750);
        else { active.current = undefined; setBusy(false); await refresh(); }
      } catch { if (!disposed) { setError('Sign-in connection was interrupted. Cancel and try again.'); setBusy(false); } }
    };
    timer = setTimeout(() => void poll(), 300);
    return () => { disposed = true; clearTimeout(timer); };
  }, [view?.attempt, view?.state, call, refresh]);
  useEffect(() => { setAnswer(''); }, [view?.prompt?.id]);
  const start = async () => {
    setError(''); setBusy(true);
    try { const next = await call('begin') as View; active.current = next.attempt; setView(next); }
    catch (cause) { setBusy(false); setError(cause instanceof Error ? cause.message : 'Sign-in could not start.'); }
  };
  const cancel = async () => { if (view) { await call('cancel', { attempt: view.attempt }); active.current = undefined; setView(undefined); await refresh(); } };
  const submit = async () => {
    if (!view?.prompt) return;
    try { setView(await call('answer', { attempt: view.attempt, prompt: view.prompt.id, value: answer }) as View); setAnswer(''); }
    catch { setError('This question expired. Wait for the current sign-in step.'); }
  };
  const signOut = async () => { try { await call('logout'); setView(undefined); await refresh(); } catch { setError('Sign-out failed. Try again.'); } };
  const prompt = view?.prompt;
  return <section aria-label="LMM" style={{ marginTop: 24, padding: 20, border: '1px solid #8886', borderRadius: 8 }}>
    <h3 style={{ margin: '0 0 8px' }}>LMM</h3>
    <p>{signedIn ? 'Signed in with LMM. Choose an LMM model in your conversation.' : 'Connect your LMM account in the browser. No API key is needed.'}</p>
    <div style={{ display: 'flex', gap: 10 }}>
      <button style={buttonStyle} disabled={busy} onClick={() => void start()}>Sign in with LMM</button>
      {signedIn && <button style={buttonStyle} disabled={busy} onClick={() => void signOut()}>Sign out</button>}
      {view?.state === 'pending' && <button style={buttonStyle} onClick={() => void cancel().catch(() => setError('Cancellation failed. Try again.'))}>Cancel</button>}
    </div>
    <div aria-live="polite">
      {view?.notices.map((notice, i) => <p key={i}>{notice.message}{notice.url && safeLoginUrl(notice.url) && <> <a href={notice.url} target="_blank" rel="noreferrer">Open LMM sign-in</a></>}{notice.code && <code> {notice.code}</code>}</p>)}
      {view?.state === 'authorized' && <p>Sign-in complete.</p>}
      {view?.state === 'cancelled' && <p>Sign-in cancelled.</p>}
      {view?.state === 'failed' && <p>Sign-in failed. Check your connection and try again.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    {prompt && <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>{prompt.message}{prompt.kind === 'select' ? <select value={answer} onChange={(e) => setAnswer(e.target.value)}><option value="">Select…</option>{prompt.options?.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select> : <input type={prompt.kind === 'secret' ? 'password' : 'text'} value={answer} placeholder={prompt.placeholder} autoComplete="off" onChange={(e) => setAnswer(e.target.value)} />}</label>
      <button style={buttonStyle} disabled={!answer} type="submit">Continue</button>
    </form>}
    {signedIn && <small>Sign out removes this local login. Revoke account access on LMM when needed.</small>}
  </section>;
}
export function safeLoginUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'api.lmm.best' && url.username === '' && url.password === ''; } catch { return false; }
}
export const inject = ['slots', 'connection'];
export function apply(ctx: ClientContext): void {
  const call: Caller = async (action, payload = {}) => {
    const result = await ctx.connection.rpc.call('/api', 'lmm-auth/' + action, payload);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({ name: 'settings.models.footer', id: 'lmm-sign-in', order: 20, inject: () => ({ call }) }, LoginCard));
}
