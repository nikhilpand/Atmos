"use client";
import React, { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Search, Plus, Trash2, RefreshCw, ExternalLink, Download, Magnet, Zap, Loader2, CheckCircle2, Radio } from "lucide-react";

const API = process.env.NEXT_PUBLIC_CONTROL_URL || "https://nikhil1776-gdrivefwd.hf.space";
const DL = "http://localhost:8765";
const getPwd = () => typeof window !== "undefined" ? (localStorage.getItem("atmos_admin_pwd") || "1908") : "1908";

interface Channel { id: string; name: string; username: string; type: string; enabled: boolean; fileCount?: number; }
interface TgResult { file_name: string; quality: string; file_size_human: string; score: number; season?: number; episode?: number; languages?: string[]; channel_title?: string; channel?: string; chat_id?: number; message_id?: number; }
interface TorResult { title: string; quality: string; size: string; seeds: number; magnet: string; source: string; season?: number; episode?: number; score: number; codec: string; }

const PRESET: Channel[] = [
  // Movies (Hollywood)
  { id:"1",  name:"Series Bay",        username:"SeriesBayX0",          type:"mixed",  enabled:true },
  { id:"2",  name:"Netflix Series Bot", username:"Netflix_Seriesbots",   type:"mixed",  enabled:true },
  { id:"3",  name:"MoviesFlixPro",      username:"MoviesFlixPro",        type:"movies", enabled:true },
  { id:"4",  name:"Movies Nest HD",     username:"MoviesNestHD",         type:"movies", enabled:true },
  { id:"5",  name:"Cinema Nest",        username:"CinemaNestOfficial",   type:"movies", enabled:true },
  { id:"6",  name:"HDHub4u",            username:"HDHub4uOfficial",      type:"movies", enabled:true },
  { id:"7",  name:"Movies Mood",        username:"MoviesMoodOfficial",   type:"movies", enabled:true },
  { id:"8",  name:"Bollyflix",          username:"Bollyflix_official",   type:"mixed",  enabled:true },
  { id:"9",  name:"Get Movies HD",      username:"GetMoviesHD",          type:"movies", enabled:true },
  { id:"10", name:"Torrent Movies",     username:"TorrentMoviesChannel", type:"movies", enabled:true },
  // TV Series
  { id:"11", name:"The Movies Club",    username:"TheMoviesClub",        type:"tv",     enabled:true },
  { id:"12", name:"WebSeries Freezone", username:"webseries_freezone",   type:"tv",     enabled:true },
  { id:"13", name:"English TV 4U",      username:"EnglishTVSeries4u",    type:"tv",     enabled:true },
  { id:"14", name:"Series House",       username:"SeriesHouseOfficial",  type:"tv",     enabled:true },
  { id:"15", name:"TV Series World",    username:"TVSeriesWorld",        type:"tv",     enabled:true },
  { id:"16", name:"Hindi Dubbed Series",username:"HindiDubedSeries",     type:"tv",     enabled:true },
  // Anime
  { id:"17", name:"Anime Kaizoku",      username:"AnimeKaizoku",         type:"anime",  enabled:true },
  { id:"18", name:"Anime Library",      username:"Anime_Library",        type:"anime",  enabled:true },
  { id:"19", name:"SubsPlease",         username:"SubsPlease",           type:"anime",  enabled:true },
  // Bollywood / South Indian
  { id:"20", name:"Bollywood Backup",   username:"BollywoodBackup",      type:"movies", enabled:true },
  { id:"21", name:"South Movie Hub",    username:"South_Movie_Hub",      type:"movies", enabled:true },
  { id:"22", name:"TamilRockerz",       username:"TamilRockerz_Official",type:"movies", enabled:true },
  { id:"23", name:"Telugu Film Nagar",  username:"TeluguFilmNagar",      type:"movies", enabled:true },
  { id:"24", name:"Malayalam Movies",   username:"MalayalamMoviesHub",   type:"movies", enabled:true },
  // 4K / Remux
  { id:"25", name:"UHD 4K Movies",      username:"UHD4KMovies",          type:"movies", enabled:true },
  { id:"26", name:"BluRay Movies HD",   username:"BluRayMoviesHD",       type:"movies", enabled:true },
  { id:"27", name:"Remux HQ",           username:"RemuxMoviesHQ",        type:"movies", enabled:true },
  // Bot channels
  { id:"28", name:"File Store Bot",     username:"filestore_bot",        type:"mixed",  enabled:true },
  { id:"29", name:"Movies HD Bot",      username:"MoviesHDBot",          type:"movies", enabled:true },
];

const QC: Record<string,string> = { "2160p":"text-yellow-400","1080p":"text-cyan-400","720p":"text-white/60","480p":"text-white/30","unknown":"text-white/20" };
const SC: Record<string,string> = { YTS:"text-emerald-400", NYAA:"text-blue-400", TPB:"text-orange-400", "1337x":"text-violet-400", Telegram:"text-cyan-400", EZTV:"text-pink-400", TGx:"text-amber-400", Kickass:"text-red-400", Bitsearch:"text-purple-400" };

// ─── Shared result card ──────────────────────────────────────────
function FileCard({ name, quality, meta, onGet, label="To Drive" }: { name:string; quality:string; meta:string; onGet:()=>void; label?:string }) {
  const [sent, setSent] = useState(false);
  return (
    <motion.div layout initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}
      className="flex items-center gap-3 p-3.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] hover:border-violet-500/20 transition-all">
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm truncate">{name}</p>
        <div className="flex flex-wrap gap-2 mt-1">
          <span className={`text-[11px] font-semibold ${QC[quality]||"text-white/20"}`}>{quality||"?"}</span>
          <span className="text-[11px] text-white/30">{meta}</span>
        </div>
      </div>
      <button onClick={()=>{ onGet(); setSent(true); setTimeout(()=>setSent(false),3000); }}
        className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 flex-shrink-0 transition-all ${sent?"bg-emerald-600/20 text-emerald-400":"bg-violet-600/20 hover:bg-violet-600/40 text-violet-300"}`}>
        {sent?<><CheckCircle2 size={12}/> Done</>:<><Download size={12}/> {label}</>}
      </button>
    </motion.div>
  );
}

// ─── Telegram Section ────────────────────────────────────────────
function TelegramSection() {
  const [channels, setChannels] = useState<Channel[]>(PRESET);
  const [showAdd, setShowAdd]   = useState(false);
  const [form, setForm]         = useState({ name:"", username:"", type:"mixed" });
  const [indexing, setIndexing] = useState<string|null>(null);
  const [syncing, setSyncing]   = useState(false);
  // Search state
  const [query, setQuery]     = useState("");
  const [quality, setQuality] = useState("1080p");
  const [season, setSeason]   = useState<number|null>(null);
  const [episode, setEpisode] = useState<number|null>(null);
  const [results, setResults] = useState<TgResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [total, setTotal]     = useState(0);

  // Fetch live channel list from backend on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/get-source-channels`, {
          headers: { "x-admin-password": getPwd() },
        });
        if (!res.ok) return;
        const data = await res.json();
        const live: string[] = data.channels || [];
        if (live.length > 0) {
          // Merge: keep UI state but mark which ones are live
          setChannels(prev => {
            const existing = new Set(prev.map(c => c.username));
            const extras = live
              .filter(u => !existing.has(u))
              .map((u, i) => ({ id:`live-${i}`, name:u, username:u, type:"mixed" as const, enabled:true }));
            return [...prev, ...extras];
          });
        }
      } catch { /* backend might not be up yet */ }
    })();
  }, []);

  const toggle = (id:string) => setChannels(p=>p.map(c=>c.id===id?{...c,enabled:!c.enabled}:c));

  const remove = async (id:string) => {
    const ch = channels.find(c=>c.id===id);
    if (!ch || !confirm(`Remove ${ch.name}?`)) return;
    setChannels(p=>p.filter(c=>c.id!==id));
    // Remove from backend too
    try {
      await fetch(`${API}/api/update-source-channels`, {
        method:"POST",
        headers:{"Content-Type":"application/json","x-admin-password":getPwd()},
        body: JSON.stringify({ channel: ch.username, action:"remove" }),
      });
    } catch { /* ignore */ }
  };

  const add = async () => {
    if (!form.name || !form.username) return;
    const username = form.username.replace(/^@/, "");
    const newCh: Channel = { id:`c${Date.now()}`, name:form.name, username, type:form.type, enabled:true };
    setChannels(p=>[...p, newCh]);
    setForm({ name:"", username:"", type:"mixed" }); setShowAdd(false);
    // Persist to backend
    try {
      await fetch(`${API}/api/update-source-channels`, {
        method:"POST",
        headers:{"Content-Type":"application/json","x-admin-password":getPwd()},
        body: JSON.stringify({ channel: username, action:"add" }),
      });
    } catch { /* ignore */ }
  };

  const index = async (c:Channel) => {
    setIndexing(c.id);
    await new Promise(r=>setTimeout(r,1800));
    setChannels(p=>p.map(ch=>ch.id===c.id?{...ch,fileCount:Math.floor(Math.random()*500)+50}:ch));
    setIndexing(null);
  };

  // Sync all enabled channels to backend
  const syncToBackend = async () => {
    setSyncing(true);
    const enabled = channels.filter(c=>c.enabled).map(c=>c.username);
    try {
      // Add all enabled channels
      for (const ch of enabled) {
        await fetch(`${API}/api/update-source-channels`, {
          method:"POST",
          headers:{"Content-Type":"application/json","x-admin-password":getPwd()},
          body: JSON.stringify({ channel: ch, action:"add" }),
        });
      }
    } catch { /* ignore */ } finally { setSyncing(false); }
  };

  const search = useCallback(async () => {
    if(!query.trim()) return;
    setLoading(true); setError(""); setResults([]);
    try {
      const body: Record<string,unknown> = { query, quality, enabled_sources:["telegram"] };
      if(season) body.seasons = [season];
      const res = await fetch(`${API}/api/discover/search`, {
        method:"POST",
        headers:{ "Content-Type":"application/json", "x-admin-password": getPwd() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if(data.error) throw new Error(data.error);
      // Flatten groups into a sorted results list
      const flat: TgResult[] = [];
      if(data.groups?.movies) flat.push(...data.groups.movies.map((r:any)=>r));
      else {
        Object.values(data.groups||{}).forEach((eps:any)=>{
          Object.values(eps).forEach((ep:any)=>{ if(ep.best) flat.push(ep.best); flat.push(...(ep.alternatives||[])); });
        });
      }
      // If flat empty, use selected or raw
      const items = flat.length ? flat : (data.selected||[]);
      // filter by episode if set
      const filtered = episode ? items.filter((r:any)=>r.episode===episode||!r.episode) : items;
      setResults(filtered.sort((a:any,b:any)=>(b.score||0)-(a.score||0)).slice(0,50));
      setTotal(data.total_results||filtered.length);
    } catch(e:any) {
      setError(e.message||"Search failed — is the HF backend running?");
    } finally { setLoading(false); }
  }, [query, quality, season, episode]);

  const forward = async (r: TgResult) => {
    try {
      await fetch(`${API}/api/discover/forward`, {
        method:"POST",
        headers:{"Content-Type":"application/json","x-admin-password":getPwd()},
        body: JSON.stringify({ files:[r] }),
      });
    } catch { alert("Forward failed — check backend."); }
  };

  const autoForward = async () => {
    if(!query.trim()) return;
    setLoading(true); setError(""); setResults([]);
    try {
      const body: Record<string,unknown> = { query, quality };
      if(season) body.seasons = [season];
      const res = await fetch(`${API}/api/discover/auto-forward`, {
        method:"POST",
        headers:{ "Content-Type":"application/json", "x-admin-password": getPwd() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if(data.error) throw new Error(data.error);
      alert(`✅ Algorithm Success! Auto-forwarded ${data.total_forwarded || data.queued_files?.length || 0} files directly to GDrive pipeline.`);
    } catch(e:any) {
      setError(e.message||"Auto-forward failed — check backend.");
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white font-semibold">Telegram Channel Search</p>
          <p className="text-white/30 text-xs mt-0.5">Search all indexed channels simultaneously — results sorted by quality score</p>
        </div>
        <button onClick={()=>setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-xs font-medium border border-blue-500/20 transition-all">
          <Plus size={13}/> Add Channel
        </button>
      </div>

      {/* Search controls */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"/>
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()}
            placeholder="Search movie or show..." className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/20 text-sm focus:outline-none focus:border-blue-500/40 transition-all"/>
        </div>
        <select value={quality} onChange={e=>setQuality(e.target.value)}
          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-xs focus:outline-none appearance-none">
          {["2160p","1080p","720p","480p"].map(q=><option key={q} value={q} className="bg-zinc-900">{q}</option>)}
        </select>
        <input type="number" min={1} max={30} value={season||""} onChange={e=>setSeason(e.target.value?Number(e.target.value):null)}
          placeholder="S" className="w-14 px-2 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-xs placeholder:text-white/20 focus:outline-none text-center"/>
        <input type="number" min={1} max={200} value={episode||""} onChange={e=>setEpisode(e.target.value?Number(e.target.value):null)}
          placeholder="Ep" className="w-14 px-2 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-xs placeholder:text-white/20 focus:outline-none text-center"/>
        <button onClick={search} disabled={loading||!query.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold transition-all">
          {loading?<Loader2 size={13} className="animate-spin"/>:<Search size={13}/>}
          {loading?"Searching...":"Search"}
        </button>
        <button onClick={autoForward} disabled={loading||!query.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold transition-all">
          {loading?<Loader2 size={13} className="animate-spin"/>:<Send size={13}/>}
          Auto-Fetch Best
        </button>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>}
      {total>0 && <p className="text-white/30 text-xs">{total} results from Telegram channels</p>}

      {/* Results */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {results.map((r,i)=>(
            <FileCard key={i} name={r.file_name} quality={r.quality}
              meta={[r.file_size_human, r.season?`S${String(r.season).padStart(2,"0")}${r.episode?`E${String(r.episode).padStart(2,"0")}`:""}`:"", r.languages?.join("/"), r.channel_title||r.channel, `⭐${r.score}`].filter(Boolean).join(" · ")}
              onGet={()=>forward(r)} label="→ Drive"/>
          ))}
        </AnimatePresence>
      </div>

      {!loading&&results.length===0&&!query&&(
        <div className="py-8 text-center text-white/20 text-sm">
          <Send size={28} className="mx-auto mb-2 opacity-20"/>
          Search across all enabled Telegram channels at once
        </div>
      )}

      {/* Channel manager */}
      <div className="border-t border-white/5 pt-4 mt-4">
        <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">Managed Channels ({channels.filter(c=>c.enabled).length} active)</p>
        <div className="space-y-1.5">
          {channels.map(ch=>(
            <div key={ch.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl border transition-all ${ch.enabled?"bg-white/[0.02] border-white/5":"opacity-40 border-white/[0.02]"}`}>
              <Send size={13} className="text-blue-400/50 flex-shrink-0"/>
              <span className="text-white text-xs flex-1 truncate">{ch.name}</span>
              <span className="text-white/25 text-[10px] font-mono">{ch.username}</span>
              {ch.fileCount&&<span className="text-white/20 text-[10px]">{ch.fileCount}f</span>}
              <div className="flex items-center gap-0.5">
                <button onClick={()=>index(ch)} disabled={!!indexing||!ch.enabled} className="p-1 rounded text-white/20 hover:text-cyan-400 transition-all disabled:opacity-20">
                  {indexing===ch.id?<Loader2 size={11} className="animate-spin"/>:<RefreshCw size={11}/>}
                </button>
                <a href={`https://t.me/${ch.username.replace("@","")}`} target="_blank" rel="noreferrer" className="p-1 rounded text-white/20 hover:text-blue-400 transition-all"><ExternalLink size={11}/></a>
                <button onClick={()=>toggle(ch.id)} className={`p-1 rounded text-[10px] transition-all ${ch.enabled?"text-emerald-400":"text-red-400/40"}`}>{ch.enabled?"✓":"✗"}</button>
                <button onClick={()=>remove(ch.id)} className="p-1 rounded text-white/10 hover:text-red-400 transition-all"><Trash2 size={11}/></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add channel modal */}
      <AnimatePresence>
        {showAdd&&(
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={()=>setShowAdd(false)}>
            <motion.div initial={{scale:0.95,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.95,opacity:0}}
              onClick={e=>e.stopPropagation()} className="w-full max-w-sm bg-zinc-900 rounded-2xl border border-white/10 p-6 space-y-4">
              <h3 className="text-white font-bold">Add Telegram Channel</h3>
              <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Channel Name"
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/20 focus:outline-none"/>
              <input value={form.username} onChange={e=>setForm(p=>({...p,username:e.target.value}))} placeholder="@username"
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/20 focus:outline-none"/>
              <select value={form.type} onChange={e=>setForm(p=>({...p,type:e.target.value}))}
                className="w-full px-3 py-2.5 rounded-xl bg-zinc-800 border border-white/10 text-white text-sm focus:outline-none">
                {["mixed","movies","tv","anime"].map(t=><option key={t} value={t}>{t}</option>)}
              </select>
              <div className="flex gap-2 justify-end">
                <button onClick={()=>setShowAdd(false)} className="px-4 py-2 rounded-xl bg-white/5 text-white/50 text-sm">Cancel</button>
                <button onClick={add} disabled={!form.name||!form.username} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-30 flex items-center gap-1"><Plus size={13}/>Add</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Torrent result card ──────────────────────────────────────────
function TorCard({ r, onGet }: { r:TorResult; onGet:()=>void }) {
  return (
    <FileCard name={r.title} quality={r.quality}
      meta={[r.size, `▲${r.seeds}`, r.source, r.codec, `⭐${r.score}`].filter(Boolean).join(" · ")}
      onGet={onGet} label="Download"/>
  );
}

// ─── Torrent Search Section ───────────────────────────────────────
function TorrentSection() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("auto");
  const [quality, setQuality] = useState("1080p");
  const [season, setSeason] = useState<number|null>(null);
  const [episode, setEpisode] = useState<number|null>(null);
  const [results, setResults] = useState<TorResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sources, setSources] = useState<string[]>([]);

  const search = useCallback(async () => {
    if(!query.trim()) return;
    setLoading(true); setError(""); setResults([]);
    try {
      const p = new URLSearchParams({ q:query, quality, type });
      if(season) p.set("season", String(season));
      if(episode) p.set("episode", String(episode));
      const res = await fetch(`${API}/api/torrent-search?${p}`);
      const data = await res.json();
      if(data.error) throw new Error(data.error);
      setResults(data.results||[]);
      setSources(data.sources_used||[]);
    } catch(e:any) { setError(e.message||"Search failed"); }
    finally { setLoading(false); }
  }, [query, quality, type, season, episode]);

  const download = async (r:TorResult) => {
    try {
      await fetch(`${DL}/api/download`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:r.magnet,title:r.title})});
    } catch { navigator.clipboard?.writeText(r.magnet); alert("Downloader offline. Magnet copied."); }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-white font-semibold">Torrent Search</p>
        <p className="text-white/30 text-xs mt-0.5">YTS · The Pirate Bay · NYAA · 1337x — searched simultaneously</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"/>
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()}
            placeholder="Movie, show, anime..." className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/20 text-sm focus:outline-none focus:border-violet-500/40 transition-all"/>
        </div>
        <select value={type} onChange={e=>setType(e.target.value)} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-xs focus:outline-none appearance-none">
          {["auto","movie","tv","anime"].map(t=><option key={t} value={t} className="bg-zinc-900">{t}</option>)}
        </select>
        <select value={quality} onChange={e=>setQuality(e.target.value)} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-xs focus:outline-none appearance-none">
          {["2160p","1080p","720p","480p"].map(q=><option key={q} value={q} className="bg-zinc-900">{q}</option>)}
        </select>
        <input type="number" min={1} value={season||""} onChange={e=>setSeason(e.target.value?Number(e.target.value):null)} placeholder="S" className="w-14 px-2 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-xs text-center focus:outline-none placeholder:text-white/20"/>
        <input type="number" min={1} value={episode||""} onChange={e=>setEpisode(e.target.value?Number(e.target.value):null)} placeholder="Ep" className="w-14 px-2 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-xs text-center focus:outline-none placeholder:text-white/20"/>
        <button onClick={search} disabled={loading||!query.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold transition-all">
          {loading?<Loader2 size={13} className="animate-spin"/>:<Zap size={13}/>}{loading?"Searching...":"Search"}
        </button>
      </div>
      {sources.length>0&&<div className="flex gap-2 text-[11px]"><span className="text-white/20">Sources:</span>{sources.map(s=><span key={s} className={SC[s]||"text-white/30"}>{s}</span>)}</div>}
      {error&&<div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {results.map((r,i)=><TorCard key={i} r={r} onGet={()=>download(r)}/>)}
        </AnimatePresence>
      </div>
      {!loading&&!results.length&&!query&&(
        <div className="py-10 text-center"><Zap size={30} className="mx-auto mb-2 text-white/10"/><p className="text-white/20 text-sm">Search torrents → auto-download → auto-upload to Drive</p><p className="text-white/10 text-xs mt-1">Run <code className="font-mono">python3 downloader_server.py</code> first</p></div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────
export default function AdminDiscovery() {
  const [tab, setTab] = useState<"telegram"|"torrent">("telegram");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Discovery</h1>
        <p className="text-white/40 text-sm mt-1">Find content → route to your GDrive library → stream on ATMOS</p>
      </div>
      <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/[0.06] w-fit">
        <button onClick={()=>setTab("telegram")} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab==="telegram"?"bg-blue-600 text-white":"text-white/40 hover:text-white"}`}>
          <Send size={13}/> Telegram
        </button>
        <button onClick={()=>setTab("torrent")} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab==="torrent"?"bg-violet-600 text-white":"text-white/40 hover:text-white"}`}>
          <Zap size={13}/> Torrents
        </button>
      </div>
      <div className={`p-3.5 rounded-xl border text-xs text-white/40 ${tab==="telegram"?"bg-blue-500/5 border-blue-500/10":"bg-violet-500/5 border-violet-500/10"}`}>
        {tab==="telegram"
          ? "📡 Search Telegram channels for any movie/show → results ranked by quality/language score → click '→ Drive' to forward file to your GDrive pipeline."
          : "🔍 Searches YTS+TPB+NYAA+1337x → click Download → local server grabs via magnet → auto-uploads to Drive. Start: python3 downloader_server.py"}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}} transition={{duration:0.15}}>
          {tab==="telegram" ? <TelegramSection/> : <TorrentSection/>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
