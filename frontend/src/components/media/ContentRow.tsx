"use client";

import React, { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import TitleCard from './TitleCard';
import type { TMDBItem } from '@/lib/api';

interface ContentRowProps {
  title: string;
  items: TMDBItem[];
  seeAllHref?: string;
  isLoading?: boolean;
}

export default function ContentRow({ title, items, seeAllHref, isLoading }: ContentRowProps) {
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
    const cardWidth = el.querySelector('.title-card')?.clientWidth || 180;
    const scrollAmount = cardWidth * 3;
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  if (isLoading) {
    return (
      <div className="py-4">
        <div className="h-5 w-40 rounded bg-white/5 shimmer mb-4" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-[160px] aspect-[2/3] rounded-xl shimmer" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="py-3 group/row">
      {/* Row Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-white font-semibold text-base sm:text-lg tracking-tight">{title}</h2>
        {seeAllHref && (
          <a
            href={seeAllHref}
            className="text-white/30 hover:text-white/60 text-xs font-medium transition-colors flex items-center gap-1"
          >
            See All <ChevronRight size={12} />
          </a>
        )}
      </div>

      {/* Scroll Container */}
      <div className="relative -mx-1">
        {/* Left Arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-0 bottom-0 z-30 w-10 flex items-center justify-center
              bg-gradient-to-r from-black/80 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity duration-200"
          >
            <ChevronLeft size={24} className="text-white" />
          </button>
        )}

        {/* Right Arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-0 bottom-0 z-30 w-10 flex items-center justify-center
              bg-gradient-to-l from-black/80 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity duration-200"
          >
            <ChevronRight size={24} className="text-white" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scrollbar-none scroll-smooth px-1 pb-2"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {items.map((item, i) => (
            <motion.div
              key={`${item.id}-${i}`}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.3) }}
              className="title-card flex-shrink-0 w-[140px] sm:w-[155px] md:w-[165px] lg:w-[175px]"
              style={{ scrollSnapAlign: 'start' }}
            >
              <TitleCard item={item} />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
