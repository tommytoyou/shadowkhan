import { Server } from 'boardgame.io/server';
import { ShadowkhanGame } from '@shadowkhan/game';

const server = Server({
  games: [ShadowkhanGame],
  origins: [process.env.CLIENT_ORIGIN ?? '*'],
});

const PORT = Number(process.env.PORT) || 8000;

server.run(PORT, () => console.log(`Server on ${PORT}`));
