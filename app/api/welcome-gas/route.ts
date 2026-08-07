import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CELO_TRANSPORT } from "@/lib/chain";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { verifyTurnstile, turnstileEnabled } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

/**
 * POST /api/welcome-gas — regala 0.1 CELO (una sola vez por dirección) a la
 * wallet embebida de Privy de un usuario de correo, para que pueda firmar su
 * primera `play()` on-chain (la jugada gratis también es transacción).
 *
 * Modelo de seguridad (mismo de nerdos.fun): el monto es tan pequeño que el
 * peor abuso vale centavos; la PK por address impide repetir; y cuando las
 * llaves de Turnstile están configuradas, enviar CELO a una dirección nueva
 * exige resolver el captcha (anti-Sybil). El flujo es en dos fases para que
 * los usuarios que ya lo recibieron nunca vean captcha:
 *   1) preflight sin token → si ya existe el registro, 200 y listo;
 *      si es dirección nueva y hay captcha activo, 401 "captcha-required".
 *   2) el cliente resuelve el captcha y repite con turnstileToken.
 */
/**
 * Cuánto se regala. Medido con `scripts/gas-cost.mjs` sobre transacciones
 * reales: a los ~200 gwei que cuesta hoy el gas en Celo, una jugada paga vale
 * ~0.017 CELO y una gratis ~0.0065, así que 0.1 CELO da para unas 6 jugadas
 * pagas o unas 15 gratis. (El comentario viejo decía "cientos de txs": era
 * cierto cuando el gas costaba unos pocos gwei, y dejó de serlo sin que nadie
 * lo notara.)
 *
 * No hace falta más: quien se queda sin CELO sigue jugando pagando la tarifa
 * de red en USDT (CIP-64), que es como juega MiniPay desde el primer día. El
 * regalo solo tiene que alcanzar para las primeras partidas de quien llega sin
 * un peso.
 */
const AIRDROP_AMOUNT_WEI = parseEther("0.1");
/**
 * Saldo a partir del cual se considera que la wallet ya puede firmar sola.
 *
 * Tiene que cubrir varias transacciones, no una: por debajo de eso el jugador
 * se queda a mitad de camino y encima no vuelve a recibir el regalo, porque
 * este endpoint solo entrega una vez por dirección.
 */
const BALANCE_THRESHOLD_WEI = parseEther("0.05");

const ADDR_RE = /^0x[0-9a-f]{40}$/;

export async function POST(req: Request) {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) {
    return NextResponse.json({ error: "no-operator-key" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    address?: string;
    email?: string;
    turnstileToken?: string;
  };
  const address = body.address?.toLowerCase();
  if (!address || !ADDR_RE.test(address)) {
    return NextResponse.json({ error: "invalid-address" }, { status: 400 });
  }

  const db = getSupabaseAdmin();

  // Idempotencia ANTES del captcha: quien ya recibió su gas pasa sin fricción.
  const { data: existing } = await db
    .from("welcome_airdrops")
    .select("address, tx_hash")
    .eq("address", address)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      status: "already-airdropped",
      txHash: existing.tx_hash,
    });
  }

  const pub = createPublicClient({ chain: celo, transport: CELO_TRANSPORT });

  // Si la wallet ya tiene gas (se fondeó sola), registrar centinela y salir.
  try {
    const bal = await pub.getBalance({ address: address as `0x${string}` });
    if (bal >= BALANCE_THRESHOLD_WEI) {
      await db.from("welcome_airdrops").insert({
        address,
        email: body.email ?? null,
        amount_wei: "0",
        tx_hash: null,
      });
      return NextResponse.json({ status: "already-funded" });
    }
  } catch {
    // RPC con hipo: seguimos con el airdrop.
  }

  // De aquí en adelante se gasta CELO en una dirección nueva: aquí es donde
  // el captcha importa (si está configurado).
  if (turnstileEnabled()) {
    if (!body.turnstileToken) {
      return NextResponse.json({ error: "captcha-required" }, { status: 401 });
    }
    const remoteIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    const check = await verifyTurnstile(body.turnstileToken, remoteIp);
    if (!check.ok) {
      console.error(
        `welcome-gas captcha-failed reason=${check.reason} addr=${address}`
      );
      return NextResponse.json(
        { error: "captcha-failed", reason: check.reason },
        { status: 403 }
      );
    }
  }

  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex
  );
  const wallet = createWalletClient({
    account,
    chain: celo,
    transport: CELO_TRANSPORT,
  });

  let txHash: Hex;
  try {
    txHash = await wallet.sendTransaction({
      to: address as `0x${string}`,
      value: AIRDROP_AMOUNT_WEI,
    });
    await pub.waitForTransactionReceipt({ hash: txHash });
  } catch (e) {
    console.error("welcome-gas transfer failed:", e);
    return NextResponse.json({ error: "transfer-failed" }, { status: 500 });
  }

  await db.from("welcome_airdrops").insert({
    address,
    email: body.email ?? null,
    amount_wei: AIRDROP_AMOUNT_WEI.toString(),
    tx_hash: txHash,
  });

  return NextResponse.json({ status: "airdropped", txHash });
}
