import type { Metadata } from "next";
import GameShell from "@/components/GameShell";
import { getServerT } from "@/lib/i18n/server";

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
      title,
      description,
      url: "/",
      siteName: "Avíspate",
      type: "website",
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: "Avíspate — juego de agilidad visual",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
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
