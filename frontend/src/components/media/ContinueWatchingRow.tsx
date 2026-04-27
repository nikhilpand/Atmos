"use client";

// ═══════════════════════════════════════════════════════════════════════
// ATMOS V6 — Continue Watching Row (Premium Landscape Cards)
// ═══════════════════════════════════════════════════════════════════════

import React, { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { Play, X, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useWatchStore, type WatchEntry } from '@/store/useWatchStore';
import { useShallow } from 'zustand/react/shallow';

export default function ContinueWatchingRow() {
  const items = useWatchStore(useShallow(s => s.getContinueWatching()));
  const clearEntry = useWatchStore(s => s.clearEntry);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 20);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 20);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    updateScrollState();
    return () => el.removeEventListener('scroll', updateScrollState);
  }, [items]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -400 : 400, behavior: 'smooth' });
  };

  if (items.length === 0) return null;

  return (
    <section className="mb-6 group/row">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-gradient-to-b from-cyan-400 to-violet-500" />
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Continue Watching
          </h2>
          <span className="text-[10px] text-white/25 font-medium bg-white/5 px-2 py-0.5 rounded-full">{items.length}</span>
        </div>
      </div>

      <div className="relative -mx-1">
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-0 bottom-0 z-30 w-12 flex items-center justify-center bg-gradient-to-r from-black/90 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity"
          >
            <ChevronLeft size={20} className="text-white" />
          </button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-0 bottom-0 z-30 w-12 flex items-center justify-center bg-gradient-to-l from-black/90 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity"
          >
            <ChevronRight size={20} className="text-white" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scrollbar-none scroll-smooth px-1 pb-2"
        >
          {items.map((item) => (
            <ContinueCard
              key={`${item.tmdbId}:${item.season ?? ''}:${item.episode ?? ''}`}
              item={item}
              onRemove={() => {
                const key = item.season !== undefined && item.episode !== undefined
                  ? `${item.tmdbId}:${item.season}:${item.episode}`
                  : item.tmdbId;
                clearEntry(key);
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ContinueCard({ item, onRemove }: { item: WatchEntry; onRemove: () => void }) {
  const watchUrl = item.mediaType === 'tv'
    ? `/watch/${item.tmdbId}?type=tv&s=${item.season}&e=${item.episode}`
    : `/watch/${item.tmdbId}?type=movie`;

  const subtitle = item.mediaType === 'tv'
    ? `S${item.season} E${item.episode}`
    : '';

  // Use backdrop for landscape cards
  const bgUrl = item.backdropPath
    ? `https://image.tmdb.org/t/p/w780${item.backdropPath}`
    : item.posterPath
      ? `https://image.tmdb.org/t/p/w342${item.posterPath}`
      : null;

  // Calculate time remaining
  const timeRemaining = item.duration > 0
    ? Math.round((item.duration - item.currentTime) / 60)
    : 0;

  return (
    <div className="relative flex-shrink-0 w-[280px] sm:w-[320px] group/card card-hover">
      {/* Remove button */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
        className="absolute -top-1.5 -right-1.5 z-30 w-6 h-6 rounded-full bg-black/80 border border-white/10 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity hover:bg-red-500/80 hover:border-red-500/30"
        aria-label="Remove from continue watching"
      >
        <X size={12} className="text-white" />
      </button>

      <Link href={watchUrl} className="block">
        {/* Landscape Card */}
        <div className="relative aspect-video rounded-xl overflow-hidden bg-white/5 border border-white/5 group-hover/card:border-violet-500/20 transition-all">
          {bgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bgUrl}
              alt={item.title}
              className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-500"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full shimmer" />
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent" />

          {/* Play overlay on hover */}
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-xl flex items-center justify-center border border-white/30 shadow-2xl hover:scale-110 transition-transform">
              <Play size={24} className="text-white ml-1" fill="white" />
            </div>
          </div>

          {/* Bottom info overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
            <h3 className="text-white font-semibold text-sm truncate leading-tight">{item.title}</h3>
            <div className="flex items-center gap-2 mt-1">
              {subtitle && (
                <span className="text-violet-300/80 text-[11px] font-semibold">{subtitle}</span>
              )}
              {timeRemaining > 0 && (
                <span className="flex items-center gap-1 text-white/40 text-[11px]">
                  <Clock size={10} /> {timeRemaining}m left
                </span>
              )}
            </div>
          </div>

          {/* Progress bar with gradient */}
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 z-20">
            <div
              className="h-full rounded-r-full transition-[width] duration-700 ease-out"
              style={{
                background: 'linear-gradient(90deg, #8b5cf6, #06b6d4)',
                width: `${Math.min(100, item.progress)}%`,
              }}
            />
          </div>
        </div>
      </Link>
    </div>
  );
}
