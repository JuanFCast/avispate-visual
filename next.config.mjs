/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // El juego se mudó de /visual-rush a la raíz (avispate.fun). Permanente
      // para que los enlaces ya compartidos —y los buscadores— apunten al
      // nuevo sitio en vez de quedarse con la ruta vieja.
      { source: "/visual-rush", destination: "/", permanent: true },
    ];
  },

  /**
   * Caché de estáticos, con la distinción que la hace segura.
   *
   * `immutable` durante un año SOLO donde la URL cambia cuando cambia el
   * contenido. Eso es `/_next/static/*`: Next mete un hash en cada nombre, así
   * que un archivo nunca se reescribe en su sitio — se publica otro con otro
   * nombre y el viejo deja de referenciarse. Ahí un año no arriesga nada.
   *
   * El logo NO entra en eso. Vive en `/logo-avispate.webp`, un nombre fijo: si
   * mañana se cambia la imagen, la URL es la misma, y con `immutable` el
   * navegador seguiría enseñando la vieja durante un año sin volver a
   * preguntar. Para esos va una caché corta con revalidación: se sirve al
   * instante desde caché y se comprueba en segundo plano, así que un cambio
   * entra en el siguiente arranque en vez de en 2027.
   */
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/:file(logo-avispate.webp|icon.png)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },

  webpack: (config, { webpack }) => {
    // Dependencias opcionales de WalletConnect/wagmi que no se usan en el
    // navegador; externalizarlas evita warnings.
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // Módulos opcionales que arrastran wagmi/Privy/MetaMask SDK pero que no
    // usamos (pagos x402, onramp de Stripe, Solana en Farcaster, storage de
    // React Native). Los ignoramos para que no rompan ni ensucien el build.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp:
          /^(@x402\/|@stripe\/crypto|@farcaster\/mini-app-solana|@react-native-async-storage\/async-storage)/,
      })
    );

    return config;
  },
};

export default nextConfig;
