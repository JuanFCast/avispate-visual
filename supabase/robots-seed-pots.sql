-- Avíspate · robot de SIEMBRA de los pozos DENTRO de Supabase (pg_cron)
--
-- Mantiene los tres pozos en su suelo (0,30 USDT por mazo) llamando a
-- /api/cron/seed-pots. El trabajo es idempotente —completa hasta el suelo, no
-- suma—, así que disparar de más no cuesta nada y disparar de menos lo arregla
-- la vuelta siguiente.
--
-- POR QUÉ ESTE ROBOT EXISTE
--
-- Hasta el 2026-08-16 sembrar era un efecto secundario del cierre: al final de
-- /api/cron/roll-day se llamaba `seedPots([...txByDeck.keys()])`, o sea
-- "resiembro los mazos que acabo de pagar". Esa madrugada la siembra no salió
-- (el Funder es la MISMA wallet que siembra TypeRush y los dos robots
-- despertaron en el mismo segundo, cada uno llevando su nonce a mano) y no
-- había forma de recuperarla: el reintento de las 00:05 encontraba las filas de
-- round_settlements y devolvía `already_settled` sin llegar a sembrar, y desde
-- el día siguiente un pozo en cero ya ni entraba a liquidarse. Los tres pozos
-- se quedaron en 0,00 con el juego abierto, cobrando entradas por un premio que
-- no existía. Ver lib/seed-rules.ts.
--
-- LAS CAPAS, Y QUÉ HACE CADA UNA
--
--   1. ESTE cron, job `-close` ....... 00:07 UTC. Rellena el pozo justo después
--                                      de que `settle` lo vacíe (00:00:10), para
--                                      que la ronda nueva no abra en 0,00 a las
--                                      7 p. m. de Colombia, que es la hora pico.
--   2. ESTE cron, job `-hourly` ...... cada hora en el minuto :35. Es el que
--                                      hace que ningún fallo sea definitivo.
--   3. GitHub Actions seed-pots ...... 2-3 h tarde. Último recurso y ALARMA: si
--                                      al llegar allí algún pozo sigue por
--                                      debajo del suelo, el workflow falla y
--                                      GitHub manda el correo.
--
-- SOBRE LOS MINUTOS ELEGIDOS, Y POR QUÉ NO SON LA DEFENSA DE VERDAD
--
-- El primer borrador de esto ponía el job de cierre a las 00:02, que resultó ser
-- el peor minuto posible: TypeRush V3 firma su siembra a las 00:00:1x (la
-- encadena a su `settle-v3`) y reintenta a las 00:04:0x, y TypeRush V2 concentra
-- 108 de sus 116 `fundPot` en el minuto :02. Las 00:07 caen fuera de esas dos
-- ráfagas, y el :35 horario cae lejos del :20 en que corre el sembrador de
-- TypeRush.
--
-- Pero elegir minutos NO es la solución, solo un colchón. La wallet Funder
-- 0x46d5F9fE ha tocado 17 contratos en 40 días: siembra TypeRush V2, V3 (dos
-- despliegues) y Avíspate, entra a Arena, y ADEMÁS es el teléfono con el que se
-- juega — 35 `play` en Avíspate, y su minuto más frecuente es justamente el :35.
-- Cuatro robots y una persona sobre una sola secuencia de nonce no se coordinan
-- con un cron. La defensa de verdad es que Avíspate use su PROPIA wallet Funder
-- (basta cambiar FUNDER_PRIVATE_KEY: el código no distingue), y el reintento con
-- nonce fresco de `lib/seed-chain.ts` como último colchón.
--
-- No hay cron de Vercel para esto. En Hobby solo caben dos jobs diarios y ya
-- están ocupados por roll-day y arena-settle; además Vercel no da horarios
-- sub-diarios en ese plan. Si algún día el proyecto pasa a Pro, añadir
-- {"path": "/api/cron/seed-pots", "schedule": "35 * * * *"} a vercel.json es
-- una cuarta capa gratis.
--
-- PREREQUISITOS (una sola vez, en Database → Extensions): pg_cron y pg_net.
--
-- USO: reemplaza __CRON_SECRET__ por el valor de CRON_SECRET (EL MISMO que está
-- en Vercel → Settings → Environment Variables, producción) y ejecuta en el SQL
-- Editor. Seguro de re-ejecutar: reemplaza los jobs si ya existen.
-- (No commitear este archivo con el secreto puesto — usa la copia generada
-- robots-seed-pots.local.sql, que está en .gitignore.)

do $$
declare
  cron_secret text := '__CRON_SECRET__';
  target_url  text := 'https://avispate.fun/api/cron/seed-pots';
  -- nombre de job → horario UTC.
  jobs        text[][] := array[
    ['avispate-seed-pots-close',  '7 0 * * *'],
    ['avispate-seed-pots-hourly', '35 * * * *']
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

  -- Validación por FORMA, no por comparación con el marcador: el buscar-y-
  -- reemplazar que genera la copia .local.sql sustituiría también esa línea y
  -- el archivo generado se compararía consigo mismo. Mismo cuidado que en
  -- robots-roll-day.sql, donde ese error dejó el robot apuntando a la URL vieja
  -- durante tres días sin que se notara.
  if cron_secret like '%CRON_SECRET%' or length(cron_secret) < 16 then
    raise exception
      'Reemplaza el marcador por el CRON_SECRET real (el de Vercel) antes de ejecutar.';
  end if;

  for i in 1 .. array_length(jobs, 1) loop
    job_name  := jobs[i][1];
    job_sched := jobs[i][2];

    -- Deja constancia de lo que había. Si el job vivo apuntaba a otra URL o
    -- llevaba otro secreto, aquí se ve.
    select command into existing from cron.job where jobname = job_name;
    if existing is not null then
      raise notice 'Reemplazando % · definición anterior: %', job_name, existing;
      perform cron.unschedule(job_name);
    end if;

    -- timeout holgado: la ruta se corta sola a los 45 s (BUDGET_MS) y hace
    -- hasta tres seedPot on-chain, uno detrás de otro.
    perform cron.schedule(
      job_name,
      job_sched,
      format(
        'select net.http_get(url => %L, headers => jsonb_build_object(''Authorization'', %L), timeout_milliseconds => 58000);',
        target_url,
        'Bearer ' || cron_secret
      )
    );

    raise notice 'Robot programado: % (% UTC) → %', job_name, job_sched, target_url;
  end loop;
end
$$;


-- ---------------------------------------------------------------------------
-- Comprobación INMEDIATA (?probe=1): confirma la URL y el secreto sin leer la
-- cadena, sin firmar y sin escribir nada. Un 200 significa que el robot
-- funcionará; un 401, que el secreto NO coincide con el de Vercel.
-- ---------------------------------------------------------------------------
-- do $$
-- declare cron_secret text := '__CRON_SECRET__';
-- begin
--   perform net.http_get(
--     url     => 'https://avispate.fun/api/cron/seed-pots?probe=1',
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
-- Los jobs y a dónde apuntan de verdad:
--   select jobid, jobname, schedule, active, command
--     from cron.job where jobname like 'avispate-seed%' order by jobname;
--
-- Lo que contestó Vercel (200 = todo en su suelo; 500 = alarma, mira el cuerpo):
--   select id, status_code, content, created
--     from net._http_response order by created desc limit 10;
--
-- El estado del cerrojo y de lo sembrado hoy:
--   select deck_size, round_date, spent_units, locked_until,
--          last_tx_hash, last_error, last_run_at
--     from pot_seed_runs order by deck_size;
--
-- Un cerrojo tomado con `locked_until` en el futuro y sin corrida en marcha se
-- suelta solo al vencer (2 min por defecto). No hace falta tocarlo a mano.
