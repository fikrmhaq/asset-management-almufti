import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { requestsApi } from '@/api/requests';

import { changeLanguage, DEFAULT_LANGUAGE, initI18n } from '@/i18n';

/**
 * jsdom implements no `ResizeObserver`, and `cmdk` — which every `Combobox`
 * popover is built on — constructs one as soon as its list mounts.
 *
 * Without this, any test that OPENS a combobox throws before it can assert
 * anything. Nothing had opened one until the reusable patterns did, which is why
 * this only surfaced now.
 *
 * A no-op is the right shim: the observer exists to recompute sizes during
 * layout, and jsdom performs no layout for it to react to. Nothing under test
 * depends on a measurement it would have reported.
 */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * Same gap, same reasoning: jsdom implements no `scrollIntoView`, and `cmdk`
 * calls it to keep the highlighted item in view as the selection moves.
 *
 * Scrolling is the one thing a headless DOM genuinely cannot do, and no
 * assertion in this suite depends on it having happened.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// Screens render through `t()`, so the dictionaries have to exist before the
// first render. Pinned to the default language explicitly: a test asserting on
// English copy should not depend on what a previous test switched to, nor on
// whatever `localStorage` happens to hold in the jsdom environment.
initI18n({ language: DEFAULT_LANGUAGE });

beforeEach(() => {
  changeLanguage(DEFAULT_LANGUAGE);
  /**
   * P5 + P6 (§64.5, §64.6): the sidebar asks for the request counts and the
   * request page marks itself seen, on every screen that shows them. Answered
   * here — nothing needing, nothing updated — so no test reaches the network by
   * accident; a test about them sets its own answer.
   */
  vi.spyOn(requestsApi, 'attention').mockResolvedValue({ actionNeeded: 0, updated: 0 });
  vi.spyOn(requestsApi, 'markViewed').mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});
