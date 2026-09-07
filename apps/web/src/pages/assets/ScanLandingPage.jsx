import { useParams, useSearchParams, Navigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ScanLine } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { assetUnitsApi } from '@/api/assetCore';
import { usePermission } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ListPage } from '@/components/patterns/page';

/**
 * Where a scanned label lands — `07-ui.md` §5.3, REQ-UNIT-011.
 *
 * The QR encodes `/u?c={inventoryCode}`; this resolves that code and forwards to
 * the unit's detail page. It exists as its own route rather than as a parameter
 * on the unit page because the scanner knows only the printed code — it has no
 * idea what the unit's internal id is, and the label cannot carry one that stays
 * correct.
 *
 * TWO SHAPES, ONE SCREEN (`CR-008`). Codes may now contain a slash, which cannot
 * survive a path segment, so new labels carry the code in the query string. The
 * `/u/:inventoryCode` route it replaced still resolves, because the labels
 * printed under it are on physical items and cannot be recalled. Whichever way
 * the code arrives, everything below it is identical.
 *
 * BEHIND THE SAME GATE AS EVERYTHING ELSE. It sits inside the protected tree, so
 * an unauthenticated scan is bounced to the login screen and returned here
 * afterwards by the existing guard, which already carries `from` in the
 * navigation state. Anyone can point a phone at a sticker; that is precisely why
 * this shows nothing without a session that reaches the record.
 *
 * A code that resolves to nothing and a code belonging to another institution
 * are the same answer (`BR-007`) — a `404`. The not-found state names the code
 * so a user can tell a mis-scan from a label for a record they cannot reach,
 * which is the one distinction worth making to them.
 */
export function ScanLandingPage() {
  const { t } = useTranslation();
  const params = useParams();
  const [search] = useSearchParams();

  // The query form first: it is the one a label minted today carries, and the
  // path form is only ever reached when there is no query to read.
  const inventoryCode = search.get('c') ?? params.inventoryCode ?? '';

  /**
   * Where "keep looking" should go — `CR-005` §6.
   *
   * This used to point unconditionally at `/assets`, which is reachable only
   * with `asset:read`. Anyone can arrive here on `asset-unit:read` alone, so a
   * Department PIC who mis-scanned a label was sent straight into
   * `ForbiddenPage` — a dead end at the exact moment they were trying to find
   * something.
   *
   * Chosen from the effective permission set rather than by testing for a tier:
   * the question is "which list can this caller actually open?", and any future
   * role with the same permissions gets the right answer for free.
   */
  const canReadAssets = usePermission('asset:read');
  const browseTo = canReadAssets ? '/assets' : '/asset-units';

  /**
   * `/u` with nothing to look up is a mis-scan, not a request to make. It is
   * reachable — a QR read that dropped the query string lands exactly here — so
   * it answers with the same not-found state rather than sending the server an
   * empty code it would refuse.
   */
  const hasCode = inventoryCode.length > 0;

  const query = useQuery({
    queryKey: queryKeys.assetUnits.sub(inventoryCode, 'by-code'),
    queryFn: () => assetUnitsApi.byCode(inventoryCode),
    enabled: hasCode,
    retry: false,
  });

  if (query.isSuccess) {
    return <Navigate to={`/assets/${query.data.assetId}/units/${query.data.id}`} replace />;
  }

  return (
    <ListPage
      title={t('assets.scan.title')}
      /* Only while the lookup is in flight. Leaving "Looking up…" on screen
         after it has failed states something untrue, and repeats the code the
         empty state below is already showing. */
      description={query.isLoading ? t('assets.scan.description', { code: inventoryCode }) : null}
      surface={false}
    >
      {query.isLoading ? (
        <LoadingState variant="detail" rows={2} label={t('assets.scan.resolving')} />
      ) : !hasCode || query.error?.code === 'NOT_FOUND' ? (
        // Not an error state: the scan worked, the code simply names nothing
        // this user can reach. A red alert would suggest the application broke.
        <EmptyState
          icon={ScanLine}
          title={t('assets.scan.notFoundTitle')}
          description={t('assets.scan.notFoundDescription', { code: inventoryCode })}
          action={
            <Button asChild variant="outline">
              <Link to={browseTo}>
                {canReadAssets ? t('assets.scan.browseAssets') : t('assets.scan.browseUnits')}
              </Link>
            </Button>
          }
        />
      ) : (
        <ErrorState error={query.error} onRetry={query.refetch} />
      )}
    </ListPage>
  );
}
