/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suit, Rank, Card } from './types';

export const CARD_WIDTH = 110;
export const CARD_HEIGHT = 156;

export const SUITS = [Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS, Suit.SPADES];
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function getCardValue(rank: Rank, suit: Suit): number {
  if (rank === 'K') {
    return (suit === Suit.HEARTS || suit === Suit.DIAMONDS) ? 0 : 13;
  }
  if (rank === 'Q' || rank === 'J') return 12; // Standard rules usually J=11, Q=12, but often grouped for effects
  if (rank === 'A') return 1;
  return parseInt(rank) || 11; // 10, J, Q are high
}

// Fixed values for standard Cambio:
// A=1, 2-10 face value, J=11, Q=12, Black K=13, Red K=0
export function getStandardValue(rank: Rank, suit: Suit): number {
  switch (rank) {
    case 'A': return 1;
    case 'J': return 11;
    case 'Q': return 12;
    case 'K': return (suit === Suit.HEARTS || suit === Suit.DIAMONDS) ? 0 : 13;
    default: return parseInt(rank);
  }
}

export const EFFECT_DESCRIPTIONS: Record<string, string> = {
  '7': 'Peek at your own card',
  '8': 'Peek at your own card',
  '9': "Peek at an opponent's card",
  '10': "Peek at an opponent's card",
  'J': 'Swap cards with an opponent (Blind)',
  'Q': 'Swap cards with an opponent (Blind)',
};
