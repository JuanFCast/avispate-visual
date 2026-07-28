require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const CELO_RPC_URL = process.env.CELO_RPC_URL || "https://forno.celo.org";
const CELOSCAN_API_KEY = process.env.CELOSCAN_API_KEY || "";

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    celo: {
      url: CELO_RPC_URL,
      chainId: 42220,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  // Verificación pública del contrato: requisito de Proof of Ship y, sobre
  // todo, lo que permite a cualquiera leer las reglas del pozo antes de pagar.
  sourcify: {
    // No pide llave de API, así que funciona siempre. Blockscout y otras
    // herramientas levantan la fuente desde aquí.
    enabled: true,
  },
  etherscan: {
    // Celoscan sí exige llave. Sin ella se desactiva para no romper `verify`;
    // en cuanto exista CELOSCAN_API_KEY, el mismo comando lo publica allá.
    enabled: Boolean(CELOSCAN_API_KEY),
    apiKey: { celo: CELOSCAN_API_KEY },
    customChains: [
      {
        network: "celo",
        chainId: 42220,
        urls: {
          apiURL: "https://api.celoscan.io/api",
          browserURL: "https://celoscan.io",
        },
      },
    ],
  },
};
