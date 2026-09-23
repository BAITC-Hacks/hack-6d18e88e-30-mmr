import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  createClient: vi.fn(),
  auth: {
    getUser: vi.fn(), getSession: vi.fn(), signUp: vi.fn(), signInWithPassword: vi.fn(),
    signOut: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn(),
    verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn(), setSession: vi.fn(),
    onAuthStateChange: vi.fn(), resend: vi.fn(),
  },
  from: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }));

const user = {
  id: '55affd29-03ef-4a43-af2e-faa31d479823', email: 'student@example.test',
  email_confirmed_at: '2026-09-23T10:00:00Z', user_metadata: { role: 'admin', full_name: 'Untrusted metadata' },
};
const profile = { id: user.id, full_name: 'Алия', role: 'student', newsletter_opt_in: false };
const session = { user, access_token: 'test-access-token', refresh_token: 'test-refresh-token' };
let page: URL;
let listener: (event: string, activeSession: typeof session | null) => void;
let query: { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; single: ReturnType<typeof vi.fn> };

function navigate(path: string) { page = new URL(path, 'http://localhost:5173'); }
async function load() { return import('./authClient'); }

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_example_test_key');
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000');
  navigate('/account');
  vi.stubGlobal('window', {
    location: { get href() { return page.href; }, get origin() { return page.origin; } },
    history: { state: null, replaceState: vi.fn((_state, _unused, next) => { navigate(next); }) },
  });
  vi.stubGlobal('fetch', vi.fn());
  query = { select: vi.fn(), update: vi.fn(), eq: vi.fn(), single: vi.fn() };
  query.select.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.single.mockResolvedValue({ data: profile, error: null });
  sdk.from.mockReturnValue(query);
  sdk.createClient.mockReturnValue({ auth: sdk.auth, from: sdk.from });
  sdk.auth.onAuthStateChange.mockImplementation(callback => {
    listener = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  sdk.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  sdk.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  for (const method of ['signUp', 'signInWithPassword', 'signOut', 'resetPasswordForEmail', 'updateUser', 'resend'] as const) {
    sdk.auth[method].mockResolvedValue({ data: { user }, error: null });
  }
  sdk.auth.verifyOtp.mockResolvedValue({ data: { user, session }, error: null });
  sdk.auth.setSession.mockResolvedValue({ data: { user, session }, error: null });
  sdk.auth.exchangeCodeForSession.mockResolvedValue({ data: { user, session }, error: null });
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Supabase identity and configuration', () => {
  it('reads the verified identity and RLS profile, never role metadata', async () => {
    const { authClient } = await load();
    await expect(authClient.login(' student@example.test ', 'valid-password')).resolves.toEqual({
      ...profile, email: user.email, email_verified: true,
    });
    expect(sdk.auth.signInWithPassword).toHaveBeenCalledWith({ email: user.email, password: 'valid-password' });
    expect(sdk.auth.getUser).toHaveBeenCalledOnce();
    expect(sdk.from).toHaveBeenCalledWith('profiles');
    expect(query.eq).toHaveBeenCalledWith('id', user.id);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not invent an account if the profile migration is missing', async () => {
    query.single.mockResolvedValue({ data: null, error: { code: '42P01', message: 'table missing' } });
    const { authClient } = await load();
    await expect(authClient.me()).rejects.toMatchObject({ status: 503, message: expect.stringContaining('профиль') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a profile for a different user', async () => {
    query.single.mockResolvedValue({ data: { ...profile, id: 'someone-else' }, error: null });
    const { authClient } = await load();
    await expect(authClient.me()).rejects.toMatchObject({ status: 503 });
  });

  it('does not query profiles when Supabase cannot verify the user', async () => {
    sdk.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    const { authClient } = await load();
    await expect(authClient.me()).rejects.toMatchObject({ status: 401 });
    expect(sdk.from).not.toHaveBeenCalled();
  });

  it('sends explicit opt-in and public role as signup metadata', async () => {
    const { authClient } = await load();
    await expect(authClient.register({ email: user.email, password: 'valid-password', full_name: ' Алия ', role: 'business' })).resolves.toMatchObject({ requires_email_confirmation: true });
    expect(sdk.auth.signUp).toHaveBeenCalledWith({
      email: user.email, password: 'valid-password', options: {
        emailRedirectTo: 'http://localhost:5173/auth/callback',
        data: { full_name: 'Алия', role: 'business', newsletter_opt_in: false },
      },
    });
    expect(sdk.from).not.toHaveBeenCalled();
  });

  it.each(['short', 'x'.repeat(129)])('rejects invalid signup password lengths before any request', async password => {
    const { authClient } = await load();
    await expect(authClient.register({ email: user.email, password, full_name: 'Алия', role: 'student' })).rejects.toMatchObject({ status: 400 });
    expect(sdk.auth.signUp).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not claim a confirmation email was sent if dashboard email confirmation is disabled', async () => {
    sdk.auth.signUp.mockResolvedValue({ data: { user, session }, error: null });
    const { authClient } = await load();
    await expect(authClient.register({ email: user.email, password: 'valid-password', full_name: 'Алия', role: 'student' })).resolves.toMatchObject({
      message: expect.stringContaining('Аккаунт создан'),
      requires_email_confirmation: false,
    });
  });

  it('changes only the current user newsletter preference', async () => {
    query.single.mockResolvedValue({ data: { ...profile, newsletter_opt_in: true }, error: null });
    const { authClient } = await load();
    await expect(authClient.preferences(true)).resolves.toMatchObject({ newsletter_opt_in: true });
    expect(query.update).toHaveBeenCalledWith({ newsletter_opt_in: true });
    expect(query.eq).toHaveBeenCalledWith('id', user.id);
  });

  it.each([
    ['', 'sb_publishable_example_test_key'],
    ['https://project.supabase.co', ''],
    ['not-a-url', 'sb_publishable_example_test_key'],
    ['https://project.supabase.co', 'sb_secret_never_in_frontend'],
    ['https://project.supabase.co', `header.${btoa('{"role":"service_role"}')}.signature`],
  ])('fails closed with incomplete or unsafe config', async (url, key) => {
    vi.stubEnv('VITE_SUPABASE_URL', url);
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', key);
    const { authClient, authProvider } = await load();
    expect(authProvider).toBe('supabase');
    await expect(authClient.login(user.email, 'valid-password')).rejects.toMatchObject({ status: 503 });
    expect(sdk.createClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires Supabase configuration for production', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const { authClient, authProvider } = await load();
    expect(authProvider).toBe('supabase');
    await expect(authClient.initialize()).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a safe error when the SDK throws a URL containing a secret', async () => {
    sdk.auth.signInWithPassword.mockRejectedValue(new Error('https://host/?secret=test-secret-value'));
    const { authClient } = await load();
    await expect(authClient.login(user.email, 'valid-password')).rejects.toMatchObject({
      status: 503, message: expect.not.stringContaining('test-secret-value'),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('password recovery and callbacks', () => {
  it('does not authorize a reset from its URL or an ordinary signed-in session', async () => {
    navigate('/auth/reset-password');
    sdk.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    const { authClient } = await load();
    await expect(authClient.initialize()).rejects.toMatchObject({ status: 400 });
    await expect(authClient.resetPassword('', 'new-secure-password')).rejects.toMatchObject({ status: 400 });
    expect(sdk.auth.updateUser).not.toHaveBeenCalled();
  });

  it('verifies recovery once in StrictMode, cleans the URL, changes password and signs out globally', async () => {
    navigate('/auth/reset-password?token_hash=one-time-secret&type=recovery&theme=light');
    sdk.auth.verifyOtp.mockImplementation(async () => {
      expect(page.search).toBe('?theme=light');
      return { data: { user, session }, error: null };
    });
    const { authClient } = await load();
    const first = authClient.initialize();
    expect(authClient.initialize()).toBe(first);
    await expect(first).resolves.toEqual({ mode: 'recovery', account: null });
    expect(sdk.auth.verifyOtp).toHaveBeenCalledOnce();
    expect(sdk.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'one-time-secret', type: 'recovery' });
    expect(sdk.from).not.toHaveBeenCalled();
    await expect(authClient.resetPassword('', 'new-secure-password')).resolves.toMatchObject({ message: expect.stringContaining('Пароль изменён') });
    expect(sdk.auth.updateUser).toHaveBeenCalledWith({ password: 'new-secure-password' });
    expect(sdk.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(page.pathname).toBe('/auth');
    await expect(authClient.resetPassword('', 'another-secure-password')).rejects.toMatchObject({ status: 400 });
    expect(sdk.auth.updateUser).toHaveBeenCalledOnce();
  });

  it('clears an expired OTP from history and keeps recovery disabled', async () => {
    navigate('/auth/reset-password?token_hash=expired-secret&type=recovery');
    sdk.auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { code: 'otp_expired', status: 403 } });
    const { authClient } = await load();
    await expect(authClient.initialize()).rejects.toMatchObject({ message: expect.stringContaining('устарела') });
    expect(page.search).toBe('');
    await expect(authClient.resetPassword('', 'new-secure-password')).rejects.toMatchObject({ status: 400 });
    expect(sdk.auth.updateUser).not.toHaveBeenCalled();
  });

  it('discards the local credentials after reset even when global logout is offline', async () => {
    navigate('/auth/reset-password?token_hash=one-time-secret&type=recovery');
    const { authClient } = await load();
    await authClient.initialize();
    const options = sdk.createClient.mock.calls[0][2];
    options.auth.storage.setItem(options.auth.storageKey, 'old-session-credentials');
    sdk.auth.signOut.mockResolvedValue({ error: { status: 503 } });
    await expect(authClient.resetPassword('', 'new-secure-password')).resolves.toMatchObject({
      message: expect.stringContaining('Не удалось подтвердить выход на других устройствах'),
    });
    expect(options.auth.storage.getItem(options.auth.storageKey)).toBeNull();
    expect(page.pathname).toBe('/auth');
    await expect(authClient.resetPassword('', 'new-secure-password')).rejects.toMatchObject({ status: 400 });
  });

  it('clears error descriptions and tokens without displaying raw callback values', async () => {
    navigate('/auth/reset-password#error=access_denied&error_description=secret-details&access_token=secret');
    const { authClient } = await load();
    await expect(authClient.initialize()).rejects.toMatchObject({ message: expect.not.stringContaining('secret') });
    expect(page.hash).toBe('');
    expect(sdk.auth.setSession).not.toHaveBeenCalled();
  });

  it('accepts a PKCE recovery event after successfully exchanging its code', async () => {
    navigate('/auth/reset-password?code=one-time-code');
    sdk.auth.exchangeCodeForSession.mockImplementation(async () => {
      listener('PASSWORD_RECOVERY', session);
      return { data: { user, session }, error: null };
    });
    const { authClient } = await load();
    await expect(authClient.initialize()).resolves.toMatchObject({ mode: 'recovery' });
    expect(page.search).toBe('');
  });

  it('does not treat an ordinary PKCE sign-in on the reset route as recovery', async () => {
    navigate('/auth/reset-password?code=signup-code');
    const { authClient } = await load();
    await expect(authClient.initialize()).rejects.toMatchObject({ status: 400 });
    await expect(authClient.resetPassword('', 'new-secure-password')).rejects.toMatchObject({ status: 400 });
  });

  it('validates implicit recovery tokens before opening the password form', async () => {
    navigate('/auth/reset-password#access_token=access&refresh_token=refresh&type=recovery');
    const { authClient } = await load();
    await expect(authClient.initialize()).resolves.toMatchObject({ mode: 'recovery' });
    expect(sdk.auth.setSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' });
    expect(sdk.auth.getUser).toHaveBeenCalledOnce();
    expect(page.hash).toBe('');
  });

  it('requires the same verified user when submitting a new password', async () => {
    navigate('/auth/reset-password?token_hash=one-time-secret&type=recovery');
    const { authClient } = await load();
    await authClient.initialize();
    sdk.auth.getUser.mockResolvedValue({ data: { user: { ...user, id: 'different-user' } }, error: null });
    await expect(authClient.resetPassword('', 'new-secure-password')).rejects.toMatchObject({ status: 400 });
    expect(sdk.auth.updateUser).not.toHaveBeenCalled();
  });

  it('signup confirmation loads a real profile but does not enable password recovery', async () => {
    navigate('/auth/callback?token_hash=signup-secret&type=signup');
    const { authClient } = await load();
    await expect(authClient.initialize()).resolves.toMatchObject({ mode: 'verified', account: { id: user.id } });
    expect(page.pathname).toBe('/auth');
    await expect(authClient.resetPassword('', 'new-secure-password')).rejects.toMatchObject({ status: 400 });
  });

  it('revalidates a session and fresh profile on later mounts', async () => {
    sdk.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    const { authClient } = await load();
    await expect(authClient.initialize()).resolves.toMatchObject({ account: { newsletter_opt_in: false } });
    query.single.mockResolvedValue({ data: { ...profile, newsletter_opt_in: true }, error: null });
    await expect(authClient.initialize()).resolves.toMatchObject({ account: { newsletter_opt_in: true } });
    expect(sdk.auth.getUser).toHaveBeenCalledTimes(2);
  });

  it('sends reset mail to the dedicated allowed redirect', async () => {
    const { authClient } = await load();
    await expect(authClient.forgotPassword(user.email)).resolves.toMatchObject({ message: expect.stringContaining('Если адрес') });
    expect(sdk.auth.resetPasswordForEmail).toHaveBeenCalledWith(user.email, { redirectTo: 'http://localhost:5173/auth/reset-password' });
  });
});

describe('explicit local development adapter', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
  });

  it('uses the cookie API when no Supabase configuration exists in development', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail: 'Not signed in' }), { status: 401 }));
    const { authClient, authProvider, getAccessToken } = await load();
    expect(authProvider).toBe('local');
    await expect(authClient.initialize()).resolves.toEqual({ account: null, mode: 'none' });
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/api/auth/me', expect.objectContaining({ credentials: 'include', method: 'GET' }));
    expect(sdk.createClient).not.toHaveBeenCalled();
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it.each([
    ['', '/api/auth/me'],
    ['http://localhost:8000///', 'http://localhost:8000/api/auth/me'],
  ])('preserves the local proxy API base: %s', async (base, endpoint) => {
    vi.stubEnv('VITE_API_BASE_URL', base);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail: 'Not signed in' }), { status: 401 }));
    const { authClient } = await load();
    await expect(authClient.initialize()).resolves.toEqual({ account: null, mode: 'none' });
    expect(fetch).toHaveBeenCalledWith(endpoint, expect.objectContaining({ credentials: 'include', method: 'GET' }));
    expect(sdk.createClient).not.toHaveBeenCalled();
  });

  it('consumes legacy verification links at the demo root before contacting the API', async () => {
    navigate('/#verify=legacy-verification');
    vi.mocked(fetch).mockImplementation(async () => {
      expect(page.hash).toBe('');
      return new Response(JSON.stringify({ message: 'Email подтверждён.' }));
    });
    const { authClient } = await load();
    await expect(authClient.initialize()).resolves.toMatchObject({ mode: 'verified' });
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/api/auth/verify-email', expect.objectContaining({
      body: JSON.stringify({ token: 'legacy-verification' }),
    }));
    expect(sdk.createClient).not.toHaveBeenCalled();
  });

  it('keeps a legacy reset token only in memory and sends it once', async () => {
    navigate('/account#reset=legacy-secret');
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: 'Пароль изменён.' })));
    const { authClient } = await load();
    await expect(authClient.initialize()).resolves.toMatchObject({ mode: 'recovery' });
    expect(page.hash).toBe('');
    await authClient.resetPassword('', 'new-secure-password');
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/api/auth/reset-password', expect.objectContaining({
      body: JSON.stringify({ token: 'legacy-secret', new_password: 'new-secure-password' }),
    }));
    await expect(authClient.resetPassword('', 'another-password')).rejects.toMatchObject({ status: 400 });
  });
});

describe('auth audit regressions', () => {
  it.each(['', ' '.repeat(5), 'Я'.repeat(121)])('rejects invalid registration names before signup: %s', async full_name => {
    const { authClient } = await load();
    await expect(authClient.register({ email: user.email, password: 'valid-password', full_name, role: 'student' })).rejects.toMatchObject({ status: 400 });
    expect(sdk.auth.signUp).not.toHaveBeenCalled();
  });

  it.each(['', 'Я'.repeat(120), '𐐀'.repeat(120)])('accepts existing profile names permitted by SQL: %s', async full_name => {
    query.single.mockResolvedValue({ data: { ...profile, full_name }, error: null });
    const { authClient } = await load();
    await expect(authClient.me()).resolves.toMatchObject({ full_name });
  });

  it('rejects an oversized Supabase profile', async () => {
    query.single.mockResolvedValue({ data: { ...profile, full_name: 'Я'.repeat(121) }, error: null });
    const { authClient } = await load();
    await expect(authClient.me()).rejects.toMatchObject({ status: 503 });
  });

  it('uses a safe configuration error without build variable names', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const { authClient } = await load();
    await expect(authClient.initialize()).rejects.toMatchObject({ status: 503, code: 'CONFIGURATION', message: expect.not.stringMatching(/VITE_|\.env|Supabase/) });
  });

  it.each(['setItem', 'removeItem'] as const)('does not resurrect stale credentials when %s fails but reads succeed', async failedOperation => {
    const disk = new Map<string, string>();
    Object.assign(window, { localStorage: {
      getItem: (key: string) => disk.get(key) ?? null,
      setItem: (key: string, value: string) => { if (failedOperation === 'setItem') throw new Error('QuotaExceededError'); disk.set(key, value); },
      removeItem: (key: string) => { if (failedOperation === 'removeItem') throw new Error('SecurityError'); disk.delete(key); },
    } });
    const { authClient } = await load();
    await authClient.initialize();
    const options = sdk.createClient.mock.calls[0][2].auth;
    disk.set(options.storageKey, 'old-session');
    if (failedOperation === 'setItem') {
      options.storage.setItem(options.storageKey, 'new-session');
      expect(options.storage.getItem(options.storageKey)).toBe('new-session');
    } else {
      const { clearSupabaseLocalSession } = await import('./supabaseClient');
      clearSupabaseLocalSession();
      expect(options.storage.getItem(options.storageKey)).toBeNull();
    }
  });

  it.each([null, {}, { ...profile, email: user.email, email_verified: 'yes' }, { ...profile, email: user.email, email_verified: true, full_name: null }])('rejects malformed local accounts: %j', async payload => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(payload)));
    const { authClient } = await load();
    await expect(authClient.login(user.email, 'valid-password')).rejects.toMatchObject({ status: 503 });
  });

  it.each([null, {}, { message: 123 }, { message: 'okay', requires_email_confirmation: 'false' }])('rejects malformed local messages: %j', async payload => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(payload)));
    const { authClient } = await load();
    await expect(authClient.forgotPassword(user.email)).rejects.toMatchObject({ status: 503 });
  });

  it('hides unexpected proxy exception details in local errors', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail: 'Traceback https://host/?token=private-value' }), { status: 500 }));
    const { authClient } = await load();
    await expect(authClient.login(user.email, 'valid-password')).rejects.toMatchObject({ status: 500, message: expect.not.stringContaining('private-value') });
  });

  it.each(['declared', 'streamed'])('bounds %s local response bodies and cancels the stream', async type => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(16_385))); },
      cancel,
    });
    vi.mocked(fetch).mockResolvedValue(new Response(body, { headers: type === 'declared' ? { 'Content-Length': '16385' } : {} }));
    const { authClient } = await load();
    await expect(authClient.me()).rejects.toMatchObject({ status: 503 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('accepts a validated local account but discards unexpected private fields', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const account = { ...profile, id: 12, email: user.email, email_verified: true };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...account, password_hash: 'private-hash' })));
    const { authClient } = await load();
    await expect(authClient.me()).resolves.toEqual(account);
  });

  it('resumes shared storage reads after a later write succeeds', async () => {
    const disk = new Map<string, string>();
    let denied = true;
    Object.assign(window, { localStorage: {
      getItem: (key: string) => disk.get(key) ?? null,
      setItem: (key: string, value: string) => { if (denied) throw new Error('QuotaExceededError'); disk.set(key, value); },
    } });
    const { authClient } = await load();
    await authClient.initialize();
    const options = sdk.createClient.mock.calls[0][2].auth;
    options.storage.setItem(options.storageKey, 'first-session');
    expect(options.storage.getItem(options.storageKey)).toBe('first-session');
    denied = false;
    options.storage.setItem(options.storageKey, 'second-session');
    disk.set(options.storageKey, 'session-updated-in-another-tab');
    expect(options.storage.getItem(options.storageKey)).toBe('session-updated-in-another-tab');
  });

  it.each(['update', 'delete'])('observes an external storage %s after a successful own write', async operation => {
    const disk = new Map<string, string>();
    let readsDenied = false;
    Object.assign(window, { localStorage: {
      getItem: (key: string) => { if (readsDenied) throw new Error('SecurityError'); return disk.get(key) ?? null; },
      setItem: (key: string, value: string) => disk.set(key, value),
      removeItem: (key: string) => disk.delete(key),
    } });
    const { authClient } = await load();
    await authClient.initialize();
    const options = sdk.createClient.mock.calls[0][2].auth;
    options.storage.setItem(options.storageKey, 'original-session');
    // Change only the disk, as another tab would; no local adapter notification.
    if (operation === 'update') disk.set(options.storageKey, 'external-session');
    else disk.delete(options.storageKey);
    expect(options.storage.getItem(options.storageKey)).toBe(operation === 'update' ? 'external-session' : null);
    readsDenied = true;
    expect(options.storage.getItem(options.storageKey)).toBe(operation === 'update' ? 'external-session' : null);
  });
});
