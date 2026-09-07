import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import { assetsApi, assetUnitsApi } from '@/api/assetCore';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ListPage } from '@/components/patterns/page';
import { UnitLabelSheet } from '@/components/asset/UnitLabel';

/**
 * Printable labels — `07-ui.md` §5.3, REQ-UNIT-009/010.
 *
 * A ROUTE, NOT A DIALOG. A dialog cannot be printed on its own: `window.print()`
 * from inside one prints the page behind it, and the browser's own print
 * preview has no way to isolate a modal. A route can hide the application shell
 * in `@media print` and put nothing but labels on the paper.
 *
 * One component serves both the single-unit and whole-asset cases, because the
 * only difference is how many labels come back — the sheet, the stylesheet and
 * the print button are identical, and two pages would drift.
 */
export function UnitLabelsPage() {
  const { t } = useTranslation();
  const { id: assetId, unitId } = useParams();

  // `unitId` present → one label. Absent → every unit of the asset.
  const single = Boolean(unitId);

  const query = useQuery({
    queryKey: single
      ? queryKeys.assetUnits.sub(unitId, 'label')
      : queryKeys.assets.sub(assetId, 'unit-labels'),
    queryFn: async () =>
      single ? [await assetUnitsApi.label(unitId)] : (await assetsApi.unitLabels(assetId)).data,
  });

  const labels = query.data ?? [];

  return (
    <ListPage
      title={t('assets.label.title')}
      description={t(single ? 'assets.label.descriptionOne' : 'assets.label.descriptionMany')}
      actions={
        labels.length > 0 ? (
          <Button className="no-print" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {t('assets.label.print')}
          </Button>
        ) : null
      }
      surface={false}
    >
      {query.isLoading ? (
        <LoadingState variant="list" rows={4} />
      ) : query.isError ? (
        /* Covers the documented refusal as well as a transport failure: a unit
           whose asset has no institution has no code to print, and the server
           says so in a field message rather than returning an empty label. */
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : labels.length === 0 ? (
        <EmptyState
          title={t('assets.label.emptyTitle')}
          description={t('assets.label.emptyDescription')}
        />
      ) : (
        <div className="print-sheet">
          <UnitLabelSheet labels={labels} />
        </div>
      )}
    </ListPage>
  );
}
