"use client";

import GlobalLeaderboard from "@/components/GlobalLeaderboard";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";

export default function RankingPage() {
  return (
    <main className="app-shell profile-page">
      <h1 className="page-title">Ranking</h1>
      <GlobalLeaderboard initialDeck={10} />
      <ProfileBottomNav active="ranking" />
    </main>
  );
}
