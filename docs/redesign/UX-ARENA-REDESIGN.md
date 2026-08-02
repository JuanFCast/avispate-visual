# Rediseño UX — Flujo de Arena multijugador

> **Alcance:** solo estructura de navegación y copy. **No tocar** paleta, tipografía ni estilo de componentes: el diseño visual se queda como está.

---

## 1. Problema

El flujo pide la misma decisión dos veces y la misma configuración dos veces:

1. El usuario elige **Partida rápida / Sala privada** y configura entrada + jugadores.
2. En la pantalla siguiente vuelve a elegir **Crear sala / Unirme con código** y vuelve a configurar entrada + jugadores + duración.
3. Si termina uniéndose con un código, todo lo que configuró se descarta ("Su mesa, su configuración").

**Fix:** aplanar la decisión a un solo nivel con 3 opciones, y configurar una sola vez, cuando esa configuración le sirve a alguien.

**Regla que ordena todo:** solo configura el que arma la sala. El que se une no configura, acepta.

---

## 2. Bugs de UX a corregir

| # | Qué pasa | Fix |
|---|---|---|
| P1 | Decisión anidada en 2 niveles para 3 caminos | 3 opciones en un solo nivel |
| P2 | `Entrada` y `Jugadores` en dos pantallas | Una sola pantalla de config por recorrido |
| P3 | 3/4 jugadores habilitados en Arena, "Próximamente" en Sala privada | Habilitar 2–4 de verdad en todos los caminos |
| P4 | "Jugadores en la mesa" vs "Jugadores máximo" | Un solo label: `Jugadores` |
| P5 | "Cuánto dura" solo existe en sala privada | Se reemplaza por `Cartas por jugador`, presente en los dos modos |
| P6 | CTA "Crear o entrar a una sala" | Se elimina; un botón = una acción |
| P7 | Config que se descarta al unirse con código | No pedir config antes de saber si sirve |
| P8 | Resumen del pozo 2 veces antes de pagar | Máx. 2 apariciones: config (estimado) + sala (real) |
| P9 | Placeholder `AVP-0000` con ayuda "solo los 4 dígitos" | Prefijo `AVP-` fijo dentro del input |
| P10 | CTA "Ver la sala" para unirse | `Buscar sala` |
| P11 | Badge "PRONTO" sobre una función usable | Quitar, o deshabilitar la tarjeta entera |
| P12 | "sala / mesa / partida / arena" como sinónimos | Aplicar glosario (§6) |
| P13 | Chips de ENTRADAS en Home no son seleccionables | Quitarlos o hacerlos atajo real |

---

## 3. Flujo objetivo

```
Home  →  [Entrar a Arena]
   │
   └── P1  ¿Cómo quieres jugar?   (3 opciones, un solo nivel)
         │
         ├── Partida rápida ─────→ P2 Configurar ──┐
         │                                          │
         ├── Crear sala ─────────→ P2 Configurar ──┤
         │                                          ├──→ P4 SALA (lobby)
         └── Entrar con código ──→ P3 Código ──────┘
```

**P4 es el punto de convergencia** y el **único** lugar de toda la app donde se mueve USDT.

---

## 4. Spec por pantalla

### P1 — ¿Cómo quieres jugar?

- Título: `Arena multijugador` · Sub: `Compite, vacía tu mazo y llévate el pozo`
- Link: `Cómo se juega`
- **Tres tarjetas tocables completas** (no radio de 44px a la derecha). Tocar = navegar. **Sin botón inferior.**

| Opción | Texto de apoyo | Destino |
|---|---|---|
| ⚡ Partida rápida | Te emparejamos con quien esté disponible. Empieza apenas se llene. | P2 |
| 🔒 Crear sala | Tú defines la sala y compartes un código de 4 dígitos. | P2 |
| 🔑 Entrar con código | Ya tienes el código de un amigo. | P3 |

**No va nada más aquí:** sin entrada, sin jugadores, sin duración, sin pozo.

> *Alternativa si quieren conservar el componente de radio actual:* 3 radios + un solo CTA cuyo texto cambie (`Buscar jugadores` / `Configurar la sala` / `Buscar sala`). Funciona, pero las tarjetas-acción ahorran un tap y un scroll.

### P2 — Configurar la sala

**Un solo componente reutilizado** por Partida rápida y Crear sala. Solo cambian el chip del header y el texto del CTA.

- Header: flecha atrás nativa + chip del modo (`Partida rápida` / `Sala privada`)
- `Entrada por jugador`: 0.10 / 0.50 / 1 USDT
- `Jugadores`: 2 / 3 / 4 — **los tres habilitados de verdad**, sin "Próximamente"
- `Cartas por jugador`: slider + `−`/`+` + presets → **spec completo en `SPEC-CARTAS-Y-REPARTO.md`**
- Resumen del pozo (única aparición previa al pago): Pozo total / Comisión (20%) / Se lleva el ganador
- Nota: `Todavía no se cobra nada. El USDT se descuenta cuando confirmes en la sala.`
- CTA: `Buscar jugadores` (rápida) · `Crear la sala` (privada)

### P3 — Entrar con código

- **Un solo campo.** Prefijo `AVP-` fijo dentro del input (no editable, gris); el usuario escribe 4 dígitos.
- Teclado numérico, autofocus al entrar, aceptar pegado de `AVP-1234` limpiando el prefijo solo.
- **Cero configuración.** Texto de apoyo: `El anfitrión define entrada, jugadores y duración.`
- CTA: `Buscar sala`

| Error | Mensaje | Salida |
|---|---|---|
| No existe | No encontramos esa sala. Revisa los 4 dígitos. | Reintentar |
| Llena | Esa sala ya está llena. | Crear una sala igual |
| Ya empezó | La partida ya arrancó. Pídele al anfitrión que cree otra. | Crear sala |
| Cancelada | El anfitrión canceló esa sala. | Volver a Arena |

### P4 — Sala (convergencia)

Misma pantalla para los 3 caminos. Cambia el **estado**, no la estructura.

**Estados**
- `buscando` (partida rápida): spinner + "Buscando jugadores…" + cancelar
- `esperando` (sala privada): código grande + Copiar + Compartir
- `completa`: todos adentro, confirmar activo

**Contenido fijo**
- Lista de jugadores con estado (`Listo` / `Esperando`)
- Resumen de la sala **en solo lectura**: entrada, jugadores, cartas por jugador, duración estimada
  *(el que se unió con código la ve aquí por primera vez y no la puede editar)*
- Resumen del pozo — este es el que importa, precede al cobro
- CTA principal: `Confirmar y pagar 0.10 USDT` → después: `Listo ✓ · Esperando a los demás`
- Secundario: `Salir de la sala` (aclarar qué pasa con la plata si ya pagó)
- Solo anfitrión: `Cancelar sala`
- **La partida arranca cuando todos confirmaron**, no cuando la sala se llena

---

## 5. Reglas

- **R1** Configura quien crea. El que se une nunca ve controles editables.
- **R2** Un botón, una acción.
- **R3** Mismas opciones y mismos estados en todos los caminos.
- **R4** Resumen del pozo máximo 2 veces: config (estimado) + sala (real).
- **R5** Un solo punto de cobro: P4.
- **R6** Volver va en el header, no como link al final del scroll.
- **R7** "Pronto" solo sobre lo que no se puede tocar.
- **R8** Nada de configuración antes de saber si le sirve a alguien.

---

## 6. Glosario (search & replace en todo el copy)

| Término | Se usa para | Reemplaza a |
|---|---|---|
| **Arena** | La sección de multijugador. No es una partida. | — |
| **Sala** | La instancia de juego, tenga código o no. | mesa, partida, room |
| **Anfitrión** | Quien crea la sala y define su config. | host, creador |
| **Entrada** | Lo que pone cada jugador. | buy-in, apuesta |
| **Pozo** | La suma de las entradas. | premio, bote |
| **Código** | 4 dígitos. Se muestra con prefijo `AVP-`. | PIN, clave |

"Mesa" se puede conservar en copy de marketing, **nunca** en labels, botones ni errores.

---

## 7. Cambios de copy

| Antes | Después |
|---|---|
| Crear o entrar a una sala | *(se elimina — la decisión ya se tomó en P1)* |
| Ver la sala | Buscar sala |
| Solo los 4 dígitos; el AVP- lo ponemos nosotros | `4 dígitos` (con prefijo `AVP-` fijo en el campo) |
| Su mesa, su configuración | El anfitrión define entrada, jugadores y cartas |
| Cuánto dura: Rápida 10 c/u / Completa 27 c/u | Cartas por jugador (slider 10 – máx según jugadores) |
| Jugadores máximo / Jugadores en la mesa | Jugadores |
| Estimado para la mesa que elegiste. Todavía no se cobra nada aquí. | Todavía no se cobra nada. El USDT se descuenta cuando confirmes en la sala. |
| ← Volver a la Arena | *(flecha atrás en el header)* |

---

## 8. Checklist de aceptación

- [ ] Desde Arena, jugar una partida rápida toma máx. 3 taps
- [ ] "sala" significa lo mismo en todas las pantallas; "mesa" no aparece en labels ni botones
- [ ] `Entrada` y `Jugadores` se configuran en una sola pantalla del recorrido
- [ ] Al elegir "Entrar con código" no aparece ningún control de configuración
- [ ] 2, 3 y 4 jugadores están habilitados en los tres caminos
- [ ] El campo de código acepta `AVP-1234` y `1234`, y abre teclado numérico
- [ ] Los 4 errores de código tienen mensaje propio y acción de salida
- [ ] El resumen del pozo aparece máx. 2 veces en todo el recorrido
- [ ] Ningún botón describe dos acciones
- [ ] El USDT solo se descuenta al tocar "Confirmar y pagar" en P4
- [ ] Todas las pantallas tienen flecha atrás en el header
- [ ] El badge "Pronto" no aparece sobre nada usable

---

## 9. Anexo

Jugadores (2–4), tope de 55 cartas, mínimo 10 por jugador, control de cartas y algoritmo de reparto: ver **`SPEC-CARTAS-Y-REPARTO.md`**.
