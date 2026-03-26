import { create } from 'zustand';
import { Location } from '../types';

interface AppState {
  activeTab: string;
  searchQuery: string;
  searchResults: Location[];
  isSearching: boolean;
  currentLocation: Location;
  
  setActiveTab: (tab: string) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: Location[]) => void;
  setIsSearching: (isSearching: boolean) => void;
  setCurrentLocation: (location: Location) => void;
}

const DEFAULT_LOCATION: Location = {
  name: 'Reykjavík',
  country: 'Iceland',
  lat: 64.1355,
  lon: -21.8954,
};

export const useStore = create<AppState>((set) => ({
  activeTab: 'dashboard',
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  currentLocation: DEFAULT_LOCATION,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchResults: (results) => set({ searchResults: results }),
  setIsSearching: (isSearching) => set({ isSearching }),
  setCurrentLocation: (location) => set({ currentLocation: location }),
}));
