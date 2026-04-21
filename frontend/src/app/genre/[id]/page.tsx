"use client";

import React, { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRef, useCallback } from 'react';
import Link from 'next/link';
import FrostedNavbar from '@/components/ui/FrostedNavbar';
import TitleCard from '@/components/media/TitleCard';
import { fetchGenreContent } from '@/lib/api';
import { GENRES, TV_GENRES } from '@/lib/constants';
import { motion, AnimatePresence } from 'framer-motion';

function GenrePageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const genreId = parseInt(params.id as string);
  const type = (searchParams.get('type') || 'movie') as 'movie' | 'tv';
  
  const allGenres = type === 'tv' ? TV_GENRES : GENRES;
  const genre = allGenres.find(g => g.id === genreId);
  const genreName = genre?.name || 'Browse';

  const observerRef = useRef<IntersectionObserver | null>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ['genre', genreId, type],
    queryFn: ({ pageParam = 1 }) => fetchGenreContent(genreId, type, pageParam as number),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.totalPages && lastPage.page < 10) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    enabled: !!genreId,
  });

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
    <div className="min-h-screen pb-20">
      <FrostedNavbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">{genreName}</h1>
          <p className="text-white/40 text-sm mt-2">{type === 'tv' ? 'TV Shows' : 'Movies'}</p>
        </div>

        {/* Type Toggle — uses Link for SPA navigation (no full reload) */}
        <div className="flex gap-2 mb-8">
          {(['movie', 'tv'] as const).map(t => (
            <Link
              key={t}
              href={`/genre/${genreId}?type=${t}`}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                type === t
                  ? 'bg-white/10 text-white border border-white/20'
                  : 'text-white/40 hover:text-white/70 border border-transparent'
              }`}
            >
              {t === 'movie' ? 'Movies' : 'TV Shows'}
            </Link>
          ))}
        </div>

        {/* Loading */}
        {status === 'pending' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] rounded-xl shimmer" />
            ))}
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="text-center py-20">
            <p className="text-red-400">Failed to load content</p>
          </div>
        )}

        {/* Grid */}
        {status === 'success' && (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${genreId}-${type}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
            >
              {allItems.map((item, index) => (
                <motion.div
                  key={`${item.id}-${index}`}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.02, 0.2) }}
                >
                  <TitleCard item={item} />
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
    </div>
  );
}

export default function GenrePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black pt-24 px-4">
        <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-xl shimmer" />
          ))}
        </div>
      </div>
    }>
      <GenrePageInner />
    </Suspense>
  );
}
