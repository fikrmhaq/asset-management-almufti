import { cn } from '@/lib/utils';

/**
 * The AL-MUFTI logo.
 *
 * THE ASSET IS AUTHORITATIVE. `public/brand/almufti-logo.png` is the supplied
 * file, byte-for-byte. Nothing here redraws it, recolours it, crops it or
 * reconstructs it in CSS.
 *
 * The lockup is 1084×167 — a 6.5:1 horizontal wordmark. Both intrinsic
 * dimensions are declared so the browser reserves the right box before the image
 * arrives, and only the HEIGHT is ever constrained (`w-auto`), which is what
 * makes distortion impossible rather than merely unlikely: there is no code path
 * that can set both axes.
 *
 * NO MARK-ONLY VARIANT EXISTS. A collapsed 4.5rem rail cannot show a 6.5:1
 * lockup, and cropping the monogram out of the supplied file would be altering
 * the mark. So the collapsed rail shows no logo at all — callers simply do not
 * render this. That is a deliberate omission, not an oversight.
 */
export function BrandMark({ className, height = 'h-7' }) {
  return (
    <img
      src="/brand/almufti-logo.png"
      /* The wordmark reads "SMK AL-MUFTI"; a screen reader should hear the
         institution, not "logo". */
      alt="SMK AL-MUFTI"
      width={1084}
      height={167}
      /* Decoding off the main thread: this sits in the shell and is painted on
         every route, and there is nothing to lay out around it. */
      decoding="async"
      className={cn('w-auto max-w-full object-contain', height, className)}
    />
  );
}
