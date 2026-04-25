"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { initAuthListener } from '@/store/useAuthStore';
import AuthModal from '@/components/auth/AuthModal';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000 * 60, // 1 hour
        refetchOnWindowFocus: false,
      },
    },
  }));

  useEffect(() => {
    const unsubscribe = initAuthListener();
    return () => unsubscribe();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <AuthModal />
    </QueryClientProvider>
  );
}
