// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Account, AuthBootstrap } from './types/auth';

const auth = vi.hoisted(() => ({
  initialize: vi.fn(), login: vi.fn(), resetPassword: vi.fn(), preferences: vi.fn(),
}));
vi.mock('./services/authClient', () => ({ authClient: auth }));
import App from './App';

const themeKey = 'ai-sana-design';
const account: Account = {
  id: 'appearance-account', full_name: 'Алия Сана', email: 'appearance@example.test',
  role: 'student', email_verified: true, newsletter_opt_in: false,
};
let host: HTMLDivElement;
let root: Root;

function input(selector: string): HTMLInputElement {
  const element = host.querySelector<HTMLInputElement>(selector);
  expect(element, `Поле ${selector} доступно`).not.toBeNull();
  return element!;
}

async function enter(selector: string, value: string) {
  const element = input(selector);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return element;
}

function themeButton(label: 'Signal' | 'Atelier' | 'Index'): HTMLButtonElement {
  const group = host.querySelector('[role="group"][aria-label="Оформление"]');
  expect(group, 'Выбор оформления доступен на экране аккаунта').not.toBeNull();
  const element = group!.querySelector<HTMLButtonElement>(`button[aria-label="Тема ${label}"]`);
  expect(element).not.toBeNull();
  return element!;
}

async function chooseTheme(label: 'Signal' | 'Atelier' | 'Index') {
  await act(async () => { themeButton(label).click(); });
  expect(themeButton(label).getAttribute('aria-pressed')).toBe('true');
  expect(document.documentElement.dataset.design).toBe(label.toLowerCase());
}

async function submit() {
  const form = host.querySelector('form');
  expect(form).not.toBeNull();
  await act(async () => { form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

async function render(bootstrap: AuthBootstrap = { account: null, mode: 'none' }) {
  auth.initialize.mockResolvedValue(bootstrap);
  await act(async () => { root.render(<StrictMode><App /></StrictMode>); });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/auth');
  window.localStorage.clear();
  delete document.documentElement.dataset.design;
  auth.login.mockResolvedValue(account);
  auth.resetPassword.mockResolvedValue({ message: 'Пароль изменён.' });
  auth.preferences.mockImplementation(async (newsletter: boolean) => ({ ...account, newsletter_opt_in: newsletter }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.design;
});

describe('account appearance integration', () => {
  it('changes the login appearance without losing credentials or restarting auth', async () => {
    await render();
    const email = await enter('#sana-email', 'appearance@example.test');
    const password = await enter('#sana-password', 'Example-password-2026');
    const initializations = auth.initialize.mock.calls.length;

    await chooseTheme('Atelier');
    await chooseTheme('Index');

    expect(themeButton('Atelier').getAttribute('aria-pressed')).toBe('false');
    expect(input('#sana-email')).toBe(email);
    expect(input('#sana-password')).toBe(password);
    expect(email.value).toBe('appearance@example.test');
    expect(password.value).toBe('Example-password-2026');
    expect(window.location.pathname).toBe('/auth');
    expect(auth.initialize).toHaveBeenCalledTimes(initializations);
    expect(auth.login).not.toHaveBeenCalled();

    await submit();
    expect(auth.login).toHaveBeenCalledExactlyOnceWith('appearance@example.test', 'Example-password-2026');
    expect(host.querySelector('.sana-auth')?.getAttribute('data-mode')).toBe('profile');
  });

  it('keeps the recovery password and confirmation when appearance changes', async () => {
    await render({ account, mode: 'recovery' });
    const password = await enter('#sana-password', 'New-example-password-2026');
    const confirmation = await enter('#sana-confirmation', 'New-example-password-2026');
    const initializations = auth.initialize.mock.calls.length;

    await chooseTheme('Atelier');

    expect(input('#sana-password')).toBe(password);
    expect(input('#sana-confirmation')).toBe(confirmation);
    expect(password.value).toBe('New-example-password-2026');
    expect(confirmation.value).toBe('New-example-password-2026');
    expect(host.querySelector('.sana-auth')?.getAttribute('data-mode')).toBe('reset');
    expect(auth.initialize).toHaveBeenCalledTimes(initializations);

    await submit();
    expect(auth.resetPassword).toHaveBeenCalledExactlyOnceWith('', 'New-example-password-2026');
  });

  it('preserves unsaved newsletter changes in the profile and saves them explicitly', async () => {
    await render({ account, mode: 'session' });
    const newsletter = input('input[role="switch"]');
    await act(async () => { newsletter.click(); });
    const initializations = auth.initialize.mock.calls.length;

    await chooseTheme('Index');

    expect(input('input[role="switch"]')).toBe(newsletter);
    expect(newsletter.checked).toBe(true);
    expect(host.textContent).toContain('Есть несохранённые изменения');
    expect(host.textContent).toContain(account.full_name);
    expect(host.textContent).toContain(account.email);
    expect(auth.initialize).toHaveBeenCalledTimes(initializations);
    expect(auth.preferences).not.toHaveBeenCalled();

    const save = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(element => element.textContent?.trim() === 'Сохранить настройки');
    expect(save?.disabled).toBe(false);
    await act(async () => { save!.click(); });
    expect(auth.preferences).toHaveBeenCalledExactlyOnceWith(true);
    expect(host.textContent).toContain('Настройки сохранены');
    expect(input('input[role="switch"]').checked).toBe(true);
  });

  it('restores the selected appearance after mounting a new app without changing other storage', async () => {
    window.localStorage.setItem('unrelated-preference', 'keep-me');
    await render();
    await chooseTheme('Atelier');
    expect(window.localStorage.getItem(themeKey)).toBe('atelier');

    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await render({ account, mode: 'session' });

    expect(themeButton('Atelier').getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.design).toBe('atelier');
    expect(window.localStorage.getItem('unrelated-preference')).toBe('keep-me');
    expect(host.textContent).toContain(account.full_name);
  });

  it('synchronizes appearance from another tab without replacing the form or handling unrelated keys', async () => {
    await render();
    const email = await enter('#sana-email', 'draft@example.test');
    const initializations = auth.initialize.mock.calls.length;
    await act(async () => {
      window.localStorage.setItem(themeKey, 'index');
      window.dispatchEvent(new StorageEvent('storage', {
        key: themeKey, newValue: 'index', storageArea: window.localStorage,
      }));
    });

    expect(themeButton('Index').getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.design).toBe('index');
    expect(input('#sana-email')).toBe(email);
    expect(email.value).toBe('draft@example.test');
    expect(auth.initialize).toHaveBeenCalledTimes(initializations);

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'unrelated-preference', newValue: 'atelier', storageArea: window.localStorage,
      }));
    });
    expect(themeButton('Index').getAttribute('aria-pressed')).toBe('true');
    expect(auth.initialize).toHaveBeenCalledTimes(initializations);
    expect(input('#sana-email').value).toBe('draft@example.test');
  });

  it('still applies appearance when the browser refuses to save it', async () => {
    await render();
    const password = await enter('#sana-password', 'Unsaved-example-password');
    const initializations = auth.initialize.mock.calls.length;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });

    await chooseTheme('Atelier');

    expect(input('#sana-password')).toBe(password);
    expect(password.value).toBe('Unsaved-example-password');
    expect(host.querySelector('.sana-app-error')).toBeNull();
    expect(auth.initialize).toHaveBeenCalledTimes(initializations);
  });
});
