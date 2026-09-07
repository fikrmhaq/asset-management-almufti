import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Pencil, Plus, Trash2 } from 'lucide-react';

import { classificationsApi } from '@/api/reference';
import { usePermission, useSession } from '@/auth/useSession';
import { invalidateResources } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { DetailField, DetailFieldList, ListPage, SectionCard } from '@/components/patterns/page';
import { ClassificationPicker } from '@/components/reference/ClassificationPicker';
import { categories, institutions } from '../organization/resources';

/**
 * Classification browser and management — `07-ui.md` §5.2.
 *
 * The hierarchy is government reference data and most of it is read-only. Phase
 * 17 (`CR-001`) opened one seam: institutions may register leaf classifications
 * the catalogue does not cover. So this page is a browser with management
 * layered on, not a CRUD table — the tree is still the navigation.
 *
 * WHERE THE CONTROLS APPEAR IS THE TEACHING. Add shows up only on a node that
 * accepts children (`acceptsChildren`, REQ-CLASS-012); Rename and Delete only on
 * nodes the application defined (`isAppDefined`, `BR-016`). Absent rather than
 * disabled-with-an-error: the drill-down itself shows where additions belong,
 * and a control that always fails teaches nothing.
 *
 * Both flags are computed by the server so the code scheme and the provenance
 * rule live in exactly one place.
 *
 * The browsing reuses the shared picker rather than a second drill-down
 * implementation — `07-ui.md` §4.5 is explicit that there is one.
 *
 * NAMES, NOT KEYS. The parent and the category are stored as a `CHAR(12)` code
 * and an integer, and printing either on its own tells the reader nothing. Both
 * are resolved through endpoints this application already calls. The code stays
 * visible beside the name — it is the natural key, and people do quote it.
 */

/** The parent's own record, for its name. One request, and only when there is one. */
function useParent(parentId) {
  return useQuery({
    queryKey: queryKeys.classifications.detail(parentId),
    queryFn: () => classificationsApi.get(parentId),
    enabled: Boolean(parentId),
  });
}

/**
 * The write hooks.
 *
 * Not `createResourceHooks`: this resource's verbs are add/rename/delete/promote
 * rather than the generic create/update/deactivate set, and `promote` has no
 * counterpart at all. The invalidation and error handling follow the same
 * conventions — a `VALIDATION_ERROR` stays inline, everything else is toasted.
 */
function useClassificationMutations(onDone) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const invalidate = () => invalidateResources(queryClient, queryKeys.classifications);

  const settle = async (messageKey) => {
    await invalidate();
    toast.success(t(messageKey));
    onDone?.();
  };

  return {
    create: useMutation({
      mutationFn: (body) => classificationsApi.create(body),
      onSuccess: () => settle('reference.classifications.manage.created'),
      onError: (error) => toast.fromError(error),
    }),
    rename: useMutation({
      mutationFn: ({ id, name }) => classificationsApi.rename(id, { name }),
      onSuccess: () => settle('reference.classifications.manage.renamed'),
      onError: (error) => toast.fromError(error),
    }),
    remove: useMutation({
      mutationFn: (id) => classificationsApi.remove(id),
      onSuccess: () => settle('reference.classifications.manage.deleted'),
      onError: (error) => toast.fromError(error),
    }),
    promote: useMutation({
      mutationFn: (id) => classificationsApi.promote(id),
      onSuccess: () => settle('reference.classifications.manage.promoted'),
      onError: (error) => toast.fromError(error),
    }),
  };
}

/** Add or rename. One dialog: both ask for a name, and only creation asks for an owner. */
function NameDialog({ open, onOpenChange, mode, parentName, onSubmit, pending, canChooseOwner }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('mine');

  // Reset whenever the dialog opens so a cancelled edit does not linger.
  const handleOpenChange = (next) => {
    if (next) {
      setName('');
      setOwner('mine');
    }
    onOpenChange(next);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), owner });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {mode === 'create'
                ? t('reference.classifications.manage.addTitle')
                : t('reference.classifications.manage.renameTitle')}
            </DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? t('reference.classifications.manage.addDescription', { parent: parentName })
                : t('reference.classifications.manage.renameDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label htmlFor="classification-name" className="text-sm font-medium">
                {t('reference.classifications.manage.nameLabel')}
              </label>
              <Input
                id="classification-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={255}
                autoFocus
              />
            </div>

            {/* Only on creation, and only for a caller who may create a global
                node. Everyone else's addition belongs to their institution and
                there is nothing to choose. */}
            {mode === 'create' && canChooseOwner ? (
              <div className="space-y-1.5">
                <label htmlFor="classification-owner" className="text-sm font-medium">
                  {t('reference.classifications.manage.ownerLabel')}
                </label>
                <NativeSelect
                  id="classification-owner"
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                >
                  <option value="global">
                    {t('reference.classifications.manage.ownerGlobal')}
                  </option>
                  <option value="mine">{t('reference.classifications.manage.ownerMine')}</option>
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  {t('reference.classifications.manage.ownerHint')}
                </p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {t('common.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Global / owned-by-an-institution, shown wherever the distinction matters. */
function OwnerBadge({ node, institutionName }) {
  const { t } = useTranslation();

  if (!node.isAppDefined) return null;

  return node.institutionId ? (
    <Badge variant="outline">
      {institutionName ?? t('reference.classifications.manage.ownedByInstitution')}
    </Badge>
  ) : (
    <Badge variant="neutral">{t('reference.classifications.manage.global')}</Badge>
  );
}

export function ClassificationsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const [selectedId, setSelectedId] = useState(null);
  const [picking, setPicking] = useState(false);
  const [dialog, setDialog] = useState(null);

  const canCreate = usePermission('classification:create');
  const canUpdate = usePermission('classification:update');
  const canDelete = usePermission('classification:delete');
  const canPromote = usePermission('classification:promote');
  const isSystemWide = Boolean(session.user?.isSystemWide);

  const detail = useQuery({
    queryKey: queryKeys.classifications.detail(selectedId),
    queryFn: () => classificationsApi.get(selectedId),
    enabled: Boolean(selectedId),
  });

  const attributes = useQuery({
    queryKey: queryKeys.classifications.sub(selectedId, 'attribute-definitions'),
    queryFn: () => classificationsApi.attributeDefinitions(selectedId),
    enabled: Boolean(selectedId),
  });

  const parent = useParent(detail.data?.parentId ?? null);

  /* Categories are a separate resource behind their own permission (`07-ui.md`
     §6), so the name is looked up only when the reader may read them — and only
     when the classification on screen actually carries one, which is why an
     unselected page and a category-less node fire no request at all. The stored
     id still shows either way. */
  const canReadCategories = usePermission('category:read');
  const categoryList = categories.useList(
    { pageSize: 100 },
    { enabled: canReadCategories && Boolean(detail.data?.categoryId) }
  );
  const categoryName = (id) =>
    (categoryList.data?.data ?? []).find((category) => String(category.id) === String(id))?.name;

  /* Owning institution, for the badge. Only a system-wide reader can see nodes
     belonging to an institution other than their own, so only they need the
     list — for everyone else the owner is, by definition, their own. */
  const canReadInstitutions = usePermission('institution:read');
  const institutionList = institutions.useList(
    { pageSize: 100 },
    { enabled: canReadInstitutions && isSystemWide && Boolean(detail.data?.institutionId) }
  );
  const institutionName = (id) =>
    (institutionList.data?.data ?? []).find((row) => row.id === id)?.name;

  const mutations = useClassificationMutations(() => {
    setDialog(null);
    detail.refetch();
  });

  const node = detail.data;
  // `acceptsChildren` and `isAppDefined` come from the server so the code scheme
  // (REQ-CLASS-012) and the provenance rule (`BR-016`) are never re-derived here.
  const showAdd = canCreate && node?.acceptsChildren;
  const showRename = canUpdate && node?.isAppDefined;
  const showDelete = canDelete && node?.isAppDefined;
  const showPromote = canPromote && isSystemWide && node?.isAppDefined && node?.institutionId;

  const submitName = ({ name, owner }) => {
    if (dialog === 'create') {
      mutations.create.mutate({
        parentId: node.id,
        name,
        // `null` means global; omitting the field means "my institution".
        ...(isSystemWide && owner === 'global' ? { institutionId: null } : {}),
      });
    } else {
      mutations.rename.mutate({ id: node.id, name });
    }
  };

  const browse = (
    <Button variant={selectedId ? 'outline' : 'default'} onClick={() => setPicking(true)}>
      {t('reference.classifications.browse')}
    </Button>
  );

  return (
    <ListPage
      title={t('reference.classifications.title')}
      description={t('reference.classifications.description')}
      actions={browse}
      /* This page supplies its own `SectionCard`s. Without this it nested one
         white panel inside another and drew a doubled border down both sides. */
      surface={false}
    >
      {!selectedId ? (
        <EmptyState
          title={t('reference.classifications.emptyTitle')}
          description={t('reference.classifications.emptyDescription')}
          action={browse}
        />
      ) : detail.isLoading ? (
        <SectionCard>
          <LoadingState variant="detail" rows={4} />
        </SectionCard>
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={detail.refetch} />
      ) : (
        <div className="space-y-5">
          <SectionCard
            title={
              <span className="flex flex-wrap items-center gap-2">
                {node.name}
                {node.isAppDefined ? (
                  <Badge variant="info">{t('reference.classifications.manage.localBadge')}</Badge>
                ) : null}
                <OwnerBadge node={node} institutionName={institutionName(node.institutionId)} />
              </span>
            }
            actions={
              showAdd || showRename || showDelete || showPromote ? (
                <div className="flex flex-wrap gap-2">
                  {showAdd ? (
                    <Button size="sm" onClick={() => setDialog('create')}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {t('reference.classifications.manage.add')}
                    </Button>
                  ) : null}
                  {showRename ? (
                    <Button size="sm" variant="outline" onClick={() => setDialog('rename')}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      {t('common.actions.rename')}
                    </Button>
                  ) : null}
                  {showPromote ? (
                    <Button size="sm" variant="outline" onClick={() => setDialog('promote')}>
                      <Globe className="h-4 w-4" aria-hidden="true" />
                      {t('reference.classifications.manage.promote')}
                    </Button>
                  ) : null}
                  {showDelete ? (
                    <Button size="sm" variant="outline" onClick={() => setDialog('delete')}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {t('common.actions.delete')}
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
          >
            <DetailFieldList>
              <DetailField label={t('reference.classifications.code')}>
                <span className="font-mono text-xs">{node.id}</span>
              </DetailField>
              <DetailField label={t('reference.classifications.parent')}>
                {node.parentId ? (
                  <span className="min-w-0">
                    {parent.data?.name ? <span className="block">{parent.data.name}</span> : null}
                    <span className="block font-mono text-xs text-muted-foreground">
                      {node.parentId}
                    </span>
                  </span>
                ) : (
                  t('reference.classifications.rootLevel')
                )}
              </DetailField>
              <DetailField label={t('reference.classifications.origin')}>
                {t(`reference.classifications.originValue.${node.origin}`, {
                  defaultValue: String(node.origin),
                })}
              </DetailField>
              <DetailField label={t('reference.classifications.category')}>
                {node.categoryId
                  ? (categoryName(node.categoryId) ?? String(node.categoryId))
                  : null}
              </DetailField>
            </DetailFieldList>

            {/* Says why the Add button is absent, on the nodes where a reader
                would most expect one. */}
            {canCreate && !node.acceptsChildren && !node.isLeaf ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('reference.classifications.manage.addHint')}
              </p>
            ) : null}
          </SectionCard>

          <SectionCard
            title={t('reference.classifications.attributes.title')}
            description={t('reference.classifications.attributes.description')}
          >
            {attributes.isLoading ? (
              <LoadingState variant="list" rows={3} />
            ) : attributes.isError ? (
              <ErrorState error={attributes.error} onRetry={attributes.refetch} />
            ) : (attributes.data ?? []).length === 0 ? (
              <EmptyState
                title={t('reference.classifications.attributes.empty')}
                description={t('reference.classifications.attributes.emptyDescription')}
              />
            ) : (
              <ul className="space-y-2">
                {attributes.data.map((definition) => (
                  <li
                    key={definition.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{definition.name}</span>
                    <Badge variant="neutral">
                      {t(`enums.attributeType.${definition.attributeType}`)}
                    </Badge>
                    <Badge variant="outline">{t(`enums.attributeScope.${definition.scope}`)}</Badge>
                    {definition.isRequired ? (
                      <Badge variant="warning">
                        {t('reference.classifications.attributes.required')}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      )}

      <NameDialog
        open={dialog === 'create' || dialog === 'rename'}
        onOpenChange={(next) => setDialog(next ? dialog : null)}
        mode={dialog === 'create' ? 'create' : 'rename'}
        parentName={node?.name}
        canChooseOwner={isSystemWide}
        pending={mutations.create.isPending || mutations.rename.isPending}
        onSubmit={submitName}
      />

      <ConfirmDialog
        open={dialog === 'promote'}
        onOpenChange={(next) => setDialog(next ? 'promote' : null)}
        title={t('reference.classifications.manage.promoteTitle')}
        description={t('reference.classifications.manage.promoteDescription', {
          name: node?.name ?? '',
        })}
        confirmLabel={t('reference.classifications.manage.promote')}
        loading={mutations.promote.isPending}
        onConfirm={() => mutations.promote.mutate(node.id)}
      />

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(next) => setDialog(next ? 'delete' : null)}
        title={t('reference.classifications.manage.deleteTitle')}
        description={t('reference.classifications.manage.deleteDescription', {
          name: node?.name ?? '',
        })}
        confirmLabel={t('common.actions.delete')}
        destructive
        loading={mutations.remove.isPending}
        onConfirm={() => mutations.remove.mutate(node.id)}
      />

      <ClassificationPicker
        open={picking}
        onOpenChange={setPicking}
        title={t('reference.classifications.browse')}
        // Browsing, not filling a form: any node may be inspected, including the
        // branches where additions belong.
        allowBranchSelect
        onSelect={(selected) => setSelectedId(selected.id)}
      />
    </ListPage>
  );
}
