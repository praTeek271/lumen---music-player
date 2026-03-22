// app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PlayerProvider } from "@/lib/playerStore";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "LUMEN — Open Music Player",
  description: "Open-source offline music player. Install once, play forever.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LUMEN",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#0a0a0a",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning on <html> handles browser extensions
    // that inject attributes (e.g. dark-mode extensions, password managers)
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body suppressHydrationWarning>
        <PlayerProvider>{children}</PlayerProvider>
        {/* SW registration moved to a client component — no dangerouslySetInnerHTML */}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
