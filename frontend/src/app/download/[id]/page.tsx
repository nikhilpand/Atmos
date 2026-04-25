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
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-white/80 text-sm font-semibold flex items-center gap-2">
                <Film size={14} className="text-violet-400" /> Available Downloads
              </h3>
              <div className="flex items-center gap-2">
                {movieLoading && (
                  <span className="text-violet-400 text-xs flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" /> Scanning 10 sources...
                  </span>
                )}
                {!movieLoading && (
                  <button
                    onClick={() => { setMovieStreams([]); setMovieLoading(false); setTimeout(extractMovie, 100); }}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-xs transition-all border border-white/5"
                  >
                    <RefreshCw size={11} /> Rescan
                  </button>
                )}
              </div>
            </div>

            {movieStreams.length > 0 ? (
              movieStreams.map((s, i) => (
                <StreamCard
                  key={i}
                  stream={s}
                  title={displayTitle}
                  type="movie"
                  year={year}
                  runtime={titleInfo?.runtime}
                />
              ))
            ) : movieLoading ? (
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
                    onClick={() => { setMovieStreams([]); setMovieLoading(false); setTimeout(extractMovie, 100); }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600/80 hover:bg-violet-600 text-white text-sm font-medium transition-all"
                  >
                    <RefreshCw size={13} /> Try Again
                  </button>
                  <button
                    onClick={() => router.push(`/watch/${tmdbId}?type=movie`)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/70 text-sm font-medium transition-all border border-white/10"
                  >
                    <Play size={13} /> Stream Instead
                  </button>
                </div>
              </div>
            )}
          </div>
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
