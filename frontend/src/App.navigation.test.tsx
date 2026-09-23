// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useAppStore } from './app/store';

const auth = vi.hoisted(() => ({ initialize: vi.fn() }));
vi.mock('./services/authClient', () => ({ authClient: auth }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected external request'))));
  window.history.replaceState(null, '', '/workspace');
  localStorage.clear();
  useAppStore.getState().resetDemo();
  auth.initialize.mockReset().mockResolvedValue({ account: null, mode: 'none' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(path = '/workspace') {
  window.history.replaceState(null, '', path);
  await act(async () => root.render(<StrictMode><App /></StrictMode>));
}

async function waitForAccount() {
  for (let attempt = 0; attempt < 100 && !container.querySelector('.sana-form-container'); attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  expect(container.querySelector('.sana-form-container')).not.toBeNull();
}

async function clickButton(text: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.trim().startsWith(text));
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

describe('account entry within the full demo platform', () => {
  it('keeps the complete local workspace available without initializing an account', async () => {
    await mount();
    expect(container.querySelector('.app-shell')).not.toBeNull();
    expect(container.textContent).toContain('Создать задачу');
    expect(container.textContent).toContain('AI Inspector');
    expect(auth.initialize).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opens the real account page and returns to the same local workspace', async () => {
    useAppStore.getState().setActiveRole('student');
    useAppStore.getState().navigate('team');
    const taskIds = useAppStore.getState().tasks.map(task => task.id);
    await mount();
    await clickButton('Войти / профиль');
    await waitForAccount();
    expect(window.location.pathname).toBe('/auth');
    expect(container.textContent).toContain('Войти в аккаунт');
    expect(container.querySelector('.app-shell')).toBeNull();
    await clickButton('Открыть демо');
    expect(window.location.pathname).toBe('/workspace');
    expect(container.querySelector('.app-shell')).not.toBeNull();
    expect(useAppStore.getState().activeRole).toBe('student');
    expect(useAppStore.getState().page).toBe('team');
    expect(useAppStore.getState().tasks.map(task => task.id)).toEqual(taskIds);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the demo reachable when account configuration or connectivity fails', async () => {
    auth.initialize.mockRejectedValue(new Error('Аккаунт временно недоступен.'));
    await mount('/auth');
    await waitForAccount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Аккаунт временно недоступен.');
    await clickButton('Открыть демо');
    expect(container.querySelector('.app-shell')).not.toBeNull();
    expect(container.textContent).toContain('Создать задачу');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    '/auth', '/auth/callback?code=test-code',
    '/auth/reset-password?token_hash=test-token&type=recovery',
    '/#verify=legacy-token', '/#reset=legacy-token', '/?verify=legacy-token',
    '/#access_token=test-access&refresh_token=test-refresh&type=recovery', '/account',
  ])('opens account links directly: %s', async path => {
    await mount(path);
    await waitForAccount();
    expect(auth.initialize).toHaveBeenCalled();
    expect(container.querySelector('.app-shell')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('responds to browser navigation without overwriting demo data or identity', async () => {
    await mount('/auth');
    await waitForAccount();
    await act(async () => {
      window.history.replaceState(null, '', '/workspace');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(container.querySelector('.app-shell')).not.toBeNull();
    await act(async () => {
      window.history.replaceState(null, '', '/#reset=test-token');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitForAccount();
    expect(container.querySelector('.app-shell')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('design preview and workspace continuity', () => {
  it('applies and restores a theme without replacing tasks, team or workspace', async () => {
    useAppStore.getState().setActiveRole('student');
    useAppStore.getState().navigate('team');
    const before = useAppStore.getState();
    const taskIds = before.tasks.map(task => task.id);
    const proposalIds = before.proposals.map(proposal => proposal.id);
    await mount('/design');
    for (let attempt = 0; attempt < 100 && !container.querySelector('[data-theme-choice="atelier"]'); attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    const choice = container.querySelector<HTMLButtonElement>('[data-theme-choice="atelier"]');
    expect(choice).not.toBeNull();
    await act(async () => choice!.click());
    const apply = container.querySelector<HTMLButtonElement>('[data-apply-design]');
    expect(apply).not.toBeNull();
    await act(async () => apply!.click());
    expect(window.location.pathname).toBe('/workspace');
    expect(container.querySelector('.app-shell')).not.toBeNull();
    expect(document.documentElement.dataset.design).toBe('atelier');
    expect(localStorage.getItem('ai-sana-design')).toBe('atelier');
    expect(useAppStore.getState().tasks.map(task => task.id)).toEqual(taskIds);
    expect(useAppStore.getState().proposals.map(proposal => proposal.id)).toEqual(proposalIds);
    expect(useAppStore.getState().activeTeamId).toBe(before.activeTeamId);
    expect(useAppStore.getState().page).toBe('team');
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(document.documentElement.dataset.design).toBe('atelier');
    expect(auth.initialize).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns from design previews with browser navigation', async () => {
    await mount();
    await clickButton('Дизайн-системы');
    expect(window.location.pathname).toBe('/design');
    await act(async () => {
      window.history.replaceState(null, '', '/workspace');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(container.querySelector('.app-shell')).not.toBeNull();
    expect(useAppStore.getState().page).toBe('overview');
  });
});
