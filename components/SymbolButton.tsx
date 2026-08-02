"use client";

import type { PlacedSymbol } from "@/lib/game";
import { SYMBOL_BY_ID } from "@/lib/symbols";
import { useI18n } from "@/lib/i18n/client";

interface Props {
  placed: PlacedSymbol;
  /**
   * `late` es de la Arena: acertaste, pero otro cambió la base antes de que tu
   * toque aterrizara. No es un acierto y tampoco es un error, así que no puede
   * pintarse como ninguno de los dos.
   */
  flash: "good" | "bad" | "late" | null;
  disabled: boolean;
  onTap: (symbolId: string) => void;
}

const FLASH_CLASS = {
  good: " flash-good",
  bad: " flash-bad",
  late: " flash-late",
} as const;

export default function SymbolButton({ placed, flash, disabled, onTap }: Props) {
  const { lang } = useI18n();
  const symbol = SYMBOL_BY_ID[placed.symbolId];
  const flashClass = flash ? FLASH_CLASS[flash] : "";

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
      aria-label={symbol.label[lang]}
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
