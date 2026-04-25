/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Download, Film, Tv, ChevronDown, ChevronRight, Loader2,
  HardDrive, Globe, CheckCircle2, AlertCircle, Play, FileVideo, RefreshCw,
  Server, Magnet, ArrowUpCircle, ArrowDownCircle, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchTitle, type Episode, type Season } from '@/lib/api';
import { TMDB_IMAGE_BASE } from '@/lib/constants';

// ─── Types ──────────────────────────────────────────────────────────
interface ExtractedStream {
  url: string;
  quality: string;
  type: 'hls' | 'mp4' | 'magnet' | 'torrent' | 'unknown';
  provider: string;
  size?: string;
  seeds?: number;
  peers?: number;
  captions: { language: string; url: string }[];
}

interface EpisodeStreams {
  episode: number;
  season: number;
  streams: ExtractedStream[];
  status: 'idle' | 'loading' | 'done' | 'error';
}

// ─── File name builder ──────────────────────────────────────────────
function buildFileName(title: string, type: string, season?: number, episode?: number, quality?: string, year?: string): string {
  const clean = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '.');
  const yr = year ? `.${year}` : '';
  const ep = type === 'tv' && season && episode ? `.S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}` : '';
  const q = quality ? `.${quality}` : '';
  return `${clean}${yr}${ep}${q}.WEB-DL.mp4`;
}

// ─── Size estimator ─────────────────────────────────────────────────
function estimateSize(quality: string, durationMin?: number): string {
  const dur = durationMin || 45;
  const bitrateMap: Record<string, number> = {
    '2160p': 15, '1080p': 5, '720p': 2.5, '480p': 1.2, '360p': 0.7, 'auto': 3,
  };
  const mbps = bitrateMap[quality] || 3;
  const sizeMB = (mbps * dur * 60) / 8;
  return sizeMB >= 1024 ? `~${(sizeMB / 1024).toFixed(1)} GB` : `~${Math.round(sizeMB)} MB`;
}

// ─── Download handler ───────────────────────────────────────────────
function triggerDownload(url: string, filename: string) {
  if (url.startsWith('magnet:')) {
    // Magnet links open the user's torrent client
    window.open(url, '_self');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Stream Card Component ──────────────────────────────────────────
function StreamCard({ stream, title, type, season, episode, year, runtime }: {
  stream: ExtractedStream;
  title: string;
  type: string;
  season?: number;
  episode?: number;
  year?: string;
  runtime?: number;
}) {
  const filename = buildFileName(title, type, season, episode, stream.quality, year);
  const isMagnet = stream.type === 'magnet' || stream.type === 'torrent';
  const size = stream.size || estimateSize(stream.quality, runtime);
  
  const qualityColor = stream.quality.includes('2160') || stream.quality.includes('4k') ? 'text-fuchsia-400 bg-fuchsia-500/15 border-fuchsia-500/20'
    : stream.quality.includes('1080') ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/20'
    : stream.quality.includes('720') ? 'text-blue-400 bg-blue-500/15 border-blue-500/20'
    : stream.quality.includes('480') ? 'text-amber-400 bg-amber-500/15 border-amber-500/20'
    : 'text-violet-400 bg-violet-500/15 border-violet-500/20';

  const providerColor = isMagnet 
    ? 'text-green-400/80'
    : 'text-cyan-400/60';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group flex items-center justify-between gap-4 p-4 rounded-2xl border transition-all ${
        isMagnet
          ? 'bg-green-500/[0.03] border-green-500/[0.08] hover:bg-green-500/[0.06] hover:border-green-500/15'
          : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/10'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {isMagnet ? (
          <ExternalLink size={18} className="text-green-400/40 flex-shrink-0" />
        ) : (
          <FileVideo size={18} className="text-white/30 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold border ${qualityColor}`}>
              {stream.quality.toUpperCase()}
            </span>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${isMagnet ? 'text-green-400/70 bg-green-500/10' : 'text-white/30'}`}>
              {isMagnet ? 'MAGNET' : stream.type.toUpperCase()}
            </span>
            <span className="text-white/20 text-xs">·</span>
            <span className="text-white/40 text-xs flex items-center gap-1">
              <HardDrive size={10} /> {size}
            </span>
            <span className="text-white/20 text-xs">·</span>
            <span className={`text-xs flex items-center gap-1 ${providerColor}`}>
              <Server size={10} /> {stream.provider}
            </span>
            {/* Seeds/Peers for torrents */}
            {isMagnet && stream.seeds !== undefined && (
              <>
                <span className="text-white/20 text-xs">·</span>
                <span className="text-green-400/70 text-xs flex items-center gap-0.5">
                  <ArrowUpCircle size={9} /> {stream.seeds}
                </span>
                <span className="text-red-400/50 text-xs flex items-center gap-0.5">
                  <ArrowDownCircle size={9} /> {stream.peers ?? 0}
                </span>
              </>
            )}
            {stream.captions && stream.captions.length > 0 && (
              <>
                <span className="text-white/20 text-xs">·</span>
                <span className="text-white/40 text-xs flex items-center gap-1">
                  <Globe size={10} /> {stream.captions.length} sub{stream.captions.length > 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
          <p className="text-white/25 text-[10px] mt-1 truncate font-mono">{filename}</p>
        </div>
      </div>

      <button
        onClick={() => triggerDownload(stream.url, filename)}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all flex-shrink-0 shadow-lg ${
          isMagnet
            ? 'bg-green-600 hover:bg-green-500 text-white shadow-green-600/20 hover:shadow-green-500/30'
            : 'bg-violet-600 hover:bg-violet-500 text-white shadow-violet-600/20 hover:shadow-violet-500/30'
        }`}
      >
        {isMagnet ? <ExternalLink size={14} /> : <Download size={14} />}
        <span className="hidden sm:inline">{isMagnet ? 'Open Magnet' : 'Download'}</span>
      </button>
    </motion.div>
  );
}

// ─── Language Detection Algorithm ───────────────────────────────────
function detectLanguage(stream: ExtractedStream): string[] {
  const langs: Set<string> = new Set();
  const url = stream.url.toLowerCase();
  const provider = stream.provider.toLowerCase();

  // From captions (most reliable)
  if (stream.captions && stream.captions.length > 0) {
    for (const cap of stream.captions) {
      const lang = cap.language?.toLowerCase() || '';
      if (lang.includes('hin') || lang === 'hi') langs.add('Hindi');
      else if (lang.includes('eng') || lang === 'en') langs.add('English');
      else if (lang.includes('tam') || lang === 'ta') langs.add('Tamil');
      else if (lang.includes('tel') || lang === 'te') langs.add('Telugu');
      else if (lang.includes('spa') || lang === 'es') langs.add('Spanish');
      else if (lang.includes('fre') || lang === 'fr') langs.add('French');
      else if (lang.includes('ger') || lang === 'de') langs.add('German');
      else if (lang.includes('jpn') || lang === 'ja') langs.add('Japanese');
      else if (lang.includes('kor') || lang === 'ko') langs.add('Korean');
      else if (lang.includes('ara') || lang === 'ar') langs.add('Arabic');
      else if (lang.includes('por') || lang === 'pt') langs.add('Portuguese');
      else if (lang.includes('ita') || lang === 'it') langs.add('Italian');
      else if (lang.includes('chi') || lang === 'zh') langs.add('Chinese');
      else if (lang.includes('rus') || lang === 'ru') langs.add('Russian');
    }
  }

  // From magnet/torrent URL or title patterns
  if (stream.type === 'magnet' || stream.type === 'torrent') {
    const decoded = decodeURIComponent(url);
    if (/hindi|hin\b/i.test(decoded)) langs.add('Hindi');
    if (/english|eng\b/i.test(decoded)) langs.add('English');
    if (/dual\.audio|multi/i.test(decoded)) { langs.add('English'); langs.add('Hindi'); }
    if (/tamil|tam\b/i.test(decoded)) langs.add('Tamil');
    if (/telugu|tel\b/i.test(decoded)) langs.add('Telugu');
    if (/korean|kor\b/i.test(decoded)) langs.add('Korean');
    if (/japanese|jpn\b/i.test(decoded)) langs.add('Japanese');
  }

  // Default: assume English for known English-first providers
  if (langs.size === 0) {
    if (['yts', 'eztv', 'movieweb', 'vidsrc'].some(p => provider.includes(p))) {
      langs.add('English');
    } else {
      langs.add('Multi');
    }
  }

  return [...langs];
}

// ─── Quality Normalization ──────────────────────────────────────────
function normalizeQuality(q: string): string {
  const lower = q.toLowerCase();
  if (lower.includes('2160') || lower.includes('4k') || lower.includes('uhd')) return '4K';
  if (lower.includes('1080')) return '1080p';
  if (lower.includes('720')) return '720p';
  if (lower.includes('480')) return '480p';
  if (lower.includes('360')) return '360p';
  return 'Auto';
}

// ─── Filter Pill Component ──────────────────────────────────────────
function FilterPill({ label, count, active, onClick, color = 'violet' }: {
  label: string; count: number; active: boolean; onClick: () => void; color?: string;
}) {
  const colors: Record<string, { active: string; inactive: string }> = {
    violet: { active: 'bg-violet-600 text-white border-violet-500/50', inactive: 'bg-white/[0.04] text-white/50 border-white/[0.08] hover:bg-white/[0.08] hover:text-white/70' },
    green:  { active: 'bg-green-600 text-white border-green-500/50',   inactive: 'bg-white/[0.04] text-white/50 border-white/[0.08] hover:bg-white/[0.08] hover:text-white/70' },
    cyan:   { active: 'bg-cyan-600 text-white border-cyan-500/50',     inactive: 'bg-white/[0.04] text-white/50 border-white/[0.08] hover:bg-white/[0.08] hover:text-white/70' },
    amber:  { active: 'bg-amber-600 text-white border-amber-500/50',   inactive: 'bg-white/[0.04] text-white/50 border-white/[0.08] hover:bg-white/[0.08] hover:text-white/70' },
  };
  const c = colors[color] || colors.violet;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${active ? c.active : c.inactive}`}
    >
      {label}
      {count > 0 && (
        <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${active ? 'bg-white/20' : 'bg-white/10 text-white/40'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Movie Download Section (with filters) ──────────────────────────
function MovieDownloadSection({ streams, loading, title, year, runtime, tmdbId, onRescan, onStreamInstead }: {
  streams: ExtractedStream[];
  loading: boolean;
  title: string;
  year: string;
  runtime?: number;
  tmdbId: string;
  onRescan: () => void;
  onStreamInstead: () => void;
}) {
  const [qualityFilter, setQualityFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [langFilter, setLangFilter] = useState<string>('all');

  // Analyze streams for filter counts
  const analysis = React.useMemo(() => {
    const qualityCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = { magnet: 0, direct: 0 };
    const langCounts: Record<string, number> = {};
    const streamLangs = new Map<ExtractedStream, string[]>();

    for (const s of streams) {
      // Quality
      const q = normalizeQuality(s.quality);
      qualityCounts[q] = (qualityCounts[q] || 0) + 1;

      // Type
      if (s.type === 'magnet' || s.type === 'torrent') typeCounts.magnet++;
      else typeCounts.direct++;

      // Language
      const langs = detectLanguage(s);
      streamLangs.set(s, langs);
      for (const l of langs) {
        langCounts[l] = (langCounts[l] || 0) + 1;
      }
    }

    return { qualityCounts, typeCounts, langCounts, streamLangs };
  }, [streams]);

  // Apply filters
  const filteredStreams = React.useMemo(() => {
    return streams.filter(s => {
      // Quality filter
      if (qualityFilter !== 'all') {
        const q = normalizeQuality(s.quality);
        if (q !== qualityFilter) return false;
      }
      // Type filter
      if (typeFilter !== 'all') {
        const isMagnet = s.type === 'magnet' || s.type === 'torrent';
        if (typeFilter === 'magnet' && !isMagnet) return false;
        if (typeFilter === 'direct' && isMagnet) return false;
      }
      // Language filter
      if (langFilter !== 'all') {
        const langs = analysis.streamLangs.get(s) || [];
        if (!langs.includes(langFilter)) return false;
      }
      return true;
    });
  }, [streams, qualityFilter, typeFilter, langFilter, analysis.streamLangs]);

  // Quality order for pills
  const qualityOrder = ['4K', '1080p', '720p', '480p', '360p', 'Auto'];
  const availableQualities = qualityOrder.filter(q => (analysis.qualityCounts[q] || 0) > 0);

  // Language order (English and Hindi first, then alphabetical)
  const langPriority = ['English', 'Hindi', 'Tamil', 'Telugu', 'Korean', 'Japanese', 'Multi'];
  const availableLangs = [...new Set([
    ...langPriority.filter(l => (analysis.langCounts[l] || 0) > 0),
    ...Object.keys(analysis.langCounts).filter(l => !langPriority.includes(l)).sort(),
  ])];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-white/80 text-sm font-semibold flex items-center gap-2">
          <Film size={14} className="text-violet-400" /> Available Downloads
          {streams.length > 0 && (
            <span className="px-2 py-0.5 rounded-lg bg-violet-500/15 text-violet-300 text-[11px] font-bold border border-violet-500/20">
              {streams.length} found
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-violet-400 text-xs flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Scanning 10 sources...
            </span>
          )}
          {!loading && (
            <button
              onClick={onRescan}
              className="flex items-center gap-1 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-xs transition-all border border-white/5"
            >
              <RefreshCw size={11} /> Rescan
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      {streams.length > 0 && (
        <div className="space-y-3 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
          {/* Quality Filters */}
          {availableQualities.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white/30 text-[10px] font-bold uppercase tracking-wider w-14 flex-shrink-0">Quality</span>
              <FilterPill label="All" count={streams.length} active={qualityFilter === 'all'} onClick={() => setQualityFilter('all')} />
              {availableQualities.map(q => (
                <FilterPill
                  key={q}
                  label={q}
                  count={analysis.qualityCounts[q] || 0}
                  active={qualityFilter === q}
                  onClick={() => setQualityFilter(qualityFilter === q ? 'all' : q)}
                  color={q === '4K' ? 'amber' : q === '1080p' ? 'green' : 'violet'}
                />
              ))}
            </div>
          )}

          {/* Type Filters */}
          {analysis.typeCounts.magnet > 0 && analysis.typeCounts.direct > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white/30 text-[10px] font-bold uppercase tracking-wider w-14 flex-shrink-0">Type</span>
              <FilterPill label="All" count={streams.length} active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
              <FilterPill
                label="⬇ Direct"
                count={analysis.typeCounts.direct}
                active={typeFilter === 'direct'}
                onClick={() => setTypeFilter(typeFilter === 'direct' ? 'all' : 'direct')}
                color="violet"
              />
              <FilterPill
                label="🧲 Magnet"
                count={analysis.typeCounts.magnet}
                active={typeFilter === 'magnet'}
                onClick={() => setTypeFilter(typeFilter === 'magnet' ? 'all' : 'magnet')}
                color="green"
              />
            </div>
          )}

          {/* Language Filters */}
          {availableLangs.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white/30 text-[10px] font-bold uppercase tracking-wider w-14 flex-shrink-0">Lang</span>
              <FilterPill label="All" count={streams.length} active={langFilter === 'all'} onClick={() => setLangFilter('all')} />
              {availableLangs.map(l => (
                <FilterPill
                  key={l}
                  label={l}
                  count={analysis.langCounts[l] || 0}
                  active={langFilter === l}
                  onClick={() => setLangFilter(langFilter === l ? 'all' : l)}
                  color="cyan"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filtered Results */}
      {streams.length > 0 ? (
        <div className="space-y-2">
          {/* Active filter summary */}
          {(qualityFilter !== 'all' || typeFilter !== 'all' || langFilter !== 'all') && (
            <div className="flex items-center justify-between px-1">
              <p className="text-white/30 text-xs">
                Showing {filteredStreams.length} of {streams.length} results
                {qualityFilter !== 'all' && <span className="text-violet-400/70"> · {qualityFilter}</span>}
                {typeFilter !== 'all' && <span className="text-green-400/70"> · {typeFilter === 'magnet' ? 'Magnet' : 'Direct'}</span>}
                {langFilter !== 'all' && <span className="text-cyan-400/70"> · {langFilter}</span>}
              </p>
              <button
                onClick={() => { setQualityFilter('all'); setTypeFilter('all'); setLangFilter('all'); }}
                className="text-white/30 hover:text-white/60 text-[10px] underline transition-colors"
              >
                Clear Filters
              </button>
            </div>
          )}

          {filteredStreams.length > 0 ? (
            filteredStreams.map((s, i) => (
              <StreamCard
                key={i}
                stream={s}
                title={title}
                type="movie"
                year={year}
                runtime={runtime}
              />
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 py-8">
              <AlertCircle size={20} className="text-white/15" />
              <p className="text-white/30 text-sm">No results match your filters</p>
              <button
                onClick={() => { setQualityFilter('all'); setTypeFilter('all'); setLangFilter('all'); }}
                className="text-violet-400 text-xs hover:text-violet-300 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-white/5" />
            <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
          </div>
          <p className="text-white/40 text-sm">Scanning 10 sources in parallel...</p>
          <p className="text-white/20 text-[11px]">VidSrc.to · Embed.su · VidSrc.icu · AutoEmbed · Videasy · VidSrc.cc · NonTongo · MovieWeb · YTS · EZTV</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-12">
          <AlertCircle size={32} className="text-white/15" />
          <p className="text-white/30 text-sm">No direct download links found</p>
          <p className="text-white/15 text-xs mb-3">All 10 sources were scanned. This title may not be available yet.</p>
          <div className="flex gap-2">
            <button
              onClick={onRescan}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600/80 hover:bg-violet-600 text-white text-sm font-medium transition-all"
            >
              <RefreshCw size={13} /> Try Again
            </button>
            <button
              onClick={onStreamInstead}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/70 text-sm font-medium transition-all border border-white/10"
            >
              <Play size={13} /> Stream Instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EpisodeRow({ ep, tmdbId, titleName, year, onExtract, episodeStreams }: {
  ep: Episode;
  tmdbId: string;
  titleName: string;
  year: string;
  onExtract: (season: number, episode: number) => void;
  episodeStreams?: EpisodeStreams;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = episodeStreams?.status || 'idle';

  const handleClick = () => {
    if (status === 'idle') {
      onExtract(ep.season_number, ep.episode_number);
    }
    setExpanded(!expanded);
  };

  return (
    <div className="border border-white/[0.05] rounded-2xl overflow-hidden">
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/[0.03] transition-all text-left"
      >
        <div className="relative flex-shrink-0 w-24 h-14 rounded-xl overflow-hidden bg-white/5">
          {ep.still_path ? (
            <img
              src={`${TMDB_IMAGE_BASE}/w300${ep.still_path}`}
              alt={ep.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film size={16} className="text-white/20" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Play size={10} className="text-white/80 ml-0.5" fill="white" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white/40 text-xs font-bold">E{ep.episode_number}</span>
            <span className="text-white/70 text-sm font-medium truncate">{ep.name}</span>
          </div>
          {ep.runtime && <span className="text-white/25 text-[11px]">{ep.runtime}min</span>}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {status === 'loading' && <Loader2 size={14} className="text-violet-400 animate-spin" />}
          {status === 'done' && episodeStreams && episodeStreams.streams.length > 0 && (
            <span className="text-emerald-400 text-xs flex items-center gap-1">
              <CheckCircle2 size={12} /> {episodeStreams.streams.length} links
            </span>
          )}
          {status === 'done' && episodeStreams && episodeStreams.streams.length === 0 && (
            <span className="text-red-400/60 text-xs flex items-center gap-1">
              <AlertCircle size={12} /> No links
            </span>
          )}
          {status === 'error' && (
            <span className="text-red-400/60 text-xs flex items-center gap-1">
              <AlertCircle size={12} /> Error
            </span>
          )}
          <ChevronDown size={14} className={`text-white/30 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {expanded && status === 'done' && episodeStreams && episodeStreams.streams.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              {episodeStreams.streams.map((s, i) => (
                <StreamCard
                  key={i}
                  stream={s}
                  title={titleName}
                  type="tv"
                  season={ep.season_number}
                  episode={ep.episode_number}
                  year={year}
                  runtime={ep.runtime}
                />
              ))}
            </div>
          </motion.div>
        )}
        {expanded && status === 'done' && episodeStreams && episodeStreams.streams.length === 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col items-center gap-3 py-6 px-3">
              <AlertCircle size={24} className="text-white/15" />
              <div className="text-center">
                <p className="text-white/30 text-sm">No direct download links found</p>
                <p className="text-white/15 text-[11px]">10 sources scanned. Try streaming instead.</p>
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={(e) => { e.stopPropagation(); onExtract(ep.season_number, ep.episode_number); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-xs font-medium transition-all"
                >
                  <RefreshCw size={11} /> Retry
                </button>
                <a
                  href={`/watch/${tmdbId}?type=tv&season=${ep.season_number}&episode=${ep.episode_number}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-xs font-medium transition-all border border-violet-500/20"
                >
                  <Play size={11} /> Stream Episode
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Download Page ─────────────────────────────────────────────
function DownloadPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tmdbId = params.id as string;
  const mediaType = (searchParams.get('type') || 'movie') as 'movie' | 'tv';

  const [selectedSeason, setSelectedSeason] = useState(1);
  const [episodeStreamsMap, setEpisodeStreamsMap] = useState<Record<string, EpisodeStreams>>({});
  const [movieStreams, setMovieStreams] = useState<ExtractedStream[]>([]);
  const [movieLoading, setMovieLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);

  // Fetch title metadata
  const { data: titleData } = useQuery({
    queryKey: ['title', tmdbId, mediaType],
    queryFn: () => fetchTitle(tmdbId, mediaType),
    enabled: !!tmdbId,
    staleTime: 24 * 60 * 60 * 1000,
  });

  // Fetch episodes for selected season
  const { data: episodesData } = useQuery({
    queryKey: ['episodes', tmdbId, selectedSeason],
    queryFn: async () => {
      const res = await fetch(`/api/title?id=${tmdbId}&type=tv&season=${selectedSeason}`);
      const data = await res.json();
      return data.episodes as Episode[] || [];
    },
    enabled: mediaType === 'tv' && !!tmdbId,
    staleTime: 60 * 60 * 1000,
  });

  const titleInfo = titleData?.detail;
  const seasons = (titleData?.seasons || []).filter((s: Season) => s.season_number > 0);
  const episodes = episodesData || [];
  const displayTitle = titleInfo?.title || titleInfo?.name || '';
  const year = (titleInfo?.release_date || titleInfo?.first_air_date || '').slice(0, 4);

  // Extract streams for a single episode
  const extractEpisode = useCallback(async (season: number, episode: number) => {
    const key = `${season}-${episode}`;
    setEpisodeStreamsMap(prev => ({
      ...prev,
      [key]: { season, episode, streams: [], status: 'loading' }
    }));

    try {
      const res = await fetch('/api/extract-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdbId, type: 'tv', title: displayTitle,
          releaseYear: parseInt(year) || new Date().getFullYear(),
          season, episode,
        }),
      });
      const data = await res.json();
      setEpisodeStreamsMap(prev => ({
        ...prev,
        [key]: { season, episode, streams: data.streams || [], status: 'done' }
      }));
    } catch {
      setEpisodeStreamsMap(prev => ({
        ...prev,
        [key]: { season, episode, streams: [], status: 'error' }
      }));
    }
  }, [tmdbId, displayTitle, year]);

  // Extract ALL episodes in a season
  const extractFullSeason = useCallback(async () => {
    if (!episodes.length) return;
    setBatchLoading(true);

    for (const ep of episodes) {
      const key = `${ep.season_number}-${ep.episode_number}`;
      if (episodeStreamsMap[key]?.status === 'done') continue;
      await extractEpisode(ep.season_number, ep.episode_number);
      // Small delay between requests to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    setBatchLoading(false);
  }, [episodes, episodeStreamsMap, extractEpisode]);

  // Extract movie streams
  const extractMovie = useCallback(async () => {
    if (movieLoading || movieStreams.length > 0) return;
    setMovieLoading(true);
    try {
      const res = await fetch('/api/extract-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdbId, type: 'movie', title: displayTitle,
          releaseYear: parseInt(year) || new Date().getFullYear(),
        }),
      });
      const data = await res.json();
      setMovieStreams(data.streams || []);
    } catch { /* ignore */ }
    setMovieLoading(false);
  }, [tmdbId, displayTitle, year, movieLoading, movieStreams.length]);

  // Auto-extract movie streams on load
  useEffect(() => {
    if (mediaType === 'movie' && displayTitle && movieStreams.length === 0 && !movieLoading) {
      extractMovie();
    }
  }, [mediaType, displayTitle, extractMovie, movieStreams.length, movieLoading]);

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Backdrop */}
      {titleInfo?.backdrop_path && (
        <div
          className="fixed inset-0 opacity-[0.08] bg-cover bg-center blur-3xl scale-110 pointer-events-none"
          style={{ backgroundImage: `url(${TMDB_IMAGE_BASE}/w1280${titleInfo.backdrop_path})` }}
        />
      )}

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 backdrop-blur-xl transition-all border border-white/10 text-sm text-white"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <div className="h-5 w-px bg-white/10" />
          <h1 className="text-white text-lg font-semibold truncate flex items-center gap-2">
            <Download size={18} className="text-violet-400" />
            Download
          </h1>
        </div>

        {/* Title Info Card */}
        {titleInfo && (
          <div className="flex gap-4 sm:gap-6 mb-8 p-4 sm:p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm">
            {titleInfo.poster_path && (
              <img
                src={`${TMDB_IMAGE_BASE}/w342${titleInfo.poster_path}`}
                alt={displayTitle}
                className="w-20 sm:w-28 rounded-xl shadow-2xl object-cover flex-shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-white text-xl sm:text-2xl font-bold">{displayTitle}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {year && <span className="text-white/40 text-sm">{year}</span>}
                {titleInfo.runtime && <span className="text-white/30 text-sm">· {titleInfo.runtime}min</span>}
                <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 text-xs font-medium border border-violet-500/20">
                  {mediaType === 'tv' ? 'TV Series' : 'Movie'}
                </span>
              </div>
              {titleInfo.spoken_languages && titleInfo.spoken_languages.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <Globe size={12} className="text-white/30" />
                  {titleInfo.spoken_languages.slice(0, 3).map((l: any) => (
                    <span key={l.iso_639_1} className="text-white/40 text-xs">{l.english_name}</span>
                  ))}
                </div>
              )}
              {titleInfo.overview && (
                <p className="text-white/30 text-xs mt-2 line-clamp-2">{titleInfo.overview}</p>
              )}
            </div>
          </div>
        )}

        {/* ═══ Movie Download ═══ */}
        {mediaType === 'movie' && (
          <MovieDownloadSection
            streams={movieStreams}
            loading={movieLoading}
            title={displayTitle}
            year={year}
            runtime={titleInfo?.runtime}
            tmdbId={tmdbId}
            onRescan={() => { setMovieStreams([]); setMovieLoading(false); setTimeout(extractMovie, 100); }}
            onStreamInstead={() => router.push(`/watch/${tmdbId}?type=movie`)}
          />
        )}

        {/* ═══ TV Show Download ═══ */}
        {mediaType === 'tv' && (
          <div>
            {/* Season Selector */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
                {seasons.map((s: Season) => (
                  <button
                    key={s.season_number}
                    onClick={() => setSelectedSeason(s.season_number)}
                    className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      selectedSeason === s.season_number
                        ? 'bg-white text-black'
                        : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/5'
                    }`}
                  >
                    Season {s.season_number}
                  </button>
                ))}
              </div>

              <button
                onClick={extractFullSeason}
                disabled={batchLoading || episodes.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-violet-600/30 disabled:cursor-not-allowed text-white text-sm font-medium transition-all shadow-lg shadow-violet-600/20 flex-shrink-0"
              >
                {batchLoading ? (
                  <><Loader2 size={14} className="animate-spin" /> Scanning...</>
                ) : (
                  <><Download size={14} /> Get All Episodes</>
                )}
              </button>
            </div>

            {/* Episode List */}
            <div className="space-y-2">
              {episodes.length > 0 ? (
                episodes.map(ep => (
                  <EpisodeRow
                    key={ep.id}
                    ep={ep}
                    tmdbId={tmdbId}
                    titleName={displayTitle}
                    year={year}
                    onExtract={extractEpisode}
                    episodeStreams={episodeStreamsMap[`${ep.season_number}-${ep.episode_number}`]}
                  />
                ))
              ) : (
                Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="flex gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/5 animate-pulse">
                    <div className="w-24 h-14 rounded-xl bg-white/5" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3 w-16 rounded bg-white/5" />
                      <div className="h-4 w-32 rounded bg-white/5" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-white/5 text-center">
          <p className="text-white/15 text-xs">
            ATMOS extracts streams from multiple public sources. Download availability depends on provider uptime.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DownloadPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/10 border-t-violet-500 rounded-full animate-spin" />
      </div>
    }>
      <DownloadPageInner />
    </Suspense>
  );
}
