import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const projectUrl = import.meta.env?.VITE_SUPABASE_URL?.trim() ?? '';
const publicKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

// An incomplete Supabase setup must never create a second, local identity.
export const authProvider: 'local' | 'supabase' =
  projectUrl || publicKey || import.meta.env?.DEV === false ? 'supabase' : 'local';

let client: SupabaseClient | undefined;
let storageKey = '';
const memoryStorage = new Map<string, string>();
// Explicit storage also works when the browser disables localStorage. Owning
// this adapter lets a completed reset discard local credentials even offline.
const authStorage = {
  getItem(key: string): string | null {
    try { return window.localStorage.getItem(key); }
    catch { return memoryStorage.get(key) ?? null; }
  },
  setItem(key: string, value: string) {
    memoryStorage.set(key, value);
    try { window.localStorage.setItem(key, value); } catch { /* Private browser mode. */ }
  },
  removeItem(key: string) {
    memoryStorage.delete(key);
    try { window.localStorage.removeItem(key); } catch { /* In-memory storage only. */ }
  },
};

export function clearSupabaseLocalSession() {
  if (!storageKey) return;
  for (const suffix of ['', '-user', '-code-verifier']) authStorage.removeItem(storageKey + suffix);
}

function invalidConfiguration(): never {
  const error = new Error('Проверьте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY в frontend/.env.local и перезапустите приложение. Нужен публичный ключ Supabase.');
  error.name = 'SupabaseConfigurationError';
  throw error;
}

function isPublicKey(value: string): boolean {
  if (value.startsWith('sb_publishable_') && value.length > 20) return true;
  // Support a legacy anon key, but explicitly reject a service_role JWT.
  try {
    const payload = JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return value.split('.').length === 3 && payload.role === 'anon';
  } catch {
    return false;
  }
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  let url: URL;
  try { url = new URL(projectUrl); } catch { return invalidConfiguration(); }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!localHost && url.protocol !== 'https:') ||
      (localHost && !['http:', 'https:'].includes(url.protocol)) ||
      url.username || url.password || url.search || url.hash ||
      !['', '/'].includes(url.pathname) || !isPublicKey(publicKey)) {
    return invalidConfiguration();
  }

  storageKey = `ai-sana-${url.hostname}-auth`;
  client = createClient(projectUrl, publicKey, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storageKey,
      storage: authStorage,
    },
    global: {
      // Do not leave an authentication screen spinning indefinitely offline.
      fetch: async (input, init) => {
        const timeout = AbortSignal.timeout(15_000);
        const signal = init?.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
        return fetch(input, { ...init, signal });
      },
    },
  });
  return client;
}
