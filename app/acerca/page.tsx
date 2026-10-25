import type { Metadata } from "next";
import Link from "next/link";
import { getServerLang, getServerT } from "@/lib/i18n/server";
import { AboutEn, AboutEs } from "./content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("meta.about.title") };
}

export default async function AcercaPage() {
  const lang = await getServerLang();
  const t = await getServerT();
  const isEs = lang === "es";

  return (
    <main className="app-shell profile-page page-narrow">
      <h1 className="page-title">{t("about.title")}</h1>
      {isEs ? <AboutEs /> : <AboutEn />}
      <Link href="/perfil" className="btn-ghost">
        {t("common.back_to_profile")}
      </Link>
    </main>
  );
}
