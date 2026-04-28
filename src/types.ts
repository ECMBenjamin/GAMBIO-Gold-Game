/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum Suit {
  HEARTS = '♥',
  DIAMONDS = '♦',
  CLUBS = '♣',
  SPADES = '♠',
}

export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  value: number;
  ownerId: string | null; // null means on pile
  positionIndex: number; // position in hand or pile
  isFaceDown: boolean;
  isKnownByOwner: boolean;
  isRevealedTemporarily: boolean;
  isOnDiscardPile: boolean;
  isDrawnThisTurn: boolean;
}

export enum GamePhase {
  LOBBY = 'LOBBY',
  INIT = 'INIT',
  SETUP = 'SETUP',
  INITIAL_LOOK = 'INITIAL_LOOK',
  TURN_START = 'TURN_START',
  DRAW_PHASE = 'DRAW_PHASE',
  DECISION_PHASE = 'DECISION_PHASE',
  ACTION_PHASE = 'ACTION_PHASE',
  EFFECT_PHASE = 'EFFECT_PHASE',
  TURN_END = 'TURN_END',
  PASS_SCREEN = 'PASS_SCREEN',
  ROUND_END = 'ROUND_END',
  GAME_END = 'GAME_END',
}

export enum GameMode {
  LOCAL = 'LOCAL',
  SOLO = 'SOLO',
}

export enum Difficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
}

export interface Player {
  id: string;
  name: string;
  isAI: boolean;
  cards: Card[];
  score: number;
  hasCalledGambio: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  player: string;
  action: string;
  details: string;
}

export type GameAction = 
  | { type: 'START_GAME', mode: GameMode, difficulty: Difficulty }
  | { type: 'BACK_TO_LOBBY' }
  | { type: 'SETUP_COMPLETE' }
  | { type: 'REVEAL_INITIAL', cardIds: string[] }
  | { type: 'DRAW_DECK' }
  | { type: 'DRAW_DISCARD' }
  | { type: 'SWAP', targetCardId: string }
  | { type: 'DISCARD' }
  | { type: 'RESOLVE_EFFECT', targetCardId?: string, swapTargetIds?: string[] }
  | { type: 'CALL_GAMBIO' }
  | { type: 'NEXT_TURN' }
  | { type: 'CONFIRM_PASS' }
  | { type: 'END_ROUND' }
  | { type: 'WATCH_AD_REWARD' };

export interface GameState {
  phase: GamePhase;
  gameMode: GameMode;
  difficulty: Difficulty;
  players: Player[];
  currentPlayerIndex: number;
  drawPile: Card[];
  discardPile: Card[];
  activeCard: Card | null; // The card currently drawn but not yet played
  logs: LogEntry[];
  message: string;
  pendingEffect: Card | null;
  gambioCallerId: string | null;
  roundWinnerId: string | null;
  adWatchedThisRound?: boolean;
}
