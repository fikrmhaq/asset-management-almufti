import { contextLabel } from './requestLabels';

/**
 * One request update in words — P6 (`IMPLEMENTATION_PLAN.md` §64.6). The
 * server says what happened (`kind`, `detail`, `extra`, `count`, `by`); this
 * only names it, in the reader's language. Always says what changed and who
 * did it — never a bare "something changed".
 *
 * @param {object} event one of `updates.events` / `unseenUpdates.events`
 * @param {{department?: object}} [context] the request's department, for a
 *   department-bound position ("Kajur — TKJ")
 */
export function updateText(t, event, { department } = {}) {
  const person = event.by;
  const name =
    (person && `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim()) ||
    person?.username ||
    t('requests.updates.someone');
  const key = (suffix) => `requests.updates.events.${suffix}`;

  switch (event.kind) {
    case 'STEP_DECIDED':
      return t(key(`STEP_DECIDED_${event.detail}`), {
        name,
        position: contextLabel(t, event.extra, department),
      });
    case 'DOCUMENT_ADDED':
      return t(key('DOCUMENT_ADDED'), {
        name,
        type: t(`requests.documents.types.${event.detail}`, { defaultValue: event.detail }),
      });
    case 'REMAINDER_CLOSED':
      return t(key('REMAINDER_CLOSED'), { name, reason: event.extra ?? '' });
    case 'REQUEST_ENDED':
      return t(key('REQUEST_ENDED'), {
        name,
        status: t(`requests.statuses.${event.detail}`).toLowerCase(),
      });
    default:
      return t(key(event.kind), { name, count: event.count ?? 1 });
  }
}
