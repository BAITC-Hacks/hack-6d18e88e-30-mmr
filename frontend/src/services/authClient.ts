import type { Account, AuthMessage, Registration } from '../types/auth';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${baseUrl}/api/auth/${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new AuthError(typeof data.detail === 'string' ? data.detail : 'Проверьте заполнение полей.', response.status);
  }
  return data as T;
}

// The browser holds an HttpOnly cookie; never save passwords or session tokens in Zustand/localStorage.
export const authClient = {
  register: (data: Registration) => request<AuthMessage>('register', data),
  login: (email: string, password: string) => request<Account>('login', { email, password }),
  me: () => request<Account>('me', undefined, 'GET'),
  logout: () => request<AuthMessage>('logout'),
  forgotPassword: (email: string) => request<AuthMessage>('forgot-password', { email }),
  resetPassword: (token: string, new_password: string) => request<AuthMessage>('reset-password', { token, new_password }),
  verifyEmail: (token: string) => request<AuthMessage>('verify-email', { token }),
  resendVerification: (email: string) => request<AuthMessage>('resend-verification', { email }),
  preferences: (newsletter_opt_in: boolean) => request<Account>('preferences', { newsletter_opt_in }, 'PATCH'),
};
