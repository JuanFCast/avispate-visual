// Publica el código de un contrato en Sourcify usando su API **v2**.
//
// Existe porque `hardhat verify` solo habla la v1, y la v1 está en apagado
// programado ("brownout") hasta enero de 2027: responde 503 y tumba el comando
// entero, incluso la parte de Celoscan. La v2 pide lo mismo por dentro —el JSON
// estándar del compilador— y eso Hardhat ya lo tiene en `artifacts/build-info`.
//
// Correr desde `contracts/`:
//   node scripts/verify-sourcify.mjs <direccion> <contrato> [txHashDeCreacion]
//
// Ejemplo:
//   node scripts/verify-sourcify.mjs 0x0952… contracts/AvispateArena.sol:AvispateArena 0xfc4b…
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const [address, identifier, creationTx] = process.argv.slice(2);
const CHAIN = process.env.CHAIN_ID || "42220";

if (!address || !identifier) {
  console.error(
    "Uso: node scripts/verify-sourcify.mjs <direccion> <ruta.sol:Contrato> [txHash]"
  );
  process.exit(1);
}

const sourceFile = identifier.split(":")[0];
const DIR = "artifacts/build-info";

// El build-info que contiene ESTE contrato, no cualquiera: la carpeta acumula
// uno por compilación y el más nuevo no tiene por qué ser el que se desplegó.
let elegido = null;
for (const f of readdirSync(DIR)) {
  const info = JSON.parse(readFileSync(path.join(DIR, f), "utf8"));
  if (info?.input?.sources?.[sourceFile]) elegido = info;
}
if (!elegido) {
  console.error(`No hay build-info con ${sourceFile}. ¿Compilaste?`);
  process.exit(1);
}

console.log("compilador:", elegido.solcLongVersion);
console.log("fuentes:   ", Object.keys(elegido.input.sources).length, "archivos");

const res = await fetch(
  `https://sourcify.dev/server/v2/verify/${CHAIN}/${address}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stdJsonInput: {
        language: elegido.input.language,
        sources: elegido.input.sources,
        settings: elegido.input.settings,
      },
      compilerVersion: elegido.solcLongVersion,
      contractIdentifier: identifier,
      ...(creationTx ? { creationTransactionHash: creationTx } : {}),
    }),
  }
);

const data = await res.json().catch(() => null);
if (res.status === 409) {
  console.log("Ya estaba verificado.");
  process.exit(0);
}
if (!res.ok || !data?.verificationId) {
  console.error("Falló el envío:", res.status, JSON.stringify(data));
  process.exit(1);
}

// La verificación es asíncrona: se pregunta hasta que el trabajo termine.
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const j = await fetch(
    `https://sourcify.dev/server/v2/verify/${data.verificationId}`
  );
  const st = await j.json().catch(() => null);
  if (!st?.isJobCompleted) {
    console.log(`  esperando… (${i + 1})`);
    continue;
  }
  const c = st.contract ?? {};
  console.log("\nresultado:", c.match ?? st.error?.message ?? "desconocido");
  console.log("  creación:", c.creationMatch ?? "—");
  console.log("  runtime: ", c.runtimeMatch ?? "—");
  console.log("  cuándo:  ", c.verifiedAt ?? "—");
  process.exit(c.match ? 0 : 1);
}
console.error("El trabajo no terminó a tiempo. Vuelve a consultarlo.");
process.exit(1);
