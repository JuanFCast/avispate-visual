# Avíspate 🐝⚡

**[avispate.fun](https://avispate.fun)** — juego diario de agilidad visual sobre
Celo. Encuentras el símbolo que comparten dos cartas, gastas tu mazo lo más
rápido que puedas, y el más veloz del día se lleva el pozo en USDT.

Pensado para el teléfono y para MiniPay: una partida dura menos de un minuto,
la entrada cuesta 0.10 USDT y cada jugada es una transacción real en Celo.

## Cómo se juega

Tienes una carta base (de referencia, no se toca) y tu carta. Comparten
**exactamente un símbolo**: encuéntralo en la tuya y tócalo. Tu carta pasa a ser
la nueva base, la vieja sale y entra la siguiente del mazo. Gana quien gaste
todo el mazo en el menor tiempo **promedio por carta** — así el mazo de 10 y el
de 20 compiten en igualdad.

- Mazos de 10, 15 o 20 cartas.
- Error: +1 segundo de penalización y la carta tiembla; puedes seguir.
- Los distractores tienen trampa: la carta nueva se llena de símbolos del mismo
  color y categoría que el objetivo (si el común es la manzana, aparecen cosas
  rojas y comidas). 60 símbolos en total.
- Sonido generado con WebAudio, sin archivos.

## La economía

- **Una jugada gratis al día por mazo y por wallet.** La decide el contrato
  (`hasFreePlayToday`), no la app.
- Las siguientes cuestan **0.10 USDT**: el **80% va al pozo** de ese mazo y el
  20% es comisión del protocolo (`commissionBps`, configurable).
- La ronda cierra a las **7:00 p. m. de Colombia** (00:00 UTC). El **#1 de cada
  mazo se lleva su pozo**; si nadie jugó, el premio se acumula para el día
  siguiente.
- El pago lo dispara un robot; hay cuatro despertadores redundantes e
  idempotentes (pg_cron de Supabase, su reintento, GitHub Actions y el cron de
  Vercel), así que pagar dos veces es imposible y no pagar es improbable.

## On-chain

Contrato **`AvispatePot`** en **Celo mainnet**:
[`0x48089fBD48576390bfd68d106d21715200E0207f`](https://celoscan.io/address/0x48089fBD48576390bfd68d106d21715200E0207f)
· código verificado ([Sourcify](https://repo.sourcify.dev/42220/0x48089fBD48576390bfd68d106d21715200E0207f),
[Blockscout](https://celo.blockscout.com/address/0x48089fBD48576390bfd68d106d21715200E0207f?tab=contract)).

- **Toda** jugada —gratis o paga— firma `play(deck)`. Esa transacción es la
  prueba de identidad de la wallet: el backend no acepta un puntaje sin ella.
- Pagos en **USDT** (6 decimales). El allowance que se pide es **acotado** (10
  entradas), nunca ilimitado: MiniPay rechaza `maxUint256`.
- Si la wallet casi no tiene CELO —lo normal en MiniPay y en las wallets
  embebidas— el gas se paga **en USDT** vía el adaptador CIP-64.

## Identidad y wallets

- **Correo** (Privy, wallet embebida) o **wallet propia** (RainbowKit/wagmi).
- Dentro de **MiniPay** se conecta sola, sin botón de "conectar wallet".
- El alias pertenece a la **wallet**, no al dispositivo: entra desde otro
  teléfono y recupera su nombre.

## Nada que se cobre se pierde

Cuando el contrato cobra, eso ya no se deshace. Por eso:

1. El `txHash` se escribe en el dispositivo **antes** de repartir cartas, y la
   partida no arranca hasta que el servidor confirma el registro (`plays`).
2. El resultado se guarda igual antes de pintarse, y se reenvía solo al volver
   a abrir la app si el envío no llegó.
3. Todo es idempotente (`tx_hash`, `client_game_id`): reintentar nunca duplica
   una jugada ni cobra de nuevo.

## Correrlo

```bash
npm install
npm run dev
```

Abrir <http://localhost:3000>. Copia `.env.example` a `.env.local` y llena las
claves (Privy, Supabase, WalletConnect, dirección del contrato, RPC de Celo).

## Estructura

- `app/page.tsx` — el juego, en la raíz del sitio.
- `app/ranking`, `app/historial`, `app/perfil`, `app/stats` — ranking del día,
  ganadores pasados, tu perfil y cartera, métricas públicas.
- `app/api/` — `scores` (guardar marca), `plays` (recibo de la jugada),
  `leaderboard`, `round`, `history`, `stats`, `profile`, `wallet-alias`,
  `welcome-gas`, `cron/roll-day` (cierre y pago de la ronda).
- `components/GameShell.tsx` — orquestador: fases, cobro, partida, resultados.
- `lib/pay.ts` — el flujo de pago (cadena, allowance, `play`), con sus estados.
- `lib/outbox.ts` — la bandeja de salida que evita perder jugadas.
- `lib/game.ts` / `lib/symbols.ts` — generación de cartas y banco de símbolos.
- `lib/settle.ts` / `lib/seed.ts` — liquidación del pozo y resiembra.
- `contracts/` — `AvispatePot.sol`, pruebas y despliegue con Hardhat.
- `supabase/migrations/` — esquema (perfiles, puntajes, jugadas,
  liquidaciones). Se ejecutan en el SQL Editor de Supabase.

## Contrato

```bash
cd contracts
npm install
npx hardhat test
npx hardhat run scripts/deploy.js --network celo
npx hardhat verify --network celo <address> <args…>
```

La verificación va a Sourcify sin llave; para publicar también en Celoscan hace
falta `CELOSCAN_API_KEY` en `contracts/.env`.

## Stack

Next.js 15 (App Router) · React 19 · wagmi + viem · Privy · RainbowKit ·
TanStack Query · Supabase (Postgres) · Hardhat · Celo mainnet.
