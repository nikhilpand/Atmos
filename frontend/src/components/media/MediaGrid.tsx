"use client";

import React, { useRef, useCallback, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import GlassCard from './GlassCard';
import { motion, AnimatePresence } from 'framer-motion';

const META_URL = "https://nikhil1776-atmos-meta.hf.space";

const CATEGORIES = [
  { label: "Trending", value: "trending" },
  { label: "Movies", value: "movie" },
  { label: "TV Shows", value: "tv" },
];

const fetchContent = async ({ pageParam = 1, category = "trending" }: { pageParam?: number; category?: string }) => {
  let url: string;
  if (category === "trending") {
    url = `${META_URL}/trending?page=${pageParam}&media_type=all&time_window=day`;
  } else {
    url = `${META_URL}/trending?page=${pageParam}&media_type=${category}&time_window=week`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('Network response was not ok');
  const data = await res.json();
  return { results: data.results || [], page: data.page || pageParam, totalPages: data.total_pages || 1 };
};

interface ContentItem {
  tmdb_id?: number;
  id?: number;
  title?: string;
  name?: string;
  poster_path?: string;
  year?: string;
  rating?: number;
  media_type?: string;
}

export default function MediaGrid() {
  const [category, setCategory] = useState("trending");
  const observerRef = useRef<IntersectionObserver | null>(null);
  const router = useRouter();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ['content', category],
    queryFn: ({ pageParam }) => fetchContent({ pageParam, category }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.totalPages && lastPage.page < 10) {
        return lastPage.page + 1;
      }
      return undefined;
    },
  });

  // Reliable IntersectionObserver-based infinite scroll
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '400px' }
    );
    observerRef.current.observe(node);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const allItems = data?.pages.flatMap(p => p.results) || [];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Category Pills */}
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2 scrollbar-none">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategory(cat.value)}
            className={`relative px-5 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-300 ${
              category === cat.value
                ? 'text-white'
                : 'text-white/50 hover:text-white/80 bg-transparent'
            }`}
          >
            {category === cat.value && (
              <motion.div
                layoutId="activePill"
                className="absolute inset-0 bg-white/10 border border-white/20 rounded-full"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative z-10">{cat.label}</span>
          </button>
        ))}
      </div>

      {/* Loading State */}
      {status === 'pending' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 lg:gap-6">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-2xl shimmer" />
          ))}
        </div>
      )}

      {/* Error State */}
      {status === 'error' && (
        <div className="text-center py-20">
          <p className="text-red-400 text-lg">Failed to load content</p>
          <p className="text-white/30 text-sm mt-2">Check your connection and try again</p>
        </div>
      )}

      {/* Content Grid */}
      {status === 'success' && (
        <AnimatePresence mode="wait">
          <motion.div
            key={category}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 lg:gap-6"
          >
            {allItems.map((item: ContentItem, index: number) => (
              <motion.div
                key={`${item.tmdb_id}-${index}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.3) }}
              >
                <GlassCard
                  id={item.tmdb_id || item.id || index}
                  title={item.title || item.name || ""}
                  imageUrl={item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : ''}
                  year={item.year}
                  rating={item.rating}
                  mediaType={item.media_type}
                  onClick={() => router.push(`/title/${item.tmdb_id || item.id || index}?type=${item.media_type || 'movie'}`)}
                />
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Infinite Scroll Sentinel */}
      <div ref={loadMoreRef} className="h-20 flex items-center justify-center mt-8">
        {isFetchingNextPage ? (
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-white/10 border-t-white rounded-full animate-spin" />
            <span className="text-white/30 text-sm">Loading more...</span>
          </div>
        ) : hasNextPage ? (
          <span className="text-white/20 text-xs">Scroll for more</span>
        ) : allItems.length > 0 ? (
          <span className="text-white/20 text-xs">You&apos;ve reached the end</span>
        ) : null}
      </div>
    </div>
  );
}
