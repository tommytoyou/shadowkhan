'use client';

import { useState } from 'react';
import type { BoardProps } from 'boardgame.io/react';
import type { ShadowkhanG, FieldCard, PendingChoice, PendingChoiceKind } from '@shadowkhan/game';
import { cardImageSrc } from '../lib/cardImage';
import CardBack from './CardBack';

type Props = BoardProps<ShadowkhanG>;

const OPP_HAND_CAP = 8;
const EMPTY_SLOT_BOX = 'h-16 w-12 rounded-md';
const FILLED_SLOT_BOX = 'aspect-[2.5/3.5] w-44 shrink-0 rounded-lg';

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

  const pendingChoice: PendingChoice | null = G.public.pendingChoice ?? null;
  const choiceActive = pendingChoice !== null;
  const myChoice = pendingChoice && pendingChoice.pid === pid ? pendingChoice : null;
  const waitingForOpponentChoice = pendingChoice !== null && pendingChoice.pid !== pid;

  const canAttack = isActive && !choiceActive && !attackedThisTurn && selectedFieldSlot !== null;

  // Subtle "what can I do next" guidance — additive only, no move-logic impact.
  const suggestHand = isActive && selectedHandIndex === null && selectedFieldSlot === null;

  function clearSelection() {
    setSelectedHandIndex(null);
    setSelectedFieldSlot(null);
  }

  function handleSelectHandCard(index: number) {
    if (!isActive || choiceActive) return;
    setSelectedFieldSlot(null);
    setSelectedHandIndex((prev) => (prev === index ? null : index));
  }

  function handleSelectFieldCard(slot: number) {
    if (!isActive || choiceActive || attackedThisTurn) return;
    setSelectedHandIndex(null);
    setSelectedFieldSlot((prev) => (prev === slot ? null : slot));
  }

  function handlePlayIntoSlot(slot: number) {
    if (!isActive || choiceActive || selectedHandIndex === null) return;
    moves.playCard(selectedHandIndex, slot);
    clearSelection();
  }

  function handleAttackField(theirSlot: number) {
    if (!isActive || choiceActive || selectedFieldSlot === null) return;
    moves.attackBattleCard(selectedFieldSlot, theirSlot);
    clearSelection();
  }

  function handleAttackHand(theirHandIndex: number) {
    if (!isActive || choiceActive || selectedFieldSlot === null) return;
    moves.attackHand(selectedFieldSlot, theirHandIndex);
    clearSelection();
  }

  function handleAttackDeck() {
    if (!isActive || choiceActive || selectedFieldSlot === null) return;
    moves.attackDeck(selectedFieldSlot);
    clearSelection();
  }

  function handleBottomUp() {
    if (!isActive || choiceActive) return;
    moves.bottomUp();
  }

  function handleEndTurn() {
    if (!isActive || choiceActive) return;
    moves.endTurn();
    clearSelection();
  }

  function handleDrawCard() {
    if (!isActive || choiceActive) return;
    moves.drawCard();
  }

  function handleBanishFromHand() {
    if (!isActive || choiceActive || selectedHandIndex === null) return;
    moves.banishFromHand(selectedHandIndex);
    clearSelection();
  }

  function handleResolveChoice(answer: number | boolean) {
    if (!myChoice) return;
    moves.resolveChoice(answer);
    clearSelection();
  }

  function choiceOptionLabel(kind: PendingChoiceKind, opt: number): string {
    switch (kind) {
      case 'opponentField': {
        const card = oppField[opt];
        return card ? `Slot ${opt + 1}: ${card.label} (BP ${card.currentBp})` : `Slot ${opt + 1}`;
      }
      case 'ownField': {
        const card = ownField[opt];
        return card ? `Slot ${opt + 1}: ${card.label} (BP ${card.currentBp})` : `Slot ${opt + 1}`;
      }
      case 'opponentHandIndex':
        return `Opponent hand card ${opt + 1}`;
      case 'ownHandIndex':
        return `Your hand card ${opt + 1}: ${ownHand[opt] ?? ''}`;
      case 'chooseAbility':
        return `Choice ${opt + 1}`;
      default:
        return `Option ${opt + 1}`;
    }
  }

  /** Non-null when this field slot is a valid answer to my pending choice —
   *  used to redirect the existing field-slot button into resolveChoice(). */
  function fieldChoiceTarget(side: 'own' | 'opp', slot: number): (() => void) | null {
    if (!myChoice) return null;
    if (side === 'own' && myChoice.kind === 'ownField' && myChoice.options?.includes(slot)) {
      return () => handleResolveChoice(slot);
    }
    if (side === 'opp' && myChoice.kind === 'opponentField' && myChoice.options?.includes(slot)) {
      return () => handleResolveChoice(slot);
    }
    return null;
  }

  function renderFieldSlot(side: 'own' | 'opp', slot: number, card: FieldCard | null) {
    const key = `${side}-field-${slot}`;

    if (!card) {
      if (side === 'own') {
        const canPlaceHere = isActive && !choiceActive && selectedHandIndex !== null;
        return (
          <button
            key={key}
            type="button"
            onClick={() => handlePlayIntoSlot(slot)}
            disabled={!canPlaceHere}
            aria-label={`Empty field slot ${slot + 1}${
              canPlaceHere ? ' - play selected card here' : ''
            }`}
            className={`${EMPTY_SLOT_BOX} border border-sk-slate/30 bg-transparent transition disabled:opacity-40 ${
              canPlaceHere ? 'ring-1 ring-sk-slate' : ''
            }`}
          />
        );
      }
      return (
        <div
          key={key}
          aria-label={`Opponent empty field slot ${slot + 1}`}
          className={`${EMPTY_SLOT_BOX} border border-sk-slate/30 bg-transparent`}
        />
      );
    }

    const choiceTarget = fieldChoiceTarget(side, slot);
    const isChoiceTarget = choiceTarget !== null;

    if (side === 'own') {
      const isSelected = selectedFieldSlot === slot;
      const disabled = choiceActive ? !isChoiceTarget : !isActive || attackedThisTurn;
      return (
        <button
          key={key}
          type="button"
          onClick={choiceTarget ?? (() => handleSelectFieldCard(slot))}
          disabled={disabled}
          aria-pressed={isSelected}
          aria-label={`Your field card in slot ${slot + 1}, BP ${card.currentBp}${
            isChoiceTarget ? ', valid target for pending choice — click to choose' : isSelected ? ', selected' : ''
          }`}
          className={`relative ${FILLED_SLOT_BOX} overflow-visible border-2 bg-neutral-950 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white ${
            isChoiceTarget
              ? 'border-sk-red ring-2 ring-sk-red'
              : isSelected
                ? 'border-white ring-2 ring-white'
                : 'border-sk-slate'
          }`}
        >
          <img
            src={cardImageSrc(card.label)}
            alt=""
            className="h-full w-full rounded-lg object-contain"
          />
          <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-black bg-sk-slate text-sm font-bold text-white">
            {card.currentBp}
          </span>
        </button>
      );
    }

    return (
      <button
        key={key}
        type="button"
        onClick={choiceTarget ?? (() => handleAttackField(slot))}
        disabled={choiceActive ? !isChoiceTarget : !canAttack}
        aria-label={`${isChoiceTarget ? 'Valid target for pending choice — choose ' : 'Attack '}opponent field card in slot ${
          slot + 1
        }, BP ${card.currentBp}`}
        className={`relative ${FILLED_SLOT_BOX} overflow-visible border-2 bg-neutral-950 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white ${
          isChoiceTarget ? 'border-sk-red ring-2 ring-sk-red' : 'border-sk-slate'
        }`}
      >
        <img
          src={cardImageSrc(card.label)}
          alt=""
          className="h-full w-full rounded-lg object-contain"
        />
        <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-black bg-sk-slate text-sm font-bold text-white">
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
    <div className="min-h-screen w-full flex flex-col bg-black text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        {/* OPPONENT ZONE */}
        <section
          aria-label="Opponent zone"
          className="flex flex-col items-center gap-4 border-b border-sk-slate/20 pb-8"
        >
          <div className="flex w-full flex-wrap items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-1">
              <div className="relative w-20">
                <CardBack />
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
                  {oppDeckCount}
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-wide text-sk-slate">Deck</p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {Array.from({ length: visibleOppHandCount }).map((_, i) => {
                const isChoiceTarget =
                  myChoice?.kind === 'opponentHandIndex' && (myChoice.options?.includes(i) ?? false);
                return (
                  <button
                    key={`opp-hand-${i}`}
                    type="button"
                    onClick={isChoiceTarget ? () => handleResolveChoice(i) : () => handleAttackHand(i)}
                    disabled={choiceActive ? !isChoiceTarget : !canAttack}
                    aria-label={`${
                      isChoiceTarget ? 'Valid target for pending choice — choose ' : 'Attack '
                    }opponent hand card ${i + 1}`}
                    className={`w-20 shrink-0 rounded disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white ${
                      isChoiceTarget ? 'ring-2 ring-sk-red' : ''
                    }`}
                  >
                    <CardBack />
                  </button>
                );
              })}
              {hiddenOppHandCount > 0 && (
                <span className="shrink-0 text-xs text-sk-slate">+{hiddenOppHandCount}</span>
              )}
            </div>

            <div className="text-right text-xs text-sk-slate">
              <p>Banished {oppBanished.length}</p>
              <p>Face-down {oppBanishedFaceDown}</p>
            </div>
          </div>

          <div className="flex items-end justify-center gap-3">
            {oppField.map((card, slot) => renderFieldSlot('opp', slot, card))}
          </div>
        </section>

        {/* STATUS + CONTROLS */}
        <section
          aria-label="Game status and controls"
          className="flex flex-col items-center gap-2 border-b border-sk-red/60 pb-8 text-center"
        >
          <p className="text-sm">
            Turn: Player {ctx.currentPlayer} {isActive ? '(your turn)' : '(waiting)'} · Attacked:{' '}
            {attackedThisTurn ? 'yes' : 'no'} · Turns — You {G.public.turnsTaken[pid] ?? 0} / Opp{' '}
            {G.public.turnsTaken[opp] ?? 0}
          </p>

          {G.public.loser !== null ? (
            <p className="text-xl font-bold text-white">
              Player {G.public.loser === '0' ? '1' : '0'} wins — Player {G.public.loser} ran out
              of cards.
            </p>
          ) : myChoice ? (
            <div
              role="group"
              aria-label="Pending ability choice"
              className="flex flex-col items-center gap-2 rounded-lg border-2 border-sk-red px-4 py-3"
            >
              <p className="text-sm font-semibold text-white" aria-live="assertive">
                {myChoice.prompt}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {myChoice.kind === 'yesNo' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleResolveChoice(true)}
                      aria-label="Yes"
                      className="rounded border-2 border-sk-red px-4 py-1 text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveChoice(false)}
                      aria-label="No"
                      className="rounded border border-sk-slate px-4 py-1 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white"
                    >
                      No
                    </button>
                  </>
                ) : (
                  (myChoice.options ?? []).map((opt) => (
                    <button
                      key={`choice-opt-${opt}`}
                      type="button"
                      onClick={() => handleResolveChoice(opt)}
                      aria-label={choiceOptionLabel(myChoice.kind, opt)}
                      className="rounded border-2 border-sk-red px-3 py-1 text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white"
                    >
                      {choiceOptionLabel(myChoice.kind, opt)}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : waitingForOpponentChoice ? (
            <p className="text-sm text-sk-slate" aria-live="polite">
              Waiting for opponent&apos;s choice…
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
              disabled={!isActive || choiceActive}
              aria-label="Draw a card"
              className="rounded border border-sk-slate px-3 py-1 text-sm disabled:opacity-50"
            >
              Draw card
            </button>
            <button
              type="button"
              onClick={handleBottomUp}
              disabled={!isActive || choiceActive || bottomUpUsed || ownDeckCount > 10}
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
              onClick={handleBanishFromHand}
              disabled={!isActive || choiceActive || selectedHandIndex === null}
              aria-label="Banish selected hand card to banished pile"
              className="rounded border border-sk-slate px-3 py-1 text-sm disabled:opacity-50"
            >
              Banish
            </button>
            <button
              type="button"
              onClick={handleEndTurn}
              disabled={!isActive || choiceActive}
              aria-label="End turn"
              className="rounded border-2 border-sk-red px-3 py-1 text-sm font-bold disabled:opacity-50"
            >
              End turn
            </button>
          </div>
        </section>

        {/* OWN ZONE */}
        <section aria-label="Your zone" className="flex flex-col items-center gap-5 pb-4">
          <div className="flex flex-row flex-nowrap w-full items-center justify-between gap-4">
            <div className="flex flex-col items-center flex-none">
              <div className="relative w-20">
                <CardBack />
                <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-white">
                  {ownDeckCount}
                </span>
              </div>
              <p className="text-xs text-sk-slate">DECK</p>
              <p className="text-xs text-sk-slate">
                {bottomUpUsed ? 'Bottom-up used' : 'Bottom-up available'}
              </p>
            </div>

            <div className="flex flex-row flex-nowrap items-center gap-2 flex-none">
              {ownField.map((card, slot) => renderFieldSlot('own', slot, card))}
            </div>

            <div className="text-right text-xs text-sk-slate flex-none">
              <p>Banished {ownBanished.length}</p>
              <p>Face-down {ownBanishedFaceDown}</p>
            </div>
          </div>

          <div className="flex w-full flex-nowrap items-center justify-center gap-3 overflow-x-auto px-2 pb-2">
            {ownHand.map((label, i) => {
              const isSelected = selectedHandIndex === i;
              return (
                <button
                  key={`own-hand-${i}-${label}`}
                  type="button"
                  onClick={() => handleSelectHandCard(i)}
                  disabled={!isActive || choiceActive}
                  aria-pressed={isSelected}
                  aria-label={`Your hand card ${i + 1}: ${label}${
                    isSelected ? ', selected' : ''
                  }`}
                  className={`aspect-[2.5/3.5] w-44 shrink-0 overflow-hidden rounded-lg border-2 bg-neutral-950 transition disabled:opacity-50 ${
                    isSelected
                      ? 'border-white ring-2 ring-white'
                      : suggestHand
                        ? 'border-sk-slate ring-1 ring-sk-slate'
                        : 'border-sk-slate'
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
        </section>
      </div>
    </div>
  );
}
