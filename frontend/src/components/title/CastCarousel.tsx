/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, User } from 'lucide-react';
import type { CastMember } from '@/lib/api';

interface CastCarouselProps {
  cast: CastMember[];
}

export default function CastCarousel({ cast }: CastCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (cast.length === 0) return null;

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -300 : 300, behavior: 'smooth' });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-base">Cast</h3>
        <div className="flex gap-1">
          <button onClick={() => scroll('left')} className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors">
            <ChevronLeft size={14} className="text-white/50" />
          </button>
          <button onClick={() => scroll('right')} className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors">
            <ChevronRight size={14} className="text-white/50" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex gap-3 overflow-x-auto scrollbar-none">
        {cast.map(member => (
          <div key={member.id} className="flex-shrink-0 w-24 text-center group">
            <div className="w-20 h-20 mx-auto rounded-full overflow-hidden bg-white/5 mb-2 border border-white/5">
              {member.profile_path ? (
                <img
                  src={`https://image.tmdb.org/t/p/w185${member.profile_path}`}
                  alt={member.name}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User size={24} className="text-white/15" />
                </div>
              )}
            </div>
            <p className="text-white/80 text-[11px] font-medium truncate">{member.name}</p>
            {member.character && (
              <p className="text-white/30 text-[10px] truncate">{member.character}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
