import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ParticleCanvas from "@/components/generative/ParticleCanvas";
import Providers from "@/components/ui/Providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "ATMOS — Stream Movies, TV Shows & Anime",
    template: "%s | ATMOS",
  },
  description: "ATMOS is a zero-buffering, ad-free streaming platform with 10+ providers, instant playback, and a Netflix-grade experience for movies, TV shows, and anime.",
  keywords: ["streaming", "movies", "tv shows", "anime", "free streaming", "ATMOS", "watch online"],
  metadataBase: new URL("https://atmos.vercel.app"),
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
      <body className={`${inter.className} min-h-screen bg-black text-white selection:bg-white/30 overflow-x-hidden`}>
        <Providers>
          {/* Generative Background (Desktop Only) */}
          <ParticleCanvas />
          
          {/* Main Content Layer */}
          <main className="relative z-10">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
