/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useReducer, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Suit, 
  Rank, 
  Card as CardType, 
  GamePhase, 
  Player, 
  GameState, 
  GameAction,
  LogEntry,
  GameMode,
  Difficulty
} from './types';
import { 
  createDeck, 
  logAction, 
  calculateScore, 
  canUseEffect 
} from './logic/gameEngine';
import { getAIMove } from './logic/ai';
import Card from './components/Card';

const PLAYER_1_ID = 'player-1';
const PLAYER_2_ID = 'player-2';

const TRACKING_KEY = 'gambio_stats_v1';

interface TrackingStats {
  gamesStarted: number;
  gamesFinished: number;
  lastPlayedAt: number | null;
}

const getStoredStats = (): TrackingStats => {
  try {
    const stored = localStorage.getItem(TRACKING_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to load stats', e);
  }
  return { gamesStarted: 0, gamesFinished: 0, lastPlayedAt: null };
};

const saveStats = (stats: TrackingStats) => {
  try {
    localStorage.setItem(TRACKING_KEY, JSON.stringify(stats));
  } catch (e) {
    console.error('Failed to save stats', e);
  }
};

const initialState: GameState = {
  phase: GamePhase.LOBBY,
  gameMode: GameMode.LOCAL,
  difficulty: Difficulty.MEDIUM,
  players: [
    { id: PLAYER_1_ID, name: 'Player 1', isAI: false, cards: [], score: 0, hasCalledGambio: false },
    { id: PLAYER_2_ID, name: 'Player 2', isAI: false, cards: [], score: 0, hasCalledGambio: false },
  ],
  currentPlayerIndex: 0,
  drawPile: [],
  discardPile: [],
  activeCard: null,
  logs: [],
  message: 'Welcome to Gambio Gold. Ready to play?',
  pendingEffect: null,
  gambioCallerId: null,
  roundWinnerId: null,
};

function gameReducer(state: GameState, action: GameAction): GameState {
  const currentPlayer = state.players[state.currentPlayerIndex];

  switch (action.type) {
    case 'START_GAME': {
      const stats = getStoredStats();
      saveStats({ ...stats, gamesStarted: stats.gamesStarted + 1, lastPlayedAt: Date.now() });

      const deck = createDeck();
      const players = [
        { id: PLAYER_1_ID, name: 'You', isAI: false, cards: [], score: 0, hasCalledGambio: false },
        { 
          id: PLAYER_2_ID, 
          name: action.mode === GameMode.SOLO ? `Bot (${action.difficulty})` : 'Player 2', 
          isAI: action.mode === GameMode.SOLO, 
          cards: [], 
          score: 0, 
          hasCalledGambio: false 
        },
      ];

      const finalizedPlayers = players.map(p => {
        const hand = deck.splice(0, 4).map((c, index) => ({
          ...c,
          ownerId: p.id,
          positionIndex: index,
        }));
        return { ...p, cards: hand };
      });
      const discardPile = deck.splice(0, 1).map(c => ({ ...c, isFaceDown: false, isOnDiscardPile: true }));

      return {
        ...state,
        phase: GamePhase.SETUP,
        gameMode: action.mode,
        difficulty: action.difficulty,
        drawPile: deck,
        discardPile,
        players: finalizedPlayers,
        currentPlayerIndex: 0,
        logs: logAction(state, 'System', 'Game Started', `${action.mode} Mode`),
        message: 'Get ready for Player 1\'s initial look.',
        activeCard: null,
        pendingEffect: null,
        gambioCallerId: null,
        roundWinnerId: null,
      };
    }

    case 'BACK_TO_LOBBY': {
      return {
        ...initialState,
        phase: GamePhase.LOBBY
      };
    }

    case 'SETUP_COMPLETE': {
      // Auto-reveal first two cards for CURRENT player during setup
      const players = state.players.map((p, i) => {
        if (i === state.currentPlayerIndex) {
          return {
            ...p,
            cards: p.cards.map((c, idx) => idx < 2 ? { ...c, isFaceDown: false, isKnownByOwner: true, isRevealedTemporarily: true } : c)
          };
        }
        return p;
      });
      return {
        ...state,
        players,
        phase: GamePhase.INITIAL_LOOK,
        message: `${state.players[state.currentPlayerIndex].name}: Look at your front two cards. Remember them!`,
      };
    }

    case 'REVEAL_INITIAL': {
      // Hide the initial look cards
      const players = state.players.map(p => ({
        ...p,
        cards: p.cards.map(c => ({ ...c, isFaceDown: true, isRevealedTemporarily: false }))
      }));

      // If it was Player 1 and we are in Solo mode, move straight to Player 2's setup
      if (state.currentPlayerIndex === 0 && state.gameMode === GameMode.SOLO) {
        return {
          ...state,
          players,
          currentPlayerIndex: 1,
          phase: GamePhase.SETUP,
          message: 'Pass to Bot for their initial look.',
        };
      }

      // If it was Player 1, move to Player 2's SETUP
      if (state.currentPlayerIndex === 0) {
        return {
          ...state,
          players,
          currentPlayerIndex: 1,
          phase: GamePhase.PASS_SCREEN,
          message: 'Pass to Player 2 for their initial look.',
        };
      }

      // If both had their look, start the game with Player 1
      return {
        ...state,
        players,
        currentPlayerIndex: 0,
        phase: state.gameMode === GameMode.SOLO ? GamePhase.TURN_START : GamePhase.PASS_SCREEN,
        message: 'Setup complete! Player 1, you go first.',
      };
    }

    case 'DRAW_DECK': {
      if (state.phase !== GamePhase.DRAW_PHASE && state.phase !== GamePhase.TURN_START) return state;
      const [newCard, ...remainingDeck] = state.drawPile;
      const activeCard = { ...newCard, isFaceDown: false, isDrawnThisTurn: true };
      
      return {
        ...state,
        drawPile: remainingDeck,
        activeCard,
        phase: GamePhase.DECISION_PHASE,
        logs: logAction(state, currentPlayer.name, 'Draw', 'from Deck'),
        message: `${currentPlayer.name} draws from deck.`,
      };
    }

    case 'DRAW_DISCARD': {
      if (state.phase !== GamePhase.TURN_START) return state;
      const [newCard, ...remainingDiscard] = state.discardPile;
      const activeCard = { ...newCard, isFaceDown: false, isDrawnThisTurn: true };
      
      return {
        ...state,
        discardPile: remainingDiscard,
        activeCard,
        phase: GamePhase.DECISION_PHASE,
        logs: logAction(state, currentPlayer.name, 'Draw', 'from Discard Pile'),
        message: `${currentPlayer.name} takes from discard pile!`,
      };
    }

    case 'SWAP': {
      if (state.phase !== GamePhase.DECISION_PHASE) return state;
      if (!state.activeCard) return state;
      
      const targetCardId = action.targetCardId;
      let moveMessage = 'Card swapped!';
      
      const players = state.players.map(p => {
        if (p.id === currentPlayer.id) {
          const cardIndex = p.cards.findIndex(c => c.id === targetCardId);
          if (cardIndex === -1) return p;
          
          const targetCard = p.cards[cardIndex];
          
          // Gamification: Detect quality of swap
          if (state.activeCard!.value === 0) {
            moveMessage = "GOLD SECURED! (0 PTS)";
          } else if (targetCard.value === 0 && state.activeCard!.value > 0) {
            moveMessage = "TRAGIC MISTAKE! Lost Gold";
          } else if (targetCard.isKnownByOwner) {
             if (state.activeCard!.value < targetCard.value) {
               moveMessage = "GREAT TRADE! Hand Improved";
             } else if (state.activeCard!.value > targetCard.value) {
               moveMessage = "OUCH! TOUGH LUCK...";
             }
          } else {
             moveMessage = "RISKY SWAP! Good Luck";
          }

          const newCards = [...p.cards];
          const swappedOut = { ...newCards[cardIndex], isKnownByOwner: false, isFaceDown: true, ownerId: null };
          
          newCards[cardIndex] = { 
            ...state.activeCard!, 
            ownerId: p.id, 
            positionIndex: cardIndex, 
            isFaceDown: true,
            isKnownByOwner: true // Player knows what they just put in their hand
          };
          
          return { ...p, cards: newCards, _swappedOut: swappedOut };
        }
        return p;
      });

      const swappedOutCard = (players.find(p => p.id === currentPlayer.id) as any)._swappedOut;
      const newDiscard = [{ ...swappedOutCard, isFaceDown: false }, ...state.discardPile];

      return {
        ...state,
        players: players.map(p => {
          const { _swappedOut, ...rest } = p as any;
          return rest;
        }),
        discardPile: newDiscard,
        activeCard: null,
        phase: GamePhase.TURN_END,
        logs: logAction(state, currentPlayer.name, 'Swap', `replaced ${swappedOutCard.rank}${swappedOutCard.suit}`),
        message: moveMessage,
      };
    }

    case 'DISCARD': {
      if (state.phase !== GamePhase.DECISION_PHASE) return state;
      if (!state.activeCard) return state;
      
      const discardedCard = { ...state.activeCard, isFaceDown: false, ownerId: null };
      const newDiscard = [discardedCard, ...state.discardPile];
      const hasEffect = canUseEffect(discardedCard);

      return {
        ...state,
        discardPile: newDiscard,
        activeCard: null,
        phase: hasEffect ? GamePhase.EFFECT_PHASE : GamePhase.TURN_END,
        pendingEffect: hasEffect ? discardedCard : null,
        logs: logAction(state, currentPlayer.name, 'Discard', discardedCard.rank),
        message: hasEffect ? `Using ${discardedCard.rank} effect...` : 'Turn complete.',
      };
    }

    case 'RESOLVE_EFFECT': {
      if (state.phase !== GamePhase.EFFECT_PHASE || !state.pendingEffect) return state;
      
      const effect = state.pendingEffect.rank;
      let logs = state.logs;
      let players = [...state.players];
      let message = 'Effect resolved.';

      if (['7', '8'].includes(effect) && action.targetCardId) {
        players = players.map(p => ({
          ...p,
          cards: p.cards.map(c => c.id === action.targetCardId ? { ...c, isRevealedTemporarily: true, isKnownByOwner: true } : c)
        }));
        logs = logAction(state, currentPlayer.name, 'Effect', `Peeked at card`);
      } else if (['9', '10'].includes(effect) && action.targetCardId) {
        players = players.map(p => ({
          ...p,
          cards: p.cards.map(c => c.id === action.targetCardId ? { ...c, isRevealedTemporarily: true } : c)
        }));
        logs = logAction(state, currentPlayer.name, 'Effect', `Peeked at opponent's card`);
      } else if (['J', 'Q'].includes(effect) && action.swapTargetIds?.length === 2) {
        // Blind Swap logic
        const [id1, id2] = action.swapTargetIds;
        let card1: CardType | null = null;
        let card2: CardType | null = null;

        players.forEach(p => {
          p.cards.forEach(c => {
            if (c.id === id1) card1 = { ...c };
            if (c.id === id2) card2 = { ...c };
          });
        });

        if (card1 && card2) {
          players = players.map(p => ({
            ...p,
            cards: p.cards.map(c => {
              if (c.id === id1) return { ...card2!, ownerId: p.id, positionIndex: c.positionIndex, isKnownByOwner: false };
              if (c.id === id2) return { ...card1!, ownerId: p.id, positionIndex: c.positionIndex, isKnownByOwner: false };
              return c;
            })
          }));
          logs = logAction(state, currentPlayer.name, 'Effect', `Blind Swapped 2 cards`);
        }
      }

      return {
        ...state,
        players,
        logs,
        phase: GamePhase.TURN_END,
        pendingEffect: null,
        message,
      };
    }

    case 'CALL_GAMBIO': {
      if (state.gambioCallerId) return state;
      return {
        ...state,
        gambioCallerId: currentPlayer.id,
        logs: logAction(state, currentPlayer.name, 'GAMBIO', 'called the end of the round!'),
        message: `${currentPlayer.name} called Gambio! Everyone else gets one last turn.`,
      };
    }

    case 'NEXT_TURN': {
      const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
      const nextPlayer = state.players[nextIndex];
      
      // Clear temporary reveals
      const players = state.players.map(p => ({
        ...p,
        cards: p.cards.map(c => ({ ...c, isRevealedTemporarily: false }))
      }));

      // Check if round ends (everyone has had their last turn after Gambio)
      if (state.gambioCallerId && state.players[nextIndex].id === state.gambioCallerId) {
        return {
          ...state,
          phase: GamePhase.ROUND_END,
          message: 'Round Over! Revealing all cards...',
        };
      }

      // In Solo mode, if next player is AI, skip the Pass Screen transition and go straight to TURN_START (or SETUP if initial)
      if (state.gameMode === GameMode.SOLO && nextPlayer.isAI) {
        const isInitialSetup = state.players.some(p => p.cards.every(c => !c.isKnownByOwner));
        return {
          ...state,
          players,
          currentPlayerIndex: nextIndex,
          phase: isInitialSetup ? GamePhase.SETUP : GamePhase.TURN_START,
          message: `${nextPlayer.name}'s turn.`,
        };
      }

      return {
        ...state,
        players,
        currentPlayerIndex: nextIndex,
        phase: GamePhase.PASS_SCREEN,
        message: `Pass the device to ${state.players[nextIndex].name}.`,
      };
    }

    case 'CONFIRM_PASS': {
      if (state.phase !== GamePhase.PASS_SCREEN) return state;

      // Determine next phase based on setup or regular turn
      const isInitialSetup = state.players.some(p => p.cards.every(c => !c.isKnownByOwner));
      
      return {
        ...state,
        phase: isInitialSetup ? GamePhase.SETUP : GamePhase.TURN_START,
        message: `${currentPlayer.name}'s turn.`,
      };
    }

    case 'END_ROUND': {
      const stats = getStoredStats();
      saveStats({ ...stats, gamesFinished: stats.gamesFinished + 1 });

      const playersWithScores = state.players.map(p => ({
        ...p,
        cards: p.cards.map(c => ({ ...c, isFaceDown: false })),
        score: calculateScore(p)
      }));

      const winnerId = playersWithScores.reduce((prev, curr) => (prev.score < curr.score ? prev : curr)).id;

      return {
        ...state,
        players: playersWithScores,
        phase: GamePhase.GAME_END,
        roundWinnerId: winnerId,
        adWatchedThisRound: false,
        message: `Round Over. ${playersWithScores.find(p => p.id === winnerId)?.name} wins with ${playersWithScores.find(p => p.id === winnerId)?.score} points!`,
      };
    }

    case 'WATCH_AD_REWARD': {
      return {
        ...state,
        adWatchedThisRound: true,
        message: "Reward received! Bonus XP added."
      };
    }

    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const activePlayer = state.players[state.currentPlayerIndex];
  const passivePlayer = state.players[(state.currentPlayerIndex + 1) % state.players.length];
  
  const [xp, setXp] = useState(() => {
    const saved = localStorage.getItem('gambio_xp');
    return saved ? parseInt(saved) : 0;
  });

  useEffect(() => {
    localStorage.setItem('gambio_xp', xp.toString());
  }, [xp]);

  const [showAdOverlay, setShowAdOverlay] = useState(false);

  const handleWatchAd = () => {
    setShowAdOverlay(true);
    // Simulate ad viewing duration
    setTimeout(() => {
      setShowAdOverlay(false);
      dispatch({ type: 'WATCH_AD_REWARD' });
      setXp(prev => prev + 250); // Bonus XP
      setFeedbackMessage({ text: "REWARD GRANTED: +250 XP", type: 'success' });
    }, 5000);
  };

  // Gamification: Add XP on game end
  useEffect(() => {
    if (state.phase === GamePhase.GAME_END) {
        setXp(prev => prev + 100);
    }
  }, [state.phase]);

  const level = Math.floor(xp / 1000) + 1;
  const nextLevelXp = level * 1000;
  const currentLevelProgress = ((xp % 1000) / 1000) * 100;

  const toggleFullscreen = () => {
    const doc = window.document as any;
    const docEl = doc.documentElement;

    const requestFullScreen = docEl.requestFullscreen || docEl.mozRequestFullScreen || docEl.webkitRequestFullScreen || docEl.msRequestFullscreen;
    const cancelFullScreen = doc.exitFullscreen || doc.mozCancelFullScreen || doc.webkitExitFullscreen || doc.msExitFullscreen;

    if (!doc.fullscreenElement && !doc.mozFullScreenElement && !doc.webkitFullscreenElement && !doc.msFullscreenElement) {
      if (requestFullScreen) {
        requestFullScreen.call(docEl);
      }
    } else {
      if (cancelFullScreen) {
        cancelFullScreen.call(doc);
      }
    }
  };
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [isHudOpen, setIsHudOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [selectedMode, setSelectedMode] = useState<GameMode>(GameMode.SOLO);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>(Difficulty.MEDIUM);
  const [aiActionStatus, setAiActionStatus] = useState<string>("");
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [botTargetId, setBotTargetId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string, type: 'success' | 'warning' | 'info' } | null>(null);

  // Phase transitions
  useEffect(() => {
    if (state.phase === GamePhase.SETUP && !activePlayer.isAI) {
      const t = setTimeout(() => dispatch({ type: 'SETUP_COMPLETE' }), 1000);
      return () => clearTimeout(t);
    }
    if (state.phase === GamePhase.TURN_END) {
      const delay = state.gameMode === GameMode.SOLO ? 1500 : 1000;
      const t = setTimeout(() => dispatch({ type: 'NEXT_TURN' }), delay);
      return () => clearTimeout(t);
    }
    if (state.phase === GamePhase.ROUND_END) {
      const t = setTimeout(() => dispatch({ type: 'END_ROUND' }), 1000);
      return () => clearTimeout(t);
    }
  }, [state.phase]);

  // AI Turn Logic with improved pacing and status feedback
  useEffect(() => {
    if (activePlayer.isAI && ![GamePhase.LOBBY, GamePhase.GAME_END, GamePhase.PASS_SCREEN, GamePhase.ROUND_END].includes(state.phase)) {
      // Safety timeout
      const fallbackTimeout = setTimeout(() => {
        setAiActionStatus("");
        setBotTargetId(null);
        setIsBotThinking(false);
        if (state.phase === GamePhase.TURN_START) dispatch({ type: 'DRAW_DECK' });
        else if (state.phase === GamePhase.DECISION_PHASE) dispatch({ type: 'DISCARD' });
      }, 15000);

      // AI Setup/Look pacing
      if (state.phase === GamePhase.SETUP || state.phase === GamePhase.INITIAL_LOOK) {
        if (!aiActionStatus) {
           setAiActionStatus(state.phase === GamePhase.SETUP ? "Bot is memorizing its deck..." : "Bot and Player preparing...");
        }
        
        clearTimeout(fallbackTimeout);
        const t = setTimeout(() => {
          setAiActionStatus("");
          if (state.phase === GamePhase.SETUP) dispatch({ type: 'SETUP_COMPLETE' });
          else dispatch({ type: 'REVEAL_INITIAL', cardIds: [] });
        }, 2000);
        return () => { clearTimeout(t); clearTimeout(fallbackTimeout); };
      }

      // Start "Thinking" phase if not already thinking or performing action
      if (!isBotThinking && !aiActionStatus && !botTargetId && ![GamePhase.SETUP, GamePhase.INITIAL_LOOK].includes(state.phase)) {
        setIsBotThinking(true);
        const thinkingDelay = 1800; // Increased base thinking time
        
        const thinkingTimer = setTimeout(() => {
          setIsBotThinking(false);
          const move = getAIMove(state);
          
          if (move) {
            let status = "";
            let finalDelay = 2500;
            let targetId: string | null = null;

            switch(move.type) {
              case 'DRAW_DECK': status = "Bot is searching for a better card..."; finalDelay = 2200; break;
              case 'DRAW_DISCARD': status = "Bot takes the discarded card!"; finalDelay = 2200; break;
              case 'SWAP': 
                status = "Bot is choosing a card to replace..."; 
                targetId = (move as any).targetCardId;
                finalDelay = 3500; 
                break;
              case 'DISCARD': status = "Bot discards the card."; finalDelay = 2000; break;
              case 'CALL_GAMBIO': status = "BOT SENSES VICTORY: GAMBIO!"; finalDelay = 4000; break;
              case 'RESOLVE_EFFECT': 
                status = "Bot is triggering a card ability..."; 
                targetId = (move as any).targetCardId;
                finalDelay = 3000; 
                break;
            }

            setAiActionStatus(status);
            if (targetId) setBotTargetId(targetId);

            const actionTimer = setTimeout(() => {
              setAiActionStatus("");
              setBotTargetId(null);
              dispatch(move as any);
            }, finalDelay);
            
            // Note: We'd need to store actionTimer to clear it if we were being exhaustive
          } else {
            // Fallback
            if (state.phase === GamePhase.DECISION_PHASE) dispatch({ type: 'DISCARD' });
            else if (state.phase === GamePhase.TURN_START) dispatch({ type: 'DRAW_DECK' });
          }
        }, thinkingDelay);
        
        return () => { 
          clearTimeout(thinkingTimer);
          clearTimeout(fallbackTimeout); 
        };
      }
      
      return () => clearTimeout(fallbackTimeout);
    } else {
      setAiActionStatus("");
      setBotTargetId(null);
      setIsBotThinking(false);
    }
  }, [state.phase, activePlayer.isAI, state.currentPlayerIndex, state.activeCard, state.pendingEffect, isBotThinking]);

  // Trigger feedback messages - now with fresh triggering for every turn
  useEffect(() => {
    if (state.message) {
      let type: 'success' | 'warning' | 'info' = 'info';
      if (state.message.includes("GOLD") || state.message.includes("GREAT") || state.message.includes("POWER")) {
        type = 'success';
      } else if (state.message.includes("OUCH") || state.message.includes("TOUGH") || state.message.includes("TRAGIC")) {
        type = 'warning';
      }
      
      // Force a fresh object to trigger animation even if text is same
      setFeedbackMessage({ text: state.message, type });
    }
  }, [state.message, state.logs.length]); // Added logs.length to trigger every turn

  useEffect(() => {
    if (feedbackMessage) {
      const t = setTimeout(() => setFeedbackMessage(null), 2500);
      return () => clearTimeout(t);
    }
  }, [feedbackMessage]);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install prompt: ${outcome}`);
    setDeferredPrompt(null);
  };

  const tutorialSteps = [
    {
      title: "Welcome to Gambio Gold",
      content: "The goal is simple: Have the lowest points in your hand when the round ends. You start with 4 cards, but you only know two of them!",
      element: "player-hand"
    },
    {
      title: "Point Values",
      content: "Aces = 1, Numbers = Value. J = 11, Q = 12. Most important: Red Kings = 0 (Great!), Black Kings = 13 (Bad!).",
      element: "player-stats"
    },
    {
      title: "Taking a Turn",
      content: "On your turn, draw a card from the Deck (hidden) or from the Discard Pile (visible).",
      element: "piles"
    },
    {
      title: "Swap or Discard",
      content: "Once drawn, you can SWAP the card with one of yours (making it known) or DISCARD it. If you discard a special card, you get an effect!",
      element: "active-card"
    },
    {
      title: "Card Effects: Peeking",
      content: "Discard a 7 or 8 to peek at your own card. Discard a 9 or 10 to peek at an opponent's card.",
      element: "hud-log"
    },
    {
      title: "Card Effects: Swapping",
      content: "Discard a Jack or Queen to swap any of your cards with an opponent's card—without looking at either!",
      element: "hud-log"
    },
    {
      title: "Calling Gambio",
      content: "Think you have the lowest score? Call 'Gambio'. Everyone else gets one last turn, then all cards are revealed.",
      element: "gambio-btn"
    }
  ];

  const handleManualAction = (action: GameAction) => {
    if (activePlayer.isAI && ![GamePhase.LOBBY, GamePhase.GAME_END].includes(state.phase)) return;
    dispatch(action);
  };

  const handleCardClick = (card: CardType) => {
    if (activePlayer.isAI && ![GamePhase.LOBBY, GamePhase.GAME_END].includes(state.phase)) return;
    if (state.phase === GamePhase.DECISION_PHASE) {
      if (card.ownerId === activePlayer.id) {
        handleManualAction({ type: 'SWAP', targetCardId: card.id });
      }
    } else if (state.phase === GamePhase.EFFECT_PHASE && state.pendingEffect) {
      const effect = state.pendingEffect.rank;
      
      if (['7', '8'].includes(effect)) {
        if (card.ownerId === activePlayer.id) {
          dispatch({ type: 'RESOLVE_EFFECT', targetCardId: card.id });
        }
      } else if (['9', '10'].includes(effect)) {
        if (card.ownerId === passivePlayer.id) {
          dispatch({ type: 'RESOLVE_EFFECT', targetCardId: card.id });
        }
      } else if (['J', 'Q'].includes(effect)) {
        const newSelection = [...selectedCards];
        if (newSelection.includes(card.id)) {
          setSelectedCards(newSelection.filter(id => id !== card.id));
        } else if (newSelection.length < 2) {
          newSelection.push(card.id);
          setSelectedCards(newSelection);
          if (newSelection.length === 2) {
            dispatch({ type: 'RESOLVE_EFFECT', swapTargetIds: newSelection });
            setSelectedCards([]);
          }
        }
      }
    }
  };

  return (
    <div className="h-screen w-full immersive-gradient select-none overflow-hidden font-sans flex flex-col text-white relative">
      {/* Top HUD Info Bar */}
      <div id="player-stats" className="fixed top-4 left-4 right-4 flex items-center justify-between z-[60] pointer-events-none">
        <div className="flex gap-4 pointer-events-auto">
          <div className={`px-4 py-2 rounded-xl border backdrop-blur-md transition-all flex items-center gap-3 ${state.currentPlayerIndex === 0 ? 'bg-blue-600/40 border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.3)]' : 'bg-black/40 border-white/10 opacity-60'}`}>
            <span className="text-[10px] font-black uppercase tracking-widest">{state.players[0].name}</span>
            <div className={`w-2 h-2 rounded-full ${state.currentPlayerIndex === 0 ? 'bg-blue-400 animate-pulse' : 'bg-white/20'}`} />
          </div>
          
          <div className={`px-4 py-2 rounded-xl border backdrop-blur-md transition-all flex items-center gap-3 ${state.currentPlayerIndex === 1 ? 'bg-red-600/40 border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.3)]' : 'bg-black/40 border-white/10 opacity-60'}`}>
            <span className="text-[10px] font-black uppercase tracking-widest">{state.players[1].name}</span>
            <div className={`w-2 h-2 rounded-full ${state.currentPlayerIndex === 1 ? 'bg-red-400 animate-pulse' : 'bg-white/20'}`} />
            {state.players[1].isAI && state.currentPlayerIndex === 1 && (
              <div className="flex items-center gap-1.5 ml-2">
                <span className="text-[8px] uppercase tracking-tighter opacity-80 font-black text-white px-2 py-0.5 bg-white/10 rounded-full">
                  {aiActionStatus || "Thinking"}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 pointer-events-auto">
          {/* Fullscreen Toggle */}
          <button 
            onClick={toggleFullscreen}
            className="w-10 h-10 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl flex items-center justify-center text-white/40 hover:text-white transition-all shadow-xl group"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>

          {state.gambioCallerId && (
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="px-4 py-2 bg-accent-gold text-black rounded-xl font-black text-[10px] uppercase tracking-[0.2em] animate-pulse"
            >
              GAMBIO Active
            </motion.div>
          )}
          <div className="flex gap-2">
                <button 
                  onClick={() => dispatch({ type: 'BACK_TO_LOBBY' })}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 backdrop-blur-md rounded-xl border border-white/5 text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
                >
                  Home
                </button>
                <button 
                  onClick={() => dispatch({ type: 'START_GAME', mode: state.gameMode, difficulty: state.difficulty })}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white backdrop-blur-md rounded-xl border border-white/5 text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  Reset
                </button>
          </div>
        </div>
      </div>

      {/* HUD Toggle (Mobile only) */}
      <button 
        onClick={() => setIsHudOpen(!isHudOpen)}
        className="lg:hidden absolute top-4 right-4 z-[60] p-3 bg-black/30 backdrop-blur-md rounded-full border border-white/10 text-accent-gold active:scale-95 transition-transform"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isHudOpen ? <path d="M18 6 6 18M6 6l12 12"/> : <path d="m15 18-6-6 6-6"/>}
        </svg>
      </button>

      {/* Main Table Area */}
      <div className={`flex-grow flex flex-col items-center justify-between py-8 px-4 lg:py-12 lg:px-24 pb-24 lg:pb-12 transition-all duration-500 relative min-h-0 ${isHudOpen ? 'lg:pr-96 scale-95 opacity-40 blur-sm' : 'lg:pr-[320px]'} ${state.phase === GamePhase.PASS_SCREEN ? 'opacity-0 scale-90 blur-xl pointer-events-none' : ''}`}>
        
        {/* Dynamic Background Glow for Active Turn */}
        <AnimatePresence>
          {state.currentPlayerIndex === 0 && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-0 top-1/2 bg-blue-500/10 pointer-events-none z-0"
            />
          )}
          {state.currentPlayerIndex === 1 && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 top-0 bottom-1/2 bg-red-500/10 pointer-events-none z-0"
            />
          )}
        </AnimatePresence>

        {/* AI Action Overlay - Center centered for better visibility */}
        <AnimatePresence>
          {state.players[1].isAI && state.currentPlayerIndex === 1 && (aiActionStatus || isBotThinking) && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 1.1, y: 20 }}
              className="absolute top-[48%] left-1/2 -translate-x-1/2 z-[100] pointer-events-none"
            >
              <div className="flex flex-col items-center gap-6 bg-black/95 backdrop-blur-3xl border-2 border-red-500/50 px-16 py-12 rounded-[4rem] shadow-[0_0_120px_rgba(239,68,68,0.5)] min-w-[400px]">
                <div className="flex gap-5">
                  <motion.span 
                    animate={{ scale: [1, 1.8, 1], opacity: [0.4, 1, 0.4] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0 }}
                    className="w-5 h-5 bg-red-500 rounded-full shadow-[0_0_15px_rgba(239,68,68,0.8)]" 
                  />
                  <motion.span 
                    animate={{ scale: [1, 1.8, 1], opacity: [0.4, 1, 0.4] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0.3 }}
                    className="w-5 h-5 bg-red-500 rounded-full shadow-[0_0_15px_rgba(239,68,68,0.8)]" 
                  />
                  <motion.span 
                    animate={{ scale: [1, 1.8, 1], opacity: [0.4, 1, 0.4] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0.6 }}
                    className="w-5 h-5 bg-red-500 rounded-full shadow-[0_0_15px_rgba(239,68,68,0.8)]" 
                  />
                </div>
                <div className="text-4xl font-black uppercase tracking-[0.6em] text-white text-center leading-tight drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]">
                  {isBotThinking ? "THINKING" : aiActionStatus.split('...')[0]}
                </div>
                {aiActionStatus && (
                  <div className="text-sm font-black text-red-400 uppercase tracking-[0.3em] opacity-80">
                    {aiActionStatus}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Top Player (Always Opponent in Solo, Passive in Local) */}
        <div className="flex flex-col items-center min-h-[160px] justify-center z-10 w-full">
          <div className={`text-[10px] lg:text-xs uppercase tracking-[0.4em] mb-4 font-black transition-all ${state.currentPlayerIndex === 1 ? 'text-red-400 scale-110 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'text-white/20'}`}>
            {state.players[1].name}
          </div>
          <div className={`flex gap-3 lg:gap-6 scale-[0.75] sm:scale-95 lg:scale-110 origin-center transition-all p-6 rounded-[3rem] border-2 shadow-2xl min-h-[180px] min-w-[300px] items-center justify-center ${state.currentPlayerIndex === 1 ? 'bg-red-500/10 border-red-500/40 shadow-red-500/10' : 'bg-white/5 border-white/5 opacity-80'}`}>
            {state.players[1].cards.map(card => (
              <motion.div layout key={card.id}>
                <Card 
                  card={{...card, isFaceDown: state.phase === GamePhase.GAME_END ? false : card.isFaceDown}} 
                  isInteractable={state.gameMode === GameMode.SOLO ? false : (state.phase === GamePhase.EFFECT_PHASE && (['9', '10', 'J', 'Q'].includes(state.pendingEffect?.rank || '')))}
                  isHighlighted={selectedCards.includes(card.id) || botTargetId === card.id}
                  onClick={() => state.gameMode !== GameMode.SOLO && handleCardClick(card)}
                />
              </motion.div>
            ))}
          </div>
        </div>


        {/* Pile Container */}
        <div id="piles" className={`flex items-center justify-center gap-3 lg:gap-24 relative transition-all ${showTutorial && tutorialSteps[tutorialStep].element === 'piles' ? 'highlight-focus scale-110' : ''}`}>
          <div className="flex flex-col items-center gap-2 scale-[0.6] sm:scale-85 lg:scale-100 origin-center transition-transform">
             <div className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold mb-1 flex items-center gap-1">
               Draw
               <span className="text-[8px] text-white font-black px-1.5 py-0.5 rounded bg-red-600 border border-white/20 uppercase tracking-tighter shadow-lg shadow-red-600/20 animate-pulse">Luck</span>
             </div>
             <div className="relative" style={{ width: 110, height: 156 }}>
                {state.drawPile.length > 0 && (
                  <Card 
                    card={state.drawPile[0]} 
                    isInteractable={state.phase === GamePhase.TURN_START || state.phase === GamePhase.DRAW_PHASE}
                    onClick={() => handleManualAction({ type: 'DRAW_DECK' })}
                  />
                )}
                {state.drawPile.length > 1 && <div className="absolute inset-0 card-back-pattern border-4 border-white translate-x-1 -translate-y-1 rounded-lg -z-10 shadow-lg" />}
                {state.drawPile.length > 2 && <div className="absolute inset-0 card-back-pattern border-4 border-white translate-x-2 -translate-y-2 rounded-lg -z-20 shadow-lg" />}
             </div>
             <div className="text-[10px] font-black text-white/30 uppercase tracking-widest mt-1">
                {state.drawPile.length} Cards
             </div>
          </div>

          <div id="active-card" className={`flex flex-col items-center gap-2 min-w-[70px] lg:min-w-[110px] transition-all scale-[0.6] sm:scale-85 lg:scale-110 origin-center ${showTutorial && tutorialSteps[tutorialStep].element === 'active-card' ? 'highlight-focus scale-110' : ''}`}>
             <div className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] text-accent-gold font-black mb-1 h-3">
                {state.activeCard ? 'Drawn' : ''}
             </div>
             <div className="w-[110px] h-[156px] border border-white/5 bg-black/10 rounded-xl flex items-center justify-center relative overflow-hidden">
                <AnimatePresence mode="popLayout">
                  {state.activeCard && (
                    <motion.div
                      key={state.activeCard.id}
                      initial={{ scale: 0, opacity: 0, rotateY: 90 }}
                      animate={{ scale: 1, opacity: 1, rotateY: 0 }}
                      exit={{ 
                        scale: 0.5, 
                        opacity: 0,
                        y: state.currentPlayerIndex === 0 ? 300 : -300
                      }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <Card card={state.activeCard} />
                    </motion.div>
                  )}
                </AnimatePresence>
             </div>
          </div>

          <div className="flex flex-col items-center gap-2 scale-[0.6] sm:scale-85 lg:scale-100 origin-center transition-transform">
             <div className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold mb-1 flex items-center gap-1">
               Discard
               <span className="text-[8px] text-white font-black px-1.5 py-0.5 rounded bg-green-600 border border-white/20 uppercase tracking-tighter shadow-lg shadow-green-600/20">Safety</span>
             </div>
             <div className="relative" style={{ width: 110, height: 156 }}>
                {state.discardPile.length === 0 ? (
                  <div className="absolute inset-0 border-2 border-dashed border-white/10 rounded-lg" />
                ) : (
                  <div className="relative w-full h-full">
                    {state.discardPile.slice(1, 3).map((card, i) => (
                      <div 
                        key={`history-${card.id}`}
                        className="absolute inset-0 transition-all opacity-40 grayscale-[0.5]"
                        style={{ transform: `translate(${(i + 1) * 3}px, ${(i + 1) * 3}px)` }}
                      >
                        <Card card={{...card, isFaceDown: false}} />
                      </div>
                    ))}
                    <Card 
                      card={state.discardPile[0]} 
                      isInteractable={state.phase === GamePhase.TURN_START}
                      onClick={() => handleManualAction({ type: 'DRAW_DISCARD' })}
                    />
                  </div>
                )}
             </div>
          </div>
        </div>

        {/* Bottom Player (You in Solo, Active in Local) */}
        <div id="player-hand" className={`flex flex-col items-center min-h-[160px] justify-center transition-all z-10 w-full ${showTutorial && tutorialSteps[tutorialStep].element === 'player-hand' ? 'highlight-focus scale-110' : ''}`}>
          <div className={`flex gap-3 lg:gap-6 scale-[0.7] sm:scale-90 lg:scale-110 origin-center transition-all p-6 rounded-[2.5rem] border-2 min-h-[180px] min-w-[300px] items-center justify-center ${state.currentPlayerIndex === 0 ? 'bg-blue-500/10 border-blue-500/40 shadow-[0_0_40px_rgba(59,130,246,0.1)]' : 'bg-white/5 border-white/5 opacity-80'}`}>
            {state.players[0].cards.map(card => (
              <motion.div layout key={card.id}>
                <Card 
                  card={card}
                  isInteractable={state.currentPlayerIndex === 0 && (state.phase === GamePhase.DECISION_PHASE || state.phase === GamePhase.EFFECT_PHASE)}
                  isHighlighted={selectedCards.includes(card.id)}
                  onClick={() => handleCardClick(card)}
                />
              </motion.div>
            ))}
          </div>
          <div className={`text-[10px] uppercase tracking-[0.3em] mt-4 font-black transition-all ${state.currentPlayerIndex === 0 ? 'text-blue-400 scale-110' : 'text-white/20'}`}>
            {state.players[0].name}
          </div>
        </div>
      </div>

      {/* Control Panel (HUD Right) */}
      <div id="hud-log" className={`hud-transition fixed lg:absolute right-0 top-0 bottom-0 w-72 lg:w-80 bg-black/80 lg:bg-black/40 backdrop-blur-3xl lg:backdrop-blur-2xl border-l lg:border border-white/10 lg:m-6 lg:rounded-2xl p-4 lg:p-6 flex flex-col z-[55] ${isHudOpen ? 'translate-x-0 shadow-[-40px_0_100px_rgba(0,0,0,0.8)]' : 'translate-x-full shadow-none lg:translate-x-0'} transition-all ${showTutorial && tutorialSteps[tutorialStep].element === 'hud-log' ? 'highlight-focus' : ''}`}>
        <div className="flex items-center justify-center mb-6">
          <div className="px-4 py-1 bg-accent-gold text-black text-[11px] font-black tracking-[0.2em] rounded-full uppercase shadow-lg shadow-accent-gold/20">
            {state.phase.replace('_', ' ')}
          </div>
        </div>

        <div className="flex-grow flex flex-col overflow-hidden mb-6">
          <h3 className="text-accent-gold text-[11px] font-black uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-accent-gold rounded-full animate-pulse" />
            Action Log
          </h3>
          <div className="flex-grow overflow-y-auto space-y-2 pr-2 custom-scrollbar">
            {state.logs.map(log => (
              <div key={log.id} className="text-[12px] border-b border-white/5 pb-2 last:border-0 leading-[1.4] py-1">
                <span className="text-accent-gold font-bold">{log.player}</span> {log.action} <span className="text-white/50">{log.details}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Current State / Scores */}
        <div className="space-y-3 mb-6">
          {state.players.map(p => (
            <div key={p.id} className={`flex justify-between items-center p-3 rounded-xl border transition-all ${state.currentPlayerIndex === state.players.indexOf(p) ? (state.players.indexOf(p) === 0 ? 'bg-blue-600/30 border-blue-400/30' : 'bg-red-600/30 border-red-400/30') : 'bg-transparent border-white/5 opacity-50'}`}>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold text-white/40">{p.name}</span>
                <span className="text-sm font-black tracking-tight">{state.phase === GamePhase.GAME_END ? p.score : '??'} <span className="text-[10px] font-normal opacity-40 uppercase">PTS</span></span>
              </div>
              {state.gambioCallerId === p.id && <div className="bg-red-500 text-[9px] font-black px-2 py-0.5 rounded text-white italic">GAMBIO</div>}
            </div>
          ))}
        </div>

        <div className="bg-white/5 rounded-xl p-4 border border-white/5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2 font-black">Current Objective</div>
          <p className="text-[13px] leading-relaxed text-white/80 font-medium italic">"{state.message}"</p>
        </div>
      </div>

      {/* Buttons / Controls Bottom Left */}
      <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 lg:left-10 lg:translate-x-0 flex flex-col lg:flex-row items-center gap-3 lg:gap-4 z-50 w-full lg:w-auto px-6 lg:px-10 transition-all ${state.phase === GamePhase.PASS_SCREEN ? 'opacity-0 pointer-events-none' : ''}`}>
        {state.phase === GamePhase.INIT && (
          <button onClick={() => dispatch({ type: 'START_GAME', mode: state.gameMode, difficulty: state.difficulty })} className="w-full lg:w-auto px-8 py-5 lg:py-4 bg-green-500 rounded-xl font-black text-xs uppercase tracking-[0.2em] shadow-[0_4px_0_#15803d] hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all">
            Start Game
          </button>
        )}

        {state.phase === GamePhase.INITIAL_LOOK && (
          <button onClick={() => dispatch({ type: 'REVEAL_INITIAL', cardIds: [] })} className="w-full lg:w-auto px-8 py-5 lg:py-4 bg-accent-gold text-black rounded-xl font-black text-xs uppercase tracking-[0.2em] shadow-[0_4px_0_#a16207] hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all">
            Done
          </button>
        )}

        {state.phase === GamePhase.DECISION_PHASE && (
          <div className="flex flex-col lg:flex-row items-center gap-3 lg:gap-4 w-full">
            <div className="text-[10px] lg:text-xs font-black text-white/30 uppercase tracking-[0.2em] animate-pulse text-center mb-1 lg:mb-0">Swap or Discard</div>
            <button onClick={() => handleManualAction({ type: 'DISCARD' })} className="w-full lg:w-auto px-8 py-5 lg:py-4 bg-white text-black rounded-xl font-black text-xs uppercase tracking-[0.2em] shadow-[0_4px_0_#cbd5e1] hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all">
               Discard & Effect
            </button>
          </div>
        )}

        {state.phase === GamePhase.EFFECT_PHASE && (
          <div className="w-full lg:w-auto text-[10px] font-black text-accent-gold uppercase tracking-[0.2em] bg-black/60 px-6 py-4 rounded-xl border border-accent-gold/20 flex items-center justify-center gap-3 backdrop-blur-xl">
             <span className="w-2 h-2 bg-accent-gold rounded-full animate-ping" />
             Select {['J', 'Q'].includes(state.pendingEffect?.rank || '') ? 'TWO' : 'ONE'} target(s)
          </div>
        )}

        {(state.phase === GamePhase.TURN_START || state.phase === GamePhase.DRAW_PHASE) && !state.gambioCallerId && (
          <button id="gambio-btn" onClick={() => handleManualAction({ type: 'CALL_GAMBIO' })} className={`w-full lg:w-auto px-8 py-5 lg:py-3 bg-red-600/10 text-red-500 border border-red-500/30 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] hover:bg-red-600 hover:text-white transition-all shadow-xl backdrop-blur-md ${showTutorial && tutorialSteps[tutorialStep].element === 'gambio-btn' ? 'highlight-focus' : ''}`}>
             Call Gambio
          </button>
        )}
      </div>

      {/* Pass Screen Overlay */}
      <AnimatePresence>
        {state.phase === GamePhase.PASS_SCREEN && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[300] bg-black/90 backdrop-blur-3xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="text-center max-w-sm w-full"
            >
              <div className={`w-24 h-24 rounded-full mx-auto mb-8 flex items-center justify-center text-4xl shadow-2xl transition-colors ${state.currentPlayerIndex === 0 ? 'bg-blue-600 shadow-blue-500/20' : 'bg-red-600 shadow-red-500/20'}`}>
                {state.currentPlayerIndex === 0 ? '👤' : '👥'}
              </div>
              <h2 className="text-4xl font-black mb-4 uppercase tracking-tighter">
                Next: {activePlayer.name}
              </h2>
              <p className="text-white/40 mb-12 uppercase tracking-widest text-xs font-black">
                Please hand the device to the next player.
              </p>
              
              <button 
                onClick={() => dispatch({ type: 'CONFIRM_PASS' })}
                className={`w-full py-6 rounded-2xl font-black uppercase text-sm tracking-[0.3em] transition-all shadow-2xl ${state.currentPlayerIndex === 0 ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/50' : 'bg-red-600 hover:bg-red-500 shadow-red-900/50'}`}
              >
                I am Ready
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Developer Credit - Discreet at bottom */}
      <div className="fixed bottom-10 left-10 z-[2000] mix-blend-difference pointer-events-auto">
        <a 
          href="https://benjaminthyssen.com" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-[9px] font-black uppercase tracking-[0.5em] text-white/10 hover:text-white/80 transition-all duration-700 flex items-center gap-5 group"
        >
          <div className="flex flex-col">
            <span className="opacity-40 text-[7px] mb-1 italic tracking-[0.2em]">Crafted by</span>
            <div className="flex items-center gap-4">
              <span className="w-12 h-px bg-white/10 group-hover:w-16 group-hover:bg-white/40 transition-all duration-500" />
              BENJAMINTHYSSEN.COM
            </div>
          </div>
        </a>
      </div>

      {/* Discreet Sponsored Section */}
      <div className="fixed bottom-10 right-10 z-[2000] mix-blend-difference pointer-events-auto">
        <div className="flex flex-col items-end gap-3 group cursor-pointer">
          <span className="text-[7px] font-black text-white/10 uppercase tracking-[0.5em]">System Status</span>
          <div className="px-6 py-3 bg-white/5 border border-white/5 rounded-2xl flex items-center gap-4 transition-all hover:bg-white/10 hover:border-white/20 backdrop-blur-sm">
             <div className="w-2 h-2 bg-accent-gold rounded-full shadow-[0_0_15px_rgba(234,179,8,1)] animate-pulse" />
             <span className="text-[9px] font-black text-white/40 group-hover:text-white/80 transition-colors uppercase tracking-[0.3em] font-mono">PLATINUM v2.1.0</span>
          </div>
        </div>
      </div>

      {/* Lobby Overlay */}
      <AnimatePresence mode="wait">
        {state.phase === GamePhase.LOBBY && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05, filter: "blur(20px)" }}
            className="fixed inset-0 z-[1000] bg-[#020617] flex items-center justify-center p-6 lg:p-12 overflow-hidden"
          >
            {/* Ambient Background Elements */}
            <div className="absolute inset-0 z-0 overflow-hidden">
               <div className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] bg-accent-gold/10 rounded-full blur-[180px] animate-pulse" />
               <div className="absolute -bottom-[20%] -right-[10%] w-[70%] h-[70%] bg-blue-600/10 rounded-full blur-[200px] animate-pulse" style={{ animationDelay: '2s' }} />
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />
            </div>

            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 w-full max-w-6xl h-full flex flex-col items-center justify-center"
            >
              <div className="mb-auto flex w-full justify-between items-start opacity-40">
                <div className="text-[10px] font-black tracking-[0.5em] uppercase">v2.1.0 // PRO</div>
                <div className="flex items-center gap-4">
                   <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                   <div className="text-[10px] font-black tracking-[0.5em] uppercase">Server Link Active</div>
                </div>
              </div>

              <div className="flex flex-col items-center flex-grow justify-center w-full max-w-2xl px-6">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="mb-6"
                >
                  <h1 className="text-9xl lg:text-[14rem] font-black italic tracking-tighter text-white leading-none drop-shadow-[0_40px_120px_rgba(255,255,255,0.15)] select-none">
                    GAMBIO
                  </h1>
                </motion.div>

                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="flex flex-col items-center w-full"
                >
                  <div className="flex items-center justify-center gap-6 mb-4">
                     <span className="w-16 h-px bg-gradient-to-r from-transparent to-white/10" />
                     <div className="flex flex-col items-center">
                        <span className="text-white/20 uppercase tracking-[1.2em] text-[10px] font-black mb-1">Rank</span>
                        <span className="text-accent-gold text-lg font-black tracking-widest uppercase">LEVEL {level}</span>
                     </div>
                     <span className="w-16 h-px bg-gradient-to-l from-transparent to-white/10" />
                  </div>
                  
                  {/* XP Bar Container */}
                  <div className="w-full max-w-sm h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/10 mb-16 relative">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${currentLevelProgress}%` }}
                      transition={{ duration: 1.5, ease: "easeOut" }}
                      className="h-full bg-gradient-to-r from-accent-gold/50 to-accent-gold shadow-[0_0_20px_rgba(234,179,8,0.8)] relative z-10"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10 w-full mb-16">
                    {/* Settings Sections */}
                    <div className="space-y-6">
                      <div className="text-left">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] mb-3 block">Match Protocol</span>
                        <div className="grid grid-cols-2 bg-white/5 p-1 rounded-2xl border border-white/5">
                          <button 
                            onClick={() => setSelectedMode(GameMode.SOLO)}
                            className={`flex items-center justify-center gap-3 py-4 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] transition-all ${selectedMode === GameMode.SOLO ? 'bg-white text-black shadow-2xl' : 'text-white/30 hover:text-white/50'}`}
                          >
                            <span>SOLO</span>
                          </button>
                          <button 
                            onClick={() => setSelectedMode(GameMode.LOCAL)}
                            className={`flex items-center justify-center gap-3 py-4 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] transition-all ${selectedMode === GameMode.LOCAL ? 'bg-white text-black shadow-2xl' : 'text-white/30 hover:text-white/50'}`}
                          >
                            <span>LOCAL</span>
                          </button>
                        </div>
                      </div>

                      {selectedMode === GameMode.SOLO && (
                        <motion.div 
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="text-left"
                        >
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] mb-3 block">Tactical AI</span>
                          <div className="grid grid-cols-3 gap-2">
                            {Object.values(Difficulty).map(d => (
                              <button 
                                key={d}
                                onClick={() => setSelectedDifficulty(d)}
                                className={`py-3 rounded-xl font-black uppercase text-[9px] tracking-widest transition-all border ${selectedDifficulty === d ? 'border-accent-gold/40 bg-accent-gold/10 text-accent-gold shadow-[0_0_15px_rgba(234,179,8,0.2)]' : 'border-white/5 text-white/40 hover:bg-white/5'}`}
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </div>

                    <div className="space-y-6">
                       <div className="text-left">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] mb-3 block">Service Actions</span>
                          <div className="grid grid-cols-1 gap-3">
                             <button 
                                onClick={() => setShowTutorial(true)}
                                className="group w-full py-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all text-left px-6 flex items-center justify-between"
                             >
                                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/60 group-hover:text-white">Training Loop</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white/20 group-hover:text-accent-gold transition-colors"><path d="m9 18 6-6-6-6"/></svg>
                             </button>
                             <button 
                                onClick={toggleFullscreen}
                                className="group w-full py-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all text-left px-6 flex items-center justify-between"
                             >
                                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/60 group-hover:text-white">IMMERSE MODE</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white/20 group-hover:text-white transition-colors"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                             </button>
                             <button 
                                onClick={handleWatchAd}
                                className="group w-full py-4 bg-accent-gold/5 hover:bg-accent-gold/10 rounded-2xl border border-accent-gold/20 transition-all text-left px-6 flex items-center justify-between"
                             >
                                <div className="flex flex-col">
                                  <span className="text-[11px] font-black uppercase tracking-[0.2em] text-accent-gold">BONUS REWARD</span>
                                  <span className="text-[8px] font-black opacity-40 uppercase tracking-widest">+250 XP REWARD</span>
                                </div>
                                <div className="w-8 h-8 bg-accent-gold/20 rounded-full flex items-center justify-center">
                                  <span className="text-[10px]">🎁</span>
                                </div>
                             </button>
                          </div>
                       </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => dispatch({ type: 'START_GAME', mode: selectedMode, difficulty: selectedDifficulty })}
                    className="group relative w-full py-10 bg-white text-black rounded-[2.5rem] font-sans font-black italic uppercase text-4xl tracking-tighter overflow-hidden transition-all hover:scale-[1.02] active:scale-95 shadow-[0_40px_80px_rgba(0,0,0,0.6)]"
                  >
                    <span className="relative z-10 flex items-center justify-center gap-6">
                       BATTLE.EXE
                       <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center">
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                       </div>
                    </span>
                    <div className="absolute inset-0 bg-accent-gold translate-x-full group-hover:translate-x-0 transition-transform duration-700 ease-[0.22, 1, 0.36, 1]" />
                  </button>
                </motion.div>
              </div>

              <div className="mt-auto pt-10 flex w-full justify-between items-end">
                <div className="flex gap-12">
                   <div className="flex flex-col">
                      <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.3em] mb-1">Lifetime Plays</span>
                      <span className="text-lg font-black text-white/50">{getStoredStats().gamesStarted}</span>
                   </div>
                   <div className="flex flex-col border-l border-white/5 pl-8">
                      <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.3em] mb-1">Total Victories</span>
                      <span className="text-lg font-black text-accent-gold/60">{getStoredStats().gamesFinished}</span>
                   </div>
                </div>
                <div className="flex gap-4">
                   <div className="px-5 py-2 border border-accent-gold/20 rounded-full text-[9px] font-black text-accent-gold tracking-[0.2em] bg-accent-gold/5 animate-pulse">
                      PATCH v2.1.1 LIVE
                   </div>
                   <div className="px-5 py-2 border border-white/5 rounded-full text-[9px] font-black opacity-30 tracking-[0.2em] bg-white/5">
                      PRO EDITION
                   </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {feedbackMessage && (
          <motion.div
            key={feedbackMessage.text + state.logs.length}
            initial={{ opacity: 0, scale: 0.1, y: 300, rotate: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 2, y: -400, rotate: 10 }}
            transition={{ 
              type: "spring",
              damping: 12,
              stiffness: 100,
              duration: 0.8 
            }}
            className={`fixed inset-0 z-[101] flex items-center justify-center pointer-events-none select-none text-4xl lg:text-9xl font-black uppercase tracking-tighter text-center px-10 ${
              feedbackMessage.type === 'success' ? "text-accent-gold drop-shadow-[0_0_30px_rgba(234,179,8,0.5)]" : 
              feedbackMessage.type === 'warning' ? "text-red-500 drop-shadow-[0_0_30px_rgba(239,68,68,0.5)]" : "text-blue-400 drop-shadow-[0_0_30px_rgba(59,130,246,0.5)]"
            }`}
          >
            <span className="bg-black/20 backdrop-blur-sm px-10 py-5 rounded-[4rem]">
              {feedbackMessage.text}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tutorial Overlay */}
      <AnimatePresence>
        {showTutorial && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[200] tutorial-overlay flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-board-dark border border-white/10 p-8 rounded-3xl max-w-md w-full shadow-2xl relative overflow-hidden"
            >
              {/* Progress bar */}
              <div className="absolute top-0 left-0 w-full h-1 bg-white/5">
                <motion.div 
                  className="h-full bg-accent-gold"
                  animate={{ width: `${((tutorialStep + 1) / tutorialSteps.length) * 100}%` }}
                />
              </div>

              <div className="flex items-center justify-between mb-6">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-accent-gold">
                  Chapter {tutorialStep + 1} of {tutorialSteps.length}
                </div>
                <button onClick={() => setShowTutorial(false)} className="text-white/40 hover:text-white transition-colors">
                   Skip
                </button>
              </div>

              <h2 className="text-2xl font-black mb-4 uppercase tracking-tight">{tutorialSteps[tutorialStep].title}</h2>
              <p className="text-white/60 leading-relaxed mb-10 text-[15px] italic">
                {tutorialSteps[tutorialStep].content}
              </p>

              <div className="flex gap-3">
                {tutorialStep > 0 && (
                  <button 
                    onClick={() => setTutorialStep(prev => prev - 1)}
                    className="flex-1 py-4 bg-white/5 hover:bg-white/10 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all"
                  >
                    Back
                  </button>
                )}
                <button 
                  onClick={() => {
                    if (tutorialStep < tutorialSteps.length - 1) {
                      setTutorialStep(prev => prev + 1);
                    } else {
                      setShowTutorial(false);
                    }
                  }}
                  className="flex-[2] py-4 bg-accent-gold text-black rounded-xl font-black uppercase text-[10px] tracking-widest shadow-[0_4px_0_#a16207] active:shadow-none active:translate-y-1 transition-all"
                >
                  {tutorialStep === tutorialSteps.length - 1 ? "Finish Tutorial" : "Next Step"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Winner Overlay */}
      <AnimatePresence>
        {state.phase === GamePhase.GAME_END && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-6 overflow-y-auto"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-black/40 border-2 border-white/10 p-8 lg:p-12 rounded-[40px] text-center max-w-4xl w-full shadow-2xl my-auto"
            >
              <div className="text-accent-gold text-6xl font-black mb-4">🏆</div>
              <h2 className="text-5xl font-black mb-2 uppercase tracking-tighter">Results</h2>
              <p className="text-white/40 mb-12 uppercase tracking-widest text-xs font-black">{state.message}</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                {state.players.map(p => (
                  <div key={p.id} className={`flex flex-col p-6 rounded-3xl border transition-all ${p.id === state.roundWinnerId ? 'bg-accent-gold/10 border-accent-gold/40' : 'bg-white/5 border-white/10 opacity-70'}`}>
                    <div className="flex justify-between items-center mb-6">
                      <div className="text-left">
                        <span className="block text-[10px] uppercase font-black text-white/40 tracking-widest mb-1">Player</span>
                        <span className={`text-xl font-black ${p.id === state.roundWinnerId ? 'text-accent-gold font-black italic' : ''}`}>{p.name} {p.id === state.roundWinnerId ? '👑' : ''}</span>
                        <div className="flex gap-2 mt-1">
                          <span className="text-[8px] font-black uppercase text-white/20 bg-white/5 border border-white/10 px-1 rounded">
                            {p.cards.filter(c => c.isKnownByOwner).length} Known
                          </span>
                          <span className="text-[8px] font-black uppercase text-white/20 bg-white/5 border border-white/10 px-1 rounded">
                            {p.cards.filter(c => !c.isKnownByOwner).length} Risk
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="block text-[10px] uppercase font-black text-white/40 tracking-widest mb-1">Score</span>
                        <span className="text-2xl font-black">{p.score} <span className="text-xs opacity-40 uppercase">pts</span></span>
                      </div>
                    </div>
                    
                    <div className="flex justify-center gap-3 scale-75 lg:scale-90">
                      {p.cards.map(card => (
                        <Card key={card.id} card={{...card, isFaceDown: false}} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col lg:flex-row gap-4">
                <button 
                  onClick={() => dispatch({ type: 'START_GAME', mode: state.gameMode, difficulty: state.difficulty })} 
                  className="flex-grow py-5 bg-accent-gold text-black rounded-2xl font-black uppercase tracking-[0.2em] text-sm shadow-[0_6px_0_#a16207] active:shadow-none active:translate-y-1 transition-all"
                >
                  Play Again
                </button>
                {!state.adWatchedThisRound && (
                  <button 
                    onClick={handleWatchAd} 
                    className="flex-grow py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-sm shadow-[0_6px_0_#1e3a8a] active:shadow-none active:translate-y-1 transition-all flex items-center justify-center gap-3"
                  >
                    Watch Ad for Bonus XP
                  </button>
                )}
                <button 
                  onClick={() => dispatch({ type: 'BACK_TO_LOBBY' })} 
                  className="px-10 py-5 bg-white/5 hover:bg-white/10 text-white/40 rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all border border-white/5"
                >
                  Main Menu
                </button>
              </div>

              <div className="mt-12 pt-8 border-t border-white/5">
                <a 
                  href="https://benjaminthyssen.com" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-[10px] font-black uppercase tracking-[0.4em] text-white/10 hover:text-white/60 transition-colors flex items-center justify-center gap-4"
                >
                  <span className="w-8 h-px bg-white/5" />
                  BENJAMINTHYSSEN.COM
                  <span className="w-8 h-px bg-white/5" />
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Ad Overlay Mockup */}
      <AnimatePresence>
        {showAdOverlay && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[5000] bg-black flex flex-col items-center justify-center p-6"
          >
            <div className="absolute top-10 left-10 flex items-center gap-3">
              <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center animate-spin">
                <div className="w-1 h-1 bg-accent-gold rounded-full" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Sponsored Content</span>
            </div>

            <div className="max-w-xl w-full text-center">
              <motion.div 
                animate={{ scale: [1, 1.05, 1], opacity: [0.8, 1, 0.8] }}
                transition={{ repeat: Infinity, duration: 3 }}
                className="text-8xl lg:text-[10rem] font-black italic tracking-tighter text-white/5 opacity-40 mb-8"
              >
                PROMO
              </motion.div>
              <h2 className="text-4xl font-black mb-6 uppercase tracking-tighter">Your Reward is Loading</h2>
              <p className="text-white/40 mb-12 uppercase tracking-widest text-xs font-black">
                Please wait a few seconds to support the developer.
              </p>
              
              <div className="w-64 h-1 bg-white/5 mx-auto rounded-full overflow-hidden border border-white/5">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 5, ease: "linear" }}
                  className="h-full bg-accent-gold"
                />
              </div>
            </div>

            <div className="absolute bottom-10 text-[9px] font-black uppercase tracking-[0.5em] text-white/20">
              Architecture by BenjaminThyssen.com
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
