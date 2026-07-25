/**
 * Verificación server-side de Cloudflare Turnstile (anti-Sybil del welcome
 * gas). Sin `TURNSTILE_SECRET_KEY` configurada, la verificación se salta y
 * todo pasa: así dev y el arranque sin captcha funcionan; al configurar las
 * llaves (server + NEXT_PUBLIC_TURNSTILE_SITE_KEY) el candado se activa solo.
 */
export async function verifyTurnstile(
  token: string,
  remoteIp?: string
): Promise<{ ok: boolean; reason: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, reason: "not-configured" };

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          response: token,
          ...(remoteIp ? { remoteip: remoteIp } : {}),
        }),
      }
    );
    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (data.success) return { ok: true, reason: "ok" };
    return { ok: false, reason: (data["error-codes"] ?? []).join(",") || "failed" };
  } catch {
    return { ok: false, reason: "verify-unreachable" };
  }
}

/** ¿El captcha está activo? (las dos llaves configuradas). */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}
