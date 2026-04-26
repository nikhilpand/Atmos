"use client";
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X } from 'lucide-react';
import Image from 'next/image';
import { META_URL } from '@/lib/constants';

interface SearchResult {
  tmdb_id: number;
  title?: string;
  name?: string;
  media_type: string;
  poster_path: string | null;
  year?: string;
  overview?: string;
  rating?: number;
}

interface SearchBarProps {
  onResultClick: (result: SearchResult) => void;
}

export default function SearchBar({ onResultClick }: SearchBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const searchTMDB = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setActiveIdx(-1); return; }
    setIsLoading(true);
    try {
      const res = await fetch(`${META_URL}/search?query=${encodeURIComponent(q)}&page=1`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setResults((data.results || []).slice(0, 8));
    } catch (err) {
      console.error('[SearchBar] Error searching TMDB:', err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchTMDB(query), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, searchTMDB]);

  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus();
  }, [isOpen]);

  // Global keyboard: ⌘K to open, Escape to close, arrows + Enter to navigate results
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        setQuery('');
        setResults([]);
        setActiveIdx(-1);
      }
      if (!isOpen) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(prev => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(prev => Math.max(prev - 1, -1));
      } else if (e.key === 'Enter' && activeIdx >= 0 && results[activeIdx]) {
        e.preventDefault();
        onResultClick(results[activeIdx]);
        setIsOpen(false);
        setQuery('');
        setResults([]);
        setActiveIdx(-1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, results, activeIdx, onResultClick]);

  return (
    <>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 h-9 px-3 rounded-full bg-white/10 hover:bg-white/20 transition-all duration-200 border border-white/10"
        aria-label="Search"
      >
        <Search size={14} className="text-white/70" />
        <span className="hidden sm:inline text-white/30 text-[10px] font-mono border border-white/10 rounded px-1 py-0.5">⌘K</span>
      </button>

      {/* Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-2xl flex flex-col items-center"
            onClick={() => { setIsOpen(false); setQuery(''); setResults([]); }}
          >
            <motion.div
              initial={{ y: -30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="w-full max-w-2xl mt-24 px-4"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Search Input */}
              <div className="relative">
                <Search size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search movies, TV shows..."
                  className="w-full h-14 pl-14 pr-14 bg-white/5 border border-white/10 rounded-2xl text-white placeholder:text-white/30 text-lg focus:outline-none focus:border-white/25 focus:bg-white/8 transition-all"
                />
                {query && (
                  <button
                    onClick={() => { setQuery(''); setResults([]); }}
                    className="absolute right-5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              {/* Loading indicator */}
              {isLoading && (
                <div className="mt-4 flex justify-center">
                  <div className="w-5 h-5 border-2 border-white/10 border-t-white rounded-full animate-spin" />
                </div>
              )}

              {/* Results */}
              {results.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 bg-white/5 border border-white/10 rounded-2xl overflow-hidden divide-y divide-white/5"
                >
                  {results.map((item) => (
                    <button
                      key={`${item.media_type}-${item.tmdb_id}`}
                      onClick={() => {
                        onResultClick(item);
                        setIsOpen(false);
                        setQuery('');
                        setResults([]);
                      }}
                      className={`w-full flex items-center gap-4 p-3 transition-colors text-left ${results.indexOf(item) === activeIdx ? 'bg-violet-500/15 border-l-2 border-violet-500' : 'hover:bg-white/5'}`}
                    >
                      <div className="w-12 h-16 rounded-lg overflow-hidden bg-white/5 flex-shrink-0 relative">
                        {item.poster_path ? (
                          <Image
                            src={`https://image.tmdb.org/t/p/w92${item.poster_path}`}
                            alt={item.title || item.name || 'Poster'}
                            fill
                            className="object-cover"
                            sizes="48px"
                          />
                        ) : (
                          <div className="w-full h-full shimmer" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">
                          {item.title || item.name}
                        </p>
                        <p className="text-white/40 text-xs mt-0.5">
                          {item.media_type === 'tv' ? 'TV Show' : 'Movie'}
                          {item.year && ` · ${item.year}`}
                          {item.rating && ` · ★ ${item.rating}`}
                        </p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}

              {/* Empty state */}
              {query.length >= 2 && !isLoading && results.length === 0 && (
                <p className="text-white/30 text-center mt-8 text-sm">No results found for &quot;{query}&quot;</p>
              )}

              {/* Hint */}
              {!query && (
                <p className="text-white/20 text-center mt-6 text-xs tracking-wide">Press ESC to close</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
