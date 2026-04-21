/* eslint-disable @next/next/no-img-element */
"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { Play, Star } from 'lucide-react';

interface GlassCardProps {
  id: string | number;
  title: string;
  imageUrl: string;
  year?: string;
  rating?: number;
  mediaType?: string;
  onClick: () => void;
}

export default function GlassCard({ title, imageUrl, year, rating, mediaType, onClick }: GlassCardProps) {
  return (
    <motion.div
      whileHover={{ y: -6, scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      onClick={onClick}
      className="relative group rounded-xl overflow-hidden cursor-pointer aspect-[2/3] w-full bg-white/5"
    >
      {/* Background Image */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={title}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
      ) : (
        <div className="absolute inset-0 shimmer" />
      )}
      
      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent opacity-70 group-hover:opacity-50 transition-opacity duration-300" />

      {/* Media Type Badge */}
      {mediaType === 'tv' && (
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-violet-500/80 backdrop-blur-sm text-[10px] font-bold text-white uppercase tracking-wider z-20">
          TV
        </div>
      )}

      {/* Rating Badge */}
      {rating && rating > 0 && (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] text-amber-400 font-medium z-20">
          <Star size={9} fill="currentColor" />
          {rating.toFixed(1)}
        </div>
      )}

      {/* Bottom Info */}
      <div className="absolute bottom-0 left-0 right-0 p-3 z-20">
        <h3 className="text-white font-semibold text-sm truncate leading-tight">{title}</h3>
        {year && <p className="text-white/40 text-[11px] mt-0.5">{year}</p>}
      </div>
      
      {/* Hover Play Overlay */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 z-10">
        <div className="w-12 h-12 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center border border-white/25 shadow-2xl">
          <Play size={20} className="text-white ml-0.5" fill="currentColor" />
        </div>
      </div>
    </motion.div>
  );
}
