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
      <body>
        <Providers lang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
