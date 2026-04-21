/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, ChevronDown, Star, Clock, Calendar, Image as ImageIcon } from 'lucide-react';
import type { Season, Episode } from '@/lib/api';

interface SeasonSelectorProps {
  tmdbId: number | string;
  seasons: Season[];
  episodes?: Episode[];
  onSeasonChange: (seasonNumber: number) => void;
  selectedSeason: number;
  isLoadingEpisodes?: boolean;
}

export default function SeasonSelector({
  tmdbId,
  seasons,
  episodes = [],
  onSeasonChange,
  selectedSeason,
  isLoadingEpisodes,
}: SeasonSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);

  if (seasons.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Season Dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(prev => !prev)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium text-sm transition-all"
        >
          Season {selectedSeason}
          <ChevronDown size={16} className={`text-white/50 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {showDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 mt-2 z-50 w-52 rounded-xl bg-zinc-900/95 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="max-h-64 overflow-y-auto scrollbar-none">
                {seasons.map(s => (
                  <button
                    key={s.season_number}
                    onClick={() => {
                      onSeasonChange(s.season_number);
                      setShowDropdown(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${
                      s.season_number === selectedSeason
                        ? 'bg-violet-600/20 text-white'
                        : 'text-white/60 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="text-white/30 text-xs ml-auto">{s.episode_count} ep</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Episode List */}
      <div className="space-y-2">
        {isLoadingEpisodes ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-3 rounded-xl bg-white/[0.02]">
              <div className="w-32 aspect-video rounded-lg shimmer flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded shimmer" />
                <div className="h-3 w-1/2 rounded shimmer" />
              </div>
            </div>
          ))
        ) : (
          episodes.map(ep => (
            <Link
              key={ep.episode_number}
              href={`/watch/${tmdbId}?type=tv&s=${ep.season_number}&e=${ep.episode_number}`}
            >
              <motion.div
                whileHover={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                className="flex gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all cursor-pointer group"
              >
                {/* Episode Still */}
                <div className="w-32 sm:w-40 aspect-video rounded-lg overflow-hidden bg-white/5 flex-shrink-0 relative">
                  {ep.still_path ? (
                    <img
                      src={`https://image.tmdb.org/t/p/w300${ep.still_path}`}
                      alt={ep.name}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon size={20} className="text-white/10" />
                    </div>
                  )}
                  {/* Play overlay */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                    <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                      <Play size={14} className="text-white ml-0.5" fill="currentColor" />
                    </div>
                  </div>
                </div>

                {/* Episode Info */}
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white/40 text-xs font-medium">E{ep.episode_number}</span>
                    <h4 className="text-white text-sm font-medium truncate">{ep.name}</h4>
                  </div>
                  
                  <div className="flex items-center gap-3 text-[11px] text-white/30 mb-1.5">
                    {ep.air_date && (
                      <span className="flex items-center gap-0.5">
                        <Calendar size={10} />
                        {ep.air_date}
                      </span>
                    )}
                    {ep.runtime && (
                      <span className="flex items-center gap-0.5">
                        <Clock size={10} />
                        {ep.runtime}m
                      </span>
                    )}
                    {ep.vote_average !== undefined && ep.vote_average > 0 && (
                      <span className="flex items-center gap-0.5 text-amber-400/60">
                        <Star size={10} fill="currentColor" />
                        {ep.vote_average.toFixed(1)}
                      </span>
                    )}
                  </div>

                  {ep.overview && (
                    <p className="text-white/30 text-xs line-clamp-2 leading-relaxed hidden sm:block">
                      {ep.overview}
                    </p>
                  )}
                </div>
              </motion.div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
