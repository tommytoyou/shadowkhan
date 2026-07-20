'use client';

import { useState } from 'react';
import type { BoardProps } from 'boardgame.io/react';
import type { ShadowkhanG, FieldCard } from '@shadowkhan/game';
import { cardImageSrc } from '../lib/cardImage';
import CardBack from './CardBack';

type Props = BoardProps<ShadowkhanG>;

const OPP_HAND_CAP = 8;
const FIELD_SLOT_BOX = 'aspect-[2.5/3.5] w-52 shrink-0 rounded-lg';

export default function Board({ G, ctx, moves, playerID, isActive }: Props) {
  const [selectedHandIndex, setSelectedHandIndex] = useState<number | null>(null);
  const [selectedFieldSlot, setSelectedFieldSlot] = useState<number | null>(null);

  const pid = playerID ?? '0';
  const opp = pid === '0' ? '1' : '0';

  const ownHand = G.secret.hands[pid] ?? [];
  const ownField = G.public.field[pid] ?? [null, null, null];
  const oppField = G.public.field[opp] ?? [null, null, null];
  const ownDeckCount = G.public.deckCounts[pid] ?? 0;
  const oppDeckCount = G.public.deckCounts[opp] ?? 0;
  const oppHandCount = G.public.handCounts[opp] ?? 0;
  const ownBanished = G.public.banished[pid] ?? [];
  const oppBanished = G.public.banished[opp] ?? [];
  const ownBanishedFaceDown = G.public.banishedFaceDown[pid] ?? 0;
  const oppBanishedFaceDown = G.public.banishedFaceDown[opp] ?? 0;
  const bottomUpUsed = G.public.bottomUpUsed[pid] ?? false;
  const attackedThisTurn = G.public.attackedThisTurn;

  const canAttack = isActive && !attackedThisTurn && selectedFieldSlot !== null;

  function clearSelection() {
    setSelectedHandIndex(null);
    setSelectedFieldSlot(null);
  }

  function handleSelectHandCard(index: number) {
    if (!isActive) return;
    setSelectedFieldSlot(null);
    setSelectedHandIndex((prev) => (prev === index ? null : index));
  }

  function handleSelectFieldCard(slot: number) {
    if (!isActive || attackedThisTurn) return;
    setSelectedHandIndex(null);
    setSelectedFieldSlot((prev) => (prev === slot ? null : slot));
  }

  function handlePlayIntoSlot(slot: number) {
    if (!isActive || selectedHandIndex === null) return;
    moves.playCard(selectedHandIndex, slot);
    clearSelection();
  }

  function handleAttackField(theirSlot: number) {
    if (!isActive || selectedFieldSlot === null) return;
    moves.attackBattleCard(selectedFieldSlot, theirSlot);
    clearSelection();
  }

  function handleAttackHand(theirHandIndex: number) {
    if (!isActive || selectedFieldSlot === null) return;
    moves.attackHand(selectedFieldSlot, theirHandIndex);
    clearSelection();
  }

  function handleAttackDeck() {
    if (!isActive || selectedFieldSlot === null) return;
    moves.attackDeck(selectedFieldSlot);
    clearSelection();
  }

  function handleBottomUp() {
    if (!isActive) return;
    moves.bottomUp();
  }

  function handleEndTurn() {
    if (!isActive) return;
    moves.endTurn();
    clearSelection();
  }

  function handleDrawCard() {
    if (!isActive) return;
    moves.drawCard();
  }

  function renderFieldSlot(side: 'own' | 'opp', slot: number, card: FieldCard | null) {
    const key = `${side}-field-${slot}`;

    if (!card) {
      if (side === 'own') {
        const canPlaceHere = isActive && selectedHandIndex !== null;
        return (
          <button
            key={key}
            type="button"
            onClick={() => handlePlayIntoSlot(slot)}
            disabled={!canPlaceHere}
            aria-label={`Empty field slot ${slot + 1}${
              canPlaceHere ? ' - play selected card here' : ''
            }`}
            className={`${FIELD_SLOT_BOX} border-2 border-dashed border-sk-slate bg-transparent disabled:opacity-40`}
          />
        );
      }
      return (
        <div
          key={key}
          aria-label={`Opponent empty field slot ${slot + 1}`}
          className={`${FIELD_SLOT_BOX} border-2 border-dashed border-sk-slate bg-transparent`}
        />
      );
    }

    if (side === 'own') {
      const isSelected = selectedFieldSlot === slot;
      const disabled = !isActive || attackedThisTurn;
      return (
        <button
          key={key}
          type="button"
          onClick={() => handleSelectFieldCard(slot)}
          disabled={disabled}
          aria-pressed={isSelected}
          aria-label={`Your field card in slot ${slot + 1}, BP ${card.currentBp}${
            isSelected ? ', selected' : ''
          }`}
          className={`relative ${FIELD_SLOT_BOX} overflow-visible border-2 bg-neutral-950 disabled:opacity-50 ${
            isSelected ? 'border-white ring-2 ring-white' : 'border-sk-slate'
          }`}
        >
          <img
            src={cardImageSrc(card.label)}
            alt=""
            className="h-full w-full rounded-lg object-contain"
          />
          <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-black bg-sk-slate text-xs font-bold text-white">
            {card.currentBp}
          </span>
        </button>
      );
    }

    return (
      <button
        key={key}
        type="button"
        onClick={() => handleAttackField(slot)}
        disabled={!canAttack}
        aria-label={`Attack opponent field card in slot ${slot + 1}, BP ${card.currentBp}`}
        className={`relative ${FIELD_SLOT_BOX} overflow-visible border-2 border-sk-slate bg-neutral-950 disabled:opacity-50`}
      >
        <img
          src={cardImageSrc(card.label)}
          alt=""
          className="h-full w-full rounded-lg object-contain"
        />
        <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-black bg-sk-slate text-xs font-bold text-white">
          {card.currentBp}
        </span>
      </button>
    );
  }

  const visibleOppHandCount = Math.min(oppHandCount, OPP_HAND_CAP);
  const hiddenOppHandCount = oppHandCount - visibleOppHandCount;

  const selectionPrompt =
    selectedHandIndex !== null
      ? 'Card selected — click an empty field slot to play it.'
      : selectedFieldSlot !== null
        ? 'Attacker selected — click an opponent target, or Attack Deck.'
        : 'Select a hand card to play, or a field card to attack.';

  return (
    <div className="flex min-h-screen w-full flex-col gap-2 bg-black p-2 text-white">
      {/* OPPONENT ZONE */}
      <section
        aria-label="Opponent zone"
        className="flex shrink-0 flex-col gap-2 border-b border-sk-slate/30 pb-2"
      >
        <div className="flex items-start gap-3">
          <div className="flex shrink-0 flex-col items-center gap-1">
            <div className="relative w-32">
              <CardBack />
              <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-white">
                {oppDeckCount}
              </span>
            </div>
            <p className="text-[10px] text-sk-slate">Deck</p>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {Array.from({ length: visibleOppHandCount }).map((_, i) => (
              <button
                key={`opp-hand-${i}`}
                type="button"
                onClick={() => handleAttackHand(i)}
                disabled={!canAttack}
                aria-label={`Attack opponent hand card ${i + 1}`}
                className="w-32 shrink-0 disabled:opacity-50"
              >
                <CardBack />
              </button>
            ))}
            {hiddenOppHandCount > 0 && (
              <span className="shrink-0 text-xs text-sk-slate">+{hiddenOppHandCount}</span>
            )}
          </div>

          <div className="shrink-0 text-right text-xs text-sk-slate">
            <p>Banished {oppBanished.length}</p>
            <p>Face-down {oppBanishedFaceDown}</p>
          </div>
        </div>

        <div className="flex gap-2">
          {oppField.map((card, slot) => renderFieldSlot('opp', slot, card))}
        </div>
      </section>

      {/* CENTER BAR */}
      <section
        aria-label="Game status and controls"
        className="flex shrink-0 flex-col items-center gap-1 border-b border-sk-red py-1 text-center"
      >
        <p className="text-sm">
          Turn: Player {ctx.currentPlayer} {isActive ? '(your turn)' : '(waiting)'} · Attacked:{' '}
          {attackedThisTurn ? 'yes' : 'no'} · Turns — You {G.public.turnsTaken[pid] ?? 0} / Opp{' '}
          {G.public.turnsTaken[opp] ?? 0}
        </p>

        {G.public.loser !== null ? (
          <p className="text-lg font-bold text-white">
            Player {G.public.loser === '0' ? '1' : '0'} wins — Player {G.public.loser} ran out of
            cards.
          </p>
        ) : (
          <p className="text-xs text-sk-slate" aria-live="polite">
            {selectionPrompt}
          </p>
        )}

        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleDrawCard}
            disabled={!isActive}
            aria-label="Draw a card"
            className="rounded border border-sk-slate px-3 py-1 text-sm disabled:opacity-50"
          >
            Draw card
          </button>
          <button
            type="button"
            onClick={handleBottomUp}
            disabled={!isActive || bottomUpUsed || ownDeckCount > 10}
            aria-label="Move bottom card of deck to top"
            className="rounded border border-sk-slate px-3 py-1 text-sm disabled:opacity-50"
          >
            Bottom-up
          </button>
          <button
            type="button"
            onClick={handleAttackDeck}
            disabled={!canAttack}
            aria-label="Attack opponent deck"
            className="rounded border border-sk-slate px-3 py-1 text-sm disabled:opacity-50"
          >
            Attack deck
          </button>
          <button
            type="button"
            onClick={handleEndTurn}
            disabled={!isActive}
            aria-label="End turn"
            className="rounded border-2 border-sk-red px-3 py-1 text-sm font-bold disabled:opacity-50"
          >
            End turn
          </button>
        </div>
      </section>

      {/* OWN ZONE */}
      <section aria-label="Your zone" className="flex min-h-0 flex-1 flex-col gap-2 pt-1">
        <div className="flex shrink-0 justify-center gap-2">
          {ownField.map((card, slot) => renderFieldSlot('own', slot, card))}
        </div>

        <div className="flex min-h-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-hidden">
          {ownHand.map((label, i) => {
            const isSelected = selectedHandIndex === i;
            return (
              <button
                key={`own-hand-${i}-${label}`}
                type="button"
                onClick={() => handleSelectHandCard(i)}
                disabled={!isActive}
                aria-pressed={isSelected}
                aria-label={`Your hand card ${i + 1}: ${label}${isSelected ? ', selected' : ''}`}
                className={`aspect-[2.5/3.5] w-52 shrink-0 overflow-hidden rounded-lg border-2 bg-neutral-950 disabled:opacity-50 ${
                  isSelected ? 'border-white ring-2 ring-white' : 'border-sk-slate'
                }`}
              >
                <img
                  src={cardImageSrc(label)}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs text-sk-slate">
          <div className="flex items-center gap-1.5">
            <div className="w-8">
              <CardBack />
            </div>
            <span>Deck {ownDeckCount}</span>
          </div>
          <span>Bottom-up {bottomUpUsed ? 'used' : 'available'}</span>
          <span>Banished {ownBanished.length}</span>
          <span>Face-down {ownBanishedFaceDown}</span>
        </div>
      </section>
    </div>
  );
}
