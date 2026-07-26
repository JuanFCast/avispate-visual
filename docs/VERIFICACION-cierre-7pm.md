# Verificación del cierre de las 7:00 p. m.

Registro de la prueba de regresión pedida en *Cosas por corregir en Avíspate
2026-07-23*: **observar un cierre real y documentarlo, sin reimplementar nada.**

El arreglo del cierre entró en `345fef1` (`perf(cron): premio de las 7:00 p. m.
en paralelo y con colchón de cierre`), fechado **2026-07-25 09:45 −05:00**. El
primer cierre real posterior fue el de esa misma noche.

## Evidencia

Cada ronda cierra a las 00:00 UTC (7:00 p. m. Colombia). El retraso es la
diferencia entre ese instante y el `created_at` de la fila de
`round_settlements`, que se escribe apenas confirma el pago on-chain.

| Ronda | Cierre (UTC) | Liquidada (UTC) | Retraso | |
|---|---|---|---|---|
| 2026-07-22 | 00:00:00 del 23 | 00:48:19.769 | +48 min 20 s | antes del arreglo |
| 2026-07-23 | 00:00:00 del 24 | 00:45:00.162 | +45 min 00 s | antes del arreglo |
| 2026-07-24 | 00:00:00 del 25 | 03:07:30.263 | +3 h 07 min 30 s | antes del arreglo |
| **2026-07-25** | **00:00:00 del 26** | **00:00:12.560** | **+12,6 s** | **con el arreglo** ✅ |

Los tres mazos de la ronda 2026-07-25 comparten el mismo `created_at`
(`00:00:12.559601Z`), que es justo lo que busca el arreglo: las tres
liquidaciones salen en paralelo y no una detrás de otra.

**Resultado: verificado.** El premio de la ronda 2026-07-25 (mazo 10, 1,00 USDT
a `PipeRabby`) se pagó 12,6 segundos después del cierre, dentro del colchón de
8 s de `SETTLE_GRACE_SECONDS` más el tiempo de confirmación en Celo. No se
modificó nada del cron ni de la liquidación.

## Cómo repetir la comprobación

Tras cualquier cierre, con `SUPABASE_SERVICE_ROLE_KEY` en el entorno:

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/round_settlements?select=round_date,deck_size,created_at,tx_hash&order=round_date.desc&limit=3" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

`created_at` debe caer dentro del minuto siguiente a las 00:00:00 UTC de la
fecha siguiente a `round_date`. Si se va a minutos, el fallo está en el
disparador (pg_cron / GitHub Actions / Vercel), no en `roll-day`.

## Partida gratis

Regresión ejecutada sobre el contrato, sin tocar su implementación:

```
cd contracts && npx hardhat test
→ 17 passing
```

Incluye los ocho casos de la jugada gratis: primera del día gratis, la segunda
cobra, es por mazo, es por wallet, se renueva a medianoche UTC, funciona sin
`approve` ni saldo en una wallet recién creada, revierte si no hay gratis ni
saldo, y rechaza mazos inválidos.
