import Link from "next/link";

export const metadata = { title: "Privacidad · Avíspate" };

export default function PrivacidadPage() {
  return (
    <main className="app-shell profile-page">
      <h1 className="page-title">Privacidad</h1>
      <section className="profile-section">
        <p className="section-note">
          Política de privacidad en preparación. Avíspate guarda tu alias y tus
          puntajes para el ranking; tu wallet se usa para pagos y premios en la
          red Celo.
        </p>
      </section>
      <Link href="/perfil" className="btn-ghost">
        ← Volver al perfil
      </Link>
    </main>
  );
}
