-- Owner notification on every new account: an AFTER INSERT trigger on
-- auth.users posts the new row to the notify-owner edge function via pg_net
-- (already enabled in this project). Fire-and-forget — a failed webhook never
-- blocks the signup.

create or replace function public.notify_owner_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/notify-owner',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'type', 'INSERT',
      'record', jsonb_build_object(
        'email', new.email,
        'created_at', new.created_at
      )
    )
  );
  return new;
exception when others then
  -- Never block a signup because a notification failed
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_notify on auth.users;
create trigger on_auth_user_created_notify
  after insert on auth.users
  for each row execute function public.notify_owner_on_signup();
