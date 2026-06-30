import Ticker from "@/components/Ticker";
import Header from "@/components/Header";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import AdSlot from "@/components/AdSlot";
import CookieConsent from "@/components/CookieConsent";
import AutoScrollButton from "@/components/AutoScrollButton";
import { getActiveThemes } from "@/lib/themes";

export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Themes (nav sections) are DB-driven from the agent's topic filters.
  const themes = await getActiveThemes(locale);
  const navThemes = themes.map((t) => ({ slug: t.slug, name: t.name }));

  return (
    <>
      {/* Whole top zone stays fixed on scroll: rates ticker + header + nav. */}
      <div className="sticky top-0 z-40">
        <Ticker />
        <Header themes={navThemes} />
        <NavBar themes={navThemes} />
      </div>
      {/* Top leaderboard ad — visible on every page, both versions. */}
      <div className="mx-auto max-w-page px-4 pt-4 sm:px-[22px]">
        <AdSlot variant="leaderboard" />
      </div>
      <main className="mx-auto min-h-[60vh] max-w-page px-[22px]">
        {children}
      </main>
      <Footer themes={navThemes} />
      <AutoScrollButton />
      <CookieConsent />
    </>
  );
}
