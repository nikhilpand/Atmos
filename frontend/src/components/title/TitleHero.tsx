"use client";

import React from 'react';
import Link from 'next/link';
import { Play, Plus, Star, Clock, Calendar, Check, Globe, Download } from 'lucide-react';
import { motion } from 'framer-motion';
import { backdropUrl, type TMDBDetail } from '@/lib/api';

interface TitleHeroProps {
  detail: TMDBDetail;
  mediaType: 'movie' | 'tv';
  isInWatchlist?: boolean;
  onToggleWatchlist?: () => void;
}

export default function TitleHero({ detail, mediaType, isInWatchlist, onToggleWatchlist }: TitleHeroProps) {
  const title = detail.title || detail.name || '';
  const year = (detail.release_date || detail.first_air_date || '').slice(0, 4);
  const rating = detail.vote_average;
  const runtime = detail.runtime;
  const genres = detail.genres || [];
  const id = detail.id;

  const playUrl = mediaType === 'tv'
    ? `/watch/${id}?type=tv&s=1&e=1`
    : `/watch/${id}?type=movie`;

  const handlePlayHover = () => {
    fetch(`/api/resolve?id=${id}&type=${mediaType}&season=1&episode=1`).catch(() => { });
  };

  return (
    <section className="relative w-full min-h-[70vh] max-h-[800px] overflow-hidden">
      {/* Backdrop Image */}
      {detail.backdrop_path && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${backdropUrl(detail.backdrop_path, 'original')})` }}
        />
      )}

      {/* Gradient Overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-transparent to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex items-end min-h-[70vh] max-h-[800px]">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-16">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="max-w-2xl"
          >
            {/* Tagline */}
            {detail.tagline && (
              <p className="text-violet-300/80 text-sm font-medium mb-2 tracking-wide uppercase">
                {detail.tagline}
              </p>
            )}

            {/* Title */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white mb-4 tracking-tight leading-[1.05]">
              {title}
            </h1>

            {/* Meta Row */}
            <div className="flex flex-wrap items-center gap-3 mb-4 text-sm text-white/60">
              {rating && rating > 0 && (
                <span className="flex items-center gap-1 text-amber-400 font-semibold">
                  <Star size={14} fill="currentColor" />
                  {rating.toFixed(1)}
                </span>
              )}
              {year && (
                <span className="flex items-center gap-1">
                  <Calendar size={13} />
                  {year}
                </span>
              )}
              {runtime && (
                <span className="flex items-center gap-1">
                  <Clock size={13} />
                  {Math.floor(runtime / 60)}h {runtime % 60}m
                </span>
              )}
              {detail.number_of_seasons && (
                <span className="text-white/40">
                  {detail.number_of_seasons} Season{detail.number_of_seasons > 1 ? 's' : ''}
                </span>
              )}
              {detail.spoken_languages && detail.spoken_languages.length > 0 && (
                <span className="flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded-md bg-white/10 text-white/80 text-[10px] uppercase font-bold tracking-wider border border-white/5">
                  <Globe size={10} />
                  {detail.spoken_languages[0].iso_639_1}
                </span>
              )}
              {detail.origin_country && detail.origin_country.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-white/80 text-[10px] uppercase font-bold tracking-wider border border-white/5">
                  {detail.origin_country[0]}
                </span>
              )}
            </div>

            {/* Genre Pills */}
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-5">
                {genres.slice(0, 5).map(g => (
                  <span
                    key={g.id}
                    className="px-3 py-1 rounded-full text-xs font-medium text-white/60 bg-white/5 border border-white/10"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            )}

            {/* Overview */}
            {detail.overview && (
              <p className="text-white/60 text-sm sm:text-base leading-relaxed mb-6 line-clamp-3">
                {detail.overview}
              </p>
            )}

            {/* CTA Buttons */}
            <div className="flex gap-3">
              <Link href={playUrl} prefetch={true}>
                <div className="relative group" onMouseEnter={handlePlayHover}>
                  <div className="absolute -inset-1 bg-white/20 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-500 animate-pulse" />
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="relative flex items-center gap-2 px-8 py-3.5 bg-white text-black font-bold rounded-full hover:bg-white/90 transition-all text-sm shadow-2xl"
                  >
                    <Play size={18} fill="currentColor" /> Play
                  </motion.button>
                </div>
              </Link>

              <Link href={`/download/${id}?type=${mediaType}`}>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="flex items-center gap-2 px-6 py-3.5 bg-violet-600/80 text-white backdrop-blur-md font-bold rounded-full hover:bg-violet-500 transition-all border border-violet-400/20 text-sm shadow-xl shadow-violet-600/20"
                >
                  <Download size={16} /> Download
                </motion.button>
              </Link>

              {onToggleWatchlist && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={onToggleWatchlist}
                  className="flex items-center gap-2 px-6 py-3.5 bg-white/10 text-white backdrop-blur-md font-medium rounded-full hover:bg-white/20 transition-all border border-white/15 text-sm"
                >
                  {isInWatchlist ? <Check size={18} /> : <Plus size={18} />}
                  {isInWatchlist ? 'In My List' : 'My List'}
                </motion.button>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
