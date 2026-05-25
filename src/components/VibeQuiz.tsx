'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { quiz, deriveArchetype } from '@/lib/quiz';
import type { QuizOption } from '@/lib/quiz';
import NeighborhoodPicker from '@/components/NeighborhoodPicker';
import type { ManhattanNeighborhood, VibeProfile, VibeTag } from '@/types';

type VibeQuizProps = { onComplete: (profile: VibeProfile) => void };

export default function VibeQuiz({ onComplete }: VibeQuizProps) {
  const [step, setStep] = useState(0);
  const [tags, setTags] = useState<VibeTag[]>([]);
  const [preferredNeighborhoods, setPreferredNeighborhoods] = useState<
    ManhattanNeighborhood[]
  >([]);

  const question = quiz[step];
  const progress = ((step + 1) / quiz.length) * 100;

  const finalize = (
    finalTags: VibeTag[],
    finalNeighborhoods: ManhattanNeighborhood[],
  ) => {
    const deduped = Array.from(new Set(finalTags));
    onComplete({
      tags: deduped,
      archetype: deriveArchetype(deduped),
      preferredNeighborhoods: finalNeighborhoods,
    });
  };

  const handlePick = (option: QuizOption) => {
    const nextTags = [...tags, ...option.tags];
    setTags(nextTags);
    setStep(step + 1);
  };

  const handleDone = () => {
    finalize(tags, preferredNeighborhoods);
  };

  const handleSkip = () => {
    finalize(tags, []);
  };

  return (
    <section className="min-h-screen flex flex-col px-6 py-10">
      <div className="h-1 bg-border w-full max-w-3xl mx-auto rounded-full overflow-hidden">
        <div
          className="h-1 bg-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center max-w-3xl mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25 }}
            className="w-full"
          >
            <p className="text-muted uppercase tracking-widest text-xs mb-4 text-center">
              Question {step + 1} of {quiz.length}
            </p>

            {renderQuestion()}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );

  function renderQuestion() {
    switch (question.kind) {
      case 'single':
        return (
          <>
            <h2 className="font-display text-3xl md:text-5xl text-center mb-10 leading-tight">
              {question.prompt}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {question.options.map((option, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handlePick(option)}
                  className="min-h-[44px] touch-manipulation border border-border hover:border-accent hover:bg-surface transition-colors rounded-2xl p-6 font-display text-xl text-left"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        );

      case 'neighborhoodMultiSelect': {
        const hasSelection = preferredNeighborhoods.length > 0;
        return (
          <>
            <NeighborhoodPicker
              multi
              selected={preferredNeighborhoods}
              onChange={setPreferredNeighborhoods}
              title={question.prompt}
            />
            <div className="max-w-2xl mx-auto px-6 mt-8 flex flex-col md:flex-row gap-3 md:gap-4">
              <button
                type="button"
                onClick={handleSkip}
                className="min-h-[44px] touch-manipulation bg-surface border border-border text-text rounded-full px-6 py-3 font-display text-lg w-full md:flex-1"
              >
                {question.skipLabel}
              </button>
              {hasSelection ? (
                <button
                  type="button"
                  onClick={handleDone}
                  className="min-h-[44px] touch-manipulation bg-accent text-bg rounded-full px-6 py-3 font-display text-lg w-full md:flex-1"
                >
                  {question.doneLabel}
                </button>
              ) : null}
            </div>
          </>
        );
      }

      default: {
        const _exhaustive: never = question;
        return _exhaustive;
      }
    }
  }
}
