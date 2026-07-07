# Avíspate Visual ⚡

Juego de agilidad visual inspirado en cartas circulares con símbolos comunes.
En cada ronda aparecen dos cartas con 8 símbolos cada una; entre ambas hay
**exactamente un símbolo en común** y hay que tocarlo lo más rápido posible.

MVP individual: sin login, sin backend, sin pagos. El ranking se guarda en
`localStorage` del navegador (`visualRushLeaderboard_v1`, top 20).

## Cómo correrlo

```bash
npm install
npm run dev
```

Abrir <http://localhost:3000/visual-rush> (la raíz `/` redirige ahí).

## Reglas

- 10 rondas por defecto (selector de 10 / 15 / 20 en la pantalla de inicio).
- Acierto: +100 puntos y avanza de ronda.
- Error: −20 puntos, +1 segundo de penalización, y puede seguir intentando.
- Puntaje final: `max(0, 1000 − promedioMs/10 − errores×50 + rachaMax×25)`.
- Ranking ordenado por puntos; en empate gana el menor tiempo promedio.

## Estructura

- `app/visual-rush/page.tsx` — ruta del juego.
- `components/` — `GameShell` (orquestador), `PlayerForm`, `CardView`,
  `SymbolButton`, `GameHUD`, `ResultsPanel`, `LocalLeaderboard`.
- `lib/symbols.ts` — banco de 48 símbolos (emojis propios).
- `lib/game.ts` — generación de rondas, reglas y puntaje.
- `lib/leaderboard.ts` — persistencia del ranking en localStorage.

## Siguiente fase (según el brief)

- Modo versus local (dos jugadores alternándose en el mismo celular).
- Niveles: fácil (6 símbolos), normal (8), difícil (10).
- Backend/Supabase para ranking real entre usuarios.
- Modo diario con el mismo set de rondas para todos.
- Algoritmo tipo plano proyectivo (mazo Dobble completo).
