"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import FrostedNavbar from "@/components/ui/FrostedNavbar";
import ContentRow from "@/components/media/ContentRow";
import ContinueWatchingRow from "@/components/media/ContinueWatchingRow";
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Info } from 'lucide-react';
import { fetchTrending, fetchHomeRow, type TMDBItem } from '@/lib/api';
import { HOME_ROWS, GENRES } from '@/lib/constants';
import { useTelemetryFlush } from '@/hooks/useTelemetryFlush';

// ─── Hero Section ───────────────────────────────────────────────────
function HeroSection() {
  const [heroes, setHeroes] = useState<TMDBItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    fetchTrending(1, 'all', 'day')
      .then(data => {
        const items = data.results
          .filter(i => i.backdrop_path)
          .slice(0, 5);
        setHeroes(items);
      })
      .catch(() => {});
  }, []);

  // Auto-rotate
  useEffect(() => {
    if (heroes.length <= 1) return;
    const interval = setInterval(() => {
      setActiveIndex(prev => (prev + 1) % heroes.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [heroes.length]);

  if (heroes.length === 0) {
    return <div className="w-full h-[65vh] max-h-[650px] shimmer" />;
  }

  const hero = heroes[activeIndex];
  const title = hero.title || hero.name || '';
  const type = hero.media_type || 'movie';
  const id = hero.tmdb_id || hero.id;

  return (
    <section className="relative w-full h-[65vh] max-h-[650px] overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={activeIndex}
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(https://image.tmdb.org/t/p/original${hero.backdrop_path})` }}
        />
      </AnimatePresence>

      {/* Gradients */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/20 z-10" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-transparent to-transparent z-10" />

      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
              className="max-w-xl"
            >
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white mb-3 tracking-tight leading-none">
                {title.toUpperCase()}
              </h1>
              {hero.overview && (
                <p className="text-sm sm:text-base text-white/70 mb-6 line-clamp-2 leading-relaxed">
                  {hero.overview}
                </p>
              )}
              <div className="flex gap-3">
                <Link href={`/watch/${id}?type=${type}`}>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="flex items-center gap-2 px-7 py-3 bg-white text-black font-semibold rounded-full hover:bg-white/90 transition-all"
                  >
                    <Play size={18} fill="currentColor" /> Play
                  </motion.button>
                </Link>
                <Link href={`/title/${id}?type=${type}&title=${encodeURIComponent(title)}`}>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="flex items-center gap-2 px-7 py-3 bg-white/10 text-white backdrop-blur-md font-medium rounded-full hover:bg-white/20 transition-all border border-white/10"
                  >
                    <Info size={18} /> More Info
                  </motion.button>
                </Link>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Dot Indicators */}
          <div className="flex gap-2 mt-6">
            {heroes.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIndex(i)}
                className={`h-1 rounded-full transition-all duration-500 ${
                  i === activeIndex ? 'w-8 bg-white' : 'w-3 bg-white/30 hover:bg-white/50'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Content Row with Data Fetching ─────────────────────────────────
function FetchableRow({ config }: { config: typeof HOME_ROWS[number] }) {
  const [items, setItems] = useState<TMDBItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchHomeRow(config.endpoint, 'params' in config ? config.params as Record<string, string> : undefined)
      .then(data => setItems(data.results.slice(0, 20)))
      .catch(() => setItems([]))
      .finally(() => setIsLoading(false));
  }, [config.endpoint]);

  // Find matching genre for "See All" link
  const genreParam = 'params' in config ? (config.params as Record<string, string>)?.with_genres : undefined;
  const seeAllHref = genreParam ? `/genre/${genreParam}?type=movie` : undefined;

  return (
    <ContentRow
      title={config.title}
      items={items}
      isLoading={isLoading}
      seeAllHref={seeAllHref}
    />
  );
}

// ─── Genre Quick Links ──────────────────────────────────────────────
function GenreBar() {
  return (
    <div className="py-3">
      <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
        {GENRES.slice(0, 10).map(g => (
          <Link key={g.id} href={`/genre/${g.id}?type=movie`}>
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/10 text-white/60 hover:text-white text-xs font-medium whitespace-nowrap transition-all cursor-pointer"
            >
              {g.name}
            </motion.div>
          </Link>
        ))}
        <Link href="/library">
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/15 hover:bg-blue-500/20 text-blue-400/70 hover:text-blue-300 text-xs font-medium whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5"
          >
            📁 Drive Library
          </motion.div>
        </Link>
      </div>
    </div>
  );
}

// ─── Home Page ──────────────────────────────────────────────────────
export default function Home() {
  useTelemetryFlush();

  return (
    <div className="min-h-screen pb-24">
      <FrostedNavbar />
      <HeroSection />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <GenreBar />
        <ContinueWatchingRow />
        {HOME_ROWS.map(row => (
          <FetchableRow key={row.id} config={row} />
        ))}
      </div>
    </div>
  );
}
