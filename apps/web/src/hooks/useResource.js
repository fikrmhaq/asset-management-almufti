import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidateResources } from '@/lib/queryClient';
import { t } from '@/i18n';
import { toast } from '@/components/ui/toast';

/**
 * Query and mutation hooks for a CRUD resource — `IMPLEMENTATION_PLAN.md` §17,
 * §15.3.
 *
 * Binds three things that must agree and are easy to get subtly wrong
 * separately: the endpoint, the cache key, and what a successful write
 * invalidates. Every mutation invalidates the resource's whole key prefix, so a
 * create or a deactivate refreshes the list AND the detail without a screen
 * having to enumerate which filtered pages might contain the record.
 *
 * What it deliberately does NOT do: validation, permission checks, or response
 * reshaping. Those are resource-specific and stay visible in the screen that
 * owns them.
 *
 * A `VALIDATION_ERROR` is not toasted — it belongs inline against the offending
 * field (`07-ui.md` §4.3), and `toast.fromError` already declines to duplicate
 * it. Everything else (a `CONFLICT` on deactivating an already-inactive record,
 * a `FORBIDDEN`) is shown, since there is no field to attach it to.
 */
/**
 * @param {object} spec
 * @param {string} spec.labelKey
 *   Translation key for the resource name, resolved at mutation time rather
 *   than at module load: these hooks are built while the module graph is
 *   evaluated, long before a language is chosen, and a label captured then would
 *   never change again.
 */
export function createResourceHooks({ api, keys, labelKey }) {
  const label = () => t(labelKey);

  function useInvalidate() {
    const queryClient = useQueryClient();
    return () => invalidateResources(queryClient, keys);
  }

  function useList(params = {}, options = {}) {
    return useQuery({
      queryKey: keys.list(params),
      queryFn: () => api.list(params),
      ...options,
    });
  }

  function useDetail(id, options = {}) {
    return useQuery({
      queryKey: keys.detail(id),
      queryFn: () => api.get(id),
      enabled: Boolean(id),
      ...options,
    });
  }

  function useCreate() {
    const invalidate = useInvalidate();

    return useMutation({
      mutationFn: (body) => api.create(body),
      onSuccess: async () => {
        await invalidate();
        toast.success(t('common.toast.created', { label: label() }));
      },
      onError: (error) => toast.fromError(error),
    });
  }

  function useUpdate() {
    const invalidate = useInvalidate();

    return useMutation({
      mutationFn: ({ id, ...body }) => api.update(id, body),
      onSuccess: async () => {
        await invalidate();
        toast.success(t('common.toast.updated', { label: label() }));
      },
      onError: (error) => toast.fromError(error),
    });
  }

  /** Deactivate/reactivate — `06-api.md` §1.7. */
  function useSetActive() {
    const invalidate = useInvalidate();

    return useMutation({
      mutationFn: ({ id, active }) => api.setActive(id, active),
      onSuccess: async (_data, variables) => {
        await invalidate();
        toast.success(
          t(variables.active ? 'common.toast.reactivated' : 'common.toast.deactivated', {
            label: label(),
          })
        );
      },
      onError: (error) => toast.fromError(error),
    });
  }

  /** Hard delete — only for the resources that actually have one (§4.4, roles). */
  function useRemove() {
    const invalidate = useInvalidate();

    return useMutation({
      mutationFn: (id) => api.remove(id),
      onSuccess: async () => {
        await invalidate();
        toast.success(t('common.toast.deleted', { label: label() }));
      },
      onError: (error) => toast.fromError(error),
    });
  }

  return { useList, useDetail, useCreate, useUpdate, useSetActive, useRemove, keys, api, labelKey };
}
