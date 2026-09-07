import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, with later Tailwind utilities winning over earlier ones.
 *
 * Plain string concatenation does not work with Tailwind: `"px-2 px-4"` leaves
 * both classes present and the winner is decided by stylesheet order, not by the
 * caller. `twMerge` resolves conflicts by utility group, which is what lets a
 * component accept a `className` override that actually overrides.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
