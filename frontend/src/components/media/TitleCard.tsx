"use client";

/* eslint-disable @next/next/no-img-element */
import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Star, Info, Plus, Check } from 'lucide-react';
import { posterUrl, type TMDBItem } from '@/lib/api';
import { useWatchStore } from '@/store/useWatchStore';
import { useMediaStore } from '@/store/useMediaStore';
import { GENRES } from '@/lib/constants';

interface TitleCardProps {
  item: TMDBItem;
  featured?: boolean;
}

export default function TitleCard({ item, featured }: TitleCardProps) {
  const title = item.title || item.name || '';
  const type = item.media_type || 'movie';
  const id = item.tmdb_id || item.id;
  const rating = item.vote_average;
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const imgSrc = posterUrl(item.poster_path, 'medium');
  const [isHovered, setIsHovered] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const hoverTimeout = useRef<NodeJS.Timeout | null>(null);

  // Watch progress
  const getEntry = useWatchStore(s => s.getEntry);
  const entry = getEntry(String(id));
  const progress = entry?.progress || 0;
  const hasProgress = progress > 3 && progress < 92;

  // Watchlist
  const isInWatchlist = useMediaStore(s => s.isInWatchlist(id));
  const toggleWatchlist = useMediaStore(s => s.toggleWatchlist);

  // Genre names
  const genreNames = (item.genre_ids || [])
    .map(gid => GENRES.find(g => g.id === gid)?.name)
    .filter(Boolean)
    .slice(0, 2);

  const handleMouseEnter = () => {
    hoverTimeout.current = setTimeout(() => setIsHovered(true), 400);
    // Pre-warm request
    fetch(`/api/resolve?id=${id}&type=${type}&season=1&episode=1`).catch(() => { });
  };

  const handleMouseLeave = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setIsHovered(false);
  };

  useEffect(() => {
    return () => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); };
  }, []);

  return (
    <div
      className="relative group"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Link href={`/title/${id}?type=${type}&title=${encodeURIComponent(title)}`} prefetch={true}>
        <motion.div
          whileHover={{ y: -8, scale: 1.05 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="relative rounded-xl overflow-hidden cursor-pointer aspect-[2/3] w-full bg-white/[0.03]"
        >
          {/* Poster Image with blur-up */}
          {imgSrc && (
            <>
              {!imgLoaded && (
                <div className="absolute inset-0 shimmer" />
              )}
              <img
                src={imgSrc}
                alt={title}
                loading="lazy"
                decoding="async"
                onLoad={() => setImgLoaded(true)}
                className={`absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-110 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
              />
            </>
          )}
          {!imgSrc && (
            <div className="absolute inset-0 shimmer flex items-center justify-center">
              <span className="text-white/20 text-xs text-center px-2">{title}</span>
            </div>
          )}

          {/* Gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-70 group-hover:opacity-40 transition-opacity duration-300" />

          {/* Type Badge */}
          {type === 'tv' && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-violet-500/90 backdrop-blur-sm text-[10px] font-bold text-white uppercase tracking-wider z-20">
              TV
            </div>
          )}

          {/* Rating Badge */}
          {rating && rating > 0 && (
            <div className="absolute top-2 right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] text-amber-400 font-semibold z-20">
              <Star size={9} fill="currentColor" />
              {rating.toFixed(1)}
            </div>
          )}

          {/* Bottom Info */}
          <div className="absolute bottom-0 left-0 right-0 p-2.5 z-20">
            <h3 className="text-white font-semibold text-xs sm:text-sm truncate leading-tight">{title}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              {year && <span className="text-white/40 text-[10px]">{year}</span>}
              {genreNames.length > 0 && (
                <>
                  <span className="text-white/20 text-[10px]">·</span>
                  <span className="text-white/30 text-[10px] truncate">{genreNames.join(' · ')}</span>
                </>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {hasProgress && (
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 z-30">
              <div
                className="h-full rounded-r-full bg-gradient-to-r from-violet-500 to-cyan-400"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {/* Hover Play Icon */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 z-10">
            <div className="w-12 h-12 rounded-full bg-white/15 backdrop-blur-xl flex items-center justify-center border border-white/25 shadow-2xl">
              <Play size={20} className="text-white ml-0.5" fill="currentColor" />
            </div>
          </div>

          {/* Hover glow border */}
          <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-violet-500/20 transition-colors duration-300 z-20 pointer-events-none" />
        </motion.div>
      </Link>

      {/* ─── Hover Expansion Panel ─── */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute left-1/2 -translate-x-1/2 top-[calc(100%+4px)] z-50 w-[200px] sm:w-[220px] p-3 rounded-xl bg-zinc-900/95 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 pointer-events-auto"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={handleMouseLeave}
          >
            {/* Quick actions */}
            <div className="flex items-center gap-1.5 mb-2">
              <Link href={`/watch/${id}?type=${type}`}>
                <button className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white text-black text-[11px] font-bold hover:bg-white/90 transition-colors">
                  <Play size={11} fill="currentColor" /> Play
                </button>
              </Link>
              <button
                onClick={(e) => { e.preventDefault(); toggleWatchlist({ id, tmdbId: id, type: type as 'movie' | 'tv', title, posterPath: item.poster_path }); }}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center border border-white/10 transition-colors"
              >
                {isInWatchlist ? <Check size={12} className="text-green-400" /> : <Plus size={12} className="text-white" />}
              </button>
              <Link href={`/title/${id}?type=${type}&title=${encodeURIComponent(title)}`}>
                <button className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center border border-white/10 transition-colors">
                  <Info size={12} className="text-white" />
                </button>
              </Link>
            </div>

            {/* Meta */}
            <div className="flex items-center gap-2 text-[10px] text-white/50 mb-1.5">
              {rating && rating > 0 && (
                <span className="text-green-400 font-bold">{Math.round(rating * 10)}% Match</span>
              )}
              {year && <span>{year}</span>}
              {type === 'tv' && <span className="px-1 py-0.5 rounded border border-white/10 text-[9px]">TV</span>}
            </div>

            {/* Genres */}
            {genreNames.length > 0 && (
              <p className="text-white/40 text-[10px]">{genreNames.join(' · ')}</p>
            )}

            {/* Synopsis */}
            {item.overview && (
              <p className="text-white/30 text-[10px] leading-relaxed line-clamp-2 mt-1">{item.overview}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
