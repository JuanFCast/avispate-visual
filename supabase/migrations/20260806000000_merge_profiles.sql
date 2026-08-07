-- ============================================================================
-- Avíspate · Fusión de perfiles partidos en dos
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- El problema que arregla, con nombre y apellido:
--
-- Un jugador entra con su correo. Privy le crea la wallet embebida, pero eso
-- tarda unos segundos y el perfil se crea ANTES, con `wallet_address` en null.
-- El jugador elige su alias ahí. Luego juega: la jugada es on-chain y llega al
-- servidor identificada por la WALLET, que todavía no está anotada en ningún
-- perfil — así que `ensureProfileByWallet` le crea un SEGUNDO perfil.
--
-- Desde ese momento la misma persona son dos filas: una con su correo y su
-- alias, otra con su wallet y sus partidas. Al volver a entrar, el servidor le
-- responde con la que no tiene alias ("no salía mi nick") y al reescribirlo lo
-- rechaza por estar tomado... por él mismo ("ya está registrado por otro").
--
-- Esta función vuelve a unir las dos filas. La wallet es la prueba: una wallet
-- embebida solo la controla su cuenta de Privy, así que dos filas con la misma
-- dirección son la misma persona, sin excepción.
--
-- Se hace en el servidor y no en el backend por una razón concreta: mover el
-- historial y borrar la fila sobrante tienen que pasar los dos o ninguno. A
-- medias dejaría partidas apuntando a un perfil que ya no existe.
-- ============================================================================

create or replace function public.merge_profiles(p_keep uuid, p_drop uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drop_alias  text;
  v_drop_wallet text;
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then
    return;
  end if;

  -- Las dos filas bloqueadas, y siempre en el mismo orden: dos peticiones del
  -- mismo jugador a la vez (la pantalla pide perfil y estado a la par) no
  -- pueden fusionarse cruzadas.
  perform 1 from public.profiles
   where id in (p_keep, p_drop)
   order by id
   for update;

  select alias, wallet_address into v_drop_alias, v_drop_wallet
    from public.profiles where id = p_drop;

  -- La fila ya no está (otra petición ganó la carrera): nada que fusionar.
  if not found then
    return;
  end if;

  -- 1. El historial se muda entero al perfil que se queda.
  update public.scores           set profile_id        = p_keep where profile_id        = p_drop;
  update public.plays            set profile_id        = p_keep where profile_id        = p_drop;
  update public.arena_rooms      set host_profile_id   = p_keep where host_profile_id   = p_drop;
  update public.arena_matches    set winner_profile_id = p_keep where winner_profile_id = p_drop;
  update public.round_settlements set winner_profile_id = p_keep where winner_profile_id = p_drop;

  -- Las sillas de Arena son únicas por sala: si el jugador estuvo en la misma
  -- sala con sus dos perfiles, la silla duplicada se descarta en vez de romper
  -- el índice.
  delete from public.arena_room_players d
   where d.profile_id = p_drop
     and exists (
       select 1 from public.arena_room_players k
        where k.room_id = d.room_id and k.profile_id = p_keep
     );
  update public.arena_room_players set profile_id = p_keep where profile_id = p_drop;

  delete from public.arena_match_players d
   where d.profile_id = p_drop
     and exists (
       select 1 from public.arena_match_players k
        where k.match_id = d.match_id and k.profile_id = p_keep
     );
  update public.arena_match_players set profile_id = p_keep where profile_id = p_drop;

  -- 2. La fila sobrante se va PRIMERO. El alias y la wallet son únicos en toda
  --    la tabla, así que hay que liberarlos antes de escribirlos en la otra
  --    (y no se pueden vaciar en su sitio: `profiles_identity_present` exige
  --    que a un perfil le quede correo o dirección).
  delete from public.profiles where id = p_drop;

  -- 3. Y el que se queda hereda lo que le falte. `coalesce` en este orden es
  --    deliberado: lo que el jugador tenía en su perfil de correo manda, y lo
  --    del otro solo rellena huecos.
  update public.profiles
     set alias          = coalesce(alias, v_drop_alias),
         wallet_address = coalesce(wallet_address, v_drop_wallet)
   where id = p_keep;
end;
$$;

-- Solo el backend (service role) puede fusionar perfiles.
revoke all on function public.merge_profiles(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_profiles(uuid, uuid) to service_role;

-- ============================================================================
-- Fin de la migración.
-- ============================================================================
