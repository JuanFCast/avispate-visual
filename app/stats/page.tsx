import type { Metadata } from "next";
import LiveStats from "@/components/stats/LiveStats";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";

export const metadata: Metadata = {
  title: "Estadísticas en vivo · Avíspate",
  description:
    "Cuánta gente juega Avíspate, qué tan rápido, cuánto se reparte en premios y qué pasa en la cadena. Datos públicos, sin sesión.",
};

/**
 * /stats — panel público de estadísticas en vivo. No pide sesión y no muestra
 * datos de ninguna persona en concreto: solo agregados del juego.
 */
export default function StatsPage() {
  return (
    <main className="app-shell profile-page">
      <h1 className="page-title">Estadísticas en vivo</h1>
      <p className="page-lead">
        Todo lo que pasa en Avíspate, en números públicos y actualizados solos.
      </p>

      <LiveStats />

      <ProfileBottomNav active="stats" />
    </main>
  );
}
