"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import FrostedNavbar from "@/components/ui/FrostedNavbar";
import ContentRow from "@/components/media/ContentRow";
import ContinueWatchingRow from "@/components/media/ContinueWatchingRow";
import TopTenRow from "@/components/media/TopTenRow";
import RecommendedRow from "@/components/media/RecommendedRow";
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Info, TrendingUp } from 'lucide-react';
import { fetchTrending, fetchHomeRow, type TMDBItem } from '@/lib/api';
import { HOME_ROWS, GENRES } from '@/lib/constants';
import { useTelemetryFlush } from '@/hooks/useTelemetryFlush';
import { useKeepAlive } from '@/hooks/useKeepAlive';
import { useLazyLoad } from '@/hooks/useLazyLoad';
import { Spotlight } from '@/components/blocks/spotlight-new';

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
      .catch(() => { });
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
    return <div className="w-full h-[70vh] max-h-[720px] shimmer" />;
  }

  const hero = heroes[activeIndex];
  const title = hero.title || hero.name || '';
  const type = hero.media_type || 'movie';
  const id = hero.tmdb_id || hero.id;
  const rating = hero.vote_average;
  const year = (hero.release_date || hero.first_air_date || '').slice(0, 4);

  return (
    <section className="relative w-full h-[70vh] max-h-[720px] overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={activeIndex}
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(https://image.tmdb.org/t/p/original${hero.backdrop_path})` }}
        />
      </AnimatePresence>

      {/* Premium Gradient Overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/10 z-10" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/20 to-transparent z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent z-10" />

      {/* Spotlight Effect */}
      <Spotlight
        gradientFirst="radial-gradient(68.54% 68.72% at 55.02% 31.46%, hsla(271, 91%, 65%, .12) 0, hsla(271, 91%, 45%, .04) 50%, hsla(271, 91%, 35%, 0) 80%)"
        gradientSecond="radial-gradient(50% 50% at 50% 50%, hsla(187, 92%, 45%, .08) 0, hsla(187, 92%, 35%, .02) 80%, transparent 100%)"
        gradientThird="radial-gradient(50% 50% at 50% 50%, hsla(271, 91%, 65%, .06) 0, hsla(271, 91%, 45%, .02) 80%, transparent 100%)"
      />

      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="max-w-xl"
            >
              {/* Meta badges */}
              <div className="flex items-center gap-2 mb-3">
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-600/90 text-[10px] font-bold text-white uppercase tracking-wider">
                  <TrendingUp size={10} /> Trending
                </span>
                {type === 'tv' && (
                  <span className="px-2 py-0.5 rounded-md bg-violet-600/80 text-[10px] font-bold text-white uppercase tracking-wider">
                    TV Series
                  </span>
                )}
                {year && (
                  <span className="text-white/40 text-xs font-medium">{year}</span>
                )}
                {rating && rating > 0 && (
                  <span className="text-amber-400 text-xs font-semibold">★ {rating.toFixed(1)}</span>
                )}
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white mb-3 tracking-tight leading-[1.05]">
                {title}
              </h1>
              {hero.overview && (
                <p className="text-sm sm:text-base text-white/60 mb-6 line-clamp-2 leading-relaxed max-w-lg">
                  {hero.overview}
                </p>
              )}
              <div className="flex gap-3">
                <Link href={`/watch/${id}?type=${type}`}>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="relative group flex items-center gap-2 px-8 py-3.5 bg-white text-black font-bold rounded-full hover:bg-white/90 transition-all text-sm shadow-2xl shadow-white/10"
                  >
                    <div className="absolute -inset-1 bg-white/20 rounded-full blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <Play size={18} fill="currentColor" className="relative" /> <span className="relative">Play Now</span>
                  </motion.button>
                </Link>
                <Link href={`/title/${id}?type=${type}&title=${encodeURIComponent(title)}`}>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="flex items-center gap-2 px-7 py-3.5 bg-white/10 text-white backdrop-blur-xl font-medium rounded-full hover:bg-white/20 transition-all border border-white/10 text-sm"
                  >
                    <Info size={18} /> More Info
                  </motion.button>
                </Link>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Dot Indicators + Progress */}
          <div className="flex gap-2 mt-8">
            {heroes.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIndex(i)}
                className="relative h-1 rounded-full overflow-hidden transition-all duration-500"
                style={{ width: i === activeIndex ? '2.5rem' : '0.75rem' }}
              >
                <div className="absolute inset-0 bg-white/20" />
                {i === activeIndex && (
                  <motion.div
                    className="absolute inset-0 bg-white rounded-full"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 6, ease: 'linear' }}
                    style={{ transformOrigin: 'left' }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Content Row with Data Fetching ─────────────────────────────────
function FetchableRow({ config }: { config: typeof HOME_ROWS[number] }) {
  const [ref, isVisible] = useLazyLoad('300px');
  const [items, setItems] = useState<TMDBItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isVisible) return; // Only fetch when scrolled into view
    fetchHomeRow(config.endpoint, 'params' in config ? config.params as Record<string, string> : undefined)
      .then(data => setItems(data.results.slice(0, 20)))
      .catch(() => setItems([]))
      .finally(() => setIsLoading(false));
  }, [config.endpoint, isVisible]);

  // Find matching genre for "See All" link
  const genreParam = 'params' in config ? (config.params as Record<string, string>)?.with_genres : undefined;
  const seeAllHref = genreParam ? `/genre/${genreParam}?type=movie` : undefined;

  return (
    <div ref={ref}>
      <ContentRow
        title={config.title}
        items={items}
        isLoading={isLoading}
        seeAllHref={seeAllHref}
      />
    </div>
  );
}

// ─── Top 10 Row with Data ──────────────────────────────────────────
function TopTenSection() {
  const [items, setItems] = useState<TMDBItem[]>([]);

  useEffect(() => {
    fetchTrending(1, 'all', 'day')
      .then(data => setItems(data.results.filter(i => i.poster_path).slice(0, 10)))
      .catch(() => setItems([]));
  }, []);

  return <TopTenRow items={items} />;
}

// ─── Genre Quick Links ──────────────────────────────────────────────
function GenreBar() {
  return (
    <div className="py-4">
      <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
        {GENRES.slice(0, 10).map(g => (
          <Link key={g.id} href={`/genre/${g.id}?type=movie`}>
            <motion.div
              whileHover={{ scale: 1.05, y: -2 }}
              whileTap={{ scale: 0.95 }}
              className="px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-violet-500/20 text-white/60 hover:text-white text-xs font-medium whitespace-nowrap transition-all cursor-pointer backdrop-blur-sm"
            >
              {g.name}
            </motion.div>
          </Link>
        ))}
        <Link href="/library">
          <motion.div
            whileHover={{ scale: 1.05, y: -2 }}
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
  useKeepAlive();

  return (
    <div className="min-h-screen pb-24">
      <FrostedNavbar />
      <HeroSection />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <GenreBar />

        {/* 1. Continue Watching (highest priority) */}
        <ContinueWatchingRow />

        {/* 2. Personalized Recommendation (from watch history) */}
        <RecommendedRow />

        {/* 3. Top 10 Today */}
        <TopTenSection />

        {/* 4. Content Rows */}
        {HOME_ROWS.map(row => (
          <FetchableRow key={row.id} config={row} />
        ))}
      </div>
    </div>
  );
}
