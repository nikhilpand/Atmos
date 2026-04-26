"use client";

import React, { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { posterUrl, type TMDBItem } from '@/lib/api';

interface TopTenRowProps {
  items: TMDBItem[];
  title?: string;
}

export default function TopTenRow({ items, title = "Top 10 Today" }: TopTenRowProps) {
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
    el.scrollBy({
      left: direction === 'left' ? -400 : 400,
      behavior: 'smooth',
    });
  };

  if (items.length === 0) return null;

  return (
    <div className="py-5 group/row">
      {/* Row Header */}
      <div className="flex items-center gap-3 mb-4 px-1">
        <div className="flex items-center gap-2">
          <div className="w-1 h-6 rounded-full bg-gradient-to-b from-red-500 to-amber-500" />
          <h2 className="text-white font-bold text-lg sm:text-xl tracking-tight">{title}</h2>
        </div>
        <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
      </div>

      {/* Scroll Container */}
      <div className="relative -mx-1">
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-0 bottom-0 z-30 w-12 flex items-center justify-center
              bg-gradient-to-r from-black/90 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity duration-200"
          >
            <ChevronLeft size={24} className="text-white" />
          </button>
        )}

        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-0 bottom-0 z-30 w-12 flex items-center justify-center
              bg-gradient-to-l from-black/90 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity duration-200"
          >
            <ChevronRight size={24} className="text-white" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-1 overflow-x-auto scrollbar-none scroll-smooth px-1 pb-2"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {items.slice(0, 10).map((item, i) => {
            const itemTitle = item.title || item.name || '';
            const type = item.media_type || 'movie';
            const id = item.tmdb_id || item.id;
            const imgSrc = posterUrl(item.poster_path, 'large');
            const rank = i + 1;

            return (
              <Link
                key={`${id}-${i}`}
                href={`/title/${id}?type=${type}&title=${encodeURIComponent(itemTitle)}`}
                prefetch={true}
              >
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.06, 0.5) }}
                  whileHover={{ scale: 1.03 }}
                  className="relative flex-shrink-0 flex items-end cursor-pointer group"
                  style={{ scrollSnapAlign: 'start', width: '220px', height: '200px' }}
                >
                  {/* Large Rank Number */}
                  <div className="absolute left-0 bottom-0 z-10 select-none pointer-events-none">
                    <span
                      className="text-[120px] font-black leading-none tracking-tighter"
                      style={{
                        WebkitTextStroke: '2px rgba(255,255,255,0.15)',
                        color: 'transparent',
                        textShadow: '0 0 40px rgba(139,92,246,0.15)',
                      }}
                    >
                      {rank}
                    </span>
                  </div>

                  {/* Poster Card */}
                  <div className="absolute right-0 bottom-2 w-[120px] z-20">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden shadow-2xl shadow-black/60 border border-white/10 group-hover:border-violet-500/30 transition-colors">
                      {imgSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imgSrc}
                          alt={itemTitle}
                          loading={i < 3 ? "eager" : "lazy"}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                        />
                      ) : (
                        <div className="w-full h-full shimmer flex items-center justify-center">
                          <span className="text-white/20 text-xs text-center px-2">{itemTitle}</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                    </div>
                  </div>
                </motion.div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
