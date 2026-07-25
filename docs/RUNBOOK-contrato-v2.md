# Runbook — Migración a AvispatePot v2 (jugada gratis on-chain)

> **⚠️ ORDEN OBLIGATORIO.** El código nuevo (ya en la rama local) NO es
> compatible con el contrato viejo: usa el evento `Played` con `wasFree` y la
> vista `hasFreePlayToday` que solo existen en v2. **NO hagas push hasta el
> paso 6.** Si el código nuevo llega a producción apuntando al contrato viejo,
> nadie puede jugar.

## Qué cambia

- TODA jugada (gratis o paga) firma `play(deck)` on-chain. El contrato regala
  la primera del día por wallet y mazo; las demás cobran 0.10 USDT.
- La gratis aplica igual para correo, wallet externa y MiniPay.
- El corte del día es medianoche UTC (7:00 p. m. Colombia), igual que el cron.
- Los usuarios de correo reciben 0.1 CELO de gas una vez (`/api/welcome-gas`).

## Pasos (en orden)

### 1. Migración de Supabase
En el SQL editor de Supabase, correr:
`supabase/migrations/20260724000000_welcome_airdrops.sql`

### 2. Desplegar el contrato v2
```
cd contracts
npm run deploy:celo
```
(usa `contracts/.env`: DEPLOYER_PRIVATE_KEY + USDT_ADDRESS, COMMISSION_WALLET,
OPERATOR_ADDRESS, OWNER_ADDRESS — los mismos del despliegue v1).
Anotar la dirección nueva: `0xNUEVO`.

### 3. Recuperar los pozos del contrato viejo
```
node scripts/recover-pots.mjs 0x28B239a1b85fc2d87a0248B0EC319Ae3e6EB43f7
```
Envía todo el saldo de los 3 pozos viejos al Funder (firma el Operator).
Hacerlo idealmente justo DESPUÉS de una liquidación de las 7 p. m. para no
interferir con una ronda en curso.

### 4. Sembrar los pozos del contrato nuevo
```
node scripts/seed-pots.mjs 0xNUEVO
```
(1 USDT por mazo desde el Funder.)

### 5. Actualizar variables de entorno
- `.env.local`: `NEXT_PUBLIC_AVISPATE_POT_ADDRESS=0xNUEVO`
- Vercel (producción): mismo cambio. `OPERATOR_PRIVATE_KEY`, `FUNDER_PRIVATE_KEY`
  y `CRON_SECRET` ya existen y no cambian.
- Opcional (cuando se quiera el captcha anti-bots del welcome gas): crear un
  widget en Cloudflare Turnstile y poner `NEXT_PUBLIC_TURNSTILE_SITE_KEY` +
  `TURNSTILE_SECRET_KEY`. Sin estas llaves el regalo de gas funciona sin
  captcha (ojo al abuso si se difunde mucho).

### 6. Push del código
`git push` → Vercel despliega el frontend/backend nuevos ya apuntando a v2.

### 7. Verificación post-despliegue
- Entrar con un correo NUEVO: debe llegar el welcome gas (0.1 CELO) y el CTA
  debe decir "Jugar gratis"; la jugada gratis firma una tx sin cobrar USDT.
- Wallet externa (Rabby): "Jugar gratis" la primera vez del día; la segunda
  pide 0.10 USDT con un approve ACOTADO (1 USDT máx, no ilimitado).
- Revisar en Supabase que el score quedó con `is_paid=false` y `tx_hash`.
- El cron de las 7 p. m. no cambia (mismo settle + resiembra).

## Notas de operación

- **Gas del Operator:** cada welcome gas cuesta 0.1 CELO. Con ~2.8 CELO
  alcanza para ~28 registros de correo. Recargar el Operator cuando el saldo
  baje (el endpoint responde 500 `transfer-failed` si no puede enviar).
- **El contrato viejo queda muerto** con pozos en 0. No hace falta tocarlo más.
- Jugada gratis "quemada": si alguien firma la tx gratis y cierra el juego sin
  terminar, su gratis del día ya se consumió on-chain (igual que nerdos).
