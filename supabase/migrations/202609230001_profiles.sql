-- AI Sana: account profiles. Run as the project owner in Supabase SQL Editor.
-- Passwords, emails and verification tokens belong to Supabase Auth, not profiles.
-- Re-running this migration preserves profile data and reinstalls its grants/triggers.
begin;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    full_name text not null default '' check (char_length(full_name) <= 120),
    role text not null default 'student' check (role in ('student', 'business', 'admin')),
    newsletter_opt_in boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Private account profile; auth.users owns credentials and email.';
comment on column public.profiles.role is 'Protected application role. Admin promotion is server/SQL only.';

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, full_name, role, newsletter_opt_in)
    values (
        new.id,
        case when jsonb_typeof(new.raw_user_meta_data -> 'full_name') = 'string'
            then left(btrim(new.raw_user_meta_data ->> 'full_name'), 120)
            else '' end,
        -- Never trust user-supplied metadata for an elevated role.
        case when new.raw_user_meta_data ->> 'role' = 'business'
            then 'business' else 'student' end,
        -- Only the JSON boolean true counts as consent; strings/numbers do not.
        coalesce(new.raw_user_meta_data -> 'newsletter_opt_in' = 'true'::jsonb, false)
    ) on conflict (id) do nothing;
    return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists ai_sana_auth_user_created on auth.users;
create trigger ai_sana_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_auth_user();

-- Existing Supabase accounts also receive profiles without overwriting edits/roles.
insert into public.profiles (id, full_name, role, newsletter_opt_in, created_at)
select
    id,
    case when jsonb_typeof(raw_user_meta_data -> 'full_name') = 'string'
        then left(btrim(raw_user_meta_data ->> 'full_name'), 120)
        else '' end,
    case when raw_user_meta_data ->> 'role' = 'business'
        then 'business' else 'student' end,
    coalesce(raw_user_meta_data -> 'newsletter_opt_in' = 'true'::jsonb, false),
    coalesce(created_at, now())
from auth.users
on conflict (id) do nothing;

create or replace function public.touch_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

revoke all on function public.touch_profile_updated_at() from public, anon, authenticated;
drop trigger if exists ai_sana_profile_updated on public.profiles;
create trigger ai_sana_profile_updated
    before update on public.profiles
    for each row execute function public.touch_profile_updated_at();

alter table public.profiles enable row level security;

-- Revoke table AND column grants before granting the minimal client permissions.
-- RLS alone restricts rows, not writable columns.
revoke all on table public.profiles from public, anon, authenticated;
revoke all (id, full_name, role, newsletter_opt_in, created_at, updated_at)
    on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, newsletter_opt_in) on public.profiles to authenticated;
grant all on public.profiles to service_role;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
    for select to authenticated
    using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
    for update to authenticated
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

commit;
