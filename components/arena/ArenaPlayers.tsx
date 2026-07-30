/**
 * Ilustración de la Arena: cuatro jugadores (dos y dos) con su carta en la
 * mano y el pozo de fichas en el centro. Es dibujo, no dato: va con
 * `aria-hidden` porque la frase de al lado ya dice lo que pasa aquí.
 *
 * Sin dependencias ni imágenes: formas planas con los colores de la marca,
 * así escala en cualquier ancho y no añade una descarga al lobby.
 */

/** Un jugador: cabeza, cuerpo y su carta. `flip` lo pone mirando al centro. */
function Player({
  x,
  color,
  flip,
}: {
  x: number;
  color: string;
  flip?: boolean;
}) {
  const cardX = flip ? x - 34 : x + 16;
  return (
    <g transform={`translate(${x} 0)`}>
      {/* Carta en la mano, ligeramente inclinada hacia el centro. */}
      <rect
        x={cardX - x}
        y={54}
        width={18}
        height={24}
        rx={4}
        fill="var(--white)"
        stroke="var(--ink)"
        strokeWidth={2.5}
        transform={`rotate(${flip ? 10 : -10} ${cardX - x + 9} 66)`}
      />
      <circle
        cx={0}
        cy={38}
        r={12}
        fill={color}
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
      <path
        d="M -17 100 L -17 70 A 17 17 0 0 1 17 70 L 17 100 Z"
        fill={color}
        stroke="var(--ink)"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    </g>
  );
}

export default function ArenaPlayers() {
  return (
    <svg
      className="arena-illustration"
      viewBox="0 0 320 116"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {/* Equipo de la izquierda y de la derecha, mirando al pozo. */}
      <Player x={34} color="var(--cyan)" />
      <Player x={88} color="var(--cyan-soft)" />
      <Player x={232} color="var(--yellow-soft)" flip />
      <Player x={286} color="var(--yellow)" flip />

      {/* El pozo: tres fichas apiladas en el centro de la mesa. */}
      <g>
        <ellipse
          cx={160}
          cy={92}
          rx={30}
          ry={10}
          fill="var(--yellow-press)"
          stroke="var(--ink)"
          strokeWidth={2.5}
        />
        <ellipse
          cx={160}
          cy={80}
          rx={30}
          ry={10}
          fill="var(--yellow)"
          stroke="var(--ink)"
          strokeWidth={2.5}
        />
        <ellipse
          cx={160}
          cy={68}
          rx={30}
          ry={10}
          fill="var(--yellow)"
          stroke="var(--ink)"
          strokeWidth={2.5}
        />
        {/* Chispa del premio, encima del pozo. */}
        <path
          d="M160 14 L165.5 28.5 L180 34 L165.5 39.5 L160 54 L154.5 39.5 L140 34 L154.5 28.5 Z"
          fill="var(--yellow)"
          stroke="var(--ink)"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
