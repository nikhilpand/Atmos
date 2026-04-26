"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import ContentRow from './ContentRow';
import { useWatchStore } from '@/store/useWatchStore';
import { META_URL } from '@/lib/constants';
import { GENRES } from '@/lib/constants';
import type { TMDBItem } from '@/lib/api';

export default function RecommendedRow() {
  const [items, setItems] = useState<TMDBItem[]>([]);
  const [seedTitle, setSeedTitle] = useState('');
  const [seedGenreName, setSeedGenreName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const entries = useWatchStore(s => s.entries);

  // Compute recent genres from entries directly (avoids infinite loop from selector returning new array)
  const recentGenres = useMemo(() => {
    const genreCount: Record<number, number> = {};
    Object.values(entries).forEach(e => {
      (e.genreIds || []).forEach(gid => {
        genreCount[gid] = (genreCount[gid] || 0) + 1;
      });
    });
    return Object.entries(genreCount)
      .map(([id, count]) => ({ genreId: Number(id), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [entries]);

  useEffect(() => {
    const fetchRecommended = async () => {
      setIsLoading(true);
      try {
        if (recentGenres.length === 0) {
          setIsLoading(false);
          return;
        }

        // Get the top genre
        const topGenre = recentGenres[0];
        const genreInfo = GENRES.find(g => g.id === topGenre.genreId);
        setSeedGenreName(genreInfo?.name || 'Your Taste');

        // Find the most recent title with this genre for the seed
        const allEntries = Object.values(entries);
        const seedEntry = allEntries
          .filter(e => e.genreIds?.includes(topGenre.genreId))
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        
        if (seedEntry) {
          setSeedTitle(seedEntry.title);
        }

        // Fetch TMDB discover with this genre
        const res = await fetch(
          `${META_URL}/trending?page=1&media_type=all&time_window=week`
        );
        const data = await res.json();
        
        // Filter by the user's top genre
        const filtered = (data.results || [])
          .filter((item: TMDBItem) => 
            item.genre_ids?.includes(topGenre.genreId) && item.poster_path
          )
          .slice(0, 20);

        // If we don't get enough genre-matched results, supplement with genre #2
        if (filtered.length < 8 && recentGenres.length > 1) {
          const secondGenre = recentGenres[1];
          const moreItems = (data.results || [])
            .filter((item: TMDBItem) => 
              item.genre_ids?.includes(secondGenre.genreId) && 
              item.poster_path &&
              !filtered.some((f: TMDBItem) => f.id === item.id)
            )
            .slice(0, 20 - filtered.length);
          filtered.push(...moreItems);
        }

        setItems(filtered);
      } catch {
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecommended();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentGenres.length]);

  // Don't render if no watch history
  if (!isLoading && items.length === 0) return null;

  const headerTitle = seedTitle
    ? `Because You Watched ${seedTitle}`
    : seedGenreName
      ? `More ${seedGenreName} for You`
      : 'Recommended for You';

  return (
    <div className="relative">
      {/* Subtle recommendation badge */}
      <div className="flex items-center gap-1.5 mb-1 px-1">
        <Sparkles size={12} className="text-amber-400/60" />
        <span className="text-[10px] font-semibold text-amber-400/50 uppercase tracking-widest">Personalized</span>
      </div>
      <ContentRow
        title={headerTitle}
        items={items}
        isLoading={isLoading}
      />
    </div>
  );
}
