"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useDisconnect } from "wagmi";
import { shortAddress, useActiveWallet, useWalletIdentity } from "@/lib/wallet";
import { USDT_DECIMALS } from "@/lib/contracts";
import ProfileHeader from "@/components/profile/ProfileHeader";
import ProfileStats from "@/components/profile/ProfileStats";
import WonPrizes, { type Prize } from "@/components/profile/WonPrizes";
import WalletCard from "@/components/profile/WalletCard";
import WalletTokens from "@/components/profile/WalletTokens";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";
import LanguageToggle from "@/components/profile/LanguageToggle";
import { useT } from "@/lib/i18n/client";

interface Stats {
  gamesPlayed: number;
  wins: number;
  totalWonUnits: string;
  prizes: Prize[];
}

const EMPTY_STATS: Stats = {
  gamesPlayed: 0,
  wins: 0,
  totalWonUnits: "0",
  prizes: [],
};

export default function PerfilPage() {
  const t = useT();
  const router = useRouter();
  const { ready, authenticated, logout, getAccessToken } = usePrivy();
  const { address, isConnected } = useActiveWallet();
  const { verdict, shown: shownWallet } = useWalletIdentity();
  const { disconnect } = useDisconnect();

  const loggedIn = authenticated || isConnected;

  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      let url = "/api/me/stats";
      const headers: Record<string, string> = {};
      if (authenticated) {
        const token = await getAccessToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      } else if (address) {
        url += `?wallet=${address}`;
      }
      const res = await fetch(url, { headers });
      const data = await res.json();
      setStats({ ...EMPTY_STATS, ...data });
    } catch {
      setStats(EMPTY_STATS);
    } finally {
      setStatsLoading(false);
    }
  }, [authenticated, address, getAccessToken]);

  useEffect(() => {
    if (!ready) return;
    if (loggedIn) loadStats();
    else setStatsLoading(false);
  }, [ready, loggedIn, loadStats]);

  // Los saldos y sus acciones (agregar / enviar) viven en WalletTokens.
  const totalWonUsdt = (
    Number(stats.totalWonUnits) / 10 ** USDT_DECIMALS
  ).toFixed(2);

  async function handleLogout() {
    try {
      if (isConnected) disconnect();
      if (authenticated) await logout();
    } finally {
      router.push("/");
    }
  }

  if (!ready) {
    return (
      <main className="app-shell profile-page page-stack page-profile">
        <p className="access-note">{t("common.loading")}</p>
      </main>
    );
  }

  if (!loggedIn) {
    return (
      <main className="app-shell profile-page page-stack page-profile">
        <div className="profile-guard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-avispate.png" alt="" className="profile-avatar" />
          <h1 className="profile-alias-big">{t("profile.title")}</h1>
          <p className="empty-note">{t("profile.guard.text")}</p>
          <Link href="/" className="btn-primary">
            {t("profile.guard.cta")}
          </Link>
        </div>
        <ProfileBottomNav active="perfil" />
      </main>
    );
  }

  return (
    <main className="app-shell profile-page page-stack page-profile">
      <ProfileHeader />

      {/* Sin rejilla ni columnas: encabezado y tarjetas son hermanos del mismo
          contenedor, así que comparten ancho y eje vertical en cualquier
          pantalla. El orden es el mismo en móvil y en escritorio. */}
      <ProfileStats
        gamesPlayed={stats.gamesPlayed}
        wins={stats.wins}
        totalWonUsdt={totalWonUsdt}
        loading={statsLoading}
      />

      <WonPrizes prizes={stats.prizes} loading={statsLoading} />

      {/* La cartera que se enseña es la del PERFIL, no la que wagmi tenga
          conectada. Eran la misma hasta que una embebida creada por accidente
          las separó: arriba salían las partidas y los premios de una wallet y
          aquí abajo el saldo de otra, las dos con la misma pinta de oficiales.
          Ahora mandan las dos cosas desde el mismo sitio (`wallet-identity.ts`).

          Y si la conectada no es la canónica se dice, sin cambiar de identidad
          por su cuenta: la cartera sigue siendo la de siempre, lo que falta es
          conectarla. */}
      {verdict.kind === "connect_canonical" && (
        <p className="room-warn" role="status">
          {verdict.connected
            ? t("profile.wallet.mismatch", {
                connected: shortAddress(verdict.connected),
                canonical: shortAddress(verdict.canonical),
              })
            : t("profile.wallet.disconnected", {
                canonical: shortAddress(verdict.canonical),
              })}
        </p>
      )}

      {shownWallet ? (
        <>
          <WalletCard address={shownWallet} />

          <WalletTokens address={shownWallet} />
        </>
      ) : (
        <p className="empty-note">{t("profile.creating_wallet")}</p>
      )}

      <section className="profile-links">
        <Link className="profile-link-row" href="/stats">
          {t("common.live_stats")}
        </Link>
        <a className="profile-link-row" href="mailto:soporte@avispate.fun">
          {t("profile.link.support")}
        </a>
        <LanguageToggle />
        <button
          type="button"
          className="profile-link-row profile-logout-link"
          onClick={handleLogout}
        >
          {t("profile.link.logout")}
        </button>
        <p className="profile-links-hint">{t("profile.links.hint")}</p>
        <div className="profile-legal">
          <Link href="/terminos">{t("profile.legal.terms")}</Link>
          <span aria-hidden="true">·</span>
          <Link href="/privacidad">{t("profile.legal.privacy")}</Link>
        </div>
      </section>

      <ProfileBottomNav active="perfil" />
    </main>
  );
}
