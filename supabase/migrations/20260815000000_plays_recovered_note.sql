-- ============================================================================
-- Avíspate · Trazabilidad de un recibo recuperado a mano
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- `plays` se escribe normalmente desde `/api/plays`, apenas la transacción
-- `play(deck)` se confirma. Cuando ese envío no llega —el recibo no alcanza a
-- guardarse en el teléfono, o se pierde antes de salir— la entrada queda
-- cobrada en la cadena y sin rastro en el servidor. La fila se puede reponer
-- leyendo el evento `Played`, que es la fuente de verdad de quién pagó, qué
-- mazo y si fue gratis.
--
-- Pero una fila repuesta a mano NO es lo mismo que una registrada por su
-- propio camino, y quien la mire dentro de un mes tiene derecho a distinguirlas
-- sin arqueología: de dónde salió, cuándo se repuso y por qué. Eso es esta
-- columna. Nula en todas las filas normales; escrita solo por
-- `scripts/recover-play.ts`.
--
-- Recibos recuperados a mano:
--   select tx_hash, round_date, deck_size, is_paid, recovered_note
--   from public.plays where recovered_note is not null order by created_at desc;
-- ============================================================================

alter table public.plays
  add column if not exists recovered_note text;
