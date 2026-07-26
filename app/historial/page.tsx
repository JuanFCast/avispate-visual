import type { Metadata } from "next";
import Link from "next/link";
import WinnersHistory from "@/components/history/WinnersHistory";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";

export const metadata: Metadata = {
  title: "Historial de ganadores · Avíspate",
  description:
    "Quién ganó cada ronda de Avíspate, cuánto se llevó y cómo quedó el pago.",
};

/**
 * /historial — ganadores de las rondas ya cerradas. Es público: se consulta
 * sin iniciar sesión. No es el registro de partidas del jugador (eso vive en
 * /perfil) ni el ranking del día (eso vive en /ranking).
 */
export default function HistorialPage() {
  return (
    <main className="app-shell profile-page">
      <h1 className="page-title">Historial de ganadores</h1>
      <p className="page-lead">
        Cada ronda cierra a las 7:00 p. m. (Colombia) y el #1 de cada mazo se
        lleva el pozo.{" "}
        <Link href="/ranking">Ver el ranking de hoy</Link>
      </p>

      <WinnersHistory />

      <ProfileBottomNav active="historial" />
    </main>
  );
}
