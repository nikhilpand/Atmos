"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, AlertTriangle, RefreshCw,
  ShieldCheck, PictureInPicture2, Gauge, SkipForward as NextIcon,
  Keyboard,
} from 'lucide-react';
import Hls from 'hls.js';

interface NativeVideoPlayerProps {
  src: string;
  isHls?: boolean;
  title?: string;
  onFatalError?: () => void;
  autoPlay?: boolean;
  onNextEpisode?: () => void;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function NativeVideoPlayer({
  src, isHls = false, title, onFatalError, autoPlay = true, onNextEpisode,
}: NativeVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [progress, setProgress] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isPiP, setIsPiP] = useState(false);

  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // ─── HLS / Native init ───────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const startVideo = async () => {
      try {
        if (autoPlay) await video.play();
        setIsPlaying(true);
      } catch { /* autoplay blocked */ }
    };

    if (isHls) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        startVideo();
        setIsLoading(false);
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferSize: 100 * 1000 * 1000,
          enableWorker: true,
          lowLatencyMode: false,
          startLevel: -1,
          abrEwmaDefaultEstimate: 5_000_000,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { setIsLoading(false); startVideo(); });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else { hls.destroy(); setHasError(true); onFatalError?.(); }
          }
        });
      } else {
        setHasError(true);
        onFatalError?.();
      }
    } else {
      video.src = src;
      startVideo();
      setIsLoading(false);
    }
    return () => { hlsRef.current?.destroy(); };
  }, [src, isHls, autoPlay, onFatalError]);

  // ─── Controls auto-hide ──────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3500);
  }, [isPlaying]);

  useEffect(() => () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); }, []);

  // ─── Core controls ──────────────────────────────────────────
  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
    resetControlsTimer();
  }, [resetControlsTimer]);

  const toggleMute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    v.volume = val;
    setVolume(val);
    v.muted = val === 0;
    setIsMuted(val === 0);
  }, []);

  const toggleFullscreen = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    else document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
  }, []);

  const seek = useCallback((seconds: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + seconds));
    resetControlsTimer();
  }, [resetControlsTimer]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
    resetControlsTimer();
  }, [duration, resetControlsTimer]);

  const changeSpeed = useCallback((speed: number) => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
    setPlaybackSpeed(speed);
    setShowSpeedMenu(false);
  }, []);

  const togglePiP = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiP(false);
      } else {
        await v.requestPictureInPicture();
        setIsPiP(true);
      }
    } catch { /* PiP not supported */ }
  }, []);

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // ─── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ': case 'k': case 'K': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': case 'j': case 'J': e.preventDefault(); seek(-10); break;
        case 'ArrowRight': case 'l': case 'L': e.preventDefault(); seek(10); break;
        case 'ArrowUp': e.preventDefault(); { const v = videoRef.current; if (v) { v.volume = Math.min(1, v.volume + 0.1); setVolume(v.volume); } } break;
        case 'ArrowDown': e.preventDefault(); { const v = videoRef.current; if (v) { v.volume = Math.max(0, v.volume - 0.1); setVolume(v.volume); } } break;
        case 'm': case 'M': toggleMute(); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'p': case 'P': togglePiP(); break;
        case 'n': case 'N': if (onNextEpisode) onNextEpisode(); break;
        case '?': setShowShortcuts(prev => !prev); break;
        case 'Escape': setShowShortcuts(false); setShowSpeedMenu(false); break;
        case '>': e.preventDefault(); { const idx = PLAYBACK_SPEEDS.indexOf(playbackSpeed); if (idx < PLAYBACK_SPEEDS.length - 1) changeSpeed(PLAYBACK_SPEEDS[idx + 1]); } break;
        case '<': e.preventDefault(); { const idx = PLAYBACK_SPEEDS.indexOf(playbackSpeed); if (idx > 0) changeSpeed(PLAYBACK_SPEEDS[idx - 1]); } break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, seek, toggleMute, toggleFullscreen, togglePiP, onNextEpisode, playbackSpeed, changeSpeed]);

  // ─── Auto-next episode ───────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !onNextEpisode) return;
    const handleEnded = () => onNextEpisode();
    v.addEventListener('ended', handleEnded);
    return () => v.removeEventListener('ended', handleEnded);
  }, [onNextEpisode]);

  // ─── Error state ─────────────────────────────────────────────
  if (hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div className="text-center">
          <AlertTriangle size={48} className="text-amber-400 mx-auto mb-4" aria-hidden="true" />
          <p className="text-white/70 text-lg font-medium mb-2">Stream failed to load</p>
          <p className="text-white/50 text-sm mb-6">The source might be offline or blocked.</p>
          {onFatalError && (
            <button onClick={() => { setHasError(false); onFatalError(); }}
              className="flex items-center gap-2 px-5 py-2.5 mx-auto rounded-full bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all"
              aria-label="Try fallback stream">
              <RefreshCw size={14} aria-hidden="true" /> Try Fallback
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black group overflow-hidden"
      onMouseMove={resetControlsTimer} onTouchStart={resetControlsTimer}
      onClick={togglePlay} onDoubleClick={toggleFullscreen}>

      <video ref={videoRef} className="w-full h-full object-contain" playsInline
        onPlay={() => { setIsPlaying(true); resetControlsTimer(); }}
        onPause={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); setIsLoading(false); }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setProgress(v.duration ? (v.currentTime / v.duration) * 100 : 0);
          if (v.buffered.length > 0) {
            setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
          }
        }}
        onWaiting={() => setIsLoading(true)}
        onCanPlay={() => setIsLoading(false)}
        onError={() => { if (!isHls) { setHasError(true); onFatalError?.(); } }}
      />

      {/* Loading overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-black/40">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-white/5" />
              <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
              <div className="absolute inset-2 rounded-full border-2 border-t-cyan-400/60 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Badges */}
      <div className="absolute top-4 right-4 z-10 flex gap-2 pointer-events-none">
        {isHls && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur border border-emerald-500/20 text-emerald-400">
            <ShieldCheck size={12} aria-hidden="true" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Ad-Free</span>
          </div>
        )}
        {playbackSpeed !== 1 && (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur border border-violet-500/20 text-violet-400">
            <span className="text-[10px] font-bold">{playbackSpeed}×</span>
          </div>
        )}
        {isPiP && (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur border border-cyan-500/20 text-cyan-400">
            <PictureInPicture2 size={10} aria-hidden="true" />
            <span className="text-[10px] font-bold">PiP</span>
          </div>
        )}
      </div>

      {/* Player Controls */}
      <AnimatePresence>
        {showControls && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.2 }}
            className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-24 pb-6"
            onClick={(e) => e.stopPropagation()}>

            {/* Progress Bar */}
            <div className="mx-6 mb-4 h-1.5 bg-white/20 rounded-full cursor-pointer relative group/bar hover:h-2.5 transition-all"
              onClick={handleProgressClick}>
              {/* Buffered */}
              <div className="absolute left-0 top-0 bottom-0 bg-white/10 rounded-full transition-all"
                style={{ width: `${buffered}%` }} />
              {/* Progress */}
              <div className="absolute left-0 top-0 bottom-0 bg-violet-500 rounded-full transition-all ease-linear"
                style={{ width: `${progress}%` }} />
              {/* Thumb */}
              <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg opacity-0 group-hover/bar:opacity-100 transition-opacity"
                style={{ left: `calc(${progress}% - 8px)` }} />
            </div>

            {/* Buttons Row */}
            <div className="flex items-center justify-between px-6">
              <div className="flex items-center gap-3 sm:gap-5">
                {/* Play/Pause */}
                <button onClick={(e) => togglePlay(e)} aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="w-11 h-11 rounded-full bg-white text-black hover:bg-gray-200 flex items-center justify-center transition-all transform hover:scale-105 shadow-xl">
                  {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                </button>

                {/* Skip */}
                <div className="flex items-center gap-1.5">
                  <button onClick={(e) => seek(-10, e)} aria-label="Rewind 10 seconds"
                    className="text-white/70 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-full">
                    <SkipBack size={18} />
                  </button>
                  <button onClick={(e) => seek(10, e)} aria-label="Forward 10 seconds"
                    className="text-white/70 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-full">
                    <SkipForward size={18} />
                  </button>
                </div>

                {/* Next Episode */}
                {onNextEpisode && (
                  <button onClick={(e) => { e.stopPropagation(); onNextEpisode(); }}
                    aria-label="Next episode"
                    className="text-white/70 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-full">
                    <NextIcon size={18} />
                  </button>
                )}

                {/* Volume */}
                <div className="flex items-center gap-1.5 group/volume">
                  <button onClick={(e) => toggleMute(e)} aria-label={isMuted ? 'Unmute' : 'Mute'}
                    className="text-white/70 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-full">
                    {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange} aria-label="Volume"
                    className="w-0 group-hover/volume:w-20 transition-all duration-200 accent-violet-500 h-1 cursor-pointer opacity-0 group-hover/volume:opacity-100" />
                </div>

                {/* Time */}
                <div className="text-white/80 text-xs font-medium tabular-nums border-l border-white/20 pl-3 hidden sm:block">
                  {formatTime((progress / 100) * duration)} <span className="text-white/40 mx-0.5">/</span> {formatTime(duration)}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {title && (
                  <span className="text-white/60 text-xs font-medium truncate max-w-[150px] hidden lg:block">{title}</span>
                )}

                {/* Speed */}
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(p => !p); }}
                    aria-label={`Playback speed ${playbackSpeed}x`}
                    className="text-white/70 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-full">
                    <Gauge size={16} />
                  </button>
                  {showSpeedMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur-xl border border-white/10 rounded-xl p-1.5 min-w-[100px]">
                      {PLAYBACK_SPEEDS.map(s => (
                        <button key={s} onClick={(e) => { e.stopPropagation(); changeSpeed(s); }}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${s === playbackSpeed ? 'bg-violet-600/30 text-violet-300' : 'text-white/70 hover:bg-white/10'}`}>
                          {s}×
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* PiP */}
                {'pictureInPictureEnabled' in document && (
                  <button onClick={(e) => togglePiP(e)} aria-label="Picture in Picture"
                    className="text-white/70 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-full">
                    <PictureInPicture2 size={16} />
                  </button>
                )}

                {/* Shortcuts */}
                <button onClick={(e) => { e.stopPropagation(); setShowShortcuts(p => !p); }}
                  aria-label="Keyboard shortcuts"
                  className="text-white/70 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-full hidden md:flex">
                  <Keyboard size={16} />
                </button>

                {/* Fullscreen */}
                <button onClick={(e) => toggleFullscreen(e)} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  className="text-white/70 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-full">
                  {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keyboard Shortcuts Overlay */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={(e) => { e.stopPropagation(); setShowShortcuts(false); }}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              className="bg-black/90 border border-white/10 rounded-2xl p-6 max-w-sm w-full mx-4"
              onClick={(e) => e.stopPropagation()}>
              <h3 className="text-white text-sm font-semibold mb-4 uppercase tracking-widest">Keyboard Shortcuts</h3>
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                {[
                  ['Space / K', 'Play / Pause'],
                  ['← / J', 'Rewind 10s'],
                  ['→ / L', 'Forward 10s'],
                  ['↑ / ↓', 'Volume'],
                  ['M', 'Mute'],
                  ['F', 'Fullscreen'],
                  ['P', 'Picture-in-Picture'],
                  ['N', 'Next Episode'],
                  ['< / >', 'Speed ↓ / ↑'],
                  ['?', 'This menu'],
                  ['Esc', 'Close'],
                ].map(([key, desc]) => (
                  <React.Fragment key={key}>
                    <kbd className="text-violet-400 font-mono bg-white/5 px-2 py-0.5 rounded text-center">{key}</kbd>
                    <span className="text-white/60">{desc}</span>
                  </React.Fragment>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
