import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Providers from "@/components/ui/Providers";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { CosmicBackground } from "@/components/generative/CosmicBackground";
import Script from "next/script";
import { PwaRegistry } from "@/components/ui/PwaRegistry";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800"], display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "ATMOS — Stream Movies, TV Shows & Anime",
    template: "%s | ATMOS",
  },
  description: "ATMOS is a zero-buffering, ad-free streaming platform with 10+ providers, instant playback, and a Netflix-grade experience for movies, TV shows, and anime.",
  keywords: ["streaming", "movies", "tv shows", "anime", "free streaming", "ATMOS", "watch online"],
  metadataBase: new URL("https://atmos-coral-sigma.vercel.app"),
  openGraph: {
    title: "ATMOS — Stream Movies, TV Shows & Anime",
    description: "Zero-buffering streaming with parallel provider racing. Watch anything, anywhere.",
    type: "website",
    siteName: "ATMOS",
  },
  twitter: {
    card: "summary_large_image",
    title: "ATMOS — Stream Movies, TV Shows & Anime",
    description: "Zero-buffering streaming with parallel provider racing.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#8b5cf6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className={`${jakarta.className} min-h-screen bg-black text-white selection:bg-violet-500/30 overflow-x-hidden`}>
        <PwaRegistry />
        <Providers>
          {/* Aceternity Cosmic Background */}
          <CosmicBackground />
          
          {/* Main Content Layer */}
          <main className="relative z-10">
            {children}
          </main>
        </Providers>
        <SpeedInsights />
      </body>
    </html>
  );
}
