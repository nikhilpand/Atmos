"use client";

// ═══════════════════════════════════════════════════════════════════════
// ATMOS V6 — Continue Watching Row
// ═══════════════════════════════════════════════════════════════════════
// Reads from Zustand watch store (localStorage-backed).
// Shows progress bars on each card. Clicking resumes from exact position.
// Items auto-remove when 92%+ completed.

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Play, X } from 'lucide-react';
import { useWatchStore, type WatchEntry } from '@/store/useWatchStore';
import { useShallow } from 'zustand/react/shallow';

export default function ContinueWatchingRow() {
  const items = useWatchStore(useShallow(s => s.getContinueWatching()));
  const clearEntry = useWatchStore(s => s.clearEntry);

  if (items.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
          Continue Watching
        </h2>
        <span className="text-xs text-white/30">{items.length} titles</span>
      </div>

      <div className="flex gap-3 overflow-x-auto scrollbar-none pb-2">
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
    </section>
  );
}

function ContinueCard({ item, onRemove }: { item: WatchEntry; onRemove: () => void }) {
  const watchUrl = item.mediaType === 'tv'
    ? `/watch/${item.tmdbId}?type=tv&s=${item.season}&e=${item.episode}`
    : `/watch/${item.tmdbId}?type=movie`;

  const subtitle = item.mediaType === 'tv'
    ? `S${item.season} E${item.episode}`
    : `${Math.round(item.currentTime / 60)}m watched`;

  const posterUrl = item.posterPath
    ? `https://image.tmdb.org/t/p/w342${item.posterPath}`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative flex-shrink-0 w-[140px] sm:w-[160px] group"
    >
      {/* Remove button */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
        className="absolute -top-1.5 -right-1.5 z-20 w-5 h-5 rounded-full bg-black/70 border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
        aria-label="Remove from continue watching"
      >
        <X size={10} className="text-white" />
      </button>

      <Link href={watchUrl} className="block">
        {/* Poster */}
        <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-white/5 mb-2">
          {posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={posterUrl}
              alt={item.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/20 text-xs">
              No Poster
            </div>
          )}

          {/* Play overlay on hover */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Play size={18} className="text-white ml-0.5" fill="white" />
            </div>
          </div>

          {/* Progress bar at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
            <motion.div
              className="h-full bg-red-500 rounded-r-full"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, item.progress)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Title + metadata */}
        <p className="text-white/80 text-xs font-medium truncate leading-tight">
          {item.title}
        </p>
        <p className="text-white/40 text-[10px] mt-0.5">
          {subtitle} · {item.progress}%
        </p>
      </Link>
    </motion.div>
  );
}
