"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DECK_OPTIONS } from "@/lib/game";
import GlobalLeaderboard from "@/components/GlobalLeaderboard";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";

/** El lobby enlaza con ?deck=10|15|20 para abrir la pestaña correcta. */
function RankingContent() {
  const params = useSearchParams();
  const requested = Number(params.get("deck"));
  const initialDeck = DECK_OPTIONS.includes(requested) ? requested : 10;
  return <GlobalLeaderboard initialDeck={initialDeck} />;
}

export default function RankingPage() {
  return (
    <main className="app-shell profile-page">
      <h1 className="page-title">Ranking</h1>
      <Suspense fallback={null}>
        <RankingContent />
      </Suspense>
      <ProfileBottomNav active="ranking" />
    </main>
  );
}
