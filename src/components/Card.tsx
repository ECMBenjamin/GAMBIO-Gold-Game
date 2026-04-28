/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from 'motion/react';
import { Suit, Card as CardType } from '../types';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';

interface CardProps {
  card: CardType;
  onClick?: () => void;
  isInteractable?: boolean;
  isHighlighted?: boolean;
  className?: string;
}

export default function Card({ card, onClick, isInteractable, isHighlighted, className = '' }: CardProps) {
  const isRed = card.suit === Suit.HEARTS || card.suit === Suit.DIAMONDS;
  const isActuallyVisible = !card.isFaceDown || card.isRevealedTemporarily;

  return (
    <motion.div
      layoutId={card.id}
      whileHover={isInteractable ? { y: -10, scale: 1.02 } : {}}
      onClick={isInteractable ? onClick : undefined}
      className={`relative rounded-lg cursor-pointer ${className}`}
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        perspective: 1000,
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!isActuallyVisible ? (
          <motion.div
            key="back"
            initial={{ rotateY: 180 }}
            animate={{ rotateY: 0 }}
            exit={{ rotateY: 180 }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            className={`absolute inset-0 w-full h-full rounded-lg border-[3px] border-white/90 shadow-2xl card-back-pattern ${isHighlighted ? 'ring-4 ring-red-500 shadow-[0_0_25px_rgba(239,68,68,0.8)] animate-pulse' : ''}`}
            style={{ backfaceVisibility: 'hidden' }}
          />
        ) : (
          <motion.div
            key="front"
            initial={{ rotateY: -180 }}
            animate={{ rotateY: 0 }}
            exit={{ rotateY: -180 }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            className={`absolute inset-0 w-full h-full ${card.value === 0 ? 'bg-gradient-to-br from-yellow-100 via-accent-gold to-yellow-600 shadow-[0_0_40px_rgba(234,179,8,0.3)]' : 'bg-[#fefefe]'} rounded-lg shadow-2xl flex flex-col items-center justify-center p-2 text-card-black border ${card.value === 0 ? 'border-yellow-400' : 'border-black/5'}`}
            style={{ backfaceVisibility: 'hidden' }}
          >
            {card.value === 0 && (
              <motion.div 
                animate={{ opacity: [0.1, 0.4, 0.1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="absolute inset-0 bg-white pointer-events-none rounded-lg"
              />
            )}
            <div className={`absolute top-2 left-2 font-black text-xl ${isRed ? 'text-card-red' : 'text-card-black'} ${card.value === 0 ? 'drop-shadow-md' : ''}`}>
              {card.rank}
            </div>
            
            <div className={`text-5xl ${isRed ? 'text-card-red' : 'text-card-black'}`}>
              {card.suit}
            </div>

            {card.isKnownByOwner && !card.isRevealedTemporarily && (
              <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-sm bg-accent-gold/20 border border-accent-gold/40 text-[7px] font-black uppercase tracking-tighter text-accent-gold shadow-sm">
                Known
              </div>
            )}

            {card.isRevealedTemporarily && (
              <div className="absolute bottom-2 text-[8px] uppercase tracking-widest text-black/40 font-bold">
                Revealed
              </div>
            )}
            
            {isHighlighted && (
              <div className="absolute inset-0 rounded-lg ring-[6px] ring-red-500 shadow-[0_0_30px_rgba(239,68,68,0.9)] pointer-events-none animate-pulse z-20" />
            )}

            {/* Value Marker */}
            <div className={`absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-black z-10 ${
              card.value === 0 ? 'bg-black text-accent-gold ring-1 ring-accent-gold animate-pulse' : 
              card.value >= 10 ? 'bg-red-500 text-white' : 
              'bg-black/5 text-black/40'
            }`}>
              {card.value}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
