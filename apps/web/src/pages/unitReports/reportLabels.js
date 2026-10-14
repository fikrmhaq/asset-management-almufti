/**
 * Shared wording for unit reports — REQ-REQUEST-025. One sentence for what a
 * report says, the same on the reporter's and the reviewer's screens.
 */

export const REPORT_KINDS = ['CONDITION', 'MOVEMENT', 'OBSERVATION'];

export const REPORT_STATUS_VARIANT = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  REJECTED: 'neutral',
};

/** "Condition: Damaged — Layar retak", "Moved to Lab — …", "Observation — …". */
export function reportWhat(t, report) {
  let head = t(`unitReports.kinds.${report.kind}`);
  if (report.kind === 'CONDITION' && report.reportedCondition) {
    head = t('unitReports.what.condition', {
      condition: t(`enums.condition.${report.reportedCondition}`),
    });
  } else if (report.kind === 'MOVEMENT' && report.destination) {
    head = t('unitReports.what.movement', { name: report.destination.name });
  }
  return `${head} — ${report.narrative}`;
}
