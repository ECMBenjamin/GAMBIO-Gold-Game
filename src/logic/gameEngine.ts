/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, Suit, Rank, Player, GameState, GamePhase, LogEntry } from '../types';
import { SUITS, RANKS, getStandardValue } from '../constants';

export function createDeck(): Card[] {
  const deck: Card[] = [];
  let idCounter = 0;

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `card-${idCounter++}`,
        suit,
        rank,
        value: getStandardValue(rank, suit),
        ownerId: null,
        positionIndex: 0,
        isFaceDown: true,
        isKnownByOwner: false,
        isRevealedTemporarily: false,
        isOnDiscardPile: false,
        isDrawnThisTurn: false,
      });
    }
  }

  return shuffle(deck);
}

export function shuffle<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export function logAction(state: GameState, player: string, action: string, details: string): LogEntry[] {
  const newLog: LogEntry = {
    id: `log-${Date.now()}-${Math.random()}`,
    timestamp: Date.now(),
    player,
    action,
    details,
  };
  return [newLog, ...state.logs].slice(0, 50);
}

export function calculateScore(player: Player): number {
  return player.cards.reduce((sum, card) => sum + card.value, 0);
}

export function canUseEffect(card: Card): boolean {
  return ['7', '8', '9', '10', 'J', 'Q'].includes(card.rank);
}
