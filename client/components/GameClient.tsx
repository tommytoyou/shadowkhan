'use client';

import { Client } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { ShadowkhanGame } from '@shadowkhan/game';
import Board from './Board';

const ShadowkhanClient = Client({
  game: ShadowkhanGame,
  board: Board,
  multiplayer: SocketIO({ server: 'http://localhost:8000' }),
  debug: false,
});

export default function GameClient({
  playerID,
  matchID,
}: {
  playerID: string;
  matchID: string;
}) {
  return <ShadowkhanClient playerID={playerID} matchID={matchID} />;
}
