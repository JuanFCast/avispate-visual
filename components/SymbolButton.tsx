"use client";

import type { PlacedSymbol } from "@/lib/game";
import { SYMBOL_BY_ID } from "@/lib/symbols";

interface Props {
  placed: PlacedSymbol;
  flash: "good" | "bad" | null;
  disabled: boolean;
  onTap: (symbolId: string) => void;
}

export default function SymbolButton({ placed, flash, disabled, onTap }: Props) {
  const symbol = SYMBOL_BY_ID[placed.symbolId];
  const flashClass =
    flash === "good" ? " flash-good" : flash === "bad" ? " flash-bad" : "";

  return (
    <button
      type="button"
      className={`symbol-btn${flashClass}`}
      style={{ left: `${placed.x}%`, top: `${placed.y}%` }}
      onPointerDown={() => !disabled && onTap(placed.symbolId)}
      onKeyDown={(e) => {
        // Enter/Espacio activan por teclado sin duplicar el toque de puntero.
        if (disabled || e.repeat) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap(placed.symbolId);
        }
      }}
      tabIndex={disabled ? -1 : undefined}
      aria-label={symbol.label}
    >
      <span
        className="symbol-emoji"
        style={{
          transform: `rotate(${placed.rotation}deg) scale(${placed.scale})`,
        }}
      >
        {symbol.emoji}
      </span>
    </button>
  );
}
