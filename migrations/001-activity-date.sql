-- =============================================================
-- Migración 001 — fecha de actividad (corte 06:00)
-- -------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor sobre una base ya creada.
--
-- La app envía activity_date desde el commit 471aa3d. Sin esta
-- columna, PostgREST rechaza cada INSERT con PGRST204 y los
-- partes quedan atascados en el buzón de salida.
-- =============================================================

alter table public.reports
  add column if not exists activity_date date;

-- Backfill: si el parte es de antes de las 06:00, la actividad
-- corresponde al día anterior.
update public.reports
set activity_date = case
  when hora >= time '06:00' then report_date
  else report_date - 1
end
where activity_date is null;

-- Verificación: no debería quedar ninguna fila sin fecha.
-- select count(*) from public.reports where activity_date is null;
