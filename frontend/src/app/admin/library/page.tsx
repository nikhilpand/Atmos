"use client";

import React, { useState, useEffect } from 'react';
import { Search, FileVideo, Trash2, Edit, ExternalLink, HardDrive } from 'lucide-react';
import { CONTROL_URL } from '@/lib/constants';

interface DriveFile {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  modifiedTime?: string;
}

export default function AdminLibrary() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${CONTROL_URL}/api/videos`)
      .then(r => r.json())
      .then(data => setFiles(data.videos || data.files || []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const filtered = files.filter(f =>
    (f.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const formatSize = (bytes?: number) => {
    if (!bytes) return '—';
    if (bytes > 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    if (bytes > 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Library</h1>
          <p className="text-white/40 text-sm mt-1">{files.length} files in Google Drive</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search files..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-violet-500/30 transition-all"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02]">
              <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Name</th>
              <th className="text-left px-4 py-3 text-white/40 font-medium text-xs hidden sm:table-cell">Size</th>
              <th className="text-left px-4 py-3 text-white/40 font-medium text-xs hidden md:table-cell">Type</th>
              <th className="text-left px-4 py-3 text-white/40 font-medium text-xs hidden lg:table-cell">Modified</th>
              <th className="text-right px-4 py-3 text-white/40 font-medium text-xs">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-white/[0.03]">
                  <td className="px-4 py-3"><div className="h-4 w-3/4 rounded shimmer" /></td>
                  <td className="px-4 py-3 hidden sm:table-cell"><div className="h-4 w-16 rounded shimmer" /></td>
                  <td className="px-4 py-3 hidden md:table-cell"><div className="h-4 w-12 rounded shimmer" /></td>
                  <td className="px-4 py-3 hidden lg:table-cell"><div className="h-4 w-20 rounded shimmer" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-12 rounded shimmer ml-auto" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12">
                  <HardDrive size={32} className="text-white/10 mx-auto mb-2" />
                  <p className="text-white/30 text-sm">No files found</p>
                </td>
              </tr>
            ) : (
              filtered.map(file => (
                <tr key={file.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileVideo size={14} className="text-violet-400/50 flex-shrink-0" />
                      <span className="text-white/80 truncate max-w-xs">{file.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-white/40 hidden sm:table-cell">{formatSize(file.size)}</td>
                  <td className="px-4 py-3 text-white/40 hidden md:table-cell">{file.mimeType?.split('/').pop() || '—'}</td>
                  <td className="px-4 py-3 text-white/40 hidden lg:table-cell">
                    {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`https://drive.google.com/file/d/${file.id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-all"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
