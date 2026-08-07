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
    /**
     * APAGADO, y no porque no usemos Sourcify — sí lo usamos.
     *
     * `hardhat verify` solo habla su API v1, que está en apagado programado
     * hasta enero de 2027: responde 503 y tumba el comando ENTERO, incluida la
     * parte de Celoscan, que sí funciona. Dejarlo encendido significa que
     * `verify` no sirve para nada.
     *
     * Sourcify se publica con `scripts/verify-sourcify.mjs`, que habla la v2.
     * Así ya se verificó AvispateArena (coincidencia exacta, 2026-08-07).
     */
    enabled: false,
  },
  etherscan: {
    // Celoscan sí exige llave. Sin ella se desactiva para no romper `verify`;
    // en cuanto exista CELOSCAN_API_KEY, el mismo comando lo publica allá.
    enabled: Boolean(CELOSCAN_API_KEY),
    /**
     * La llave va como CADENA, no como `{ celo: ... }`.
     *
     * No es cosmético: el plugin elige el endpoint por ahí. Con el objeto por
     * red usa la API v1 de Etherscan, que está retirada y responde "You are
     * using a deprecated V1 endpoint"; con una cadena suelta usa la v2, que es
     * multired y resuelve Celo por su chainId. Una misma llave de etherscan.io
     * sirve para todas las redes que cubre.
     */
    apiKey: CELOSCAN_API_KEY,
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
