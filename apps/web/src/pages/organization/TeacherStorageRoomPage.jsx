import { useTranslation } from 'react-i18next';

import { useSession } from '@/auth/useSession';
import { EmptyState } from '@/components/ui/states';
import { DetailPage } from '@/components/patterns/page';
import { TeacherStorageRoomPanel } from '@/components/organization/TeacherStorageRoomPanel';

/**
 * The Teacher Storage Room of the caller's OWN institution — REQ-REQUEST-023.
 *
 * Exists for the same reason as `InventoryCodeFormatPage`: an institution
 * administrator cannot hold `institution:read` (`BR-015`), so the institution
 * detail page — where a system-wide user configures it — is unreachable to them.
 */
export function TeacherStorageRoomPage() {
  const { t } = useTranslation();
  const { user } = useSession();

  const institutionId = user?.institutionId ?? null;

  return (
    <DetailPage
      title={t('organization.teacherStorageRoom.title')}
      description={t('organization.teacherStorageRoom.description')}
    >
      {institutionId ? (
        <TeacherStorageRoomPanel institutionId={institutionId} />
      ) : (
        <EmptyState
          title={t('organization.teacherStorageRoom.noInstitutionTitle')}
          description={t('organization.teacherStorageRoom.noInstitutionDescription')}
        />
      )}
    </DetailPage>
  );
}
