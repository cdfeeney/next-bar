'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { quiz, deriveArchetype } from '@/lib/quiz';
import type { QuizOption } from '@/lib/quiz';
import type { VibeProfile, VibeTag } from '@/types';

type VibeQuizProps = { onComplete: (profile: VibeProfile) => void };

export default function VibeQuiz({ onComplete }: VibeQuizProps) {
  const [step, setStep] = useState(0);
  const [tags, setTags] = useState<VibeTag[]>([]);

  const question = quiz[step];
  const progress = ((step + 1) / quiz.length) * 100;

  const handlePick = (option: QuizOption) => {
    const nextTags = [...tags, ...option.tags];

    if (step === quiz.length - 1) {
      const deduped = Array.from(new Set(nextTags));
      onComplete({ tags: deduped, archetype: deriveArchetype(deduped) });
      return;
    }

    setTags(nextTags);
    setStep(step + 1);
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
            <h2 className="font-display text-3xl md:text-5xl text-center mb-10 leading-tight">
              {question.prompt}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {question.options.map((option, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handlePick(option)}
                  className="border border-border hover:border-accent hover:bg-surface transition-colors rounded-2xl p-6 font-display text-xl text-left"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
