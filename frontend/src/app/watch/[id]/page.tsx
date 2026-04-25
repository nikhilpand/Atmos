/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useState, Suspense, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Info, ChevronRight, Tv, Film, Server, Play, X, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import StreamPlayer from '@/components/player/StreamPlayer';
import ProviderSelector from '@/components/player/ProviderSelector';
import { resolveStream, fetchTitle, type Episode } from '@/lib/api';
import { DEFAULT_PROVIDERS, buildProviderUrl, type Provider } from '@/lib/providers';
import { useWatchStore } from '@/store/useWatchStore';
import { TMDB_IMAGE_BASE } from '@/lib/constants';

// ─── Watch Page Inner (needs Suspense for useSearchParams) ──────────
function WatchPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const tmdbId = params.id as string;
  const mediaType = (searchParams.get('type') || 'movie') as 'movie' | 'tv';
  const season = parseInt(searchParams.get('s') || searchParams.get('season') || '1');
  const episode = parseInt(searchParams.get('e') || searchParams.get('episode') || '1');
  const titleHint = searchParams.get('title') || undefined;
  
  // GDrive direct streaming mode (from library page)
  const fileId = searchParams.get('fileId') || undefined;
  const fileNameParam = searchParams.get('fileName') || undefined;
  
  const [activeProviderId, setActiveProviderId] = useState('');
  const [failedProviders, setFailedProviders] = useState<Set<string>>(new Set());
  const [showServers, setShowServers] = useState(false);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState(season);
  const [usingStaticFallback, setUsingStaticFallback] = useState(false);

  // ═══════════════════════════════════════════════════════════════════
  // PARALLEL DATA FETCHING — All 3 fire simultaneously, no waterfall
  // ═══════════════════════════════════════════════════════════════════

  // ── 1. Resolve stream providers IMMEDIATELY (no waiting for category) ──
  // The server does its own TMDB fetch in parallel for classification.
  const { data: streamData, isLoading: isResolving } = useQuery({
    queryKey: ['resolve', tmdbId, mediaType, season, episode],
    queryFn: () => resolveStream(tmdbId, mediaType, season, episode),
    enabled: !!tmdbId && !fileId,
    staleTime: 12 * 60 * 60 * 1000,
  });

  // ── 2. Fetch title metadata (parallel with resolve) ──
  const { data: titleData } = useQuery({
    queryKey: ['title', tmdbId, mediaType],
    queryFn: () => fetchTitle(tmdbId, mediaType, titleHint),
    enabled: !!tmdbId,
    staleTime: 24 * 60 * 60 * 1000,
  });

  // ── 3. Fetch episodes for TV (parallel with everything) ──
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

  // ── 4. Pre-resolve NEXT episode while current one plays (TV only) ──
  useQuery({
    queryKey: ['resolve', tmdbId, mediaType, season, episode + 1],
    queryFn: () => resolveStream(tmdbId, mediaType, season, episode + 1),
    enabled: mediaType === 'tv' && !!tmdbId && !fileId && !!streamData,
    staleTime: 12 * 60 * 60 * 1000,
  });

  // ═══════════════════════════════════════════════════════════════════
  // 500ms STATIC FALLBACK — Start iframe instantly if API is slow
  // ═══════════════════════════════════════════════════════════════════
  const staticFallbackProviders = useMemo(() => {
    if (!tmdbId || fileId) return [];
    return DEFAULT_PROVIDERS.slice(0, 3).map((p: Provider) => ({
      id: p.id,
      name: p.name,
      url: buildProviderUrl(p, tmdbId, mediaType as 'movie' | 'tv', season, episode),
      priority: p.priority,
    }));
  }, [tmdbId, mediaType, season, episode, fileId]);

  // Use static fallback if resolve hasn't returned within 500ms
  useEffect(() => {
    if (streamData || fileId) return;
    const timer = setTimeout(() => {
      if (!streamData && staticFallbackProviders.length > 0) {
        setUsingStaticFallback(true);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [streamData, staticFallbackProviders, fileId]);

  // Clear static fallback once real data arrives
  useEffect(() => {
    if (streamData && usingStaticFallback) {
      setUsingStaticFallback(false);
    }
  }, [streamData, usingStaticFallback]);

  // ═══════════════════════════════════════════════════════════════════
  // DERIVED STATE
  // ═══════════════════════════════════════════════════════════════════
  const providers = useMemo(() => {
    if (streamData?.providers?.length) return streamData.providers;
    if (usingStaticFallback) return staticFallbackProviders;
    return [];
  }, [streamData?.providers, usingStaticFallback, staticFallbackProviders]);

  const titleInfo = titleData?.detail;
  const seasons = useMemo(() => titleData?.seasons || [], [titleData?.seasons]);
  const episodes = episodesData || [];
  const displayTitle = titleInfo?.title || titleInfo?.name || titleHint || '';

  // Filter out Season 0 (Specials) unless it's the only one
  const validSeasons = useMemo(() => 
    seasons.filter((s: any) => s.season_number > 0 || seasons.length === 1),
    [seasons]
  );

  // ── Set first provider when resolved ──
  useEffect(() => {
    if (providers.length > 0 && !activeProviderId) {
      setTimeout(() => setActiveProviderId(providers[0].id), 0);
    }
  }, [providers, activeProviderId]);

  // ── Track watch progress → Zustand store (for Continue Watching) ──
  const updateProgress = useWatchStore(s => s.updateProgress);
  const lastProgressRef = React.useRef(0);
  
  useEffect(() => {
    const handleProgress = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || !tmdbId) return;
      
      // Throttle: only write to store every 10 seconds
      const now = Date.now();
      if (now - lastProgressRef.current < 10000) return;
      lastProgressRef.current = now;

      updateProgress({
        tmdbId,
        mediaType,
        title: displayTitle,
        posterPath: titleInfo?.poster_path || null,
        backdropPath: titleInfo?.backdrop_path || null,
        season: mediaType === 'tv' ? season : undefined,
        episode: mediaType === 'tv' ? episode : undefined,
        progress: detail.progress,
        currentTime: detail.currentTime,
        duration: detail.duration,
        genreIds: titleInfo?.genres?.map((g: { id: number }) => g.id) || [],
        category: (streamData as unknown as Record<string, unknown>)?.category as string || undefined,
      });
    };

    window.addEventListener('atmos:progress', handleProgress);
    return () => window.removeEventListener('atmos:progress', handleProgress);
  }, [tmdbId, mediaType, season, episode, displayTitle, titleInfo, streamData, updateProgress]);

  // ── Dynamic page title ──
  useEffect(() => {
    const title = fileNameParam || displayTitle;
    if (title) {
      const suffix = mediaType === 'tv' ? ` S${season}E${episode}` : '';
      document.title = `Watch ${title}${suffix} | ATMOS`;
    }
  }, [fileNameParam, displayTitle, mediaType, season, episode]);

  // ── Reset failed providers when season/episode changes ──
  useEffect(() => {
    setTimeout(() => {
      setFailedProviders(new Set());
      setActiveProviderId('');
    }, 0);
  }, [season, episode]);

  // ── Sync selectedSeason with URL ──
  useEffect(() => { setTimeout(() => setSelectedSeason(season), 0); }, [season]);

  // ── Auto-hide controls ──
  useEffect(() => {
    let timer: NodeJS.Timeout;
    const show = () => {
      setShowControls(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShowControls(false), 4000);
    };
    
    window.addEventListener('mousemove', show);
    window.addEventListener('touchstart', show);
    show();
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', show);
      window.removeEventListener('touchstart', show);
    };
  }, []);

  const handleProviderError = useCallback((id: string) => {
    setFailedProviders(prev => new Set(prev).add(id));
  }, []);

  const handleProviderChange = useCallback((id: string) => {
    setActiveProviderId(id);
  }, []);

  // ── Episode navigation ──
  const goToEpisode = (s: number, e: number) => {
    setShowEpisodes(false);
    router.push(`/watch/${tmdbId}?type=tv&s=${s}&e=${e}`);
  };

  // ── Next episode ──
  const currentSeasonData = validSeasons.find((s: any) => s.season_number === season);
  const hasNextEpisode = currentSeasonData ? episode < currentSeasonData.episode_count : false;
  const hasNextSeason = validSeasons.some((s: any) => s.season_number === season + 1);

  const goNext = () => {
    if (hasNextEpisode) {
      goToEpisode(season, episode + 1);
    } else if (hasNextSeason) {
      goToEpisode(season + 1, 1);
    }
  };

  const goPrev = () => {
    if (episode > 1) {
      goToEpisode(season, episode - 1);
    } else if (season > 1) {
      const prevSeason = validSeasons.find((s: any) => s.season_number === season - 1);
      if (prevSeason) goToEpisode(season - 1, prevSeason.episode_count);
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-[100] flex flex-col">
      {/* Backdrop blur background */}
      {titleInfo?.backdrop_path && (
        <div
          className="absolute inset-0 opacity-[0.06] bg-cover bg-center blur-3xl scale-110 pointer-events-none"
          style={{ backgroundImage: `url(https://image.tmdb.org/t/p/w780${titleInfo.backdrop_path})` }}
        />
      )}

      {/* ── Top Controls ── */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/90 via-black/50 to-transparent"
          >
            <div className="flex items-center justify-between p-4 gap-4">
              {/* Left: Back + Title */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <button
                  onClick={() => router.push(titleInfo ? `/title/${tmdbId}?type=${mediaType}` : '/')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 backdrop-blur-xl transition-all border border-white/10 text-sm text-white flex-shrink-0"
                >
                  <ArrowLeft size={14} /> Back
                </button>
                
                {displayTitle && (
                  <div className="min-w-0 hidden sm:block">
                    <p className="text-white font-medium text-sm truncate">{displayTitle}</p>
                    <p className="text-white/40 text-xs">
                      {mediaType === 'tv' ? `Season ${season} · Episode ${episode}` : titleInfo?.release_date?.slice(0, 4) || ''}
                    </p>
                  </div>
                )}
              </div>

              {/* Right: Controls */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Episodes Drawer Toggle (TV only) */}
                {mediaType === 'tv' && (
                  <button
                    onClick={() => { setShowEpisodes(prev => !prev); setShowServers(false); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                      showEpisodes
                        ? 'bg-violet-600/30 border-violet-500/30 text-violet-300'
                        : 'bg-white/10 border-white/10 text-white/70 hover:bg-white/15 hover:text-white'
                    }`}
                  >
                    <Tv size={12} />
                    <span className="hidden sm:inline">Episodes</span>
                    <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px]">S{season}</span>
                  </button>
                )}

                {/* Server Selector Toggle */}
                <button
                  onClick={() => { setShowServers(prev => !prev); setShowEpisodes(false); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                    showServers
                      ? 'bg-violet-600/30 border-violet-500/30 text-violet-300'
                      : 'bg-white/10 border-white/10 text-white/70 hover:bg-white/15 hover:text-white'
                  }`}
                >
                  <Server size={12} />
                  <span className="hidden sm:inline">Servers</span>
                  <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px]">{providers.length}</span>
                </button>

                {/* Title Info */}
                {titleInfo && (
                  <button
                    onClick={() => router.push(`/title/${tmdbId}?type=${mediaType}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 text-xs text-white/70 hover:text-white transition-all"
                  >
                    <Info size={12} /> Details
                  </button>
                )}

                {/* Download */}
                <button
                  onClick={() => router.push(`/download/${tmdbId}?type=${mediaType}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/20 text-xs text-violet-300 hover:text-white transition-all"
                >
                  <Download size={12} />
                  <span className="hidden sm:inline">Download</span>
                </button>
              </div>
            </div>

            {/* Server Selector (inline) */}
            <AnimatePresence>
              {showServers && providers.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden px-4 pb-3"
                >
                  <ProviderSelector
                    providers={providers}
                    activeProviderId={activeProviderId}
                    onSelect={handleProviderChange}
                    failedProviders={failedProviders}
                    compact
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Netflix-Style Episode Drawer (slides from right) ═══ */}
      <AnimatePresence>
        {showEpisodes && mediaType === 'tv' && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[60] bg-black/60"
              onClick={() => setShowEpisodes(false)}
            />
            {/* Drawer */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute top-0 right-0 bottom-0 z-[70] w-full max-w-md bg-zinc-900/95 backdrop-blur-2xl border-l border-white/10 flex flex-col"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                <div>
                  <h2 className="text-white font-semibold text-base">{displayTitle}</h2>
                  <p className="text-white/40 text-xs mt-0.5">
                    {validSeasons.length} Season{validSeasons.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => setShowEpisodes(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-white/60 hover:text-white transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Season Selector */}
              <div className="px-5 py-3 border-b border-white/5">
                <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
                  {validSeasons.map((s: any) => (
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
              </div>

              {/* Episode List */}
              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2 scrollbar-thin scrollbar-thumb-white/10">
                {episodes.length > 0 ? episodes.map(ep => {
                  const isCurrentEpisode = ep.season_number === season && ep.episode_number === episode;
                  return (
                    <button
                      key={ep.id}
                      onClick={() => goToEpisode(ep.season_number, ep.episode_number)}
                      className={`w-full text-left rounded-xl overflow-hidden transition-all group ${
                        isCurrentEpisode
                          ? 'bg-violet-600/20 border border-violet-500/30 ring-1 ring-violet-500/20'
                          : 'bg-white/[0.02] border border-white/5 hover:bg-white/[0.06] hover:border-white/10'
                      }`}
                    >
                      <div className="flex gap-3 p-3">
                        {/* Episode Thumbnail */}
                        <div className="relative flex-shrink-0 w-28 h-16 rounded-lg overflow-hidden bg-white/5">
                          {ep.still_path ? (
                            <img
                              src={`${TMDB_IMAGE_BASE}/w300${ep.still_path}`}
                              alt={ep.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Film size={18} className="text-white/20" />
                            </div>
                          )}
                          {/* Play overlay */}
                          <div className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity ${
                            isCurrentEpisode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}>
                            <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
                              <Play size={12} className="text-white ml-0.5" fill="white" />
                            </div>
                          </div>
                          {/* Duration badge */}
                          {ep.runtime && (
                            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-white/80 text-[9px] font-medium">
                              {ep.runtime}m
                            </div>
                          )}
                        </div>

                        {/* Episode Info */}
                        <div className="flex-1 min-w-0 py-0.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${isCurrentEpisode ? 'text-violet-300' : 'text-white/40'}`}>
                              E{ep.episode_number}
                            </span>
                            {isCurrentEpisode && (
                              <span className="px-1.5 py-0.5 rounded bg-violet-500/30 text-violet-200 text-[9px] font-semibold">
                                NOW PLAYING
                              </span>
                            )}
                          </div>
                          <p className={`text-sm font-medium truncate mt-0.5 ${isCurrentEpisode ? 'text-white' : 'text-white/80'}`}>
                            {ep.name}
                          </p>
                          {ep.overview && (
                            <p className="text-white/30 text-[11px] line-clamp-2 mt-1 leading-relaxed">{ep.overview}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                }) : (
                  // Skeleton loading for episodes
                  Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="flex gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 animate-pulse">
                      <div className="w-28 h-16 rounded-lg bg-white/5" />
                      <div className="flex-1 space-y-2 py-1">
                        <div className="h-3 w-16 rounded bg-white/5" />
                        <div className="h-4 w-32 rounded bg-white/5" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Bottom Episode Nav Bar (TV Shows — Netflix-style) ── */}
      {mediaType === 'tv' && showControls && !showEpisodes && (
        <AnimatePresence>
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute bottom-0 left-0 right-0 z-50 bg-gradient-to-t from-black/90 via-black/50 to-transparent"
          >
            <div className="flex items-center gap-3 p-4">
              {/* Previous Episode */}
              <button
                onClick={goPrev}
                disabled={episode <= 1 && season <= 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs transition-all border border-white/5 disabled:opacity-20 disabled:cursor-not-allowed flex-shrink-0"
              >
                <ArrowLeft size={12} /> Prev
              </button>

              {/* Episode quick-nav */}
              <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-none">
                <div className="flex items-center gap-1 text-white/40 text-xs flex-shrink-0 mr-1">
                  <Tv size={11} />
                  <span>S{season}</span>
                </div>
                {Array.from(
                  { length: Math.min(20, currentSeasonData?.episode_count || 10) },
                  (_, i) => i + 1
                ).map(ep => (
                  <button
                    key={ep}
                    onClick={() => goToEpisode(season, ep)}
                    className={`flex-shrink-0 w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                      ep === episode
                        ? 'bg-white text-black shadow-lg shadow-white/20'
                        : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white border border-white/5'
                    }`}
                  >
                    {ep}
                  </button>
                ))}
              </div>

              {/* Next Episode */}
              <button
                onClick={goNext}
                disabled={!hasNextEpisode && !hasNextSeason}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs transition-all border border-white/5 disabled:opacity-20 disabled:cursor-not-allowed flex-shrink-0"
              >
                Next <ChevronRight size={12} />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* ── Main Player ── */}
      <div className="flex-1 w-full h-full">
        {/* GDrive direct streaming mode */}
        {fileId ? (
          <StreamPlayer fileId={fileId} fileName={fileNameParam} />
        ) : isResolving ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-5">
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-2 border-white/5" />
                <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
                <div className="absolute inset-2 rounded-full border-2 border-t-cyan-400/60 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
              </div>
              <div className="text-center">
                <p className="text-white/70 text-sm font-medium">Finding best servers...</p>
                <p className="text-white/30 text-xs mt-1">Racing {providers.length || '10+'} providers</p>
              </div>
            </div>
          </div>
        ) : providers.length > 0 ? (
          <StreamPlayer
            providers={providers}
            activeProviderId={activeProviderId}
            onProviderChange={handleProviderChange}
            onProviderError={handleProviderError}
            tmdbId={tmdbId}
            mediaType={mediaType}
            season={season}
            episode={episode}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <Film size={48} className="text-white/20 mx-auto mb-4" />
              <p className="text-white/50 text-lg">No streams found</p>
              <p className="text-white/30 text-sm mt-1">This title may not be available yet</p>
              <button
                onClick={() => router.push('/')}
                className="mt-6 px-6 py-2.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all"
              >
                Browse Other Titles
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Export with Suspense boundary ──────────────────────────────────
export default function WatchPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 bg-black z-[100] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/10 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <WatchPageInner />
    </Suspense>
  );
}
