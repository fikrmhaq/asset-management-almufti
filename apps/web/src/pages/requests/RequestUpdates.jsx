import { useTranslation } from 'react-i18next';

import { formatDate } from '@/lib/dates';
import { SectionCard } from '@/components/patterns/page';
import { updateText } from './updateText';

/**
 * Request Updates on screen — P6 (`IMPLEMENTATION_PLAN.md` §64.6),
 * REQ-REQUEST-017. Informational, and styled to stay quieter than Action
 * Needed (`ActionsNeeded.jsx`): muted text, never a solid chip, never a button.
 */

/** A list row's updates: the newest in words, and how many more. */
export function UpdateLines({ updates, department }) {
  const { t } = useTranslation();
  const events = updates?.events ?? [];
  if (events.length === 0) return <span className="text-muted-foreground">—</span>;
  const more = (updates.total ?? events.length) - 1;
  return (
    <span className="text-xs text-muted-foreground">
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-neutral-400 align-middle" />
      {updateText(t, events[0], { department })}
      {more > 0 ? (
        <span className="ml-1">{t('requests.updates.more', { count: more })}</span>
      ) : null}
    </span>
  );
}

/**
 * "Since your last view" on the request page: every unseen update, newest
 * first. The page keeps what it first loaded, so the list stays while you are
 * on the page even though the page marks the request seen.
 */
export function SinceLastView({ unseen, department }) {
  const { t } = useTranslation();
  const events = unseen?.events ?? [];
  if (events.length === 0) return null;
  return (
    <SectionCard
      title={t('requests.updates.sinceTitle')}
      description={t('requests.updates.sinceDescription', {
        date: formatDate(String(unseen.since).slice(0, 10)),
      })}
    >
      <ul className="space-y-1 text-sm" data-testid="since-last-view">
        {events.map((event, index) => (
          <li key={`${event.kind}-${index}`} className="flex flex-wrap justify-between gap-2">
            <span>{updateText(t, event, { department })}</span>
            <span className="text-xs text-muted-foreground">
              {formatDate(String(event.at).slice(0, 10))}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
