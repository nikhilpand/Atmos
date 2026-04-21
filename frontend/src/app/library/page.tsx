"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import FrostedNavbar from '@/components/ui/FrostedNavbar';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Play, HardDrive, Film, Tv, FileVideo, ExternalLink, Filter } from 'lucide-react';
import { CONTROL_URL } from '@/lib/constants';

interface DriveFile {
  id: string;
  name: string;
  title?: string;
  size?: number;
  mimeType?: string;
  stream_url?: string;
  modifiedTime?: string;
  media_type?: string;
}

export default function LibraryPage() {
  const router = useRouter();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'movie' | 'tv' | 'anime'>('all');

  // Fetch Drive files
  useEffect(() => {
    const fetchFiles = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${CONTROL_URL}/api/videos`);
        if (res.ok) {
          const data = await res.json();
          setFiles(data.videos || data.files || []);
        } else {
          setError('Failed to fetch library');
        }
      } catch {
        setError('Could not connect to Drive server');
      } finally {
        setIsLoading(false);
      }
    };
    fetchFiles();
  }, []);

  const playFile = (file: DriveFile) => {
    const params = new URLSearchParams({
      fileId: file.id,
      fileName: file.name || file.title || '',
    });
    router.push(`/watch/gdrive?${params}`);
  };

  // Filter and search
  const filteredFiles = useMemo(() => {
    let result = files;
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(f => 
        (f.name || f.title || '').toLowerCase().includes(q)
      );
    }

    if (filterType !== 'all') {
      result = result.filter(f => {
        const name = (f.name || f.title || '').toLowerCase();
        switch (filterType) {
          case 'movie':
            return !name.includes('s0') && !name.includes('season') && !name.includes('episode');
          case 'tv':
            return name.includes('s0') || name.includes('season') || name.includes('episode');
          case 'anime':
            return name.includes('anime') || name.includes('sub') || name.includes('dub');
          default:
            return true;
        }
      });
    }

    return result;
  }, [files, searchQuery, filterType]);

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes > 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    if (bytes > 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="min-h-screen pb-20">
      <FrostedNavbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/30 to-cyan-500/30 flex items-center justify-center border border-blue-500/20">
            <HardDrive size={20} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Drive Library</h1>
            <p className="text-white/40 text-sm">
              {files.length} files available · Stream directly from Google Drive
            </p>
          </div>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mt-6 mb-8">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search library..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-violet-500/30 focus:bg-white/[0.07] transition-all"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex gap-1.5">
            {[
              { value: 'all', label: 'All', icon: Filter },
              { value: 'movie', label: 'Movies', icon: Film },
              { value: 'tv', label: 'TV', icon: Tv },
              { value: 'anime', label: 'Anime', icon: FileVideo },
            ].map(f => (
              <button
                key={f.value}
                onClick={() => setFilterType(f.value as typeof filterType)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  filterType === f.value
                    ? 'bg-violet-600/20 text-violet-300 border border-violet-500/20'
                    : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white border border-white/5'
                }`}
              >
                <f.icon size={12} />
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.02]">
                <div className="w-10 h-10 rounded-lg shimmer" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded shimmer" />
                  <div className="h-3 w-1/4 rounded shimmer" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center py-20">
            <HardDrive size={48} className="text-white/10 mx-auto mb-4" />
            <p className="text-white/50 text-lg">{error}</p>
            <p className="text-white/30 text-sm mt-1">Make sure the Drive server is running</p>
          </div>
        )}

        {/* File List */}
        {!isLoading && !error && (
          <div className="space-y-1">
            {filteredFiles.length === 0 ? (
              <div className="text-center py-20">
                <Search size={40} className="text-white/10 mx-auto mb-4" />
                <p className="text-white/40">No files match your search</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {filteredFiles.map((file, i) => (
                  <motion.div
                    key={file.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: Math.min(i * 0.02, 0.15) }}
                    onClick={() => playFile(file)}
                    className="flex items-center gap-4 p-3 sm:p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.03] hover:border-violet-500/20 transition-all group cursor-pointer"
                  >
                    {/* Icon */}
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center flex-shrink-0 border border-white/5 group-hover:from-violet-500/30 group-hover:to-cyan-500/30 transition-all">
                      <FileVideo size={18} className="text-violet-400/70" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{file.name || file.title}</p>
                      <div className="flex items-center gap-3 text-[11px] text-white/30 mt-0.5">
                        {file.size && <span>{formatSize(file.size)}</span>}
                        {file.mimeType && <span>{file.mimeType.split('/').pop()}</span>}
                        {file.modifiedTime && <span>{new Date(file.modifiedTime).toLocaleDateString()}</span>}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); playFile(file); }}
                        className="p-2 rounded-lg bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 transition-colors"
                        title="Play"
                      >
                        <Play size={14} fill="currentColor" />
                      </button>
                      <a
                        href={`https://drive.google.com/file/d/${file.id}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                        title="Open in Drive"
                      >
                        <ExternalLink size={14} />
                      </a>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}

            {/* Count */}
            {filteredFiles.length > 0 && (
              <div className="text-center py-6">
                <span className="text-white/20 text-xs">
                  Showing {filteredFiles.length} of {files.length} files
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
