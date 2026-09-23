// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Account, AuthBootstrap } from './types/auth';

const auth = vi.hoisted(() => ({ initialize: vi.fn(), me: vi.fn() }));
vi.mock('./services/authClient', () => ({ authClient: auth }));
import App from './App';
import { useAppStore } from './app/store';

const account: Account = { id: 'student-id', full_name: 'Алия Сана', email: 'student@example.test', role: 'student', email_verified: true, newsletter_opt_in: false };
let host: HTMLDivElement;
let root: Root;

function button(label: string) {
  const element = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label);
  expect(element, `Кнопка «${label}» доступна`).toBeDefined();
  return element!;
}
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function render(bootstrap: AuthBootstrap) {
  auth.initialize.mockResolvedValue(bootstrap);
  await act(async () => { root.render(<StrictMode><App /></StrictMode>); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.localStorage.clear();
  useAppStore.getState().resetDemo();
  auth.me.mockResolvedValue(account);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove(); vi.unstubAllGlobals();
});

describe('account and platform integration', () => {
  it('opens the login first, offers guest demo and returns to the account screen', async () => {
    await render({ account: null, mode: 'none' });
    expect(host.querySelector('.sana-auth')?.getAttribute('data-mode')).toBe('login');
    expect(host.querySelector('.app-shell')).toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>('.sana-demo-button')!.click(); });
    expect(host.querySelector('.app-shell')).not.toBeNull();
    expect(host.querySelector('.workspace-demo-note')?.textContent).toContain('только в этом браузере');
    expect(host.querySelector('.demo-bar')).not.toBeNull();
    await click('Войти / профиль');
    expect(host.querySelector('.sana-auth')?.getAttribute('data-mode')).toBe('login');
    expect(auth.me).not.toHaveBeenCalled();
  });

  it('rechecks the session, starts with the account role and preserves workspace on return', async () => {
    await render({ account, mode: 'session' });
    expect(host.querySelector('.sana-auth')?.getAttribute('data-mode')).toBe('profile');
    const originalTasks = useAppStore.getState().tasks;
    await click('Открыть платформу');
    expect(auth.me).toHaveBeenCalledOnce();
    expect(host.querySelector('.app-shell')).not.toBeNull();
    expect(useAppStore.getState().activeRole).toBe('student');
    expect(useAppStore.getState().page).toBe('catalog');
    expect(host.querySelector('.sidebar-footer')?.textContent).toContain(account.full_name);
    expect(host.querySelector('.demo-bar')).toBeNull();
    await click('Мой профиль');
    expect(host.querySelector('.sana-auth')?.getAttribute('data-mode')).toBe('profile');
    expect(useAppStore.getState().tasks).toEqual(originalTasks);
  });

  it('shows an expired session error instead of opening the account workspace', async () => {
    auth.me.mockRejectedValue(new Error('Сессия завершилась. Войдите снова.'));
    await render({ account, mode: 'session' });
    await click('Открыть платформу');
    expect(host.querySelector('.app-shell')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Сессия завершилась');
  });

  it('preserves the recovery form when a recovery callback also has a session', async () => {
    await render({ account, mode: 'recovery' });
    expect(host.querySelector('.sana-auth')?.getAttribute('data-mode')).toBe('reset');
    expect(host.querySelector('#sana-password')).not.toBeNull();
    expect(host.querySelector('#sana-confirmation')).not.toBeNull();
    expect(host.querySelector('.app-shell')).toBeNull();
    expect(auth.me).not.toHaveBeenCalled();
  });
});
