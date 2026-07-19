import { Server, Origins } from 'boardgame.io/server';
import { ShadowkhanGame } from '@shadowkhan/game';

const server = Server({ games: [ShadowkhanGame], origins: [Origins.LOCALHOST] });

const PORT = Number(process.env.PORT) || 8000;

server.run(PORT, () => console.log(`Server on ${PORT}`));
