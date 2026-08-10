import type { Metadata } from "next";
import GameShell from "@/components/GameShell";
import { getServerT } from "@/lib/i18n/server";

const SOCIAL_TITLE = "Avíspate";
const SOCIAL_DESCRIPTION =
  "Avíspate! Find the symbol two cards have in common and burn through your deck at full speed.";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  const title = t("meta.home.title");
  const description = t("meta.home.description");

  return {
    title,
    description,
    alternates: {
      canonical: "/",
    },
    openGraph: {
      title: SOCIAL_TITLE,
      description: SOCIAL_DESCRIPTION,
      url: "/",
      siteName: "Avíspate",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: SOCIAL_TITLE,
      description: SOCIAL_DESCRIPTION,
    },
  };
}

/**
 * El juego vive en la raíz: avispate.fun ES Avíspate, no una puerta que
 * redirige a otra parte. La ruta vieja /visual-rush sigue funcionando con un
 * redirect permanente (next.config.mjs) para no romper enlaces compartidos.
 */
export default function Home() {
  return <GameShell />;
}
