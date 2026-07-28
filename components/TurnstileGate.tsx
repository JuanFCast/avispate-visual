"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/client";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: { sitekey: string; callback: (token: string) => void }
  ) => string;
  remove: (id: string) => void;
}

/** Otra dependencia ya declara window.turnstile con otro tipo: cast local. */
function getTurnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

/**
 * Captcha visible de Cloudflare Turnstile para el welcome gas. Solo se monta
 * cuando el servidor pidió captcha (dirección nueva) y hay site key. Visible
 * y no invisible a propósito: el modo invisible rechaza demasiados usuarios
 * legítimos de LATAM (lección aprendida por nerdos.fun).
 */
export default function TurnstileGate({
  onToken,
}: {
  onToken: (token: string) => void;
}) {
  const t = useT();
  const slotRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;

    function renderWidget() {
      const ts = getTurnstile();
      if (cancelled || !slotRef.current || !ts) return;
      if (widgetRef.current) return;
      widgetRef.current = ts.render(slotRef.current, {
        sitekey: SITE_KEY,
        callback: onToken,
      });
    }

    if (getTurnstile()) {
      renderWidget();
    } else {
      let script = document.querySelector<HTMLScriptElement>(
        `script[src="${SCRIPT_SRC}"]`
      );
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderWidget);
    }

    return () => {
      cancelled = true;
      const ts = getTurnstile();
      if (widgetRef.current && ts) {
        ts.remove(widgetRef.current);
        widgetRef.current = null;
      }
    };
  }, [onToken]);

  if (!SITE_KEY) return null;

  return (
    <div
      className="turnstile-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("turnstile.aria")}
    >
      <div className="turnstile-panel">
        <p className="turnstile-text">{t("turnstile.text")}</p>
        <div ref={slotRef} />
      </div>
    </div>
  );
}
