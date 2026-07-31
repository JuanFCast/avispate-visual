-- Avíspate · robot puntual del pago de premios DENTRO de Supabase (pg_cron)
--
-- Patrón copiado de TypeRush (gamev2_robots.sql): pg_cron es el reloj puntual
-- de Supabase; a las 00:00 UTC EN PUNTO (7:00 p. m. Colombia) dispara vía pg_net
-- el endpoint /api/cron/roll-day de Vercel, que liquida la ronda y resiembra.
-- El endpoint espera unos segundos de colchón (SETTLE_GRACE_SECONDS) para que
-- la última partida del día alcance a registrarse, y paga los tres mazos en
-- paralelo: el premio suele caer sobre las 7:00:15 p. m.
--
-- Capas de respaldo (todas idempotentes, correr doble no paga doble):
--   1. ESTE cron de Supabase ............ 00:00 UTC (principal, puntual)
--   2. Reintento de Supabase ............ 00:03 UTC (por si el principal falla)
--   3. Cron de Vercel ................... 00:05 UTC (impuntual: en Hobby llega
--                                         con hasta una hora de retraso)
--   4. GitHub Actions settle-round ...... programado a 00:20 UTC, pero GitHub
--                                         lo entrega 2-3 h tarde: es el último
--                                         recurso y la ALERTA, no un reloj.
--
-- Solo las capas 1 y 2 son puntuales. Si esas dos se caen, el pago llega
-- tarde aunque las otras dos funcionen — que es exactamente lo que pasó entre
-- el 27 y el 30 de julio de 2026: el job apuntaba a la URL vieja
-- (avispate-visual.vercel.app), que desde el cambio de dominio responde 308
-- hacia avispate.fun. pg_net NO sigue redirecciones, así que el disparo
-- puntual se perdía en silencio y pagaba el cron de Vercel a las 00:13-00:32.
--
-- PREREQUISITOS (una sola vez, en Database → Extensions): pg_cron y pg_net.
--
-- USO: reemplaza __CRON_SECRET__ por el valor de CRON_SECRET (EL MISMO que
-- está en Vercel → Settings → Environment Variables, producción) y ejecuta en
-- el SQL Editor. Seguro de re-ejecutar: reemplaza el job si ya existe.
-- (No commitear este archivo con el secreto puesto — usa la copia generada
-- robots-roll-day.local.sql, que está en .gitignore.)
--
-- Un secreto que no coincida con el de Vercel devuelve 401 y NO paga. La
-- comprobación de abajo lo detecta antes de programar nada.

do $$
declare
  cron_secret text := '__CRON_SECRET__';
  target_url  text := 'https://avispate.fun/api/cron/roll-day';
  -- nombre de job → horario UTC. El primero paga; el segundo solo actúa si el
  -- primero no dejó fila en round_settlements.
  jobs        text[][] := array[
    ['avispate-roll-day',       '0 0 * * *'],
    ['avispate-roll-day-retry', '3 0 * * *']
  ];
  job_name    text;
  job_sched   text;
  existing    text;
  i           int;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron no está activo. Actívalo en Database → Extensions.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net no está activo. Actívalo en Database → Extensions.';
  end if;

  -- Validación por FORMA, no por comparación con el marcador.
  --
  -- Antes esto decía `if cron_secret = '__CRON_SECRET__'`, y el buscar-y-
  -- reemplazar que genera la copia .local.sql sustituía TAMBIÉN esa línea: el
  -- archivo generado comparaba el secreto consigo mismo, la condición era
  -- siempre cierta y el bloque entero abortaba. Como todo esto va en una sola
  -- transacción, el `raise` deshacía el `unschedule` y el job se quedaba
  -- intacto con la URL vieja — el arreglo parecía aplicado y nunca lo estuvo.
  -- Un CRON_SECRET real es hexadecimal, así que nunca contiene 'CRON_SECRET'.
  if cron_secret like '%CRON_SECRET%' or length(cron_secret) < 16 then
    raise exception
      'Reemplaza el marcador por el CRON_SECRET real (el de Vercel) antes de ejecutar.';
  end if;

  for i in 1 .. array_length(jobs, 1) loop
    job_name  := jobs[i][1];
    job_sched := jobs[i][2];

    -- Deja constancia de lo que había. Si el job vivo apuntaba a otra URL o
    -- llevaba otro secreto, aquí se ve — es la única forma de notar que el
    -- robot llevaba días disparando al vacío.
    select command into existing from cron.job where jobname = job_name;
    if existing is not null then
      raise notice 'Reemplazando % · definición anterior: %', job_name, existing;
      perform cron.unschedule(job_name);
    end if;

    -- timeout largo: roll-day espera el colchón de cierre y hace hasta 3
    -- settles + resiembras on-chain (en paralelo, ~20 s en total).
    perform cron.schedule(
      job_name,
      job_sched,  -- 00:00 UTC = 7:00 p. m. Colombia (UTC−5 fija)
      format(
        'select net.http_get(url => %L, headers => jsonb_build_object(''Authorization'', %L), timeout_milliseconds => 58000);',
        target_url,
        'Bearer ' || cron_secret
      )
    );

    raise notice 'Robot programado: % (% UTC diario) → %', job_name, job_sched, target_url;
  end loop;
end
$$;


-- ---------------------------------------------------------------------------
-- Comprobación INMEDIATA (?probe=1): confirma la URL y el secreto sin liquidar,
-- sin pagar y sin escribir nada. Un 200 significa que el robot funcionará; un
-- 401 significa que el secreto NO coincide con el de Vercel y volvería a
-- fallar en silencio. Descomenta y ejecuta.
--
-- NO uses ?date=<fecha vieja> para probar: una ronda sin partidas no tiene
-- ganador, pero el endpoint igual registra la transición y te deja tres filas
-- basura en round_settlements. Para eso está ?probe=1.
-- ---------------------------------------------------------------------------
-- do $$
-- declare cron_secret text := '__CRON_SECRET__';
-- begin
--   perform net.http_get(
--     url     => 'https://avispate.fun/api/cron/roll-day?probe=1',
--     headers => jsonb_build_object('Authorization', 'Bearer ' || cron_secret),
--     timeout_milliseconds => 20000
--   );
-- end $$;
--
-- Espera ~5 s y mira la respuesta (pg_net es asíncrono):
--   select id, status_code, content, created
--     from net._http_response order by created desc limit 3;


-- ---------------------------------------------------------------------------
-- Diagnóstico
-- ---------------------------------------------------------------------------
-- Los jobs programados y a dónde apuntan de verdad:
--   select jobid, jobname, schedule, active, command
--     from cron.job where jobname like 'avispate%' order by jobname;
--
-- Las últimas corridas (status 'succeeded' aquí solo dice que pg_cron ejecutó
-- el SQL, NO que el HTTP haya respondido 200 — para eso, _http_response):
--   select jobid, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 10;
--
-- Lo que realmente contestó Vercel:
--   select id, status_code, content, created
--     from net._http_response order by created desc limit 10;
--
-- Si la ronda se liquidó y a qué hora (00:00:1x UTC = puntual):
--   select round_date, deck_size, tx_hash, created_at
--     from round_settlements order by created_at desc limit 6;
