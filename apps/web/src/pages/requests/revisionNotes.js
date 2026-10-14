/**
 * REQ-REQUEST-018: the notes the CURRENT revision makes on one item — shown
 * against its line while the request is returned. Earlier rounds' notes are
 * history (`EarlierRounds`), never shown as current.
 */
export function itemRevisionNotes(request, itemId) {
  if (request.status !== 'REVISION_REQUESTED' || !request.revision) return [];
  return request.revision.itemNotes.filter((note) => note.requestItemId === itemId);
}
