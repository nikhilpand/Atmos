import React from 'react';
import { Search, Settings, User, Map as MapIcon, LayoutDashboard, CloudSun, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { searchLocations, intelligentSearch } from '../services/weatherService';
import { Location } from '../types';
import { useStore } from '../store/useStore';

export const Navbar: React.FC = () => {
  const { 
    activeTab, setActiveTab, 
    searchQuery, setSearchQuery, 
    searchResults, setSearchResults, 
    isSearching, setIsSearching,
    setCurrentLocation 
  } = useStore();

  const handleSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (query.length > 2) {
      const locs = await searchLocations(query);
      setSearchResults(locs);
    } else {
      setSearchResults([]);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.length > 2) {
      setIsSearching(true);
      try {
        const loc = await intelligentSearch(searchQuery);
        if (loc) {
          selectLocation(loc);
        }
      } finally {
        setIsSearching(false);
      }
    }
  };

  const selectLocation = (loc: Location) => {
    setCurrentLocation(loc);
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <header className="fixed top-0 w-full z-50 bg-slate-900/60 backdrop-blur-3xl shadow-[0_8px_32px_0_rgba(59,191,250,0.08)]">
      <div className="flex justify-between items-center px-8 h-20 w-full">
        <div className="flex items-center gap-8">
          <span className="text-2xl font-bold tracking-widest text-white uppercase font-headline">ATMOS</span>
          <nav className="hidden md:flex gap-6 items-center">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { id: 'forecast', label: 'Forecast', icon: CloudSun },
              { id: 'maps', label: 'Maps', icon: MapIcon },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "font-headline tracking-tight transition-colors pb-1 border-b-2",
                  activeTab === tab.id 
                    ? "text-primary border-primary" 
                    : "text-on-surface-variant border-transparent hover:text-white"
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative group">
            <span className="absolute inset-y-0 left-3 flex items-center text-on-surface-variant">
              {isSearching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearch}
              onKeyDown={handleKeyDown}
              className="bg-white/5 border-none rounded-full pl-10 pr-4 py-2 text-sm focus:ring-1 focus:ring-primary w-48 lg:w-64 transition-all text-white placeholder:text-slate-500"
              placeholder={isSearching ? "Gemini is thinking..." : "Search or ask anything..."}
              disabled={isSearching}
            />
            {searchResults.length > 0 && !isSearching && (
              <div className="absolute top-full left-0 w-full mt-2 bg-surface-container-highest rounded-xl border border-outline-variant/20 shadow-2xl overflow-hidden">
                {searchResults.map((loc, i) => (
                  <button
                    key={i}
                    onClick={() => selectLocation(loc)}
                    className="w-full px-4 py-3 text-left hover:bg-white/10 transition-colors text-sm border-b border-outline-variant/10 last:border-none"
                  >
                    <div className="font-bold">{loc.name}</div>
                    <div className="text-xs text-on-surface-variant">{loc.country}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="p-2 rounded-full hover:bg-white/10 transition-all duration-300 text-primary">
            <Settings size={20} />
          </button>
          <button className="p-2 rounded-full hover:bg-white/10 transition-all duration-300 text-primary">
            <User size={20} />
          </button>
        </div>
      </div>
    </header>
  );
};
