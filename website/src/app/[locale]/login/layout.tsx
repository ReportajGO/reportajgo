import type { Metadata } from "next";

// The login page is a Client Component (can't export metadata itself), so this
// thin layout carries the noindex directive that keeps it out of search.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
