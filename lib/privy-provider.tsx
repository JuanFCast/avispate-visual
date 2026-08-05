"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { I18nProvider } from "./i18n/client";
import type { Lang } from "./i18n";

const queryClient = new QueryClient();

/**
 * El stack de wallets llega aparte y solo donde hace falta.
 *
 * Sin `ssr: false` a propósito: el HTML se sigue renderizando en el servidor.
 * Apagarlo dejaría la pantalla de jugar en blanco hasta que el JS aterrice, que
 * es exactamente lo contrario de lo que se busca — MiniPay mide esa pantalla.
 * Lo único que hace `dynamic` aquí es partir el chunk, para que las rutas que
 * no lo montan tampoco lo pidan.
 */
const WalletProviders = dynamic(() => import("./wallet-providers"));

/**
 * Rutas sin wallet: no hay un solo botón que firme, pague o lea un saldo.
 *
 * Se comprobó componente a componente antes de ponerlas aquí — `LiveStats`,
 * `WinnersHistory` y `ProfileBottomNav` solo usan i18n y react-query, y
 * `useIsMiniPay` mira `window.ethereum` sin necesitar provider. Ninguna llama a
 * `useProfile`, que es lo que reventaría al quedarse fuera del árbol.
 *
 * Ante la duda, una ruta NO va en esta lista: sobrarle un megabyte a una página
 * es un problema de velocidad, y faltarle un provider es una pantalla rota.
 */
const WALLET_FREE_ROUTES = ["/terminos", "/privacidad", "/historial", "/stats"];

function isWalletFree(pathname: string): boolean {
  return WALLET_FREE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/**
 * Árbol de providers de Avíspate, en dos mitades.
 *
 * Arriba lo barato y de todos: el idioma —que decide el servidor, y por eso va
 * por fuera de todo: cambiarlo no vuelve a montar la wallet ni la sesión— y el
 * caché de peticiones.
 *
 * Abajo, y solo en las rutas que lo usan, el megabyte: Privy, wagmi, RainbowKit
 * y el catálogo de wallets. Ver `wallet-providers.tsx`.
 */
export function Providers({
  lang,
  children,
}: {
  lang: Lang;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const walletFree = isWalletFree(pathname);

  return (
    <I18nProvider initialLang={lang}>
      <QueryClientProvider client={queryClient}>
        {walletFree ? children : <WalletProviders>{children}</WalletProviders>}
      </QueryClientProvider>
    </I18nProvider>
  );
}
