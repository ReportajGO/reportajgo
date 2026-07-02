import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// This repo has two package-lock.json files (agent at the root, website nested),
// so Next.js can't infer the file-tracing root. Pin it to the website dir to
// silence the "inferred your workspace root" dev warning.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// 'unsafe-eval' is only needed by the dev server (React Refresh / HMR). Drop it
// in production so injected scripts can't eval(). 'unsafe-inline' stays because
// Next.js emits inline hydration scripts without a nonce pipeline.
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

// Hardening headers applied to every response.
const securityHeaders = [
  // Stop the site being framed (clickjacking).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Don't let browsers MIME-sniff responses.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Trim the referrer sent to other origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable powerful APIs we don't use.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // Force HTTPS once deployed (ignored on plain http://localhost).
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Baseline CSP: block plugins/embeds, lock framing & base-uri. Scripts/styles
  // stay 'unsafe-inline' because Next.js injects inline runtime code.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "img-src 'self' data: https:",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin file-tracing root to this dir (two lockfiles exist in the repo).
  outputFileTracingRoot: projectRoot,
  // Hide the Next.js dev tools indicator (the "N" badge) during development.
  devIndicators: false,
  poweredByHeader: false, // hide "X-Powered-By: Next.js"
  images: {
    // Allow remote article cover images (admins paste external URLs).
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
