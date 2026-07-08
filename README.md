# Avíspate Visual ⚡

Juego de agilidad visual inspirado en cartas circulares con símbolos comunes.
Las cartas fluyen en cadena continua: una carta base y una carta nueva, con
**exactamente un símbolo en común** entre ambas. Al tocarlo, la carta nueva
pasa a ser la base (con animación), la vieja sale de pantalla y entra otra del
mazo. Así hasta que se acaba el tiempo.

MVP individual: sin login, sin backend, sin pagos. El ranking se guarda en
`localStorage` del navegador (`visualRushLeaderboard_v1`, top 20).

## Cómo correrlo

```bash
npm install
npm run dev
```

Abrir <http://localhost:3000/visual-rush> (la raíz `/` redirige ahí).

## Reglas

- Partida contrarreloj: 60s por defecto (selector de 30 / 60 / 90 al inicio).
- Acierto: +100 puntos + bono de combo (+10 por cada acierto seguido extra),
  y la cadena avanza a la siguiente carta.
- Error: −20 puntos, se pierde el combo y la carta tiembla; se puede seguir
  intentando.
- Al final: puntaje, cartas acertadas, errores, precisión, mejor combo y
  mejor marca personal.
- Ranking ordenado por puntos; en empate gana mayor precisión y luego más
  cartas acertadas.

## Estructura

- `app/visual-rush/page.tsx` — ruta del juego.
- `components/` — `GameShell` (orquestador), `PlayerForm`, `CardView`,
  `SymbolButton`, `GameHUD`, `ResultsPanel`, `LocalLeaderboard`.
- `lib/symbols.ts` — banco de 48 símbolos (emojis propios).
- `lib/game.ts` — generación de la cadena de cartas, reglas y puntaje.
- `lib/leaderboard.ts` — persistencia del ranking en localStorage.

## Siguiente fase (según el brief)

- Modo versus local (dos jugadores alternándose en el mismo celular).
- Niveles: fácil (6 símbolos), normal (8), difícil (10).
- Backend/Supabase para ranking real entre usuarios.
- Modo diario con el mismo set de rondas para todos.
- Algoritmo tipo plano proyectivo (mazo Dobble completo).
