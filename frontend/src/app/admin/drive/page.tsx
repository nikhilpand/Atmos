"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, FileVideo, Trash2, Edit3, FolderPlus, ArrowLeft,
  RefreshCw, MoveRight, Check, X, Share2, Search, ChevronRight, Wand2
} from 'lucide-react';
import { adminGet, adminPost } from '@/lib/adminApi';

interface DriveItem {
  id: string;
  name: string;
  is_folder: boolean;
  size: string;
  size_bytes: number;
  modified: string;
  mime: string;
}

export default function DrivePage() {
  const [items, setItems] = useState<DriveItem[]>([]);
  const [currentFolder, setCurrentFolder] = useState('');
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [autoRenaming, setAutoRenaming] = useState(false);
  const [sharing, setSharing] = useState(false);

  const browse = useCallback(async (folderId: string = '', folderName: string = 'Root') => {
    setIsLoading(true);
    setSelected(new Set());
    try {
      const params = folderId ? `?folder_id=${folderId}` : '';
      const data = await adminGet(`/api/admin/drive/browse${params}`);
      setItems(data.files || []);
      setCurrentFolder(data.folder_id || '');
      if (folderId && folderName) {
        setBreadcrumbs(prev => {
          const exists = prev.findIndex(b => b.id === folderId);
          if (exists >= 0) return prev.slice(0, exists + 1);
          return [...prev, { id: folderId, name: folderName }];
        });
      } else {
        setBreadcrumbs([]);
      }
    } catch { /* silent */ }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { browse(); }, [browse]);

  const goBack = () => {
    if (breadcrumbs.length > 1) {
      const parent = breadcrumbs[breadcrumbs.length - 2];
      setBreadcrumbs(prev => prev.slice(0, -1));
      browse(parent.id, parent.name);
    } else {
      setBreadcrumbs([]);
      browse();
    }
  };

  const openFolder = (item: DriveItem) => {
    if (item.is_folder) browse(item.id, item.name);
  };

  const renameFile = async (id: string) => {
    if (!renameName.trim()) return;
    try {
      await adminPost(`/api/admin/rename/${id}`, { new_name: renameName });
      browse(currentFolder, breadcrumbs[breadcrumbs.length - 1]?.name);
    } catch (e: any) { alert(e.message); }
    setRenaming(null);
  };

  const deleteFile = async (id: string) => {
    if (!confirm('Delete this file permanently?')) return;
    try {
      await adminPost(`/api/admin/delete/${id}`, {});
      browse(currentFolder, breadcrumbs[breadcrumbs.length - 1]?.name);
    } catch (e: any) { alert(e.message); }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} files permanently?`)) return;
    try {
      await adminPost('/api/admin/bulk/delete', { file_ids: Array.from(selected) });
      browse(currentFolder, breadcrumbs[breadcrumbs.length - 1]?.name);
    } catch (e: any) { alert(e.message); }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await adminPost('/api/admin/drive/mkdir', { name: newFolderName, parent_id: currentFolder });
      setShowNewFolder(false);
      setNewFolderName('');
      browse(currentFolder, breadcrumbs[breadcrumbs.length - 1]?.name);
    } catch (e: any) { alert(e.message); }
  };

  const autoRename = async () => {
    if (!confirm('Auto-rename ALL video files using TMDB metadata? This can take a while.')) return;
    setAutoRenaming(true);
    try {
      const data = await adminPost('/api/admin/auto-rename', {});
      alert(`✅ Renamed ${data.renamed} files, skipped ${data.skipped}, ${data.errors} errors.`);
      browse(currentFolder, breadcrumbs[breadcrumbs.length - 1]?.name);
    } catch (e: any) { alert(e.message); }
    finally { setAutoRenaming(false); }
  };

  const shareAll = async () => {
    if (!confirm('Make all files publicly accessible?')) return;
    setSharing(true);
    try {
      const data = await adminPost('/api/admin/share-all', {});
      alert(`✅ Shared ${data.shared}/${data.total} files.`);
    } catch (e: any) { alert(e.message); }
    finally { setSharing(false); }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.id)));
  };

  const filtered = search
    ? items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  const folders = filtered.filter(i => i.is_folder);
  const files = filtered.filter(i => !i.is_folder);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Drive Explorer</h1>
          <p className="text-white/30 text-sm mt-0.5">{items.length} items in current folder</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={autoRename} disabled={autoRenaming}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500/10 hover:bg-violet-500/15 border border-violet-500/15 text-violet-400/70 hover:text-violet-400 text-xs font-medium transition-all disabled:opacity-30">
            <Wand2 size={13} className={autoRenaming ? 'animate-spin' : ''} /> {autoRenaming ? 'Renaming…' : 'Auto-Rename All'}
          </button>
          <button onClick={shareAll} disabled={sharing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/15 text-blue-400/70 hover:text-blue-400 text-xs font-medium transition-all disabled:opacity-30">
            <Share2 size={13} /> Share All
          </button>
          <button onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/15 text-emerald-400/70 hover:text-emerald-400 text-xs font-medium transition-all">
            <FolderPlus size={13} /> New Folder
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-xs overflow-x-auto">
        <button onClick={() => { setBreadcrumbs([]); browse(); }}
          className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0">Root</button>
        {breadcrumbs.map((b, i) => (
          <React.Fragment key={b.id}>
            <ChevronRight size={12} className="text-white/15 flex-shrink-0" />
            <button onClick={() => {
              setBreadcrumbs(prev => prev.slice(0, i + 1));
              browse(b.id, b.name);
            }} className="text-white/40 hover:text-white/70 transition-colors truncate max-w-32">{b.name}</button>
          </React.Fragment>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        {breadcrumbs.length > 0 && (
          <button onClick={goBack} className="p-2 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-all">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter files..." className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white text-xs placeholder:text-white/20 focus:outline-none focus:border-violet-500/30 transition-all" />
        </div>
        {selected.size > 0 && (
          <button onClick={bulkDelete}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/15 text-red-400 text-xs font-medium hover:bg-red-500/15 transition-all">
            <Trash2 size={13} /> Delete {selected.size}
          </button>
        )}
        <button onClick={selectAll} className="text-white/20 hover:text-white/40 text-[11px] transition-colors">
          {selected.size === items.length ? 'Deselect All' : 'Select All'}
        </button>
        <button onClick={() => browse(currentFolder, breadcrumbs[breadcrumbs.length - 1]?.name)}
          className="p-2 rounded-lg text-white/20 hover:text-white hover:bg-white/5 transition-all ml-auto">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* New Folder Dialog */}
      {showNewFolder && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
          <FolderPlus size={16} className="text-emerald-400/50" />
          <input type="text" value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
            placeholder="Folder name..." autoFocus onKeyDown={e => e.key === 'Enter' && createFolder()}
            className="flex-1 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-white text-xs focus:outline-none" />
          <button onClick={createFolder} className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10"><Check size={16} /></button>
          <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="p-1.5 rounded-lg text-white/30 hover:text-white"><X size={16} /></button>
        </div>
      )}

      {/* File List */}
      <div className="rounded-2xl border border-white/[0.04] overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center"><div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FolderOpen size={36} className="mx-auto mb-3 text-white/10" />
            <p className="text-white/25 text-sm">Empty folder</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {/* Folders first */}
            {folders.map(item => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer group"
                onClick={() => openFolder(item)}>
                <FolderOpen size={16} className="text-amber-400/50 flex-shrink-0" />
                <span className="text-white/70 text-sm flex-1 truncate group-hover:text-white transition-colors">{item.name}</span>
                <ChevronRight size={14} className="text-white/15 flex-shrink-0" />
              </div>
            ))}
            {/* Files */}
            {files.map(item => (
              <div key={item.id} className={`flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors ${selected.has(item.id) ? 'bg-violet-500/5' : ''}`}>
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)}
                  className="rounded border-white/20 bg-white/5 text-violet-500 focus:ring-0 focus:ring-offset-0 cursor-pointer" />
                <FileVideo size={14} className="text-violet-400/40 flex-shrink-0" />
                {renaming === item.id ? (
                  <div className="flex items-center gap-1.5 flex-1">
                    <input type="text" value={renameName} onChange={e => setRenameName(e.target.value)}
                      autoFocus onKeyDown={e => { if (e.key === 'Enter') renameFile(item.id); if (e.key === 'Escape') setRenaming(null); }}
                      className="flex-1 px-2 py-1 rounded-lg bg-white/[0.04] border border-violet-500/30 text-white text-xs focus:outline-none" />
                    <button onClick={() => renameFile(item.id)} className="text-emerald-400"><Check size={14} /></button>
                    <button onClick={() => setRenaming(null)} className="text-white/30"><X size={14} /></button>
                  </div>
                ) : (
                  <span className="text-white/60 text-sm flex-1 truncate">{item.name}</span>
                )}
                <span className="text-white/20 text-[11px] hidden sm:block">{item.size}</span>
                <span className="text-white/15 text-[11px] hidden md:block">{item.modified}</span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={e => { e.stopPropagation(); setRenaming(item.id); setRenameName(item.name); }}
                    className="p-1.5 rounded-lg text-white/20 hover:text-white hover:bg-white/5"><Edit3 size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); deleteFile(item.id); }}
                    className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
