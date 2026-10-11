-- =============================================================
-- Estadística de Supervisores 2.0 — Esquema de base de datos
-- -------------------------------------------------------------
-- Pegá TODO esto en: Supabase → SQL Editor → New query → Run
-- =============================================================

create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),   -- hora real del servidor
  report_date    date        not null default current_date,
  hora           time        not null default localtime,
  sector         int         not null,
  turno          int         not null,
  legajo         int         not null,
  device_id      uuid,
  mesas          jsonb       not null default '[]'::jsonb,  -- [{n,ganancia,perdida,propina}, ...]
  total_ganancia int         not null default 0,
  total_perdida  int         not null default 0,
  total_capital  int         not null default 0,            -- total_ganancia - total_perdida
  total_propina  int         not null default 0,
  notas          text
);

create index if not exists reports_fecha_idx  on public.reports (report_date desc);
create index if not exists reports_legajo_idx on public.reports (legajo);
create index if not exists reports_sector_idx on public.reports (sector);
create index if not exists reports_turno_idx  on public.reports (turno);

-- -------------------------------------------------------------
-- Seguridad: RLS + permisos
--   anon          → SOLO INSERTAR (los supervisores)
--   authenticated → SOLO LEER     (el admin)
-- -------------------------------------------------------------
alter table public.reports enable row level security;

revoke all on public.reports from anon, authenticated;

drop policy if exists "anon puede insertar partes" on public.reports;
create policy "anon puede insertar partes"
  on public.reports for insert to anon
  with check (true);

drop policy if exists "admin puede leer partes" on public.reports;
create policy "admin puede leer partes"
  on public.reports for select to authenticated
  using (true);

grant insert on public.reports to anon;
grant select on public.reports to authenticated;
