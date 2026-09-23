// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthPage from './AuthPage';

const auth = vi.hoisted(() => ({ initialize: vi.fn(), login: vi.fn(), register: vi.fn() }));
vi.mock('../../services/authClient', () => ({ authClient: auth }));
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected external request'))));
  vi.resetAllMocks();
  window.history.replaceState(null, '', '/auth');
  auth.initialize.mockResolvedValue({ account: null, mode: 'none' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(onDemo?: () => void) { await act(async () => root.render(<AuthPage onDemo={onDemo} />)); }
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.trim().startsWith(label));
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

describe('account UI audit', () => {
  it('submits only once when two submit events arrive before a render', async () => {
    let reject!: (reason: Error) => void;
    auth.login.mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    await mount();
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(auth.login).toHaveBeenCalledOnce();
    await act(async () => reject(new Error('Попробуйте снова.')));
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows unavailable configuration as a short state with retry and a working demo exit', async () => {
    auth.initialize.mockRejectedValue(Object.assign(new Error('Сервис аккаунтов ещё не подключён.'), { status: 503, code: 'CONFIGURATION' }));
    const onDemo = vi.fn();
    await mount(onDemo);
    expect(container.textContent).toContain('Вход временно недоступен');
    expect(container.textContent).not.toMatch(/VITE_|\.env|Supabase/);
    expect(container.querySelector('form')).toBeNull();
    auth.initialize.mockResolvedValue({ account: null, mode: 'none' });
    await click('Попробовать снова');
    expect(auth.initialize).toHaveBeenCalledTimes(2);
    expect(container.querySelector('form')).not.toBeNull();
    await click('Открыть демо');
    expect(onDemo).toHaveBeenCalledOnce();
  });

  it('lets registration accept names up to the server limit of 120', async () => {
    await mount();
    await click('Регистрация');
    expect(container.querySelector<HTMLInputElement>('#sana-name')?.maxLength).toBe(120);
  });
});
