"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useProfile, type ProfileDebugSnapshot } from "@/lib/profile-context";
import { shortAddress, useActiveWallet } from "@/lib/wallet";

/**
 * PANEL DE DIAGNÓSTICO — TEMPORAL, SE BORRA AL CERRAR EL CASO.
 *
 * Existe para una sola pregunta: cuando el lobby se queda en "Comprobando tu
 * perfil… / Comprobando tu entrada… / Preparando…", ¿QUÉ estado exacto es el
 * que no avanza? Se llegó aquí después de varios arreglos por hipótesis que
 * no dieron; esto sustituye la hipótesis por una lectura.
 *
 * ── Qué NO enseña, y es deliberado ────────────────────────────────────────
 *
 * Ni tokens, ni cookies, ni claves, ni la dirección completa. Solo estados
 * booleanos, códigos HTTP y contadores. Las direcciones salen abreviadas por
 * `shortAddress`, igual que en el resto de la app, y de la sesión de wallet
 * solo se dice SÍ/NO — nunca su contenido.
 *
 * ── Y por qué no persiste ─────────────────────────────────────────────────
 *
 * Se enciende solo con `?debugProfile=1` en la URL y no escribe nada en
 * ningún sitio: quitar el parámetro lo apaga, y no queda rastro que pueda
 * dejarlo encendido para otra persona.
 *
 * El sondeo va por intervalo y NO por estado del proveedor a propósito: si
 * este panel se re-renderizara con cada cambio del perfil, sería parte del
 * ciclo que intenta medir. Así solo mira.
 */
const POLL_MS = 300;

function Fila({
  k,
  v,
  alarma,
}: {
  k: string;
  v: string | number | boolean;
  /** Resalta el valor cuando es justo el que estamos cazando. */
  alarma?: boolean;
}) {
  const texto = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "1px 0",
      }}
    >
      <span style={{ opacity: 0.7 }}>{k}</span>
      <span
        style={{
          fontWeight: 700,
          color: alarma ? "#ff6b6b" : "#8ef58e",
          whiteSpace: "nowrap",
        }}
      >
        {texto}
      </span>
    </div>
  );
}

export default function ProfileDebugPanel() {
  const privy = usePrivy();
  const profile = useProfile();
  const activa = useActiveWallet();
  const cuenta = useAccount();

  const [snap, setSnap] = useState<ProfileDebugSnapshot | null>(null);
  const [t, setT] = useState(0);

  useEffect(() => {
    const arranque = Date.now();
    const id = setInterval(() => {
      setSnap(profile.readDebug());
      setT(Math.round((Date.now() - arranque) / 1000));
    }, POLL_MS);
    return () => clearInterval(id);
  }, [profile]);

  // El congelamiento tiene una firma concreta: sigue "cargando" pasados los
  // topes (8s token + 12s perfil + 2s de margen) sin haberse asentado.
  const congelado = profile.loading && t > 22;

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        left: 8,
        zIndex: 99999,
        maxWidth: 320,
        padding: "10px 12px",
        borderRadius: 10,
        border: `2px solid ${congelado ? "#ff6b6b" : "#444"}`,
        background: "rgba(12,12,14,0.94)",
        color: "#e8e8e8",
        font: "11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
        pointerEvents: "none",
      }}
      role="status"
      aria-label="Diagnóstico de perfil"
    >
      <div style={{ fontWeight: 800, marginBottom: 6, letterSpacing: 0.3 }}>
        debugProfile · {t}s {congelado ? "· CONGELADO" : ""}
      </div>

      <Fila k="privy.ready" v={privy.ready} alarma={!privy.ready} />
      <Fila k="privy.authenticated" v={privy.authenticated} />

      <div style={{ height: 6 }} />
      <Fila k="profile.ready" v={profile.ready} alarma={!profile.ready} />
      <Fila k="profile.authenticated" v={profile.authenticated} />
      <Fila k="profile.loading (derivado)" v={profile.loading} alarma={profile.loading} />
      <Fila k="state.loading (crudo)" v={snap?.rawLoading ?? "—"} />
      <Fila k="profile.fetched" v={profile.fetched} alarma={!profile.fetched} />
      <Fila k="profile.failed" v={profile.failed} />
      <Fila
        k="profile.walletAddress"
        v={profile.walletAddress ? shortAddress(profile.walletAddress) : "null"}
      />

      <div style={{ height: 6 }} />
      <Fila
        k="useAccount().address"
        v={cuenta.address ? shortAddress(cuenta.address) : "null"}
      />
      <Fila k="isConnected" v={cuenta.isConnected} />
      <Fila k="wagmi status" v={cuenta.status} />
      <Fila k="reconnecting" v={activa.reconnecting} alarma={activa.reconnecting} />

      <div style={{ height: 6 }} />
      <Fila k="/api/profile" v={snap?.lastFetch ?? "—"} />
      <Fila k="token" v={snap?.lastToken ?? "—"} />
      <Fila k="ultimo publish" v={snap?.lastPublish ?? "—"} />
      <Fila
        k="descartados por gate"
        v={snap?.discarded ?? "—"}
        alarma={(snap?.discarded ?? 0) > 0}
      />
      <Fila
        k="refresh() ejecutado"
        v={snap?.refreshCount ?? "—"}
        alarma={(snap?.refreshCount ?? 0) > 12}
      />
      <Fila k="sequenceGate" v={snap?.sequence ?? "—"} />
      <Fila k="sesion wallet guardada" v={snap?.walletSession ?? "—"} />
    </div>
  );
}
