import Ticker from "@/components/Ticker";
import Header from "@/components/Header";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import AdSlot from "@/components/AdSlot";
import CookieConsent from "@/components/CookieConsent";
import AutoScrollButton from "@/components/AutoScrollButton";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Whole top zone stays fixed on scroll: rates ticker + header + nav. */}
      <div className="sticky top-0 z-40">
        <Ticker />
        <Header />
        <NavBar />
      </div>
      {/* Top leaderboard ad — visible on every page, both versions. */}
      <div className="mx-auto max-w-page px-4 pt-4 sm:px-[22px]">
        <AdSlot variant="leaderboard" />
      </div>
      <main className="mx-auto min-h-[60vh] max-w-page px-[22px]">
        {children}
      </main>
      <Footer />
      <AutoScrollButton />
      <CookieConsent />
    </>
  );
}
