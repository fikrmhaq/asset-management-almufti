import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { REPORT_STATUS_VARIANT } from './reportLabels';

/** A unit report's status — REQ-REQUEST-025. */
export function ReportStatusBadge({ status }) {
  const { t } = useTranslation();
  return (
    <Badge variant={REPORT_STATUS_VARIANT[status] ?? 'neutral'}>
      {t(`unitReports.statuses.${status}`)}
    </Badge>
  );
}
