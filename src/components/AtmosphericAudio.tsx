import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { WEATHER_CONDITIONS } from '../types';

interface AtmosphericAudioProps {
  conditionCode: number;
}

// Using high-quality, reliable Mixkit ambient tracks which are stable for hotlinking
const AUDIO_MAP: Record<string, string> = {
  rain: 'https://assets.mixkit.co/active_storage/sfx/2438/2438-preview.mp3',
  storm: 'https://assets.mixkit.co/active_storage/sfx/2439/2439-preview.mp3',
  wind: 'https://assets.mixkit.co/active_storage/sfx/2440/2440-preview.mp3',
  clear_day: 'https://assets.mixkit.co/active_storage/sfx/2441/2441-preview.mp3',
  clear_night: 'https://assets.mixkit.co/active_storage/sfx/2442/2442-preview.mp3',
  snow: 'https://assets.mixkit.co/active_storage/sfx/2440/2440-preview.mp3', // Using wind for snow
};

export const AtmosphericAudio: React.FC<AtmosphericAudioProps> = ({ conditionCode }) => {
  const [isMuted, setIsMuted] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const condition = WEATHER_CONDITIONS[conditionCode];
    let trackKey = 'clear_day';

    if (condition?.isStormy) trackKey = 'storm';
    else if (condition?.isRainy) trackKey = 'rain';
    else if (condition?.isSnowy) trackKey = 'snow';
    else if (conditionCode === 32) trackKey = 'wind';
    else if (conditionCode >= 33 && conditionCode <= 37) trackKey = 'clear_night';
    else trackKey = 'clear_day';

    const newTrack = AUDIO_MAP[trackKey];
    if (newTrack !== currentTrack) {
      setCurrentTrack(newTrack);
    }
  }, [conditionCode, currentTrack]);

  // Handle track changes and playback
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const playAudio = async () => {
      try {
        // If there's an ongoing play request, we don't need to do anything special
        // as setting src will naturally abort it.
        audio.src = currentTrack;
        audio.load();
        audio.loop = true;
        audio.volume = 0.4;

        if (!isMuted) {
          playPromiseRef.current = audio.play();
          await playPromiseRef.current;
        }
      } catch (error: any) {
        // Ignore AbortError as it's expected when switching tracks rapidly
        if (error.name !== 'AbortError') {
          console.error("Audio playback failed:", error.message);
          // Don't auto-mute on error, just log it. The user can try again.
        }
      }
    };

    playAudio();

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [currentTrack]);

  // Handle mute/unmute separately to avoid reloading the track
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;

    const syncPlayback = async () => {
      try {
        if (isMuted) {
          audio.pause();
        } else {
          playPromiseRef.current = audio.play();
          await playPromiseRef.current;
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error("Mute toggle playback failed:", error.message);
        }
      }
    };

    syncPlayback();
  }, [isMuted]);

  const toggleMute = () => {
    setIsMuted(prev => !prev);
  };

  return (
    <div className="fixed bottom-8 right-8 z-[100]">
      <audio 
        ref={audioRef} 
        preload="auto"
        onEnded={() => {
          // Fallback for loop if needed, though loop=true handles it
          if (audioRef.current) audioRef.current.play().catch(() => {});
        }}
      />
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={toggleMute}
        className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-xl border transition-all duration-500 shadow-2xl",
          isMuted 
            ? "bg-white/5 border-white/10 text-on-surface-variant" 
            : "bg-primary border-primary/20 text-white"
        )}
        title={isMuted ? "Unmute Atmospheric Audio" : "Mute Atmospheric Audio"}
      >
        <AnimatePresence mode="wait">
          {isMuted ? (
            <motion.div
              key="muted"
              initial={{ opacity: 0, rotate: -45 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 45 }}
            >
              <VolumeX size={20} />
            </motion.div>
          ) : (
            <motion.div
              key="unmuted"
              initial={{ opacity: 0, rotate: -45 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 45 }}
            >
              <Volume2 size={20} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
      
      {!isMuted && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute right-16 top-1/2 -translate-y-1/2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 whitespace-nowrap"
        >
          <span className="text-[10px] uppercase tracking-widest font-bold text-white/80 flex items-center gap-2">
            <span className="w-1 h-1 bg-primary rounded-full animate-ping" />
            Atmospheric Audio Active
          </span>
        </motion.div>
      )}
    </div>
  );
};
