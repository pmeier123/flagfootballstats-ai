-- Flag Football Stats: schema, access rules and RPCs.
-- Writes to events happen only through push_events(); anonymous access is limited to ticker_snapshot() and ping().

-- ---------------------------------------------------------------------------------------------------------------
-- Users and roles
-- ---------------------------------------------------------------------------------------------------------------
create table public.app_user (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'viewer' check (role in ('admin', 'typist', 'viewer'))
);

create function public.current_app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.app_user where id = auth.uid()
$$;

-- The very first user becomes admin; everybody else starts as viewer until an admin changes the role.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_user (id, email, display_name, role)
  values (
    new.id, new.email, split_part(coalesce(new.email, ''), '@', 1),
    case when exists (select 1 from public.app_user where role = 'admin') then 'viewer' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------------------------
-- Master data (last write wins on updated_at; srv_ts is the server-side change cursor)
-- ---------------------------------------------------------------------------------------------------------------
create function public.set_srv_ts() returns trigger language plpgsql as $$
begin
  new.srv_ts := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end $$;

create table public.teams (
  id text primary key,
  name text not null,
  is_own boolean not null default false,
  updated_at bigint not null,
  srv_ts bigint not null default 0
);

create table public.players (
  id text primary key,
  number text not null,
  name text not null,
  active boolean not null default true,
  offense_prio int not null default 9 check (offense_prio between 1 and 9),
  defense_prio int not null default 9 check (defense_prio between 1 and 9),
  qb_prio int not null default 9 check (qb_prio between 1 and 9),
  blitz_prio int not null default 9 check (blitz_prio between 1 and 9),
  updated_at bigint not null,
  srv_ts bigint not null default 0
);

create table public.games (
  id text primary key,
  opponent_team_id text not null,
  date date not null,
  occasion text not null check (occasion in ('dffl_game', 'semifinal', 'final', 'group_stage', 'other')),
  venue text,
  status text not null default 'planned' check (status in ('planned', 'live', 'finished')),
  ticker_token text not null unique,
  updated_at bigint not null,
  srv_ts bigint not null default 0
);

create table public.roster (
  game_id text not null,
  player_id text not null,
  present boolean not null default true,
  updated_at bigint not null,
  srv_ts bigint not null default 0,
  primary key (game_id, player_id)
);

create table public.typists (
  id text primary key,
  game_id text not null,
  user_id uuid not null,
  from_ts bigint not null,
  to_ts bigint,
  updated_at bigint not null,
  srv_ts bigint not null default 0
);
create index typists_game_idx on public.typists (game_id) where to_ts is null;

create trigger teams_srv before insert or update on public.teams for each row execute function public.set_srv_ts();
create trigger players_srv before insert or update on public.players for each row execute function public.set_srv_ts();
create trigger games_srv before insert or update on public.games for each row execute function public.set_srv_ts();
create trigger roster_srv before insert or update on public.roster for each row execute function public.set_srv_ts();
create trigger typists_srv before insert or update on public.typists for each row execute function public.set_srv_ts();

-- ---------------------------------------------------------------------------------------------------------------
-- Event log (append-only) and export progress
-- ---------------------------------------------------------------------------------------------------------------
create table public.game_seq (
  game_id text primary key,
  next_seq bigint not null default 0
);

create table public.events (
  id text primary key,
  game_id text not null,
  seq bigint not null,
  client_ts bigint not null,
  author_id uuid,
  author_label text,
  kind text not null check (kind in ('play', 'marker', 'comment', 'edit', 'void')),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (game_id, seq)
);

create table public.export_state (
  game_id text primary key,
  last_seq bigint not null default 0,
  last_run timestamptz,
  last_error text
);

create table public.settings (
  key text primary key,
  value text not null
);

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------------------------
alter table public.app_user enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.roster enable row level security;
alter table public.typists enable row level security;
alter table public.game_seq enable row level security;
alter table public.events enable row level security;
alter table public.export_state enable row level security;
alter table public.settings enable row level security;

create policy app_user_read on public.app_user for select to authenticated
  using (id = auth.uid() or public.current_app_role() = 'admin');
create policy app_user_admin_update on public.app_user for update to authenticated
  using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy teams_read on public.teams for select to authenticated using (true);
create policy players_read on public.players for select to authenticated using (public.current_app_role() in ('admin', 'typist'));
create policy games_read on public.games for select to authenticated using (public.current_app_role() in ('admin', 'typist'));
create policy roster_read on public.roster for select to authenticated using (public.current_app_role() in ('admin', 'typist'));
create policy typists_read on public.typists for select to authenticated using (public.current_app_role() in ('admin', 'typist'));
create policy events_read on public.events for select to authenticated using (public.current_app_role() in ('admin', 'typist'));
create policy export_state_read on public.export_state for select to authenticated using (public.current_app_role() in ('admin', 'typist'));
-- No insert/update/delete policies: all writes go through the security definer functions below.
-- game_seq and settings have no policies at all (service role / functions only).

revoke all on public.teams, public.players, public.games, public.roster, public.typists, public.events,
  public.export_state, public.game_seq, public.settings, public.app_user from anon;
grant select on public.teams, public.players, public.games, public.roster, public.typists, public.events,
  public.export_state, public.app_user to authenticated;
grant update (role, display_name) on public.app_user to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- RPC: master data
-- ---------------------------------------------------------------------------------------------------------------
create function public.push_rows(p_table text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.current_app_role();
begin
  if v_role is null then raise exception 'Nicht angemeldet' using errcode = '28000'; end if;

  if p_table = 'typists' then
    if v_role <> 'admin' and (
      v_role <> 'typist' or exists (
        select 1 from jsonb_populate_recordset(null::public.typists, p_rows) r
        where not exists (
          select 1 from public.typists t where t.game_id = r.game_id and t.user_id = auth.uid() and t.to_ts is null
        )
      )
    ) then
      raise exception 'Keine Berechtigung für Typisten-Zuweisung' using errcode = '42501';
    end if;
    insert into public.typists (id, game_id, user_id, from_ts, to_ts, updated_at)
    select r.id, r.game_id, r.user_id, r.from_ts, r.to_ts, r.updated_at from jsonb_populate_recordset(null::public.typists, p_rows) r
    on conflict (id) do update set game_id = excluded.game_id, user_id = excluded.user_id, from_ts = excluded.from_ts,
      to_ts = excluded.to_ts, updated_at = excluded.updated_at
      where public.typists.updated_at <= excluded.updated_at;
    return;
  end if;

  if v_role <> 'admin' then raise exception 'Keine Berechtigung' using errcode = '42501'; end if;

  if p_table = 'players' then
    insert into public.players (id, number, name, active, offense_prio, defense_prio, qb_prio, blitz_prio, updated_at)
    select r.id, r.number, r.name, r.active, r.offense_prio, r.defense_prio, r.qb_prio, r.blitz_prio, r.updated_at
    from jsonb_populate_recordset(null::public.players, p_rows) r
    on conflict (id) do update set number = excluded.number, name = excluded.name, active = excluded.active,
      offense_prio = excluded.offense_prio, defense_prio = excluded.defense_prio, qb_prio = excluded.qb_prio,
      blitz_prio = excluded.blitz_prio, updated_at = excluded.updated_at
      where public.players.updated_at <= excluded.updated_at;
  elsif p_table = 'teams' then
    insert into public.teams (id, name, is_own, updated_at)
    select r.id, r.name, r.is_own, r.updated_at from jsonb_populate_recordset(null::public.teams, p_rows) r
    on conflict (id) do update set name = excluded.name, is_own = excluded.is_own, updated_at = excluded.updated_at
      where public.teams.updated_at <= excluded.updated_at;
  elsif p_table = 'games' then
    insert into public.games (id, opponent_team_id, date, occasion, venue, status, ticker_token, updated_at)
    select r.id, r.opponent_team_id, r.date, r.occasion, r.venue, r.status, r.ticker_token, r.updated_at
    from jsonb_populate_recordset(null::public.games, p_rows) r
    on conflict (id) do update set opponent_team_id = excluded.opponent_team_id, date = excluded.date,
      occasion = excluded.occasion, venue = excluded.venue, status = excluded.status,
      ticker_token = excluded.ticker_token, updated_at = excluded.updated_at
      where public.games.updated_at <= excluded.updated_at;
    insert into public.game_seq (game_id) select r.id from jsonb_populate_recordset(null::public.games, p_rows) r
    on conflict (game_id) do nothing;
  elsif p_table = 'roster' then
    insert into public.roster (game_id, player_id, present, updated_at)
    select r.game_id, r.player_id, r.present, r.updated_at from jsonb_populate_recordset(null::public.roster, p_rows) r
    on conflict (game_id, player_id) do update set present = excluded.present, updated_at = excluded.updated_at
      where public.roster.updated_at <= excluded.updated_at;
  else
    raise exception 'Unbekannte Tabelle %', p_table;
  end if;
end $$;

create function public.pull_rows(p_since bigint) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_from bigint := greatest(p_since - 5000, 0);
  v_cursor bigint;
begin
  select greatest(
    p_since,
    coalesce((select max(srv_ts) from public.teams), 0),
    coalesce((select max(srv_ts) from public.players), 0),
    coalesce((select max(srv_ts) from public.games), 0),
    coalesce((select max(srv_ts) from public.roster), 0),
    coalesce((select max(srv_ts) from public.typists), 0)
  ) into v_cursor;
  return jsonb_build_object(
    'cursor', v_cursor,
    'rows', jsonb_build_object(
      'teams', coalesce((select jsonb_agg(to_jsonb(t) - 'srv_ts') from public.teams t where t.srv_ts > v_from), '[]'::jsonb),
      'players', coalesce((select jsonb_agg(to_jsonb(t) - 'srv_ts') from public.players t where t.srv_ts > v_from), '[]'::jsonb),
      'games', coalesce((select jsonb_agg(to_jsonb(t) - 'srv_ts') from public.games t where t.srv_ts > v_from), '[]'::jsonb),
      'roster', coalesce((select jsonb_agg(to_jsonb(t) - 'srv_ts') from public.roster t where t.srv_ts > v_from), '[]'::jsonb),
      'typists', coalesce((select jsonb_agg(to_jsonb(t) - 'srv_ts') from public.typists t where t.srv_ts > v_from), '[]'::jsonb)
    )
  );
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- RPC: events
-- ---------------------------------------------------------------------------------------------------------------
create function public.push_events(p_events jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.current_app_role();
  v_uid uuid := auth.uid();
  e record;
  v_game public.games;
  v_seq bigint;
  v_existing bigint;
  v_acks jsonb := '[]'::jsonb;
  v_allowed boolean;
begin
  if v_role is null then raise exception 'Nicht angemeldet' using errcode = '28000'; end if;
  if v_role not in ('admin', 'typist') then raise exception 'Keine Berechtigung zum Erfassen' using errcode = '42501'; end if;

  for e in
    select * from jsonb_to_recordset(p_events)
      as x(id text, game_id text, client_ts bigint, author_label text, kind text, payload jsonb)
    order by client_ts, id
  loop
    select seq into v_existing from public.events where id = e.id;
    if v_existing is not null then
      v_acks := v_acks || jsonb_build_object('id', e.id, 'seq', v_existing);
      continue;
    end if;

    select * into v_game from public.games where id = e.game_id;
    if not found then raise exception 'Spiel % unbekannt', e.game_id using errcode = '23503'; end if;

    if v_role = 'admin' then
      v_allowed := true;
    else
      if v_game.status = 'finished' then raise exception 'Das Spiel ist beendet' using errcode = '42501'; end if;
      if v_game.status <> 'live' then raise exception 'Das Spiel läuft noch nicht' using errcode = '42501'; end if;
      select exists (
        select 1 from public.typists t where t.game_id = e.game_id and t.user_id = v_uid and t.to_ts is null
      ) into v_allowed;
      if not v_allowed then raise exception 'Du bist nicht der aktive Typist dieses Spiels' using errcode = '42501'; end if;
    end if;

    insert into public.game_seq (game_id) values (e.game_id) on conflict (game_id) do nothing;
    update public.game_seq set next_seq = next_seq + 1 where game_id = e.game_id returning next_seq into v_seq;

    insert into public.events (id, game_id, seq, client_ts, author_id, author_label, kind, payload)
    values (e.id, e.game_id, v_seq, e.client_ts, v_uid, e.author_label, e.kind, e.payload);

    v_acks := v_acks || jsonb_build_object('id', e.id, 'seq', v_seq);
  end loop;
  return v_acks;
end $$;

create function public.pull_events(p_game text, p_after bigint) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'game_id', e.game_id, 'client_ts', e.client_ts, 'author_id', e.author_id,
    'author_label', e.author_label, 'kind', e.kind, 'payload', e.payload, 'seq', e.seq
  ) order by e.seq), '[]'::jsonb)
  from public.events e where e.game_id = p_game and e.seq > p_after
$$;

-- Public ticker: validates the token, exposes only what the ticker shows, returns events newer than p_after.
create function public.ticker_snapshot(p_token text, p_after bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_game public.games;
  v_max bigint;
begin
  select * into v_game from public.games where ticker_token = p_token;
  if not found then return null; end if;
  select coalesce(max(seq), 0) into v_max from public.events where game_id = v_game.id;
  return jsonb_build_object(
    'game', jsonb_build_object('id', v_game.id, 'date', v_game.date, 'occasion', v_game.occasion, 'status', v_game.status),
    'own_name', coalesce((select name from public.teams where is_own limit 1), 'Emperors'),
    'opp_name', coalesce((select name from public.teams where id = v_game.opponent_team_id), 'Gegner'),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'number', p.number, 'name', p.name))
      from public.roster r join public.players p on p.id = r.player_id
      where r.game_id = v_game.id and r.present
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'game_id', e.game_id, 'client_ts', e.client_ts, 'author_label', e.author_label,
        'kind', e.kind, 'payload', e.payload, 'seq', e.seq
      ) order by e.seq)
      from (select * from public.events where game_id = v_game.id and seq > p_after order by seq limit 2000) e
    ), '[]'::jsonb),
    'max_seq', v_max,
    'server_time', (extract(epoch from clock_timestamp()) * 1000)::bigint
  );
end $$;

create function public.export_status(p_game text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when public.current_app_role() not in ('admin', 'typist') then null
    when coalesce((select value from public.settings where key = 'sheets_export'), 'off') <> 'on' then null
    else jsonb_build_object(
      'last_seq', coalesce((select last_seq from public.export_state where game_id = p_game), 0),
      'last_run', (select (extract(epoch from last_run) * 1000)::bigint from public.export_state where game_id = p_game),
      'last_error', (select last_error from public.export_state where game_id = p_game)
    )
  end
$$;

create function public.ping() returns int language sql stable as $$ select 1 $$;

revoke all on function public.push_rows(text, jsonb), public.pull_rows(bigint), public.push_events(jsonb),
  public.pull_events(text, bigint), public.ticker_snapshot(text, bigint), public.export_status(text), public.ping(),
  public.current_app_role() from public;
grant execute on function public.ticker_snapshot(text, bigint), public.ping() to anon, authenticated;
grant execute on function public.push_rows(text, jsonb), public.pull_rows(bigint), public.push_events(jsonb),
  public.pull_events(text, bigint), public.export_status(text), public.current_app_role() to authenticated;
