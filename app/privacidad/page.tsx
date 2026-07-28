import type { Metadata } from "next";
import Link from "next/link";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("meta.privacy.title") };
}

export default async function PrivacidadPage() {
  const t = await getServerT();

  return (
    <main className="app-shell profile-page page-narrow">
      <h1 className="page-title">{t("privacy.title")}</h1>
      <section className="profile-section">
        <p className="section-note">{t("privacy.body")}</p>
      </section>
      <Link href="/perfil" className="btn-ghost">
        {t("common.back_to_profile")}
      </Link>
    </main>
  );
}
