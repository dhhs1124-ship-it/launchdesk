-- Store the validated LaunchROAS origin on the existing, single-use OAuth state.
-- Both start functions validate the allowlist, and callbacks revalidate before redirecting.
-- NULL retains the existing LaunchDesk return path for older clients and pending states.
alter table public.oauth_states
  add column if not exists return_origin text;

comment on column public.oauth_states.return_origin is
  'Validated LaunchROAS origin for OAuth return; nullable for existing LaunchDesk flows.';
