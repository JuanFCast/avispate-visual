"use client";

import type { PlacedSymbol } from "@/lib/game";
import SymbolButton from "./SymbolButton";

interface Props {
  symbols: PlacedSymbol[];
  /** Símbolo que debe destellar en esta carta, si alguno. */
  flashSymbolId: string | null;
  flashType: "good" | "bad" | null;
  shake: boolean;
  disabled: boolean;
  onTap: (symbolId: string) => void;
}

export default function CardView({
  symbols,
  flashSymbolId,
  flashType,
  shake,
  disabled,
  onTap,
}: Props) {
  return (
    <div className={`card-circle${shake ? " shake" : ""}`}>
      {symbols.map((placed) => (
        <SymbolButton
          key={placed.symbolId}
          placed={placed}
          flash={placed.symbolId === flashSymbolId ? flashType : null}
          disabled={disabled}
          onTap={onTap}
        />
      ))}
    </div>
  );
}
