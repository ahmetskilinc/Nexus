import type { Transition, Variants } from "motion/react";

export const easeOut = [0.22, 1, 0.36, 1] as const;

export const transitions = {
  base: { duration: 0.22, ease: easeOut },
  fast: { duration: 0.16, ease: easeOut },
  panel: { duration: 0.26, ease: easeOut },
} satisfies Record<string, Transition>;

export const rise: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: transitions.base },
  exit: { opacity: 0, y: 6, transition: transitions.fast },
};

export const popIn: Variants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1, transition: transitions.base },
  exit: { opacity: 0, scale: 0.98, transition: transitions.fast },
};

export const slideInRight: Variants = {
  initial: { opacity: 0, x: 14 },
  animate: { opacity: 1, x: 0, transition: transitions.panel },
  exit: { opacity: 0, x: 14, transition: transitions.fast },
};
