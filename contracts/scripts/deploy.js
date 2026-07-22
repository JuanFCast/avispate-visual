const { ethers } = require("hardhat");

/**
 * Despliegue de AvispatePot en Celo. Configura por variables de entorno:
 *   USDT_ADDRESS, COMMISSION_WALLET, FEE_AMOUNT, COMMISSION_BPS, OWNER_ADDRESS
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  const usdt = process.env.USDT_ADDRESS;
  const commissionWallet = process.env.COMMISSION_WALLET;
  const operator = process.env.OPERATOR_ADDRESS;
  const feeAmount = BigInt(process.env.FEE_AMOUNT || "100000"); // 0.10 USDT
  const commissionBps = Number(process.env.COMMISSION_BPS || "2000"); // 20%
  const owner = process.env.OWNER_ADDRESS || deployer.address;

  if (!usdt || !commissionWallet || !operator) {
    throw new Error(
      "Faltan USDT_ADDRESS, COMMISSION_WALLET y/o OPERATOR_ADDRESS en el entorno."
    );
  }

  console.log("Deployer:", deployer.address);
  console.log("USDT:", usdt);
  console.log("Commission wallet:", commissionWallet);
  console.log("Operator:", operator);
  console.log("Fee:", feeAmount.toString());
  console.log("Commission bps:", commissionBps);
  console.log("Owner:", owner);

  const AvispatePot = await ethers.getContractFactory("AvispatePot");
  const pot = await AvispatePot.deploy(
    usdt,
    commissionWallet,
    operator,
    feeAmount,
    commissionBps,
    owner
  );
  await pot.waitForDeployment();

  console.log("AvispatePot desplegado en:", await pot.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
