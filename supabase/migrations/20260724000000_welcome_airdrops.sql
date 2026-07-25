-- Welcome gas: registro idempotente del CELO regalado a wallets embebidas de
-- Privy (correo) para que puedan firmar su primera play() on-chain. La PK por
-- address garantiza un solo airdrop por wallet; amount_wei=0 con tx_hash null
-- es el centinela "ya tenía saldo, no se envió nada".
create table if not exists public.welcome_airdrops (
  address text primary key,
  email text,
  amount_wei text not null default '0',
  tx_hash text,
  created_at timestamptz not null default now()
);

-- Solo el service role escribe/lee (todo pasa por la API del servidor).
alter table public.welcome_airdrops enable row level security;
grant all on public.welcome_airdrops to service_role;
