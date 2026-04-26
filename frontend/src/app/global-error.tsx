"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center px-4">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <span className="text-2xl">⚠️</span>
          </div>
          <h2 className="text-white text-lg font-bold mb-2">Critical Error</h2>
          <p className="text-white/40 text-sm mb-6">ATMOS encountered a fatal error.</p>
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-full bg-violet-600 text-white font-semibold text-sm"
          >
            Reload App
          </button>
          {error.digest && (
            <p className="text-white/10 text-[10px] mt-4 font-mono">{error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
