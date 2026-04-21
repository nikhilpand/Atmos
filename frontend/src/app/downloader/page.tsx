/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import FrostedNavbar from "@/components/ui/FrostedNavbar";
import {
  Search, Download, Link2, Magnet, CheckCircle2,
  XCircle, Loader2, Trash2, Play,
  Film, Tv, HardDrive, Zap, Clock, ChevronRight
} from "lucide-react";
import { CONTROL_URL } from "@/lib/constants";

const DOWNLOADER_URL = `${CONTROL_URL}/downloader`;
const ATMOS_WATCH = "/library";

// ─── Types ───────────────────────────────────────────────────────────
interface TmdbResult {
  id: number; title: string; year: string; type: string;
  overview: string; poster: string; rating: number;
}
interface Job {
  id: string; url: string; title: string; status: string;
  phase: string; progress: number; speed: string; eta: string;
  size: string; drive_id: string; error: string; created: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  queued: "text-white/40", downloading: "text-cyan-400",
  uploading: "text-violet-400", done: "text-emerald-400", error: "text-red-400",
};
const STATUS_BG: Record<string, string> = {
  queued: "bg-white/5", downloading: "bg-cyan-500/10",
  uploading: "bg-violet-500/10", done: "bg-emerald-500/10", error: "bg-red-500/10",
};

// ─── Job Card ─────────────────────────────────────────────────────────
function JobCard({ job, onDelete }: { job: Job; onDelete: () => void }) {
  const isDone = job.status === "done";
  const isError = job.status === "error";
  const isActive = job.status === "downloading" || job.status === "uploading";

  return (
    <motion.div
      layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className={`rounded-2xl border border-white/[0.06] p-4 ${STATUS_BG[job.status]} transition-all`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
          {isDone ? <CheckCircle2 size={18} className="text-emerald-400" /> :
           isError ? <XCircle size={18} className="text-red-400" /> :
           isActive ? <Loader2 size={18} className={`${STATUS_COLOR[job.status]} animate-spin`} /> :
           <Clock size={18} className="text-white/30" />}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{job.title || job.url}</p>
          <p className={`text-xs mt-0.5 ${STATUS_COLOR[job.status]}`}>{job.phase}</p>

          {/* Progress bar */}
          {(isActive || isDone) && (
            <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${isDone ? "bg-emerald-500" : job.status === "uploading" ? "bg-violet-500" : "bg-cyan-500"}`}
                initial={{ width: 0 }}
                animate={{ width: `${job.progress}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          )}

          {/* Stats row */}
          {isActive && (job.speed || job.eta || job.size) && (
            <div className="flex gap-3 mt-2 text-[11px] text-white/30">
              {job.size && <span>{job.size}</span>}
              {job.speed && <span>↓ {job.speed}/s</span>}
              {job.eta && <span>ETA {job.eta}</span>}
              {job.progress > 0 && <span>{job.progress.toFixed(1)}%</span>}
            </div>
          )}

          {isError && <p className="text-red-400/70 text-[11px] mt-1 truncate">{job.error}</p>}

          {isDone && (
            <a href={ATMOS_WATCH} className="inline-flex items-center gap-1 text-emerald-400 text-xs mt-2 hover:text-emerald-300 transition-colors">
              <Play size={10} fill="currentColor" /> Watch in ATMOS <ChevronRight size={10} />
            </a>
          )}
        </div>

        {/* Delete */}
        <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-white/10 text-white/20 hover:text-red-400 transition-all flex-shrink-0">
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  );
}

// ─── TMDB Result Card ─────────────────────────────────────────────────
function ResultCard({ result, onDownload }: { result: TmdbResult; onDownload: (r: TmdbResult) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.05] hover:border-violet-500/20 transition-all group cursor-pointer"
      onClick={() => onDownload(result)}
    >
      {result.poster
        ? <img src={result.poster} alt={result.title} className="w-12 h-16 rounded-lg object-cover flex-shrink-0 bg-white/5" />
        : <div className="w-12 h-16 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
            {result.type === "tv" ? <Tv size={16} className="text-white/20" /> : <Film size={16} className="text-white/20" />}
          </div>
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-white text-sm font-semibold truncate">{result.title}</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/40 flex-shrink-0">
            {result.type === "tv" ? "TV" : "Movie"}
          </span>
        </div>
        <p className="text-white/30 text-xs mt-0.5">{result.year} · ⭐ {result.rating}</p>
        <p className="text-white/30 text-[11px] mt-1 line-clamp-2">{result.overview}</p>
      </div>
      <div className="flex items-center flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="w-7 h-7 rounded-full bg-violet-600/30 flex items-center justify-center">
          <Download size={12} className="text-violet-300" />
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────
export default function DownloaderPage() {
  const [tab, setTab] = useState<"search" | "url">("search");
  const [query, setQuery] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const searchTimer = useRef<NodeJS.Timeout | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ── Check if local server is running ──
  useEffect(() => {
    fetch(`${DOWNLOADER_URL}/api/jobs`)
      .then(() => setServerOk(true))
      .catch(() => setServerOk(false));
  }, []);

  // ── Poll jobs ──
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${DOWNLOADER_URL}/api/jobs`);
      if (res.ok) setJobs(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    setTimeout(() => fetchJobs(), 0);
    pollRef.current = setInterval(fetchJobs, 1500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchJobs]);

  // ── TMDB search with debounce ──
  useEffect(() => {
    if (tab !== "search") return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) { setTimeout(() => setResults([]), 0); return; }
    searchTimer.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`${DOWNLOADER_URL}/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) setResults(await res.json());
      } catch {}
      finally { setIsSearching(false); }
    }, 500);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, tab]);

  // ── Submit download ──
  const submitDownload = async (url: string, title: string) => {
    try {
      await fetch(`${DOWNLOADER_URL}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, title }),
      });
      await fetchJobs();
      setResults([]);
      setQuery("");
      setUrlInput("");
      setCustomTitle("");
    } catch {
      alert("Could not connect to downloader server. Is it running?");
    }
  };

  const deleteJob = async (jid: string) => {
    await fetch(`${DOWNLOADER_URL}/api/jobs/${jid}`, { method: "DELETE" });
    setJobs(j => j.filter(x => x.id !== jid));
  };

  const activeJobs = jobs.filter(j => j.status !== "done" && j.status !== "error");
  const doneJobs   = jobs.filter(j => j.status === "done" || j.status === "error");

  return (
    <div className="min-h-screen pb-20">
      <FrostedNavbar />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-24">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600/30 to-cyan-500/20 border border-violet-500/20 flex items-center justify-center">
            <Zap size={22} className="text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Download Manager</h1>
            <p className="text-white/30 text-sm">Search → Download → Auto-upload to Drive</p>
          </div>

          {/* Server status */}
          <div className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-white/10">
            <div className={`w-1.5 h-1.5 rounded-full ${serverOk === true ? "bg-emerald-400" : serverOk === false ? "bg-red-400" : "bg-yellow-400 animate-pulse"}`} />
            <span className="text-white/40">{serverOk === true ? "Server ready" : serverOk === false ? "Server offline" : "Connecting..."}</span>
          </div>
        </div>

        {/* ── Server offline warning ── */}
        {serverOk === false && (
          <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-sm text-red-300">
            <p className="font-semibold mb-1">⚠️ Local downloader server is not running</p>
            <p className="text-red-300/60 font-mono text-xs">cd ~/Desktop/jio-to-gdrive && python3 downloader_server.py</p>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/[0.06] mb-6 w-fit">
          {(["search", "url"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t ? "bg-violet-600 text-white shadow-lg" : "text-white/40 hover:text-white"}`}>
              {t === "search" ? <><Search size={14} /> TMDB Search</> : <><Link2 size={14} /> Paste URL / Magnet</>}
            </button>
          ))}
        </div>

        {/* ── Search Tab ── */}
        {tab === "search" && (
          <div className="mb-8">
            <div className="relative mb-4">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search movies, TV shows, anime..."
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-violet-500/40 focus:bg-white/[0.07] transition-all text-sm"
              />
              {isSearching && <Loader2 size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 animate-spin" />}
            </div>

            <AnimatePresence mode="popLayout">
              <div className="space-y-2">
                {results.map(r => (
                  <ResultCard key={r.id} result={r}
                    onDownload={r => {
                      const title = `${r.title}${r.year ? ` (${r.year})` : ""}`;
                      // We pass a search intent — user will be prompted for a URL
                      setTab("url");
                      setCustomTitle(title);
                      setUrlInput("");
                    }}
                  />
                ))}
              </div>
            </AnimatePresence>
          </div>
        )}

        {/* ── URL / Magnet Tab ── */}
        {tab === "url" && (
          <div className="mb-8 space-y-3">
            <div className="relative">
              <Link2 size={16} className="absolute left-4 top-4 text-white/30" />
              <textarea
                autoFocus
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder={"Paste URL or magnet link...\n\nhttps://example.com/video.mp4\nmagnet:?xt=urn:btih:..."}
                rows={4}
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500/40 transition-all text-sm resize-none font-mono"
              />
            </div>

            <input
              value={customTitle}
              onChange={e => setCustomTitle(e.target.value)}
              placeholder="Title / filename (optional)"
              className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-violet-500/40 transition-all text-sm"
            />

            <div className="flex items-center gap-2 text-xs text-white/25 px-1">
              <Magnet size={11} /> Supports: YouTube, direct .mp4/.mkv links, magnet URIs, most video sites
            </div>

            <button
              disabled={!urlInput.trim() || serverOk === false}
              onClick={() => submitDownload(urlInput.trim(), customTitle.trim())}
              className="w-full py-3.5 rounded-2xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all flex items-center justify-center gap-2"
            >
              <Download size={16} /> Start Download
            </button>
          </div>
        )}

        {/* ── Active Jobs ── */}
        {activeJobs.length > 0 && (
          <div className="mb-6">
            <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">
              Active · {activeJobs.length}
            </p>
            <div className="space-y-3">
              <AnimatePresence>
                {activeJobs.map(j => <JobCard key={j.id} job={j} onDelete={() => deleteJob(j.id)} />)}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* ── Done/Error Jobs ── */}
        {doneJobs.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-white/40 text-xs font-semibold uppercase tracking-widest">History · {doneJobs.length}</p>
              <button onClick={() => doneJobs.forEach(j => deleteJob(j.id))} className="text-white/20 hover:text-red-400 text-xs transition-colors">Clear all</button>
            </div>
            <div className="space-y-2">
              <AnimatePresence>
                {doneJobs.map(j => <JobCard key={j.id} job={j} onDelete={() => deleteJob(j.id)} />)}
              </AnimatePresence>
            </div>
          </div>
        )}

        {jobs.length === 0 && (
          <div className="text-center py-16">
            <HardDrive size={40} className="text-white/10 mx-auto mb-3" />
            <p className="text-white/20 text-sm">No downloads yet</p>
            <p className="text-white/10 text-xs mt-1">Search for a title or paste a URL above</p>
          </div>
        )}
      </div>
    </div>
  );
}
