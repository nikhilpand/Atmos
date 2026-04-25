"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, Lock, Loader2, User, AlertCircle } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';

export default function AuthModal() {
  const { isAuthModalOpen, closeAuthModal } = useAuthStore();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!isSupabaseConfigured() || !supabase) {
      setError('Authentication is not configured. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your environment variables.');
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        if (!username.trim()) throw new Error("Username is required");
        if (password.length < 6) throw new Error("Password must be at least 6 characters");

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username: username.trim() }
          }
        });
        if (error) throw error;
        setSuccess('Account created! Check your email to confirm your account.');
        setEmail('');
        setPassword('');
        setUsername('');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        closeAuthModal();
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={closeAuthModal}
          className="absolute inset-0 bg-black/80 backdrop-blur-md"
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 30 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-md bg-[#0a0a0a]/95 border border-white/10 rounded-2xl shadow-2xl shadow-violet-500/5 overflow-hidden backdrop-blur-xl"
        >
          {/* Decorative gradients */}
          <div className="absolute -top-32 -right-32 w-64 h-64 bg-violet-600/20 rounded-full blur-[80px] pointer-events-none" />
          <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-cyan-500/15 rounded-full blur-[80px] pointer-events-none" />

          <button
            onClick={closeAuthModal}
            className="absolute top-4 right-4 p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-full transition-all z-10"
          >
            <X size={18} />
          </button>

          <div className="p-8 relative z-10">
            {/* Logo */}
            <div className="flex items-center gap-2 mb-6">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-cyan-500" />
              <span className="text-white font-bold tracking-widest text-sm">ATMOS</span>
            </div>

            <h2 className="text-2xl font-bold text-white mb-1.5">
              {isSignUp ? 'Create an Account' : 'Welcome Back'}
            </h2>
            <p className="text-white/40 text-sm mb-8">
              {isSignUp 
                ? 'Sign up to sync your watch history across all your devices.' 
                : 'Sign in to pick up right where you left off.'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div>
                  <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Username</label>
                  <div className="relative">
                    <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25" />
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] focus:ring-1 focus:ring-violet-500/20 transition-all placeholder:text-white/15"
                      placeholder="e.g. Cinephile99"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Email address</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] focus:ring-1 focus:ring-violet-500/20 transition-all placeholder:text-white/15"
                    placeholder="name@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] focus:ring-1 focus:ring-violet-500/20 transition-all placeholder:text-white/15"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2.5 p-3.5 bg-red-500/10 border border-red-500/15 rounded-xl"
                >
                  <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-red-400 text-sm leading-relaxed">{error}</p>
                </motion.div>
              )}

              {success && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3.5 bg-emerald-500/10 border border-emerald-500/15 rounded-xl"
                >
                  <p className="text-emerald-400 text-sm leading-relaxed">{success}</p>
                </motion.div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-white text-black font-bold text-sm rounded-xl hover:bg-white/90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  isSignUp ? 'Create Account' : 'Sign In'
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => { setIsSignUp(!isSignUp); setError(''); setSuccess(''); }}
                className="text-sm text-white/40 hover:text-white/70 transition-colors"
              >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
