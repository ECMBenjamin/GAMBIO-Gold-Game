import { GameState, GamePhase, Difficulty, GameAction } from '../types';

export function getAIMove(state: GameState): GameAction | null {
  const bot = state.players[1];
  const difficulty = state.difficulty || Difficulty.MEDIUM;

  if (state.phase.toString() === 'TURN_START' || state.phase === GamePhase.TURN_START) {
    // Decide whether to draw from deck or discard
    const topDiscard = state.discardPile[state.discardPile.length - 1];
    
    // Simple logic: if discard is low (known gold) or better than known hand cards, take it
    if (topDiscard && (topDiscard.value <= 2 || difficulty === Difficulty.HARD)) {
       return { type: 'DRAW_DISCARD' };
    }
    return { type: 'DRAW_DECK' };
  }

  if (state.phase === GamePhase.DECISION_PHASE) {
    if (!state.activeCard) return { type: 'DISCARD' };

    // Find highest known card in hand to swap with
    const hand = bot.cards;
    const knownHighest = hand.reduce((max, card) => {
        if (!card.isFaceDown && card.value > (max?.value || -1)) return card;
        return max;
    }, (null as any));

    if (knownHighest && (state.activeCard.value < knownHighest.value || difficulty === Difficulty.HARD)) {
        return { type: 'SWAP', targetCardId: knownHighest.id };
    }
    
    return { type: 'DISCARD' };
  }

  if (state.phase === GamePhase.EFFECT_PHASE) {
    const effect = state.pendingEffect;
    if (!effect) return null;

    // Logic for different card effects
    if (effect.rank === '7' || effect.rank === '8') {
        // Look at own card
        const faceDown = bot.cards.find(c => c.isFaceDown);
        if (faceDown) return { type: 'RESOLVE_EFFECT', targetCardId: faceDown.id };
    }

    if (effect.rank === '9' || effect.rank === '10') {
        // Look at opponent card
        const oppCards = state.players[0].cards;
        return { type: 'RESOLVE_EFFECT', targetCardId: oppCards[Math.floor(Math.random() * oppCards.length)].id };
    }

    if (effect.rank === 'J' || effect.rank === 'Q') {
        // Swap cards
        const oppCard = state.players[0].cards[0];
        return { type: 'RESOLVE_EFFECT', targetCardId: oppCard.id };
    }
  }

  return null;
}
