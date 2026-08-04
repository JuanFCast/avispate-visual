-- Sesiones de wallet: entrar sin firmar un mensaje (MiniPay no soporta
-- personal_sign). El jugador canjea el hash de una jugada reciente por un token
-- de sesión; esta tabla es lo que impide canjear DOS veces el mismo hash, que es
-- la única defensa real contra que un tercero reutilice un hash público.
create table if not exists public.wallet_sessions (
  tx_hash text primary key,
  wallet_address text not null,
  created_at timestamptz not null default now()
);

-- Para poder purgar los canjes viejos: pasada la ventana de 5 minutos que exige
-- verifyWalletControl, la fila ya no defiende nada y solo ocupa espacio.
create index if not exists wallet_sessions_created_at_idx
  on public.wallet_sessions (created_at);

-- Solo el service role (todo pasa por la API del servidor).
alter table public.wallet_sessions enable row level security;
grant all on public.wallet_sessions to service_role;
