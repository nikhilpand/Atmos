import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import { useWatchStore } from './useWatchStore';

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: any | null;
  isLoading: boolean;
  isAuthModalOpen: boolean;

  setAuth: (user: User | null, session: Session | null) => void;
  setProfile: (profile: any) => void;
  setLoading: (loading: boolean) => void;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  isLoading: true,
  isAuthModalOpen: false,

  setAuth: (user, session) => set({ user, session, isLoading: false }),
  setProfile: (profile) => set({ profile }),
  setLoading: (isLoading) => set({ isLoading }),
  
  openAuthModal: () => set({ isAuthModalOpen: true }),
  closeAuthModal: () => set({ isAuthModalOpen: false }),

  signOut: async () => {
    if (supabase) {
      await supabase.auth.signOut();
      set({ user: null, session: null, profile: null });
      useWatchStore.getState().clearAll(); // Clear local cache on logout
    }
  },
}));

// Global listener for auth changes
export function initAuthListener() {
  if (!supabase) {
    useAuthStore.getState().setLoading(false);
    return () => {};
  }

  // Get initial session
  supabase.auth.getSession().then(({ data: { session } }) => {
    useAuthStore.getState().setAuth(session?.user ?? null, session);
    if (session?.user) {
      fetchProfile(session.user.id);
      useWatchStore.getState().initSync(session.user.id); // Trigger initial sync
    }
  });

  // Listen for changes
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    useAuthStore.getState().setAuth(session?.user ?? null, session);
    if (session?.user) {
      fetchProfile(session.user.id);
      if (_event === 'SIGNED_IN') {
        useWatchStore.getState().initSync(session.user.id);
      }
    } else {
      useAuthStore.getState().setProfile(null);
    }
  });

  return () => subscription.unsubscribe();
}

async function fetchProfile(userId: string) {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
    
  if (!error && data) {
    useAuthStore.getState().setProfile(data);
  }
}
