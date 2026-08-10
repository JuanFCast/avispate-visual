import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import "./globals.css";
import { Providers } from "@/lib/privy-provider";
import { getServerLang, getServerT } from "@/lib/i18n/server";

const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
});

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t("meta.home.title"),
    description: t("meta.home.description"),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#FFC20E",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // El idioma se resuelve en el servidor (cookie del jugador o el del
  // dispositivo), así que el HTML ya sale traducido y `lang` es el de verdad.
  const lang = await getServerLang();

  return (
    <html lang={lang} className={`${fredoka.variable} ${nunito.variable}`}>
      <head>
        {/*
          Resolver DNS y TLS en paralelo con el HTML, para que la descarga no
          pague después el saludo. La regla es la que importa: SOLO orígenes que
          se piden en la carga inicial. Precargar uno que espera a que alguien
          toque un botón gasta conexión y no ahorra nada.

          `auth.privy.io` es el que más pesa de todos —Lighthouse le atribuye
          ~936 KB— y sale en cuanto arranca la home, así que va con preconnect
          entero (DNS + TCP + TLS).

          Los RPC de Celo van con dns-prefetch y no con preconnect: la home lee
          la cadena al cargar (el pozo del día y las jugadas gratis), pero esa
          lectura llega un poco después, y ahí resolver el nombre por adelantado
          es casi todo el beneficio sin ocupar una conexión desde el principio.

          Deliberadamente NO están:
          · Supabase — la app nunca lo llama desde el navegador; va por `/api`,
            que es el mismo origen. Precargarlo sería una conexión a un host
            que el cliente jamás abre.
          · WalletConnect / Reown / Coinbase — perezosos: no se piden hasta que
            alguien abre el selector de billeteras. Misma regla.
        */}
        <link rel="preconnect" href="https://auth.privy.io" crossOrigin="" />
        <link rel="dns-prefetch" href="https://forno.celo.org" />
        <link rel="dns-prefetch" href="https://celo.drpc.org" />
      </head>
      <body>
        <Providers lang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
