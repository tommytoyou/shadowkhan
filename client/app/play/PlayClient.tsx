'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';

const GameClient = dynamic(() => import('../../components/GameClient'), {
  ssr: false,
});

export default function PlayClient() {
  const searchParams = useSearchParams();
  const playerID = searchParams.get('player') ?? '0';
  const matchID = searchParams.get('match') ?? 'dev-match';

  return (
    <main className="relative min-h-screen w-full bg-black">
      <GameClient playerID={playerID} matchID={matchID} />
      <div className="fixed bottom-2 right-2 rounded border border-sk-slate bg-black/80 px-2 py-1 text-xs text-white">
        Player {playerID}
      </div>
    </main>
  );
}
