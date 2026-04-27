"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import ContentRow from './ContentRow';
import { useWatchStore } from '@/store/useWatchStore';
import { TMDB_BASE, TMDB_API_KEY } from '@/lib/constants';
import type { TMDBItem } from '@/lib/api';

const TMDB_KEY = TMDB_API_KEY || '';

async function fetchRecommendationsForTitle(tmdbId: number, type: 'movie' | 'tv'): Promise<TMDBItem[]> {
  try {
    const path = `/${type}/${tmdbId}/recommendations`;
    const url = `${TMDB_BASE}${path}?api_key=${TMDB_KEY}&language=en-US&page=1`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || [])
      .filter((i: TMDBItem) => i.poster_path)
      .map((i: TMDBItem) => ({ ...i, media_type: type }));
  } catch {
    return [];
  }
}

export default function RecommendedRow() {
  const [items, setItems] = useState<TMDBItem[]>([]);
  const [seedTitle, setSeedTitle] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const entries = useWatchStore(s => s.entries);

  // Pick the most recently watched title as the seed
  const seedEntry = useMemo(() => {
    const all = Object.values(entries);
    if (all.length === 0) return null;
    return all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }, [entries]);

  useEffect(() => {
    if (!seedEntry || !TMDB_KEY) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setSeedTitle(seedEntry.title || '');

    fetchRecommendationsForTitle(
      Number(seedEntry.tmdbId),
      seedEntry.mediaType,
    )
      .then(results => setItems(results.slice(0, 20)))
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedEntry?.tmdbId]);

  if (!isLoading && items.length === 0) return null;

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 mb-1 px-1">
        <Sparkles size={12} className="text-amber-400/60" />
        <span className="text-[10px] font-semibold text-amber-400/50 uppercase tracking-widest">
          Personalized
        </span>
      </div>
      <ContentRow
        title={seedTitle ? `Because You Watched: ${seedTitle}` : 'Recommended for You'}
        items={items}
        isLoading={isLoading}
      />
    </div>
  );
}
