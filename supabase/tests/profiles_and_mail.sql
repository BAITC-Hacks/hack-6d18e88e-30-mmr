-- Run in a disposable/staging Supabase project's SQL Editor after both migrations.
-- No SMTP calls: SQL inserts synthetic users/jobs and ROLLBACK removes all fixtures.
-- If any assertion fails, the transaction aborts; run ROLLBACK before retrying.
begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
    ('91000000-0000-4000-8000-000000000001', 'sana-test-student@example.invalid', now(),
     '{"full_name":"Student Test","role":"admin","newsletter_opt_in":"true"}'::jsonb),
    ('91000000-0000-4000-8000-000000000002', 'sana-test-business@example.invalid', now(),
     '{"full_name":"Business Test","role":"business","newsletter_opt_in":true}'::jsonb);

do $$
begin
    if not exists (select 1 from public.profiles
        where id = '91000000-0000-4000-8000-000000000001'
        and role = 'student' and not newsletter_opt_in and full_name = 'Student Test') then
        raise exception 'Signup must never accept metadata admin or string consent';
    end if;
    if not exists (select 1 from public.profiles
        where id = '91000000-0000-4000-8000-000000000002'
        and role = 'business' and newsletter_opt_in) then
        raise exception 'Signup must preserve allowed role and explicit boolean consent';
    end if;
    if has_table_privilege('anon', 'public.profiles', 'select')
        or has_column_privilege('authenticated', 'public.profiles', 'role', 'update')
        or has_column_privilege('authenticated', 'public.profiles', 'id', 'update')
        or has_table_privilege('authenticated', 'public.profiles', 'insert')
        or has_table_privilege('authenticated', 'public.profiles', 'delete') then
        raise exception 'Profile grants expose protected data or changes';
    end if;
    if has_table_privilege('authenticated', 'public.mail_outbox', 'select')
        or has_table_privilege('anon', 'public.mail_campaigns', 'insert')
        or has_function_privilege('authenticated', 'public.queue_newsletter(uuid,text,text,text)', 'execute')
        or has_function_privilege('anon', 'public.unsubscribe_mail(text)', 'execute') then
        raise exception 'Newsletter data/RPC must be server-only';
    end if;
end;
$$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v_count integer;
begin
    select count(*) into v_count from public.profiles;
    if v_count <> 1 then raise exception 'RLS must expose exactly the current profile'; end if;
    update public.profiles set full_name = 'Updated Student', newsletter_opt_in = true
        where id = '91000000-0000-4000-8000-000000000001';
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception 'Owner must be able to edit name and consent'; end if;
    update public.profiles set full_name = 'Tampered'
        where id = '91000000-0000-4000-8000-000000000002';
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception 'RLS allowed editing another profile'; end if;
    begin
        update public.profiles set role = 'admin';
        raise exception 'Privilege escalation unexpectedly succeeded';
    exception when insufficient_privilege then null;
    end;
    begin
        delete from public.profiles;
        raise exception 'Direct deletion unexpectedly succeeded';
    exception when insufficient_privilege then null;
    end;
end;
$$;
reset role;

do $$
begin
    begin
        perform public.queue_newsletter('91000000-0000-4000-8000-000000000001', 'Test', 'Text', 'https://example.invalid/account');
        raise exception 'Non-admin unexpectedly queued newsletter';
    exception when insufficient_privilege then null;
    end;
end;
$$;

-- A privileged manual promotion, never derived from browser metadata.
update public.profiles set role = 'admin', newsletter_opt_in = false
    where id = '91000000-0000-4000-8000-000000000001';

-- Temporarily isolate test subscriber/jobs inside this rolled-back transaction.
update public.profiles set newsletter_opt_in = false
    where id <> '91000000-0000-4000-8000-000000000002';
update public.mail_outbox set status = 'skipped' where status in ('pending', 'sending');

set local role service_role;
do $$
declare
    v_result jsonb;
    v_campaign bigint;
    v_token text;
    v_count integer;
    v_job public.mail_outbox%rowtype;
begin
    v_result := public.queue_newsletter('91000000-0000-4000-8000-000000000001', 'Test subject', 'Test body', 'https://example.invalid/account');
    v_campaign := (v_result ->> 'id')::bigint;
    if (v_result ->> 'queued')::integer <> 1 then raise exception 'Expected exactly one subscriber'; end if;
    select * into v_job from public.claim_mail_job(extract(epoch from now())::bigint);
    if v_job.id is null or v_job.campaign_id <> v_campaign or v_job.status <> 'sending' or v_job.attempts <> 1 then
        raise exception 'Worker must lease exactly one pending job';
    end if;
    select count(*) into v_count from public.claim_mail_job(extract(epoch from now())::bigint);
    if v_count <> 0 then raise exception 'Active lease must not be claimed twice'; end if;
    v_token := split_part(v_job.body, '#unsubscribe=', 2);
    if char_length(v_token) <> 64 then raise exception 'Missing unsubscribe token'; end if;
    if not public.unsubscribe_mail(encode(sha256(convert_to(v_token, 'UTF8')), 'hex')) then
        raise exception 'Valid unsubscribe link was rejected';
    end if;
    if public.unsubscribe_mail(encode(sha256(convert_to(v_token, 'UTF8')), 'hex')) then
        raise exception 'Unsubscribe tokens must be one use';
    end if;
    if exists (select 1 from public.profiles where id = v_job.user_id and newsletter_opt_in) then
        raise exception 'Unsubscribe must revoke consent';
    end if;
    select count(*) into v_count from public.claim_mail_job(extract(epoch from now())::bigint + 301);
    if v_count <> 0 then raise exception 'Unsubscribed user must not receive retry'; end if;
    if not exists (select 1 from public.mail_outbox where id = v_job.id and status = 'skipped') then
        raise exception 'Unsubscribed job must be skipped';
    end if;
end;
$$;
reset role;

-- The 500-recipient cap must roll back the entire RPC, including action tokens.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select gen_random_uuid(), 'sana-cap-' || entry || '@example.invalid', now(),
       '{"full_name":"Limit fixture","newsletter_opt_in":true}'::jsonb
from generate_series(1, 501) as entry;

set local role service_role;
do $$
declare
    v_campaigns bigint;
    v_jobs bigint;
    v_tokens bigint;
begin
    select count(*) into v_campaigns from public.mail_campaigns;
    select count(*) into v_jobs from public.mail_outbox;
    select count(*) into v_tokens from public.mail_unsubscribe_tokens;
    begin
        perform public.queue_newsletter('91000000-0000-4000-8000-000000000001',
            'Oversized fixture', 'Fixture body', 'https://example.invalid/account');
        raise exception 'Oversized newsletter unexpectedly succeeded';
    exception when invalid_parameter_value then null;
    end;
    if (select count(*) from public.mail_campaigns) <> v_campaigns
        or (select count(*) from public.mail_outbox) <> v_jobs
        or (select count(*) from public.mail_unsubscribe_tokens) <> v_tokens then
        raise exception 'Rejected campaign partially changed the database';
    end if;
end;
$$;
reset role;

rollback;
select 'All SQL assertions passed; test data was rolled back.' as result;
