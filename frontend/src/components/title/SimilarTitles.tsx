"use client";

import React from 'react';
import TitleCard from '@/components/media/TitleCard';
import type { TMDBItem } from '@/lib/api';

interface SimilarTitlesProps {
  items: TMDBItem[];
  title?: string;
}

export default function SimilarTitles({ items, title = "More Like This" }: SimilarTitlesProps) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-white font-semibold text-base">{title}</h3>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
        {items.map(item => (
          <TitleCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
