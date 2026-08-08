'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

// Same reason /play does this: boardgame.io's Client owns live state and a
// transport, neither of which survives (or wants) a server render.
const CpuGame = dynamic(() => import('../../components/CpuGame'), {
  ssr: false,
});

export default function CpuPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-black text-white">
          Loading…
        </main>
      }
    >
      <main className="relative min-h-screen w-full bg-black">
        <CpuGame />
        <div className="fixed bottom-2 right-2 rounded border border-sk-slate bg-black/80 px-2 py-1 text-xs text-white">
          vs CPU — Player 0
        </div>
      </main>
    </Suspense>
  );
}
