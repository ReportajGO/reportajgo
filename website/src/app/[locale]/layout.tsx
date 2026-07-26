import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Archivo, Newsreader, Space_Mono } from "next/font/google";
import { routing, type Locale } from "@/i18n/routing";
import { SITE_URL } from "@/lib/seo";
import ThemeProvider from "@/components/ThemeProvider";
import "../globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
  variable: "--font-archivo",
  display: "swap",
});
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

// SITE_URL (public origin) is centralized in lib/seo.ts and drives metadataBase
// so canonical/OpenGraph URLs resolve absolute for search engines. These are
// site-wide DEFAULTS; per-page generateMetadata overrides title/description/
// canonical/hreflang where set.
const SITE_NAME = "ReportajGO";
const DEFAULT_TITLE = "ReportajGO — World News";
const DEFAULT_DESCRIPTION =
  "World news without the noise. Fast, clear, in three languages (UZ/RU/EN).";
const DEFAULT_OG_IMAGE = {
  url: "/og-default.png",
  width: 1200,
  height: 630,
  alt: DEFAULT_TITLE,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: "%s — ReportajGO",
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: true, follow: true },
  icons: {
    icon: "/icon.png",
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: ["/og-default.png"],
  },
  // Search-console ownership tokens. Set the matching env var to the token each
  // console shows under its "HTML tag" method, then redeploy and click Verify.
  // Undefined values render no tag, so this is a no-op until a token is set.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
    yandex: process.env.YANDEX_VERIFICATION,
    other: process.env.BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
      : undefined,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e11" },
  ],
};

export const dynamic = "force-dynamic";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as Locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${archivo.variable} ${newsreader.variable} ${spaceMono.variable}`}
      >
        <ThemeProvider>
          <NextIntlClientProvider messages={messages}>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
