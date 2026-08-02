# Anexo A — Jugadores, reparto y cartas por jugador

> Reemplaza el control **"Cuánto dura: Rápida / Completa"** de P2 (Configurar la sala).

---

## A.0 Lo único que tienes que confirmar antes de programar

El tope de 55 cartas **compite con la reserva de castigos**: las dos salen del mismo mazo. Si tu mazo total es chico, el máximo real baja.

```ts
export const MAZO_TOTAL  = 108;  // ⚠️ PONER EL TAMAÑO REAL DEL MAZO
export const RESERVA_MIN = 15;   // ⚠️ mínimo de cartas que deben quedar para castigos
```

- Si `MAZO_TOTAL = 108` → el tope de 55 es el que manda y los máximos son 27 / 18 / 13.
- Si `MAZO_TOTAL = 55` → en el máximo la reserva quedaría en **0** y no habría de dónde sacar castigos. La fórmula lo corrige sola y el máximo con 2 jugadores baja a 19.

La fórmula de A.2 funciona con cualquier valor; solo hay que poner el correcto.

---

## A.1 Constantes

```ts
export const JUGADORES_MIN      = 2;
export const JUGADORES_MAX      = 4;
export const CARTAS_MIN         = 10;   // mínimo por jugador
export const CARTAS_EN_JUEGO_MAX = 55;  // repartidas + base compartida
export const MAZO_TOTAL         = 108;  // ⚠️ ver A.0
export const RESERVA_MIN        = 15;   // ⚠️ ver A.0
export const SEG_POR_CARTA      = 6;    // solo para el estimado de duración
```

`SEG_POR_CARTA` sale de tu propio leaderboard (7.04 s/carta en solo). Calibrar con datos reales de multijugador.

---

## A.2 Fórmula del máximo

```
cartasEnJuego = jugadores × cartasPorJugador + 1        (el +1 es la base compartida)

cartasEnJuego ≤ 55
cartasEnJuego + RESERVA_MIN ≤ MAZO_TOTAL
```

```ts
export function maxCartasPorJugador(jugadores: number): number {
  const porTope = Math.floor((CARTAS_EN_JUEGO_MAX - 1) / jugadores);
  const porMazo = Math.floor((MAZO_TOTAL - RESERVA_MIN - 1) / jugadores);
  return Math.min(porTope, porMazo);
}
```

Con `MAZO_TOTAL = 108`:

| Jugadores | Rango de cartas | En juego (mín) | En juego (máx) | Reserva (en el máx) |
|---|---|---|---|---|
| 2 | 10 – **27** | 21 | 55 | 53 |
| 3 | 10 – **18** | 31 | 55 | 53 |
| 4 | 10 – **13** | 41 | 53 | 55 |

El 27 coincide exactamente con la "Completa" que ya tienes hoy — o sea que el modo actual es el máximo de 2 jugadores. Eso confirma que el tope de 55 está bien puesto.

> Nota: da igual si el 55 incluye o no la base. `floor(54/n)` y `floor(55/n)` dan el mismo resultado para n = 2, 3, 4.

---

## A.3 El control en pantalla

Va en **P2 — Configurar la sala**, reemplazando "Cuánto dura".

```
┌──────────────────────────────────────┐
│ Jugadores                            │
│  [  2  ] [  3  ] [  4  ]             │   ← los tres habilitados, sin "Pronto"
│                                      │
│ Cartas por jugador              18   │
│  [ − ] ━━━━━━━●━━━━━━━━━━━━━━ [ + ]  │
│  mín 10                     máx 27   │
│                                      │
│  [Rápida 10] [Media 18] [Larga 27]   │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Se reparten             36     │  │
│  │ Base compartida          1     │  │
│  │ ─────────────────────────────  │  │
│  │ En juego (tope 55)      37     │  │
│  │ Dura aprox.          4 min     │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

**Comportamiento**

- Slider con `step="1"`, más botones `−` / `+` para precisión (con 2 jugadores el rango tiene 18 pasos y el dedo no acierta).
- Los tres presets son atajos y **muestran su número**: se re-etiquetan cuando cambia `jugadores`. `Rápida = mín`, `Media = redondeo((mín+máx)/2)`, `Larga = máx`.
- El preset activo se resalta si el valor actual coincide.
- El resumen de abajo se recalcula en vivo. Nunca mostrar decimales.

**Al cambiar de jugadores** (el caso que rompe todo si no se maneja):

- Se recalcula `max`.
- Si el valor actual excede el nuevo máximo, se hace **clamp** y se muestra un aviso inline, no un modal:
  `Con 4 jugadores el máximo es 13 cartas. Te dejamos en 13.`
- Nunca se cambia el valor en silencio, y nunca se deja el slider en un estado inválido.

---

## A.4 Validación

Se ejecuta en cliente para la UI y **otra vez en el servidor** al crear la sala. El servidor nunca confía en el cliente: hay plata de por medio.

```ts
export type SalaConfig = {
  entradaUSDT: 0.10 | 0.50 | 1;
  jugadores: 2 | 3 | 4;
  cartasPorJugador: number;
};

export function clampCartas(cartas: number, jugadores: number): number {
  return Math.min(Math.max(cartas, CARTAS_MIN), maxCartasPorJugador(jugadores));
}

export function validarConfig(c: SalaConfig): { ok: true } | { ok: false; error: string } {
  if (c.jugadores < JUGADORES_MIN || c.jugadores > JUGADORES_MAX)
    return { ok: false, error: 'La sala es de 2 a 4 jugadores.' };

  if (!Number.isInteger(c.cartasPorJugador))
    return { ok: false, error: 'Las cartas por jugador deben ser un número entero.' };

  if (c.cartasPorJugador < CARTAS_MIN)
    return { ok: false, error: `Mínimo ${CARTAS_MIN} cartas por jugador.` };

  const max = maxCartasPorJugador(c.jugadores);
  if (c.cartasPorJugador > max)
    return { ok: false, error: `Con ${c.jugadores} jugadores el máximo es ${max} cartas.` };

  return { ok: true };
}

export function resumenReparto(c: SalaConfig) {
  const repartidas = c.jugadores * c.cartasPorJugador;
  return {
    repartidas,
    base: 1,
    enJuego: repartidas + 1,
    reserva: MAZO_TOTAL - repartidas - 1,
    duracionEstimadaSeg: repartidas * SEG_POR_CARTA,
  };
}
```

---

## A.5 Algoritmo de reparto

1. El **servidor** genera una `seed` criptográfica y la guarda con la partida.
2. Baraja el mazo con Fisher-Yates alimentado por un PRNG sembrado con esa `seed` (determinista y auditable).
3. Reparte **round-robin, una carta a la vez**: `for i in 0..cartas-1 → for cada jugador en orden de turno`. No repartir en bloques.
4. Voltea la **base compartida** desde el tope de la reserva. Si sale una carta especial, se devuelve a una posición aleatoria y se voltea otra (máx. 10 intentos; al 11º se acepta tal cual).
5. Lo que queda es la **reserva** para castigos.
6. El **orden de turnos** se deriva de la misma `seed` y se muestra en la sala antes de arrancar.

---

## A.6 Integridad (esto importa porque hay USDT)

- La barajada y el reparto ocurren **solo en el servidor**. Nunca en el cliente.
- A cada cliente se le manda **únicamente su mano**, la base y el *conteo* de la reserva. Jamás las manos ajenas, ni siquiera ocultas en el payload.
- La `seed` se guarda y se puede publicar al terminar la partida, para que cualquiera pueda reproducir el reparto y verificar que no hubo trampa.
- La configuración de la sala se **congela** en el momento en que el primer jugador distinto al anfitrión confirma y paga. Después de eso el anfitrión no puede cambiar entrada, jugadores ni cartas.

**Reserva agotada a mitad de partida:** se toma el descarte menos la carta de arriba, se baraja con la continuación del mismo stream del PRNG, y pasa a ser la nueva reserva. Se registra el evento.

---

## A.7 Copy

| Elemento | Texto |
|---|---|
| Sección | `Cartas por jugador` |
| Extremos del slider | `mín 10` · `máx {max}` |
| Presets | `Rápida {min}` · `Media {mid}` · `Larga {max}` |
| Resumen | `Se reparten {n}` · `Base compartida 1` · `En juego (tope 55) {n+1}` · `Dura aprox. {m} min` |
| Clamp | `Con {j} jugadores el máximo es {max} cartas. Te dejamos en {max}.` |
| Error servidor | `Con {j} jugadores el máximo es {max} cartas.` |

Se elimina: `Rápida 10 c/u` / `Completa 27 c/u` como toggle, y el texto `A cada uno le tocan 27 cartas, más una base compartida...` (esa explicación se mueve a "Cómo se juega").

---

## A.8 Casos borde / QA

- [ ] Con 4 jugadores el slider no pasa de 13; con 3, de 18; con 2, de 27
- [ ] Ningún camino permite bajar de 10 cartas
- [ ] Elegir 27 con 2 jugadores y luego cambiar a 4 → baja a 13 y muestra el aviso
- [ ] Elegir 10 con 4 jugadores y luego cambiar a 2 → **se queda en 10** (no sube solo)
- [ ] `cartasPorJugador` es siempre entero; el resumen nunca muestra decimales
- [ ] Los presets se re-etiquetan al cambiar el número de jugadores
- [ ] Las opciones 2, 3 y 4 están habilitadas en los tres caminos (adiós "Próximamente")
- [ ] Un request manipulado con `cartasPorJugador: 40` y 4 jugadores es rechazado por el servidor
- [ ] Ningún payload al cliente contiene las manos de los otros jugadores
- [ ] `jugadores × cartas + 1 ≤ 55` en todas las combinaciones válidas
- [ ] Queda al menos `RESERVA_MIN` en la reserva después de repartir
- [ ] Con la sala ya pagada por otro jugador, el anfitrión no puede editar la config
- [ ] Dos partidas con la misma seed producen el mismo reparto

---

## A.9 Prompt para Claude Code

```
Implementa el control de "Cartas por jugador" según el Anexo A.

1. Habilita 2, 3 y 4 jugadores de verdad. Quita todo estado "Próximamente".

2. Reemplaza el toggle "Cuánto dura: Rápida/Completa" por un control de
   cartas por jugador: slider (step 1) + botones − / + + tres presets
   que muestran su número y se re-etiquetan según los jugadores.

3. Implementa las constantes y funciones puras de A.1, A.2 y A.4 en un
   módulo compartido entre cliente y servidor. El servidor valida otra
   vez; nunca confía en el cliente.

4. Al cambiar el número de jugadores, haz clamp del valor de cartas al
   nuevo máximo y muestra el aviso inline de A.7. Nunca cambies el valor
   en silencio.

5. Muestra el resumen en vivo: repartidas, base, en juego, duración
   estimada. Todos los números redondeados a entero.

6. Reparto en el servidor con seed guardada, Fisher-Yates sembrado y
   round-robin de una carta a la vez (A.5). A cada cliente solo se le
   manda su propia mano.

7. Congela la configuración cuando el primer jugador distinto al
   anfitrión confirma el pago.

MAZO_TOTAL y RESERVA_MIN están marcados con ⚠️ en A.0: pídeme el valor
real antes de asumir uno.

Verifica cada punto del checklist A.8 al terminar.
```
