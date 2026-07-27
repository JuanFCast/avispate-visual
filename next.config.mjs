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
