import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { institutionsApi } from '@/api/organization';
import { queryKeys } from '@/lib/queryKeys';
import { t } from '@/i18n';
import { toast } from '@/components/ui/toast';

/**
 * An institution's Teacher Storage Room — REQ-REQUEST-023. One value on one
 * institution, like the inventory code format, so bespoke hooks rather than the
 * CRUD factory. A `VALIDATION_ERROR` is shown against the panel, not toasted.
 */

const roomKey = (id) => queryKeys.institutions.sub(id, 'teacher-storage-room');

export function useTeacherStorageRoom(institutionId) {
  return useQuery({
    queryKey: roomKey(institutionId),
    queryFn: () => institutionsApi.teacherStorageRoom(institutionId),
    enabled: Boolean(institutionId),
  });
}

export function useSetTeacherStorageRoom(institutionId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (locationId) => institutionsApi.setTeacherStorageRoom(institutionId, locationId),
    onSuccess: async (data) => {
      queryClient.setQueryData(roomKey(institutionId), data);
      // The request form's default reads it through the guidance.
      await queryClient.invalidateQueries({ queryKey: ['request-guidance'] });
      toast.success(t('organization.teacherStorageRoom.saved'));
    },
    onError: (error) => toast.fromError(error),
  });
}
