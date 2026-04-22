"use client";

import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, FileVideo, Trash2, Edit3, ExternalLink, HardDrive,
  RefreshCw, Download, Grid, List, SortAsc, SortDesc, Film,
  Check, X, ChevronDown, Eye, Play
} from 'lucide-react';
import { publicGet, adminPost, API_BASE } from '@/lib/adminApi';

interface DriveFile {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  modifiedTime?: string;
}

type SortKey = 'name' | 'size' | 'date';
type ViewMode = 'list' | 'grid';

function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes > 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatDate(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getTotalSize(files: DriveFile[]): string {
  const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
  return formatSize(total);
}

function getQuality(name: string): string | null {
  const m = name.match(/(2160p|4K|1080p|720p|480p|360p)/i);
  return m ? m[1].toUpperCase() : null;
}

const qualityColor: Record<string, string> = {
  '2160P': 'text-yellow-400 bg-yellow-500/10 border-yellow-500/15',
  '4K': 'text-yellow-400 bg-yellow-500/10 border-yellow-500/15',
  '1080P': 'text-cyan-400 bg-cyan-500/10 border-cyan-500/15',
  '720P': 'text-white/50 bg-white/5 border-white/10',
  '480P': 'text-white/30 bg-white/[0.03] border-white/[0.05]',
  '360P': 'text-white/20 bg-white/[0.02] border-white/[0.03]',
};

export default function AdminLibrary() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchFiles = async () => {
    setIsLoading(true);
    try {
      const data = await publicGet('/api/videos');
      setFiles(data.videos || data.files || []);
    } catch { /* silent */ }
    finally { setIsLoading(false); }
  };

  useEffect(() => { fetchFiles(); }, []);

  const filtered = useMemo(() => {
    let list = files.filter(f => (f.name || '').toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sortKey === 'size') cmp = (a.size || 0) - (b.size || 0);
      else if (sortKey === 'date') cmp = new Date(a.modifiedTime || 0).getTime() - new Date(b.modifiedTime || 0).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [files, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const renameFile = async (id: string) => {
    if (!renameName.trim()) return;
    try {
      await adminPost(`/api/admin/rename/${id}`, { new_name: renameName });
      fetchFiles();
    } catch (e: any) { alert(e.message); }
    setRenaming(null);
  };

  const deleteFile = async (id: string) => {
    if (!confirm('Delete this file permanently?')) return;
    try {
      await adminPost(`/api/admin/delete/${id}`, {});
      fetchFiles();
    } catch (e: any) { alert(e.message); }
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} files?`)) return;
    try {
      await adminPost('/api/admin/bulk/delete', { file_ids: Array.from(selected) });
      setSelected(new Set());
      fetchFiles();
    } catch (e: any) { alert(e.message); }
  };

  const SortIcon = sortDir === 'asc' ? SortAsc : SortDesc;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Library</h1>
          <p className="text-white/30 text-sm mt-0.5">
            {files.length} files · {getTotalSize(files)} total
          </p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <button onClick={bulkDelete}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/15 text-red-400 text-xs font-medium transition-all">
              <Trash2 size={13} /> Delete {selected.size}
            </button>
          )}
          <button onClick={fetchFiles}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-white/50 hover:text-white text-xs font-medium transition-all">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search library..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-violet-500/30 transition-all" />
        </div>

        {/* Sort */}
        <div className="flex gap-1 p-1 rounded-lg bg-white/[0.03] border border-white/[0.04]">
          {(['name', 'size', 'date'] as SortKey[]).map(k => (
            <button key={k} onClick={() => toggleSort(k)}
              className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium capitalize transition-all ${
                sortKey === k ? 'bg-white/[0.06] text-white' : 'text-white/30 hover:text-white/50'
              }`}>
              {k} {sortKey === k && <SortIcon size={10} className="inline ml-0.5" />}
            </button>
          ))}
        </div>

        {/* View mode */}
        <div className="flex gap-0.5 p-1 rounded-lg bg-white/[0.03] border border-white/[0.04]">
          <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md ${viewMode === 'list' ? 'bg-white/[0.06] text-white' : 'text-white/30'}`}>
            <List size={14} />
          </button>
          <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md ${viewMode === 'grid' ? 'bg-white/[0.06] text-white' : 'text-white/30'}`}>
            <Grid size={14} />
          </button>
        </div>
      </div>

      {/* List View */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-12 rounded-xl bg-white/[0.02] animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <HardDrive size={40} className="mx-auto mb-3 text-white/10" />
          <p className="text-white/25 text-sm">No files found</p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="rounded-2xl border border-white/[0.04] overflow-hidden divide-y divide-white/[0.03]">
          {filtered.map(file => {
            const q = getQuality(file.name);
            return (
              <div key={file.id} className={`flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group ${
                selected.has(file.id) ? 'bg-violet-500/5' : ''
              }`}>
                <input type="checkbox" checked={selected.has(file.id)}
                  onChange={() => setSelected(prev => { const next = new Set(prev); next.has(file.id) ? next.delete(file.id) : next.add(file.id); return next; })}
                  className="rounded border-white/20 bg-white/5 text-violet-500 focus:ring-0 cursor-pointer" />
                <FileVideo size={14} className="text-violet-400/40 flex-shrink-0" />
                {renaming === file.id ? (
                  <div className="flex items-center gap-1.5 flex-1">
                    <input type="text" value={renameName} onChange={e => setRenameName(e.target.value)}
                      autoFocus onKeyDown={e => { if (e.key === 'Enter') renameFile(file.id); if (e.key === 'Escape') setRenaming(null); }}
                      className="flex-1 px-2 py-1 rounded-lg bg-white/[0.04] border border-violet-500/30 text-white text-xs focus:outline-none" />
                    <button onClick={() => renameFile(file.id)} className="text-emerald-400"><Check size={14} /></button>
                    <button onClick={() => setRenaming(null)} className="text-white/30"><X size={14} /></button>
                  </div>
                ) : (
                  <span className="text-white/70 text-sm flex-1 truncate">{file.name}</span>
                )}
                {q && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${qualityColor[q] || ''}`}>{q}</span>
                )}
                <span className="text-white/20 text-[11px] hidden sm:block w-16 text-right">{formatSize(file.size)}</span>
                <span className="text-white/15 text-[11px] hidden md:block w-24">{formatDate(file.modifiedTime)}</span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a href={`${API_BASE}/api/stream/${file.id}`} target="_blank" rel="noreferrer"
                    className="p-1.5 rounded-lg text-white/20 hover:text-emerald-400 hover:bg-emerald-500/10"><Play size={13} /></a>
                  <button onClick={() => { setRenaming(file.id); setRenameName(file.name); }}
                    className="p-1.5 rounded-lg text-white/20 hover:text-white hover:bg-white/5"><Edit3 size={13} /></button>
                  <a href={`https://drive.google.com/file/d/${file.id}/view`} target="_blank" rel="noreferrer"
                    className="p-1.5 rounded-lg text-white/20 hover:text-blue-400 hover:bg-blue-500/10"><ExternalLink size={13} /></a>
                  <button onClick={() => deleteFile(file.id)}
                    className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10"><Trash2 size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Grid View */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map(file => {
            const q = getQuality(file.name);
            return (
              <div key={file.id}
                className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 hover:border-white/[0.08] transition-all group cursor-pointer"
                onClick={() => window.open(`${API_BASE}/api/stream/${file.id}`, '_blank')}>
                <div className="w-full aspect-video rounded-lg bg-gradient-to-br from-violet-500/10 to-cyan-500/10 flex items-center justify-center mb-3 overflow-hidden relative">
                  <Film size={24} className="text-white/10" />
                  {q && (
                    <span className={`absolute top-1.5 right-1.5 text-[9px] font-bold px-1 py-0.5 rounded ${qualityColor[q] || ''}`}>{q}</span>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play size={20} className="text-white" />
                  </div>
                </div>
                <p className="text-white/60 text-xs truncate">{file.name}</p>
                <p className="text-white/20 text-[10px] mt-1">{formatSize(file.size)}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
