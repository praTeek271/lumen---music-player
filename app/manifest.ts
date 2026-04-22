// app/manifest.ts — Type-safe Web App Manifest for LUMEN
// display: 'standalone' removes the browser chrome when launched from home screen
import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LUMEN — Open Music Player",
    short_name: "LUMEN",
    description:
      "Open-source offline music player. Install once, play forever.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "any",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    categories: ["music", "entertainment"],
    shortcuts: [
      {
        name: "Play Music",
        url: "/",
        description: "Open the immersive player",
      },
    ],
  };
}
