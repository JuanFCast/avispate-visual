import GameShell from "@/components/GameShell";

/**
 * El juego vive en la raíz: avispate.fun ES Avíspate, no una puerta que
 * redirige a otra parte. La ruta vieja /visual-rush sigue funcionando con un
 * redirect permanente (next.config.mjs) para no romper enlaces compartidos.
 */
export default function Home() {
  return <GameShell />;
}
