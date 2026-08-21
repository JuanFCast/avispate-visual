import type { Metadata } from "next";
import Link from "next/link";
import { getServerLang, getServerT } from "@/lib/i18n/server";
import {
  LAST_UPDATED_EN,
  LAST_UPDATED_ES,
  TermsEn,
  TermsEs,
} from "./content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("meta.terms.title") };
}

export default async function TerminosPage() {
  const lang = await getServerLang();
  const t = await getServerT();
  const isEs = lang === "es";

  return (
    <main className="app-shell profile-page page-narrow">
      <h1 className="page-title">{t("terms.title")}</h1>
      <p className="page-lead">{isEs ? LAST_UPDATED_ES : LAST_UPDATED_EN}</p>
      {isEs ? <TermsEs /> : <TermsEn />}
      <Link href="/perfil" className="btn-ghost">
        {t("common.back_to_profile")}
      </Link>
    </main>
  );
}
