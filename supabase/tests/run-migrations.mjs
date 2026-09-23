// Runs the real migrations and SQL assertions in an ephemeral Postgres WASM DB.
// No credentials, network connections, real users, SMTP or persistent files.
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const database = new PGlite();

try {
  await database.waitReady;
  // Minimal Supabase-owned primitives. Production migrations use the real Auth
  // schema. BYPASSRLS is intentional for the mocked backend service role.
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    -- Model permissive Supabase project defaults: migrations must actively
    -- revoke these grants rather than pass only in a closed empty database.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (
      id uuid primary key,
      email text,
      email_confirmed_at timestamptz,
      raw_user_meta_data jsonb,
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid
      language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    insert into auth.users (id, email, raw_user_meta_data)
    values ('92000000-0000-4000-8000-000000000001', 'existing@example.invalid',
      '{"full_name":"Existing account","role":"business","newsletter_opt_in":true}');
  `);

  const migrationsDirectory = new URL('../migrations/', import.meta.url);
  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (let pass = 1; pass <= 2; pass += 1) {
    for (const name of migrationNames) {
      await database.exec(await readFile(new URL(name, migrationsDirectory), 'utf8'));
      console.log(`Migration pass ${pass}: ${name}`);
    }
    if (pass === 1) {
      const { rows } = await database.query('select role, newsletter_opt_in from public.profiles');
      if (rows.length !== 1 || rows[0].role !== 'business' || !rows[0].newsletter_opt_in) {
        throw new Error('Migration did not backfill the existing Auth account');
      }
      await database.exec(`
        update public.profiles set role = 'admin', full_name = 'Manually edited', newsletter_opt_in = false;
      `);
    }
  }
  const { rows: preserved } = await database.query('select role, full_name, newsletter_opt_in from public.profiles');
  if (preserved[0]?.role !== 'admin' || preserved[0]?.full_name !== 'Manually edited' || preserved[0]?.newsletter_opt_in) {
    throw new Error('Re-running migrations overwrote existing account changes');
  }
  await database.exec(`delete from auth.users where id = '92000000-0000-4000-8000-000000000001'`);
  const { rows: deleted } = await database.query('select count(*)::integer as count from public.profiles');
  if (deleted[0].count !== 0) throw new Error('Account deletion must cascade to profile');
  console.log('Verified: existing-account backfill, preserved manual profile changes, delete cascade.');

  const results = await database.exec(
    await readFile(new URL('./profiles_and_mail.sql', import.meta.url), 'utf8'),
  );
  const lastResult = results.at(-1);
  console.log(lastResult?.rows?.[0]?.result ?? 'SQL assertions completed.');
  const { rows } = await database.query('select count(*)::integer as count from auth.users');
  if (rows[0].count !== 0) throw new Error('SQL test fixtures were not rolled back');
  console.log('Verified: migrations are repeatable, SQL assertions passed, fixtures rolled back.');
} finally {
  await database.close();
}
