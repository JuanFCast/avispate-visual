-- Avíspate · robot puntual del pago de premios DENTRO de Supabase (pg_cron)
--
-- Patrón copiado de TypeRush (gamev2_robots.sql): pg_cron es el reloj puntual
-- de Supabase; a las 00:01 UTC (7:01 p. m. Colombia) dispara vía pg_net el
-- endpoint /api/cron/roll-day de Vercel, que liquida la ronda y resiembra.
--
-- Capas de respaldo (todas idempotentes, correr doble no paga doble):
--   1. ESTE cron de Supabase ............ 00:01 UTC (principal, puntual)
--   2. GitHub Actions settle-round ...... 00:01/00:04/00:08/00:15 UTC
--   3. Cron de Vercel ................... 00:05 UTC (impuntual, da igual)
--
-- PREREQUISITOS (una sola vez, en Database → Extensions): pg_cron y pg_net.
--
-- USO: reemplaza __CRON_SECRET__ por el valor de CRON_SECRET (el de Vercel /
-- .env.local) y ejecuta en el SQL Editor. Seguro de re-ejecutar: reemplaza el
-- job si ya existe. (No commitear este archivo con el secreto puesto — usa la
-- copia generada robots-roll-day.local.sql, que está en .gitignore.)

do $$
declare
  cron_secret text := '__CRON_SECRET__';
  job_name    text := 'avispate-roll-day';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron no está activo. Actívalo en Database → Extensions.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net no está activo. Actívalo en Database → Extensions.';
  end if;
  if cron_secret = '__CRON_SECRET__' or cron_secret = '' then
    raise exception 'Reemplaza __CRON_SECRET__ por el CRON_SECRET real antes de ejecutar.';
  end if;

  if exists (select 1 from cron.job where jobname = job_name) then
    perform cron.unschedule(job_name);
  end if;

  -- timeout largo: roll-day hace hasta 3 settles + resiembras on-chain (~30 s).
  perform cron.schedule(
    job_name,
    '1 0 * * *',  -- 00:01 UTC = 7:01 p. m. Colombia (UTC−5 fija)
    format(
      'select net.http_get(url => %L, headers => jsonb_build_object(''Authorization'', %L), timeout_milliseconds => 58000);',
      'https://avispate-visual.vercel.app/api/cron/roll-day',
      'Bearer ' || cron_secret
    )
  );

  raise notice 'Robot programado: % (00:01 UTC diario).', job_name;
end
$$;

-- Ver el job programado:
--   select jobid, jobname, schedule from cron.job order by jobname;
-- Ver las últimas corridas:
--   select * from cron.job_run_details order by start_time desc limit 5;
