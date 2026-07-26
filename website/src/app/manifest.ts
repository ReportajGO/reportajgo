import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest. Minimal PWA metadata + install icons.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ReportajGO — World News",
    short_name: "ReportajGO",
    description:
      "World news without the noise. Fast, clear, in three languages (UZ/RU/EN).",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#e51a24",
    icons: [
      { src: "/icon.png", sizes: "any", type: "image/png" },
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
  };
}
