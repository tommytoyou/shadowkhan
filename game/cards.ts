export type CardType = 'battle' | 'power' | 'action';
export type CardTier = 'seven' | 'eight' | 'nine';

export interface Card {
  label: string;
  name: string;
  type: CardType;
  bp?: number;
  tier?: CardTier;
  effects: string[];
  image: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

export const CARDS: Card[] = [
  {
    label: 'Sk-01',
    name: 'RULES OF ENGAGEMENT',
    type: 'action',
    effects: [
      'For the duration of the game after this card is played, if a Battle Card attacks a Battle Card with a higher BP, instead of the attacking card being removed, reduce the BP of the attack target by the BP of the attacking card. When a Battle Card\'s BP reaches zero, remove it.',
      'This card\'s effect can be undone if another copy of this card is activated',
    ],
    image: '/cards/Sk-01.png',
    confidence: 'high',
  },
  {
    label: 'Sk-02',
    name: 'TAKEN BY DARKNESS',
    type: 'action',
    effects: [
      'If this card is attacked while in your hand or deck, remove the attacking card.',
    ],
    image: '/cards/Sk-02.png',
    confidence: 'high',
  },
  {
    label: 'Sk-03',
    name: 'ARRIVAL OF DOOM',
    type: 'action',
    effects: [
      'This card can only be played when you have Sage of Dark Omen on the field.',
      'Remove one card on your field and add one War Dragon (that was removed or in your deck) to your hand.',
    ],
    image: '/cards/Sk-03.png',
    confidence: 'high',
  },
  {
    label: 'Sk-04',
    name: 'PURGATORY UNDONE',
    type: 'action',
    effects: [
      'Add one removed face-up card that was removed from your field back to your field.',
    ],
    image: '/cards/Sk-04.png',
    confidence: 'high',
  },
  {
    label: 'Sk-05',
    name: 'DIVINE SKY STRIKE',
    type: 'action',
    effects: [
      'Remove one Battle Card from the field face-up.',
    ],
    image: '/cards/Sk-05.png',
    confidence: 'high',
  },
  {
    label: 'Sk-06',
    name: 'TRANSFORMATION CHAMBER',
    type: 'action',
    effects: [
      'Play this card on the field and select one Battle Card with BP 8 or lower from your deck.',
      'Select and remove from your hand and/or deck cards equal to the BP of the selected card. At the start of your next turn, the selected card is considered played.',
    ],
    image: '/cards/Sk-06.png',
    confidence: 'high',
  },
  {
    label: 'Sk-07',
    name: 'ACE IN THE HOLE',
    type: 'action',
    effects: [
      'If you draw this card and it is your last card, you may select 10 of your face-up removed cards, shuffle them, and add them to your deck.',
      'If you draw this card normally, you may place it at the bottom of your deck. You cannot play other action cards this turn.',
    ],
    image: '/cards/Sk-07.png',
    confidence: 'high',
  },
  {
    label: 'Sk-08',
    name: 'A SINISTER ALLIANCE',
    type: 'action',
    effects: [
      'You can only play this card if you have at least one Blazing Sky Goblin, Sand Squid, or Battle Shock Scorpion on your field. From your deck, you may play one of the above-mentioned cards that is not already on your field.',
      'If you have all three of the above-mentioned cards on your field, their BP each becomes 9 until the end of your turn.',
    ],
    image: '/cards/Sk-08.png',
    confidence: 'high',
  },
  {
    label: 'Sk-09',
    name: 'POWER OF THE SHADOWS',
    type: 'power',
    effects: [
      'This card can only be used on Shadow Ghost.',
      'Shadow Ghost cannot be removed by Battle Cards or card effects until the end of your opponent\'s turn after this card was activated.',
    ],
    image: '/cards/Sk-09.png',
    confidence: 'high',
  },
  {
    label: 'Sk-10',
    name: 'CYCLO OPTIC BEAM',
    type: 'power',
    effects: [
      'This card can only be played while you have a One Eyed Mechanical Monster on the field.',
      'Remove one Battle Card on your opponent\'s field with a BP of 7 or less.',
      'If there are no cards on your opponent\'s field, remove one from their hand.',
    ],
    image: '/cards/Sk-10.png',
    confidence: 'high',
  },
  {
    label: 'Sk-11',
    name: 'CHOSEN CONDUIT',
    type: 'power',
    effects: [
      'You can only play this card when you have two or more Battle Cards on the field. Select one of those Battle Cards and increase its BP by the BP of your other Battle Cards.',
      'This effect can only be applied if the selected card\'s BP is 9 or less.',
      'If the selected card\'s BP becomes more than 9, remove all cards from your field.',
    ],
    image: '/cards/Sk-11.png',
    confidence: 'high',
  },
  {
    label: 'Sk-12',
    name: 'CURSE OF STONE',
    type: 'power',
    effects: [
      'Select one Battle Card on your opponent\'s field.',
      'The selected card and any cards they control with the same BP cannot attack, be attacked, or use card effects.',
      'This effect lasts until the end of your opponent\'s turn after this card was activated.',
    ],
    image: '/cards/Sk-12.png',
    confidence: 'high',
  },
  {
    label: 'Sk-13',
    name: 'MYSTICAL BLUE FLAME POWER CARD',
    type: 'power',
    effects: [
      'This Power Card may only be used on Battle Cards with a BP of 6 or less. Choose one of the following effects',
      'when activated: Increase the BP of one of your Battle Cards by +1 until the end of your turn.',
      'Restore the VP of one of your Battle Cards to its original BP at the end of your opponent\'s turn after this card is activated.',
    ],
    image: '/cards/Sk-13.png',
    confidence: 'high',
  },
  {
    label: 'Sk-14',
    name: 'ONE EYED MECHANICAL MONSTER',
    type: 'battle',
    bp: 8,
    effects: [
      'When this card is summoned, you may remove 1 of your opponent\'s Battle Cards from the field.',
      'When this card removes a card by battle, you may remove 1 card from your opponent\'s hand or the top of their deck.',
    ],
    image: '/cards/Sk-14.png',
    confidence: 'high',
  },
  {
    label: 'Sk-15',
    name: 'SHADOW GHOST',
    type: 'battle',
    bp: 7,
    effects: [
      'This card cannot be removed by Battle Card effects.',
      'While this card is on the field, if it would be removed by battle, you may return it to your hand instead.',
    ],
    image: '/cards/Sk-15.png',
    confidence: 'high',
  },
  {
    label: 'Sk-16',
    name: 'WAR DRAGON',
    type: 'battle',
    bp: 9,
    effects: [
      'You can only play this card if you have at least two BP 7 or BP 8 cards removed, and your opponent has at least one BP 7 or BP 8 card removed.',
      'This card cannot be removed by Battle Cards.',
      'You may remove 1 face-down Power Card from your hand to negate the effect of an opponent\'s Power Card.',
      'You may remove 1 face-down Action Card from your hand during either player\'s turn to negate your opponent\'s Action Card remove 1 card from the field.',
    ],
    image: '/cards/Sk-16.png',
    confidence: 'medium',
    notes: 'effect_d text unclear at end — printed reads: negate your opponent\'s Action Card remove 1 card from the field — may be missing conjunction before final remove',
  },
  {
    label: 'Sk-17',
    name: 'BLOAT DRAGON',
    type: 'battle',
    bp: 3,
    effects: [
      'When this card is removed, your opponent must remove cards from the top of their deck equal to the number of turns this card was on the field.',
    ],
    image: '/cards/Sk-17.png',
    confidence: 'high',
  },
  {
    label: 'Sk-18',
    name: 'EMPTY VESSEL',
    type: 'battle',
    bp: 1,
    effects: [
      'When you play this card, you may select 1 of your removed cards. This card\'s BP and effects become identical to the selected card.',
      'If the selected removed card is no longer removed, remove this card face-down.',
    ],
    image: '/cards/Sk-18.png',
    confidence: 'high',
  },
  {
    label: 'Sk-19',
    name: 'THE HEADLESS HORSEMAN',
    type: 'battle',
    bp: 5,
    effects: [
      'Once after this card is played, if it would be removed by battle, it may remain on the field instead.',
    ],
    image: '/cards/Sk-19.png',
    confidence: 'high',
  },
  {
    label: 'Sk-20',
    name: 'SAGE OF DARK OMEN',
    type: 'battle',
    bp: 2,
    effects: [
      'While this is the only card on your side of the field, you may remove 3 cards from your hand to remove up to 2 BP 7 or BP 8 Battle Cards from your deck.',
      'Remove this card from the field and add 1 Arrival Of Doom from your deck to your hand.',
    ],
    image: '/cards/Sk-20.png',
    confidence: 'high',
  },
  {
    label: 'Sk-21',
    name: 'SAND SQUID',
    type: 'battle',
    bp: 6,
    effects: [
      'When this card battles, you may select all Battle Cards on your opponent\'s field and shuffle them face-down. Flip the top card face-up, and if you call it correctly, remove all cards on your opponent\'s field.',
      'If your guess is incorrect, decrease this card\'s BP by 2.',
    ],
    image: '/cards/Sk-21.png',
    confidence: 'high',
  },
  {
    label: 'Sk-22',
    name: 'GARGOYLE THE WICKED',
    type: 'battle',
    bp: 6,
    effects: [
      'When you play this card, if your opponent has a card adjacent to this one, that card cannot attack while this card is on the field.',
      'Remove the top card from your opponent\'s deck. This card cannot attack for the rest of the time it remains on the field.',
    ],
    image: '/cards/Sk-22.png',
    confidence: 'high',
  },
  {
    label: 'Sk-23',
    name: 'PORTAL MONARCH',
    type: 'battle',
    bp: 4,
    effects: [
      'Discard 1 Battle Card, Action Card, or Power Card from your hand to add 1 card of the same type from your deck to your hand. You cannot play the selected card this turn.',
    ],
    image: '/cards/Sk-23.png',
    confidence: 'high',
  },
  {
    label: 'Sk-24',
    name: 'BLAZING SKY GOBLIN',
    type: 'battle',
    bp: 6,
    effects: [
      'If you play this card while Sand Squid or Battle Shock Scorpion is on your field, you can add A Sinister Alliance from your deck to your hand.',
    ],
    image: '/cards/Sk-24.png',
    confidence: 'high',
  },
  {
    label: 'Sk-25',
    name: 'BATTLE SHOCK SCORPION',
    type: 'battle',
    bp: 6,
    effects: [
      'If this card removes a Battle Card, you can remove the top card from your opponent\'s deck.',
      'You can remove face down one Action Card in your hand to stop this card from being removed after losing a battle.',
      'If you play this card while Blazing Sky Goblin and Sand Squid are on your field, you can add one face-up removed Action Card to your hand.',
    ],
    image: '/cards/Sk-25.png',
    confidence: 'high',
  },
  {
    label: 'Sk-26',
    name: 'ABDUCTION SAUCER',
    type: 'battle',
    bp: 5,
    effects: [
      'Once per turn, you can select one Battle Card on your opponent\'s field and place it under this card. When this card is removed, remove all cards under this card.',
      'If this card is removed by a card effect, return as many of your opponent\'s cards to their field as possible, with the rest going back to the deck.',
    ],
    image: '/cards/Sk-26.png',
    confidence: 'high',
  },
  {
    label: 'Sk-27',
    name: 'CRIMSON SHE-KNIGHT',
    type: 'battle',
    bp: 5,
    effects: [
      'When this card removes a Battle Card, increase this card\'s BP by 1.',
    ],
    image: '/cards/Sk-27.png',
    confidence: 'high',
  },
  {
    label: 'Sk-28',
    name: 'SKULLFACE',
    type: 'battle',
    bp: 1,
    effects: [
      'Remove all cards in your hand and place this card in your opponent\'s deck.',
      'If they draw this card in their next five turns, remove the top three cards from their deck.',
      'If they do not draw this card in their next five turns, they must remove this card face down and you remove the top three cards of your deck.',
    ],
    image: '/cards/Sk-28.png',
    confidence: 'high',
  },
  {
    label: 'Sk-29',
    name: 'RAREWOLF',
    type: 'battle',
    bp: 4,
    effects: [
      'If a Battle Card with a BP of 4 or less on your field were to be removed, you can remove this card on the field instead.',
    ],
    image: '/cards/Sk-29.png',
    confidence: 'high',
  },
  {
    label: 'Sk-30',
    name: 'SHADOW\'S MISTRESS',
    type: 'battle',
    bp: 3,
    effects: [
      'If a Shadow Ghost on your field were to be removed, you can add it to your deck instead and remove one card face down from your hand.',
    ],
    image: '/cards/Sk-30.png',
    confidence: 'high',
  },
];

export const CARD_BY_LABEL: Record<string, Card> =
  Object.fromEntries(CARDS.map(c => [c.label, c]));
