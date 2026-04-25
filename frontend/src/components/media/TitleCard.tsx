"use client";

/* eslint-disable @next/next/no-img-element */
import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Play, Star } from 'lucide-react';
import { posterUrl, type TMDBItem } from '@/lib/api';

interface TitleCardProps {
  item: TMDBItem;
}

export default function TitleCard({ item }: TitleCardProps) {
  const title = item.title || item.name || '';
  const type = item.media_type || 'movie';
  const id = item.tmdb_id || item.id;
  const rating = item.vote_average;
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const imgSrc = posterUrl(item.poster_path, 'medium');

  const handleHover = () => {
    // Fire and forget pre-warm request
    fetch(`/api/resolve?id=${id}&type=${type}&season=1&episode=1`).catch(() => { });
  };

  return (
    <Link href={`/title/${id}?type=${type}&title=${encodeURIComponent(title)}`} prefetch={true}>
      <motion.div
        onMouseEnter={handleHover}
        whileHover={{ y: -6, scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className="relative group rounded-xl overflow-hidden cursor-pointer aspect-[2/3] w-full bg-white/[0.03]"
      >
        {/* Poster Image */}
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={title}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
        ) : (
          <div className="absolute inset-0 shimmer flex items-center justify-center">
            <span className="text-white/20 text-xs text-center px-2">{title}</span>
          </div>
        )}

        {/* Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-40 transition-opacity duration-300" />

        {/* Type Badge */}
        {type === 'tv' && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-violet-500/80 backdrop-blur-sm text-[10px] font-bold text-white uppercase tracking-wider z-20">
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
          {year && <p className="text-white/40 text-[10px] mt-0.5">{year}</p>}
        </div>

        {/* Hover Play Icon */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 z-10">
          <div className="w-11 h-11 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center border border-white/25 shadow-2xl">
            <Play size={18} className="text-white ml-0.5" fill="currentColor" />
          </div>
        </div>

        {/* Hover glow border */}
        <div className="absolute inset-0 rounded-xl border border-white/0 group-hover:border-white/10 transition-colors duration-300 z-20 pointer-events-none" />
      </motion.div>
    </Link>
  );
}
