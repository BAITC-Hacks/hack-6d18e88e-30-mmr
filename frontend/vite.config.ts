import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  let legacyRole = '';
  try { legacyRole = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()).role; } catch { /* modern keys are not JWTs */ }
  if (key.startsWith('sb_secret_') || legacyRole === 'service_role') {
    throw new Error('A secret Supabase key cannot be bundled into frontend. Replace it with a publishable key and rotate the exposed secret.');
  }
  return { plugins: [react()], server: { port: 5173, strictPort: true } };
})
