const { ethers } = require("hardhat");

/**
 * Despliegue de AvispateArena, el escrow de las mesas con entrada.
 *
 * Se configura por variables de entorno (en `contracts/.env`):
 *
 *   USDT_ADDRESS       token de las entradas y del premio (INMUTABLE)
 *   COMMISSION_WALLET  quién recibe la comisión de la casa
 *   OPERATOR_ADDRESS   bot que liquida las mesas
 *   COMMISSION_BPS     comisión sobre el pozo (2000 = 20%)
 *   SETTLE_TIMEOUT     segundos antes de poder anular una mesa llena sin pagar
 *   OPEN_TIMEOUT       segundos antes de poder anular una mesa que no se llenó
 *   OWNER_ADDRESS      quién manda en el contrato (NO se toma del deployer)
 *
 * Este script comprueba MÁS de lo que parece necesario, y es a propósito. Un
 * contrato desplegado no se corrige: si el token va mal, las entradas se cobran
 * en una moneda equivocada y no hay parche posible; si el operator va mal, no
 * hay quien pague a los ganadores. Todo lo que se puede comprobar antes de
 * firmar cuesta segundos, y lo que se descubre después cuesta desplegar otro
 * contrato y mudar las mesas.
 *
 * Correr:  npx hardhat run scripts/deploy-arena.js --network celo
 */

/** Segundos. Los valores acordados el 2026-08-07. */
const DEFAULT_SETTLE_TIMEOUT = 24 * 60 * 60; // 24 h
const DEFAULT_OPEN_TIMEOUT = 2 * 60 * 60; // 2 h

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

function requireAddress(name, value) {
  if (!value) throw new Error(`Falta ${name} en el entorno.`);
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} no es una dirección válida: ${value}`);
  }
  if (value === ethers.ZeroAddress) {
    throw new Error(`${name} no puede ser la dirección cero.`);
  }
  return ethers.getAddress(value);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  const usdt = requireAddress("USDT_ADDRESS", process.env.USDT_ADDRESS);
  const commissionWallet = requireAddress(
    "COMMISSION_WALLET",
    process.env.COMMISSION_WALLET
  );
  const operator = requireAddress(
    "OPERATOR_ADDRESS",
    process.env.OPERATOR_ADDRESS
  );
  /**
   * Obligatorio y explícito. No cae por defecto en el deployer a propósito: si
   * cayera, el dueño del contrato dependería de con qué llave se firmó, que es
   * cosa de la máquina y del apuro, y no de una decisión revisada.
   */
  const owner = requireAddress("OWNER_ADDRESS", process.env.OWNER_ADDRESS);
  const commissionBps = Number(process.env.COMMISSION_BPS || "2000");
  const settleTimeout = Number(
    process.env.SETTLE_TIMEOUT || DEFAULT_SETTLE_TIMEOUT
  );
  const openTimeout = Number(process.env.OPEN_TIMEOUT || DEFAULT_OPEN_TIMEOUT);

  if (!Number.isInteger(commissionBps) || commissionBps > 10_000) {
    throw new Error(`COMMISSION_BPS fuera de rango: ${commissionBps}`);
  }
  /**
   * Un plazo más corto que una partida convertiría la válvula de devoluciones
   * en una salida de emergencia para perdedores: bastaría con aguantar sin
   * liquidar para recuperar la entrada. Una partida dura minutos.
   */
  if (settleTimeout < 3600) {
    throw new Error(
      `SETTLE_TIMEOUT demasiado corto (${settleTimeout}s). Mínimo una hora, y lo acordado son 24.`
    );
  }
  if (openTimeout < 600) {
    throw new Error(`OPEN_TIMEOUT demasiado corto (${openTimeout}s).`);
  }

  // El token es INMUTABLE en el contrato: esta es la única oportunidad de
  // descubrir que la dirección no es la que creíamos.
  const token = new ethers.Contract(usdt, ERC20_ABI, ethers.provider);
  let symbol;
  let decimals;
  try {
    [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
  } catch {
    throw new Error(
      `USDT_ADDRESS (${usdt}) no responde como un ERC-20. ¿Es la dirección correcta y estás en la red correcta?`
    );
  }
  if (Number(decimals) !== 6) {
    throw new Error(
      `El token tiene ${decimals} decimales y las entradas están escritas para 6 (0.10 USDT = 100000). Revisa la dirección.`
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("─────────────────────────────────────────────");
  console.log("Red:               ", net.name, `(chainId ${net.chainId})`);
  console.log("Deployer (firma):  ", deployer.address);
  console.log("Owner (manda):     ", owner);
  console.log("Saldo del deployer:", ethers.formatEther(balance), "CELO");
  console.log("Token:             ", usdt, `(${symbol}, ${decimals} decimales)`);
  console.log("Comisión a:        ", commissionWallet);
  console.log("Operator:          ", operator);
  console.log("Comisión:          ", `${commissionBps / 100}%`);
  console.log("Plazo sin liquidar:", `${settleTimeout}s (${settleTimeout / 3600} h)`);
  console.log("Plazo sin llenar:  ", `${openTimeout}s (${openTimeout / 3600} h)`);
  console.log("─────────────────────────────────────────────");

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    // No es un error: es justo lo que este parámetro permite. Pero se avisa,
    // porque desplegar con una llave y dejar el mando en otra dirección tiene
    // que ser algo que se lee en pantalla, no algo que se descubre después.
    console.log(
      "ℹ️  El owner NO es quien despliega. Intencional: revísalo igualmente."
    );
  }

  if (net.chainId !== 42220n) {
    console.log("⚠️  No estás en Celo mainnet (42220).");
  }
  if (balance === 0n) {
    throw new Error("El deployer no tiene CELO para la tarifa de red.");
  }

  const Arena = await ethers.getContractFactory("AvispateArena");
  const arena = await Arena.deploy(
    usdt,
    commissionWallet,
    operator,
    commissionBps,
    settleTimeout,
    openTimeout,
    owner
  );
  await arena.waitForDeployment();
  const address = await arena.getAddress();

  // Releer del contrato lo que acabamos de escribir. Si algo no cuadra hay que
  // saberlo AHORA, no el día que alguien pague una entrada.
  const [onToken, onCommission, onOperator, onBps, onSettle, onOpen, onOwner] =
    await Promise.all([
      arena.token(),
      arena.commissionWallet(),
      arena.operator(),
      arena.commissionBps(),
      arena.settleTimeout(),
      arena.openTimeout(),
      arena.owner(),
    ]);

  const checks = [
    ["token", onToken, usdt],
    ["commissionWallet", onCommission, commissionWallet],
    ["operator", onOperator, operator],
    ["commissionBps", String(onBps), String(commissionBps)],
    ["settleTimeout", String(onSettle), String(settleTimeout)],
    ["openTimeout", String(onOpen), String(openTimeout)],
    ["owner", onOwner, owner],
  ];
  const wrong = checks.filter(
    ([, got, want]) => String(got).toLowerCase() !== String(want).toLowerCase()
  );

  console.log("\n✅ AvispateArena desplegado en:", address);
  for (const [name, got] of checks) console.log(`   ${name}:`, got);

  if (wrong.length > 0) {
    console.error("\n❌ El contrato NO quedó como se pidió:");
    for (const [name, got, want] of wrong) {
      console.error(`   ${name}: esperado ${want}, quedó ${got}`);
    }
    throw new Error("Despliegue verificado con diferencias. NO lo uses.");
  }

  console.log("\nSiguiente:");
  console.log("  1. Verificar el código:");
  console.log(
    `     npx hardhat verify --network celo ${address} ${usdt} ${commissionWallet} ${operator} ${commissionBps} ${settleTimeout} ${openTimeout} ${owner}`
  );
  console.log("  2. Poner la dirección en .env.local y en Vercel (Production):");
  console.log(`     NEXT_PUBLIC_AVISPATE_ARENA_ADDRESS=${address}`);
  console.log(
    "     Ojo: desde ese momento las salas NUEVAS nacen pagas. Las que ya\n" +
      "     existen siguen gratis para siempre."
  );
  console.log("  3. Programar /api/cron/arena-settle en GitHub Actions.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
