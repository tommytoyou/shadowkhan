import { CARD_BY_LABEL } from '@shadowkhan/game';

export function cardImageSrc(label: string): string {
  const card = CARD_BY_LABEL[label];
  if (card) return card.image;
  return `/cards/${label}.png`;
}
