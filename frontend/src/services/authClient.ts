import type { User } from '@supabase/supabase-js';
import type { Account, AuthBootstrap, AuthMessage, Registration } from '../types/auth';
import { authProvider, clearSupabaseLocalSession, getSupabaseClient } from './supabaseClient';

export { authProvider } from './supabaseClient';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const mailMessage = 'Если адрес подходит для этой операции, письмо будет отправлено. Проверьте почту и папку «Спам».';
const invalidLink = 'Ссылка недействительна или устарела. Запросите новое письмо и откройте последнюю ссылку.';
const profileMessage = 'Не удалось загрузить профиль. Проверьте подключение и настройку таблицы profiles в Supabase.';
let initialization: Promise<AuthBootstrap> | undefined;
let recoveryUserId: string | null = null;
let legacyResetToken = '';

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

function translateError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  if (error instanceof Error && error.name === 'SupabaseConfigurationError') {
    return new AuthError(error.message, 503);
  }
  const failure = error as { code?: string; status?: number; name?: string } | null;
  const messages: Record<string, string> = {
    invalid_credentials: 'Неверный email или пароль.',
    email_not_confirmed: 'Сначала подтвердите email по ссылке из письма.',
    weak_password: 'Придумайте более надёжный пароль: минимум 12 символов.',
    same_password: 'Новый пароль должен отличаться от предыдущего.',
    over_email_send_rate_limit: 'Письмо недавно отправлено. Подождите минуту и попробуйте снова.',
    over_request_rate_limit: 'Слишком много попыток. Подождите немного и попробуйте снова.',
    otp_expired: invalidLink,
    otp_disabled: invalidLink,
    bad_code_verifier: 'Откройте ссылку в том же браузере, где запросили письмо, или запросите новую.',
    flow_state_expired: invalidLink,
    flow_state_not_found: invalidLink,
    signup_disabled: 'Регистрация временно закрыта. Попробуйте позже.',
    user_already_exists: 'Проверьте почту или попробуйте войти в аккаунт.',
    email_address_invalid: 'Укажите корректный адрес email.',
    validation_failed: 'Проверьте email и заполнение полей.',
  };
  if (failure?.code && messages[failure.code]) {
    return new AuthError(messages[failure.code], failure.status ?? 400);
  }
  if (failure?.status === 429) return new AuthError(messages.over_request_rate_limit, 429);
  if (failure?.status === 401 || failure?.code === 'session_not_found' || failure?.name === 'AuthSessionMissingError') {
    return new AuthError('Сессия завершилась. Войдите снова.', 401);
  }
  // Raw SDK/network errors may contain URLs or credentials. Never render them.
  return new AuthError('Не удалось связаться с сервисом. Проверьте интернет и настройки подключения, затем повторите попытку.', 503);
}

async function safely<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) { throw translateError(error); }
}

async function request<T>(path: string, body?: unknown, method = 'POST', scope = 'auth'): Promise<T> {
  return safely(async () => {
    const response = await fetch(`${baseUrl}/api/${scope}/${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new AuthError(typeof data.detail === 'string' ? data.detail : 'Проверьте заполнение полей.', response.status);
    }
    return data as T;
  });
}

function redirect(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function validatePassword(password: string) {
  if (password.length < 12 || password.length > 128) {
    throw new AuthError('Пароль должен содержать от 12 до 128 символов.', 400);
  }
}

function clearCallbackPath() {
  const url = new URL(window.location.href);
  if (['/auth/callback', '/auth/reset-password'].includes(url.pathname)) {
    window.history.replaceState(window.history.state, '', `/auth${url.search}${url.hash}`);
  }
}

async function verifiedUser(): Promise<User> {
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new AuthError('Войдите в аккаунт.', 401);
  return data.user;
}

async function accountFor(user: User): Promise<Account> {
  const { data, error } = await getSupabaseClient().from('profiles')
    .select('id, full_name, role, newsletter_opt_in').eq('id', user.id).single();
  if (error || !data || data.id !== user.id || typeof data.full_name !== 'string' ||
      !['student', 'business', 'admin'].includes(data.role) || typeof data.newsletter_opt_in !== 'boolean') {
    throw new AuthError(profileMessage, 503);
  }
  return {
    id: user.id,
    email: user.email ?? '',
    full_name: data.full_name,
    role: data.role,
    newsletter_opt_in: data.newsletter_opt_in,
    email_verified: Boolean(user.email_confirmed_at),
  };
}

// Copy callback values, then immediately remove secrets (even on errors) from
// browser history. Tokens are never written to the application/Zustand store.
function consumeCallback() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const value = (key: string) => url.searchParams.get(key) ?? hash.get(key) ?? '';
  const callback = {
    path: url.pathname,
    tokenHash: value('token_hash'), type: value('type'), code: value('code'),
    accessToken: value('access_token'), refreshToken: value('refresh_token'),
    error: value('error') || value('error_code'),
    reset: value('reset'), verify: value('verify'),
  };
  let changed = false;
  for (const key of ['token_hash', 'token', 'type', 'code', 'access_token', 'refresh_token',
    'expires_at', 'expires_in', 'token_type', 'provider_token', 'provider_refresh_token',
    'error', 'error_code', 'error_description', 'reset', 'verify']) {
    if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
    if (hash.has(key)) { hash.delete(key); changed = true; }
  }
  if (changed) {
    url.hash = hash.toString();
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return callback;
}

async function bootstrap(): Promise<AuthBootstrap> {
  const callback = consumeCallback();
  if (callback.error) throw new AuthError(invalidLink, 400);
  if (authProvider === 'local') {
    if (callback.reset) {
      legacyResetToken = callback.reset;
      return { account: null, mode: 'recovery' };
    }
    if (callback.verify) {
      const result = await request<AuthMessage>('verify-email', { token: callback.verify });
      clearCallbackPath();
      return { account: null, mode: 'verified', message: result.message };
    }
    if (legacyResetToken) return { account: null, mode: 'recovery' };
    if (callback.path === '/auth/reset-password') throw new AuthError(invalidLink, 400);
    try {
      return { account: await request<Account>('me', undefined, 'GET'), mode: 'session' };
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) return { account: null, mode: 'none' };
      throw error;
    }
  }

  const client = getSupabaseClient();
  let recoveryEventUserId: string | null = null;
  // Do not await SDK methods in this synchronous event callback (auth lock).
  const { data: listener } = client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) recoveryEventUserId = session.user.id;
  });
  try {
    let callbackCompleted = false;
    let recoveryCallback = false;
    if (callback.tokenHash) {
      if (!['signup', 'recovery'].includes(callback.type)) throw new AuthError(invalidLink, 400);
      const { data, error } = await client.auth.verifyOtp({
        token_hash: callback.tokenHash, type: callback.type as 'signup' | 'recovery',
      });
      if (error) throw error;
      if (!data.session) throw new AuthError(invalidLink, 400);
      callbackCompleted = true;
      recoveryCallback = callback.type === 'recovery';
    } else if (callback.code) {
      const { data, error } = await client.auth.exchangeCodeForSession(callback.code);
      if (error) throw error;
      if (!data.session) throw new AuthError(invalidLink, 400);
      callbackCompleted = true;
      recoveryCallback = recoveryEventUserId === data.session.user.id;
    } else if (callback.accessToken || callback.refreshToken) {
      if (!callback.accessToken || !callback.refreshToken || !['signup', 'recovery'].includes(callback.type)) {
        throw new AuthError(invalidLink, 400);
      }
      const { data, error } = await client.auth.setSession({
        access_token: callback.accessToken, refresh_token: callback.refreshToken,
      });
      if (error) throw error;
      if (!data.session) throw new AuthError(invalidLink, 400);
      callbackCompleted = true;
      recoveryCallback = callback.type === 'recovery';
    }

    if (callbackCompleted) {
      const user = await verifiedUser();
      if (recoveryCallback || recoveryEventUserId === user.id) {
        recoveryUserId = user.id;
        return { account: null, mode: 'recovery' };
      }
      if (callback.path === '/auth/reset-password') throw new AuthError(invalidLink, 400);
      const account = await accountFor(user);
      clearCallbackPath();
      return { account, mode: 'verified', message: 'Email подтверждён. Добро пожаловать в AI Sana!' };
    }

    if (recoveryUserId) {
      if ((await verifiedUser()).id === recoveryUserId) return { account: null, mode: 'recovery' };
      recoveryUserId = null;
      throw new AuthError(invalidLink, 400);
    }
    // An ordinary logged-in session and a recovery URL are not a recovery flow.
    if (callback.path === '/auth/reset-password' || callback.path === '/auth/callback') {
      throw new AuthError(invalidLink, 400);
    }
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) return { account: null, mode: 'none' };
    return { account: await accountFor(await verifiedUser()), mode: 'session' };
  } finally {
    listener.subscription.unsubscribe();
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (authProvider === 'local') return null;
  return safely(async () => {
    const { data, error } = await getSupabaseClient().auth.getSession();
    if (error) throw error;
    return data.session?.access_token ?? null;
  });
}

export const authClient = {
  initialize(): Promise<AuthBootstrap> {
    // One callback exchange even when React StrictMode runs its effect twice.
    // Later mounts revalidate the session/profile instead of keeping stale data.
    initialization ??= safely(bootstrap).then(result => {
      initialization = undefined;
      return result;
    }, error => {
      initialization = undefined;
      throw error;
    });
    return initialization;
  },
  getAccessToken,
  async register(data: Registration): Promise<AuthMessage> {
    validatePassword(data.password);
    if (authProvider === 'local') return request('register', data);
    return safely(async () => {
      if (!['student', 'business'].includes(data.role)) throw new AuthError('Выберите роль: студент или бизнес.', 400);
      const { data: result, error } = await getSupabaseClient().auth.signUp({
        email: data.email.trim(), password: data.password,
        options: {
          emailRedirectTo: redirect('/auth/callback'),
          data: { full_name: data.full_name.trim(), role: data.role, newsletter_opt_in: data.newsletter_opt_in === true },
        },
      });
      if (error) throw error;
      if (result.session) {
        return { message: 'Аккаунт создан. Подтверждение email в настройках проекта отключено.', requires_email_confirmation: false };
      }
      return { message: mailMessage, requires_email_confirmation: true };
    });
  },
  async login(email: string, password: string): Promise<Account> {
    recoveryUserId = null;
    legacyResetToken = '';
    initialization = undefined;
    if (authProvider === 'local') return request('login', { email, password });
    return safely(async () => {
      const { error } = await getSupabaseClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      return accountFor(await verifiedUser());
    });
  },
  async me(): Promise<Account> {
    if (authProvider === 'local') return request('me', undefined, 'GET');
    return safely(async () => accountFor(await verifiedUser()));
  },
  async logout(): Promise<AuthMessage> {
    if (authProvider === 'local') {
      const result = await request<AuthMessage>('logout');
      initialization = undefined;
      legacyResetToken = '';
      return result;
    }
    return safely(async () => {
      const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
      if (error) throw error;
      recoveryUserId = null;
      initialization = undefined;
      return { message: 'Вы вышли из аккаунта.' };
    });
  },
  async forgotPassword(email: string): Promise<AuthMessage> {
    if (authProvider === 'local') return request('forgot-password', { email });
    return safely(async () => {
      const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirect('/auth/reset-password'),
      });
      if (error) throw error;
      return { message: mailMessage };
    });
  },
  async resetPassword(token: string, new_password: string): Promise<AuthMessage> {
    validatePassword(new_password);
    if (authProvider === 'local') {
      const resetToken = token || legacyResetToken;
      if (!resetToken) throw new AuthError(invalidLink, 400);
      const result = await request<AuthMessage>('reset-password', { token: resetToken, new_password });
      legacyResetToken = '';
      initialization = undefined;
      clearCallbackPath();
      return result;
    }
    return safely(async () => {
      if (!recoveryUserId) throw new AuthError(invalidLink, 400);
      const client = getSupabaseClient();
      const user = await verifiedUser();
      if (user.id !== recoveryUserId) throw new AuthError(invalidLink, 400);
      const { error } = await client.auth.updateUser({ password: new_password });
      if (error) throw error;
      recoveryUserId = null;
      initialization = undefined;
      let sessionsRevoked = false;
      try {
        const { error: signOutError } = await client.auth.signOut({ scope: 'global' });
        sessionsRevoked = !signOutError;
      } catch { /* Password already changed; still discard this local session. */ }
      clearSupabaseLocalSession();
      if (!sessionsRevoked) {
        clearCallbackPath();
        return { message: 'Пароль изменён. Войдите с новым паролем. Не удалось подтвердить выход на других устройствах — проверьте активные сессии.' };
      }
      clearCallbackPath();
      return { message: 'Пароль изменён. Войдите с новым паролем.' };
    });
  },
  async verifyEmail(token: string): Promise<AuthMessage> {
    if (authProvider === 'local') return request('verify-email', { token });
    return safely(async () => {
      const { error } = await getSupabaseClient().auth.verifyOtp({ token_hash: token, type: 'signup' });
      if (error) throw error;
      return { message: 'Email подтверждён. Теперь можно войти.' };
    });
  },
  async resendVerification(email: string): Promise<AuthMessage> {
    if (authProvider === 'local') return request('resend-verification', { email });
    return safely(async () => {
      const { error } = await getSupabaseClient().auth.resend({
        type: 'signup', email: email.trim(), options: { emailRedirectTo: redirect('/auth/callback') },
      });
      if (error) throw error;
      return { message: mailMessage };
    });
  },
  async preferences(newsletter_opt_in: boolean): Promise<Account> {
    if (authProvider === 'local') return request('preferences', { newsletter_opt_in }, 'PATCH');
    return safely(async () => {
      const user = await verifiedUser();
      const { data, error } = await getSupabaseClient().from('profiles')
        .update({ newsletter_opt_in }).eq('id', user.id).select('id').single();
      if (error || data?.id !== user.id) throw new AuthError('Не удалось сохранить настройки рассылки. Попробуйте снова.', 503);
      return accountFor(user);
    });
  },
  unsubscribe: (token: string): Promise<AuthMessage> => request('unsubscribe', { token }, 'POST', 'mail'),
};
