"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useDisconnect } from "wagmi";
import { useActiveWallet } from "@/lib/wallet";
import { USDT_DECIMALS } from "@/lib/contracts";
import ProfileHeader from "@/components/profile/ProfileHeader";
import ProfileStats from "@/components/profile/ProfileStats";
import WonPrizes, { type Prize } from "@/components/profile/WonPrizes";
import WalletCard from "@/components/profile/WalletCard";
import WalletTokens from "@/components/profile/WalletTokens";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";

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
  const router = useRouter();
  const { ready, authenticated, logout, getAccessToken } = usePrivy();
  const { address, isConnected } = useActiveWallet();
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
      router.push("/visual-rush");
    }
  }

  if (!ready) {
    return (
      <main className="app-shell profile-page">
        <p className="access-note">Cargando…</p>
      </main>
    );
  }

  if (!loggedIn) {
    return (
      <main className="app-shell profile-page">
        <div className="profile-guard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-avispate.png" alt="" className="profile-avatar" />
          <h1 className="profile-alias-big">Tu perfil</h1>
          <p className="empty-note">
            Inicia sesión con tu correo o conecta tu wallet para ver tu perfil.
          </p>
          <Link href="/visual-rush" className="btn-primary">
            Ir al inicio
          </Link>
        </div>
        <ProfileBottomNav active="perfil" />
      </main>
    );
  }

  return (
    <main className="app-shell profile-page">
      <ProfileHeader />

      {/* Dos columnas en pantallas anchas (juego a la izquierda, cartera y
          ajustes a la derecha); en móvil se apila en el mismo orden. */}
      <div className="page-grid">
        <div className="page-col">
          <ProfileStats
            gamesPlayed={stats.gamesPlayed}
            wins={stats.wins}
            totalWonUsdt={totalWonUsdt}
            loading={statsLoading}
          />

          <WonPrizes prizes={stats.prizes} loading={statsLoading} />
        </div>

        <div className="page-col">
          {address ? (
            <>
              <WalletCard address={address} />

              <WalletTokens address={address} />
            </>
          ) : (
            <p className="empty-note">Creando tu wallet…</p>
          )}

          <section className="profile-links">
            <Link className="profile-link-row" href="/stats">
              Estadísticas en vivo
            </Link>
            <a
              className="profile-link-row"
              href="mailto:soporte@avispate.fun"
            >
              Ayuda y soporte
            </a>
            <button
              type="button"
              className="profile-link-row profile-logout-link"
              onClick={handleLogout}
            >
              Cerrar sesión
            </button>
            <p className="profile-links-hint">
              Cierra sesión para cambiar de cuenta.
            </p>
            <div className="profile-legal">
              <Link href="/terminos">Términos</Link>
              <span aria-hidden="true">·</span>
              <Link href="/privacidad">Privacidad</Link>
            </div>
          </section>
        </div>
      </div>

      <ProfileBottomNav active="perfil" />
    </main>
  );
}
