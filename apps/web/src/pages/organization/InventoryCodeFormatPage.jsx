import { useTranslation } from 'react-i18next';

import { useSession } from '@/auth/useSession';
import { EmptyState } from '@/components/ui/states';
import { DetailPage } from '@/components/patterns/page';
import { InventoryCodeFormatBuilder } from '@/components/organization/InventoryCodeFormatBuilder';

/**
 * The inventory code format for the caller's OWN institution — Phase 25
 * (`CR-006`), REQ-ORG-007, `07-ui.md` §5.1.
 *
 * THIS SCREEN EXISTS BECAUSE OF `BR-015`. An institution administrator cannot
 * hold `institution:read`, which is system-wide-only, so `/organization/institutions`
 * and the detail page behind it are unreachable for them — and that page is
 * where a system-wide user configures the format. Without this route the feature
 * would be visible only to the tier that needs it least.
 *
 * The institution comes from the session profile rather than a picker: there is
 * exactly one it could be, and offering a choice would imply otherwise. A
 * system-wide user has no `institutionId` and belongs on the institution detail
 * page, where they can say which institution they mean — so they are told that
 * here rather than shown an empty builder.
 */
export function InventoryCodeFormatPage() {
  const { t } = useTranslation();
  const { user } = useSession();

  const institutionId = user?.institutionId ?? null;

  return (
    <DetailPage
      title={t('organization.inventoryCodeFormat.title')}
      description={t('organization.inventoryCodeFormat.pageDescription')}
    >
      {institutionId ? (
        <InventoryCodeFormatBuilder institutionId={institutionId} />
      ) : (
        <EmptyState
          title={t('organization.inventoryCodeFormat.noInstitutionTitle')}
          description={t('organization.inventoryCodeFormat.noInstitutionDescription')}
        />
      )}
    </DetailPage>
  );
}
