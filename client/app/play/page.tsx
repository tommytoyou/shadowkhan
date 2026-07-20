import { Suspense } from 'react';
import PlayClient from './PlayClient';

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-black text-white">
          Loading…
        </main>
      }
    >
      <PlayClient />
    </Suspense>
  );
}
