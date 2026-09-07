import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/numbers';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import {
  DetailField,
  DetailFieldList,
  DetailPage,
  DetailTabs,
  SectionCard,
} from '@/components/patterns/page';
import { ContractItemsPanel } from './ContractItemsPanel';
import { contracts } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Contract detail — `07-ui.md` §5.5, `IMPLEMENTATION_PLAN.md` §19.3;
 * REQ-PROC-002/003/004/005.
 *
 * Details plus the editable line-item sub-table §5.5 asks for. Editing the
 * contract itself is a full page on its own route (`DEC-033`), so this page has
 * no form.
 *
 * The detail response resolves supplier, contract type, funding source and
 * institution (`06-api.md` §6.2), so — unlike the list (`DEC-037`) — nothing
 * here needs a lookup map.
 *
 * The Assets link is traceability, not a report: `?contractId=` is a documented
 * asset filter and the assets list already forwards it to the API (`DEC-038`).
 * The cross-contract report is Phase 15's (`GAP-002`).
 */
export function ContractDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const query = contracts.useDetail(id);
  const setActive = contracts.useSetActive();
  const canReadItems = usePermission('contract-item:read');
  const canReadAssets = usePermission('asset:read');
  const [confirming, setConfirming] = useState(false);

  const contract = query.data;

  if (query.isLoading) return <LoadingState variant="detail" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const detailsTab = (
    <SectionCard title={t('procurement.detail.information')}>
      <DetailFieldList>
        <DetailField label={t('procurement.detail.contractNumber')}>
          {contract.contractNumber}
        </DetailField>
        <DetailField label={t('procurement.detail.supplier')}>
          {contract.supplier ? (
            <Link to={`/procurement/suppliers/${contract.supplier.id}`} className="hover:underline">
              {contract.supplier.name}
            </Link>
          ) : null}
        </DetailField>
        <DetailField label={t('procurement.detail.contractType')}>
          {contract.contractType?.name}
        </DetailField>
        <DetailField label={t('procurement.detail.contractDate')}>
          {formatDate(contract.contractDate) || null}
        </DetailField>
        <DetailField label={t('procurement.detail.contractValue')}>
          {formatMoney(contract.contractValue) || null}
        </DetailField>
        <DetailField label={t('procurement.detail.fundingSource')}>
          {contract.fundingSource?.name}
        </DetailField>
        <DetailField label={t('procurement.detail.accountCode')}>
          {contract.accountCode ? (
            <span className="font-mono text-xs">{contract.accountCode}</span>
          ) : null}
        </DetailField>
        <DetailField label={t('common.fields.institution')}>
          {contract.institution?.name}
        </DetailField>
        <DetailField label={t('procurement.detail.receivingDocument')}>
          {contract.receivingDocument}
        </DetailField>
        <DetailField label={t('procurement.detail.receivingDate')}>
          {formatDate(contract.receivingDate) || null}
        </DetailField>
        <DetailField label={t('common.fields.notes')} className="sm:col-span-2">
          {contract.notes}
        </DetailField>

        {/* Traceability the other way round from the asset's own procurement
            line (REQ-ASSET-011): everything acquired under this contract. */}
        {canReadAssets ? (
          <DetailField label={t('procurement.detail.assets')}>
            <Link to={`/assets?contractId=${id}`} className="hover:underline">
              Assets from this contract
            </Link>
          </DetailField>
        ) : null}
      </DetailFieldList>
    </SectionCard>
  );

  return (
    <DetailPage
      title={contract.contractNumber}
      description={contract.supplier?.name}
      badge={<StatusBadge value={contract.isActive ? 'active' : 'inactive'} />}
      actions={
        <>
          <Can code="contract:update">
            <Button asChild variant="outline">
              <Link to={`/procurement/contracts/${id}/edit`}>Edit</Link>
            </Button>
          </Can>
          <Can code="contract:deactivate">
            <Button
              variant={contract.isActive ? 'outline' : 'default'}
              onClick={() => setConfirming(true)}
            >
              {contract.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </Can>
        </>
      }
    >
      <DetailTabs
        tabs={[
          { value: 'details', label: 'Details', content: detailsTab },
          ...(canReadItems
            ? [
                {
                  value: 'items',
                  label: 'Line items',
                  content: <ContractItemsPanel contractId={id} />,
                },
              ]
            : []),
        ]}
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={contract.isActive ? 'Deactivate this contract?' : 'Reactivate this contract?'}
        description={
          contract.isActive
            ? 'Its line items, and the assets traced back to them, are untouched.'
            : 'It becomes selectable again for new records.'
        }
        confirmLabel={contract.isActive ? 'Deactivate' : 'Reactivate'}
        loading={setActive.isPending}
        onConfirm={async () => {
          await setActive.mutateAsync({ id, active: !contract.isActive }).catch(() => undefined);
          setConfirming(false);
        }}
      />
    </DetailPage>
  );
}
