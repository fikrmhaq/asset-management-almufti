import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/auth/useSession';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { SectionCard } from '@/components/patterns/page';
import { FormErrorSummary } from '@/components/form/field';
import { LocationSelector } from '@/components/location/LocationSelector';
import { useSetTeacherStorageRoom, useTeacherStorageRoom } from '@/hooks/useTeacherStorageRoom';

/**
 * The Teacher Storage Room — REQ-REQUEST-023, `07-ui.md` §5.1. One Location of
 * this institution, shared by all teachers: the default intended location a new
 * request proposes to a teacher who is no Location PIC. Only future defaults
 * change; nothing already requested, received or placed is touched.
 *
 * Choosing a room needs `location:read` as well (the picker browses locations);
 * without it the current room is shown read-only.
 */
export function TeacherStorageRoomPanel({ institutionId }) {
  const { t } = useTranslation();
  const query = useTeacherStorageRoom(institutionId);
  const save = useSetTeacherStorageRoom(institutionId);
  const canUpdate = usePermission('teacher-storage-room:update');
  const canBrowse = usePermission('location:read');

  const current = query.data?.location ?? null;
  const [locationId, setLocationId] = useState(null);
  useEffect(() => setLocationId(current?.id ?? null), [current?.id]);

  if (query.isLoading) return <LoadingState variant="form" rows={2} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const editable = canUpdate && canBrowse;
  const isDirty = (locationId ?? null) !== (current?.id ?? null);

  return (
    <SectionCard
      title={t('organization.teacherStorageRoom.title')}
      description={t('organization.teacherStorageRoom.description')}
    >
      <div className="max-w-xl space-y-4">
        <FormErrorSummary error={save.error} />
        {save.error?.details?.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
            {save.error.details.map((detail) => (
              <li key={`${detail.field}-${detail.issue}`}>{detail.issue}</li>
            ))}
          </ul>
        ) : null}

        {editable ? (
          <LocationSelector
            value={locationId}
            allowClear
            placeholder={t('organization.teacherStorageRoom.none')}
            onChange={(next) => setLocationId(next ?? null)}
          />
        ) : (
          <p className="text-sm" data-testid="teacher-storage-room-current">
            {current?.name ?? t('organization.teacherStorageRoom.none')}
          </p>
        )}

        {current && !current.isActive ? (
          <Alert variant="warning" size="sm">
            {t('organization.teacherStorageRoom.inactive', { name: current.name })}
          </Alert>
        ) : null}

        <Alert variant="info" size="sm">
          {t('organization.teacherStorageRoom.futureOnly')}
        </Alert>

        {canUpdate && !canBrowse ? (
          <p className="text-sm text-muted-foreground">
            {t('organization.teacherStorageRoom.needsLocationRead')}
          </p>
        ) : null}

        {editable ? (
          <div className="flex justify-end">
            <Button
              type="button"
              loading={save.isPending}
              disabled={!isDirty}
              onClick={() => save.mutateAsync(locationId ?? null).catch(() => undefined)}
            >
              {t('common.actions.saveChanges')}
            </Button>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
