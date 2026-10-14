import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { requestsApi } from '@/api/requests';
import { Can } from '@/auth/guards';
import { useListParams } from '@/hooks/useListParams';
import { formatDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ListPage } from '@/components/patterns/page';
import { categoryLabel, contextLabel, STATUS_VARIANT } from './requestLabels';
import { ActionChips } from './ActionsNeeded';
import { UpdateLines } from './RequestUpdates';

/**
 * Requests list — Phase 37 (`CR-014`), `07-ui.md` §5.10, REQ-REQUEST-015.
 *
 * `mine` lists the caller's own requests. `all` is the oversight view: the
 * caller's own plus every SUBMITTED-or-later request of their institution. A
 * DRAFT is private to its requester and never appears here for anyone else
 * (Phase 37 decision E1) — the server applies that; the screen only asks.
 *
 * Progress (received / required) is not shown: nothing is registered or
 * received before Phases 40–41 (decision E5).
 */
/**
 * The three views (`07-ui.md` §5.10):
 *   mine      the caller's own;
 *   awaiting  ACTIVE steps the caller currently resolves as actor of AND holds the
 *             step's permission for (Phase 38, decision F6) — never through
 *             oversight;
 *   all       everything the caller may see.
 */
const SCOPE_PARAMS = {
  mine: { mine: 'true' },
  awaiting: { awaiting: 'me' },
  // P6 (§64.6): involved requests with an unseen update.
  updates: { updated: 'me' },
  all: {},
};

export function RequestsPage({ scope = 'mine' }) {
  const { t } = useTranslation();
  const { params, setPage } = useListParams();

  const query = useQuery({
    queryKey: ['requests', scope, params],
    queryFn: () => requestsApi.list({ ...params, ...SCOPE_PARAMS[scope] }),
  });

  const rows = query.data?.data ?? [];

  return (
    <ListPage
      title={t(`requests.${scope}Title`)}
      description={t(`requests.${scope}Description`)}
      actions={
        <Can code="request:create">
          <Button asChild>
            <Link to="/requests/new">{t('requests.new')}</Link>
          </Button>
        </Can>
      }
      meta={query.data?.meta}
      onPageChange={setPage}
    >
      {query.isLoading ? (
        <LoadingState rows={5} columns={8} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('requests.empty')} description={t('requests.emptyDescription')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('requests.number')}</TableHead>
              <TableHead>{t('requests.titleField')}</TableHead>
              {/* P5 (§64.5): what the row needs of you — on every list. */}
              <TableHead>{t('requests.actionsNeeded.column')}</TableHead>
              {/* P6 (§64.6): what changed — kept apart from the action. */}
              <TableHead>{t('requests.updates.column')}</TableHead>
              <TableHead>{t('requests.category')}</TableHead>
              <TableHead>{t('requests.requestedAs')}</TableHead>
              <TableHead>{t('requests.department')}</TableHead>
              <TableHead>{t('requests.status')}</TableHead>
              <TableHead>{t('requests.received')}</TableHead>
              <TableHead>{t('requests.created')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    to={`/requests/${row.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {row.requestNumber}
                  </Link>
                </TableCell>
                <TableCell>{row.title}</TableCell>
                <TableCell data-testid={`actions-needed-${row.id}`}>
                  <ActionChips needed={row.actionsNeeded} />
                </TableCell>
                <TableCell data-testid={`updates-${row.id}`}>
                  <UpdateLines updates={row.updates} department={row.department} />
                </TableCell>
                <TableCell>{categoryLabel(t, row.category)}</TableCell>
                <TableCell>
                  {contextLabel(t, row.requesterPositionCode, row.requesterDepartment)}
                  {scope !== 'mine' && row.requester ? (
                    <span className="block text-xs text-muted-foreground">
                      {`${row.requester.firstName} ${row.requester.lastName}`.trim()}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{row.department?.name ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[row.status]}>
                    {t(`requests.statuses.${row.status}`)}
                  </Badge>
                </TableCell>
                {/* Phase 41 (D41-6): receipts only — never registration. */}
                <TableCell>
                  {row.status === 'DRAFT'
                    ? '—'
                    : `${row.quantityReceived ?? 0} / ${row.quantityRequired ?? 0}`}
                </TableCell>
                <TableCell>{formatDate(String(row.createdAt).slice(0, 10))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPage>
  );
}
