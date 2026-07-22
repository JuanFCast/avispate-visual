import Link from "next/link";

export const metadata = { title: "Términos · Avíspate" };

export default function TerminosPage() {
  return (
    <main className="app-shell profile-page">
      <h1 className="page-title">Términos</h1>
      <section className="profile-section">
        <p className="section-note">
          Contenido de términos y condiciones en preparación. Avíspate es un juego
          de agilidad visual; las partidas pagadas y los premios se procesan en la
          red Celo.
        </p>
      </section>
      <Link href="/perfil" className="btn-ghost">
        ← Volver al perfil
      </Link>
    </main>
  );
}
