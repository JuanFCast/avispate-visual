# Avíspate Visual ⚡

Juego de agilidad visual inspirado en cartas circulares con símbolos comunes.
Tienes un mazo de cartas y una carta base de referencia (que no se toca). Tu
carta y la base comparten **exactamente un símbolo**: encuéntralo en tu carta
y tócalo. Tu carta pasa a ser la nueva base (con animación), la vieja sale de
pantalla y entra la siguiente del mazo. Gana quien gaste todo el mazo en el
menor tiempo.

MVP individual: sin login, sin backend, sin pagos. El ranking se guarda en
`localStorage` del navegador (`visualRushLeaderboard_v1`, top 20).

## Cómo correrlo

```bash
npm install
npm run dev
```

Abrir <http://localhost:3000/visual-rush> (la raíz `/` redirige ahí).

## Reglas

- Mazo de 10 cartas por defecto (selector de 10 / 15 / 20 al inicio).
- El cronómetro corre hacia arriba desde la primera carta.
- Solo se toca **tu carta** (la de abajo/derecha); la base es de referencia.
- Acierto: tu carta se convierte en la base y sale la siguiente del mazo.
- Error: +1 segundo de penalización y la carta tiembla; puedes seguir
  intentando.
- Al final: tiempo total, promedio por carta, errores, precisión y mejor
  marca personal.
- Distractores con trampa: la carta nueva se llena de símbolos del mismo
  color y categoría que el objetivo (si el común es la manzana, aparecen
  cosas rojas y comidas).
- Sonido generado con WebAudio (sin archivos): acierto, error, reparto,
  cuenta regresiva y fanfarria final. Botón 🔊/🔇 con preferencia guardada.
- Ranking ordenado por menor tiempo promedio por carta (comparable entre
  mazos de distinto tamaño); en empate, menos errores.

## Estructura

- `app/visual-rush/page.tsx` — ruta del juego.
- `components/` — `GameShell` (orquestador), `PlayerForm`, `CardView`,
  `SymbolButton`, `GameHUD`, `ResultsPanel`, `LocalLeaderboard`.
- `lib/symbols.ts` — banco de 59 símbolos (emojis propios) con color y
  categoría.
- `lib/game.ts` — generación de la cadena con distractores parecidos al
  objetivo, reglas y puntaje.
- `lib/sound.ts` — efectos de sonido WebAudio y toggle de silencio.
- `lib/leaderboard.ts` — persistencia del ranking en localStorage.

## Siguiente fase (según el brief)

- Modo versus local (dos jugadores alternándose en el mismo celular).
- Niveles: fácil (6 símbolos), normal (8), difícil (10).
- Backend/Supabase para ranking real entre usuarios.
- Modo diario con el mismo set de rondas para todos.
- Algoritmo tipo plano proyectivo (mazo Dobble completo).
