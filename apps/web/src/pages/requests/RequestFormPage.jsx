import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { requestsApi } from '@/api/requests';
import { usePermission } from '@/auth/useSession';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field, FormErrorSummary } from '@/components/form/field';
import { DetailPage, SectionCard } from '@/components/patterns/page';
import { LocationSelector } from '@/components/location/LocationSelector';
import { useDepartmentOptions } from '../assets/referenceOptions';
import { RequestItemsEditor } from './RequestItemsEditor';
import { RequestDocumentsPanel } from './RequestDocumentsPanel';
import { RequestSubmitSection } from './RequestSubmitPanel';
import { categoryLabel, contextLabel, REQUEST_CATEGORIES } from './requestLabels';
import { RevisionBanner } from './RequestRevision';
import { DEPARTMENT_BOUND } from '../organization/workflows/constants';

/**
 * Request form — create and edit a DRAFT. Phase 37 (`CR-014` §4.4),
 * `07-ui.md` §5.10, REQ-REQUEST-002 – REQ-REQUEST-006.
 *
 * GUIDANCE NEVER BLOCKS. Every category is selectable and saving always works:
 *
 *   - an unusual category for the context shows a notice;
 *   - a category with no active workflow shows a warning that the draft can be
 *     saved but not yet submitted (Phase 37 guidance decision, amending the
 *     "disabled" wording of the original §5.10).
 *
 * The server applies the real rules — own current context, the department lock
 * and the JURUSAN department requirement — and reports them against the field.
 *
 * Items are added once the draft exists: a new request is saved first, then
 * opens here in edit mode with its items section.
 */

const fieldError = (error, name) =>
  error?.fieldErrors?.[name] ?? error?.fieldErrors?.[`body.${name}`] ?? null;

function initialForm(request) {
  return {
    requesterAssignmentId: request?.requesterAssignmentId ?? '',
    category: request?.category ?? '',
    title: request?.title ?? '',
    justification: request?.justification ?? '',
    departmentId: request?.departmentId ?? '',
    destinationLocationId: request?.destinationLocationId ?? '',
    neededBy: request?.neededBy ?? '',
  };
}

export function RequestFormPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const canCreate = usePermission('request:create');
  const canReadLocations = usePermission('location:read');

  const guidance = useQuery({
    queryKey: ['request-guidance'],
    queryFn: () => requestsApi.guidance(),
    enabled: canCreate,
  });
  const existing = useQuery({
    queryKey: ['request', id],
    queryFn: () => requestsApi.get(id),
    enabled: isEdit,
  });

  const [form, setForm] = useState(initialForm());
  const [touchedDestination, setTouchedDestination] = useState(false);

  const contexts = useMemo(() => guidance.data?.contexts ?? [], [guidance.data]);

  // Initialise once the data it depends on has arrived.
  useEffect(() => {
    if (isEdit && existing.data) setForm(initialForm(existing.data));
  }, [isEdit, existing.data]);

  useEffect(() => {
    if (isEdit || contexts.length === 0) return;
    setForm((current) => {
      if (current.requesterAssignmentId) return current;
      const first = contexts[0];
      return {
        ...current,
        requesterAssignmentId: first.assignmentId,
        category: first.typicalCategories[0] ?? REQUEST_CATEGORIES[0],
      };
    });
  }, [isEdit, contexts]);

  const context = contexts.find(
    (entry) =>
      entry.assignmentId ===
      (isEdit ? existing.data?.requesterAssignmentId : form.requesterAssignmentId)
  );

  // Pre-fill the destination from the caller's Location PIC rooms (`CR-014`
  // §5.4) or, for a teacher with none, the Teacher Storage Room
  // (REQ-REQUEST-023) — on a new draft only, and only until the user chooses.
  useEffect(() => {
    if (isEdit || touchedDestination || !context) return;
    setForm((current) => ({
      ...current,
      destinationLocationId: context.defaultDestinations[0]?.id ?? '',
    }));
  }, [isEdit, touchedDestination, context]);

  // Unsaved edits of a draft: Submit sends the SAVED draft, so it waits (P1).
  const dirty =
    isEdit &&
    Boolean(existing.data) &&
    JSON.stringify(form) !== JSON.stringify(initialForm(existing.data));

  const institutionId = isEdit ? existing.data?.institutionId : context?.institutionId;
  const positionCode = isEdit ? existing.data?.requesterPositionCode : context?.positionCode;
  /**
   * REQ-REQUEST-018: a request returned for revision is edited here as a draft
   * is, but its category is fixed, and so is its department when a step of its
   * frozen process is decided within the department (D5) — the server refuses
   * either change; the form shows them fixed.
   */
  const revising = isEdit && existing.data?.status === 'REVISION_REQUESTED';
  const revisionFixesDepartment =
    revising &&
    (existing.data?.steps ?? []).some((step) => DEPARTMENT_BOUND.has(step.actorPositionCode));
  const lockedDepartment = isEdit
    ? (existing.data?.requesterDepartment ??
      (revisionFixesDepartment ? (existing.data?.department ?? null) : null))
    : context?.departmentRule === 'LOCKED'
      ? context.department
      : null;
  const departments = useDepartmentOptions(lockedDepartment ? null : institutionId);

  const categoryInfo = context?.categories.find((entry) => entry.category === form.category);
  /**
   * Only the categories this context may request (UAT decision, 2026-09-28 —
   * a Jurusan teacher: COMMON and JURUSAN). The server enforces the same rule;
   * `eligible` absent means an older server, so nothing is hidden. A draft
   * already holding an ineligible category keeps it visible, so the form shows
   * what is stored — submitting it is refused.
   */
  const orderedCategories = useMemo(() => {
    const typical = context?.typicalCategories ?? [];
    const ordered = [
      ...typical,
      ...REQUEST_CATEGORIES.filter((category) => !typical.includes(category)),
    ];
    const eligible = (category) =>
      context?.categories.find((entry) => entry.category === category)?.eligible !== false;
    const stored = isEdit ? existing.data?.category : null;
    return ordered.filter((category) => eligible(category) || category === stored);
  }, [context, isEdit, existing.data]);

  // A change of context (several positions held) may leave the chosen category
  // outside what the new one may request: fall back to its first offered one.
  useEffect(() => {
    if (isEdit || !context || orderedCategories.length === 0) return;
    if (!orderedCategories.includes(form.category)) {
      setForm((current) => ({ ...current, category: orderedCategories[0] }));
    }
  }, [isEdit, context, orderedCategories, form.category]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        category: form.category,
        title: form.title.trim(),
        justification: form.justification.trim() || null,
        destinationLocationId: form.destinationLocationId || null,
        neededBy: form.neededBy || null,
        ...(lockedDepartment ? {} : { departmentId: form.departmentId || null }),
      };
      return isEdit
        ? requestsApi.update(id, body)
        : requestsApi.create({ ...body, requesterAssignmentId: form.requesterAssignmentId });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
      queryClient.setQueryData(['request', saved.id], saved);
      toast.success(
        t(isEdit ? 'requests.saved' : 'requests.createdToast', { number: saved.requestNumber })
      );
      if (!isEdit) navigate(`/requests/${saved.id}/edit`, { replace: true });
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  if (guidance.isLoading || (isEdit && existing.isLoading))
    return <LoadingState variant="form" rows={6} />;
  if (isEdit && existing.isError)
    return <ErrorState error={existing.error} onRetry={existing.refetch} />;
  if (guidance.isError) return <ErrorState error={guidance.error} onRetry={guidance.refetch} />;

  if (!isEdit && contexts.length === 0) {
    return (
      <DetailPage title={t('requests.newTitle')}>
        <EmptyState
          title={t('requests.noContextTitle')}
          description={t('requests.noContextDescription')}
        />
      </DetailPage>
    );
  }

  const request = existing.data;
  if (isEdit && !['DRAFT', 'REVISION_REQUESTED'].includes(request.status)) {
    return (
      <DetailPage title={request.requestNumber}>
        <Alert variant="info">{t('requests.notDraft')}</Alert>
      </DetailPage>
    );
  }

  const set = (name) => (event) =>
    setForm((current) => ({ ...current, [name]: event.target.value }));
  const errorFor = (name) => fieldError(save.error, name);
  const departmentRequired = form.category === 'JURUSAN';

  return (
    <DetailPage
      title={
        isEdit
          ? t(revising ? 'requests.revision.editTitle' : 'requests.editTitle', {
              number: request.requestNumber,
            })
          : t('requests.newTitle')
      }
      description={t(revising ? 'requests.revision.formDescription' : 'requests.formDescription')}
    >
      {revising ? <RevisionBanner request={request} editing /> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <SectionCard title={t('requests.headerTitle')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* The context: hidden when there is only one to choose (§4.4). */}
            {isEdit ? (
              <Field label={t('requests.requestedAs')}>
                {() => (
                  <p className="text-sm">
                    {contextLabel(t, request.requesterPositionCode, request.requesterDepartment)}
                  </p>
                )}
              </Field>
            ) : contexts.length > 1 ? (
              <Field
                label={t('requests.requestedAs')}
                hint={t('requests.contextHint')}
                error={errorFor('requesterAssignmentId')}
                required
              >
                {(fieldProps) => (
                  <NativeSelect
                    {...fieldProps}
                    value={form.requesterAssignmentId}
                    onChange={(event) => {
                      const next = contexts.find((c) => c.assignmentId === event.target.value);
                      setForm((current) => ({
                        ...current,
                        requesterAssignmentId: event.target.value,
                        departmentId: '',
                        category: next?.typicalCategories.includes(current.category)
                          ? current.category
                          : (next?.typicalCategories[0] ?? current.category),
                      }));
                    }}
                  >
                    {contexts.map((c) => (
                      <option key={c.assignmentId} value={c.assignmentId}>
                        {contextLabel(t, c.positionCode, c.department)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            ) : (
              <Field label={t('requests.requestedAs')}>
                {() => (
                  <p className="text-sm">
                    {contextLabel(t, contexts[0].positionCode, contexts[0].department)}
                  </p>
                )}
              </Field>
            )}

            <Field
              label={t('requests.category')}
              hint={revising ? t('requests.revision.categoryFixed') : null}
              error={errorFor('category')}
              required
            >
              {(fieldProps) => (
                <NativeSelect
                  {...fieldProps}
                  value={form.category}
                  onChange={set('category')}
                  disabled={revising}
                >
                  {orderedCategories.map((category) => (
                    <option key={category} value={category}>
                      {categoryLabel(t, category)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>

          {/* Guidance: notices only, never a block. */}
          <div className="mt-3 space-y-2">
            {context && categoryInfo && !categoryInfo.typical ? (
              <Alert variant="info" size="sm">
                {t('requests.unusualCategory', {
                  context: contextLabel(t, positionCode, context.department),
                })}
              </Alert>
            ) : null}
            {context && categoryInfo && !categoryInfo.processConfigured ? (
              <Alert variant="warning" size="sm">
                {t('requests.noProcess')}
              </Alert>
            ) : null}
            {isEdit && request.requesterAssignmentCurrent === false ? (
              <Alert variant="warning" size="sm">
                {t('requests.contextEnded')}
              </Alert>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t('requests.titleField')} error={errorFor('title')} required>
              {(fieldProps) => (
                <Input {...fieldProps} value={form.title} maxLength={255} onChange={set('title')} />
              )}
            </Field>

            <Field
              label={t('requests.department')}
              hint={
                lockedDepartment
                  ? t(
                      revisionFixesDepartment && !existing.data?.requesterDepartment
                        ? 'requests.revision.departmentFixed'
                        : 'requests.departmentLocked'
                    )
                  : null
              }
              error={errorFor('departmentId')}
              required={departmentRequired || Boolean(lockedDepartment)}
            >
              {(fieldProps) =>
                lockedDepartment ? (
                  <p className="text-sm" id={fieldProps.id}>
                    {lockedDepartment.name}
                  </p>
                ) : (
                  <NativeSelect
                    {...fieldProps}
                    value={form.departmentId}
                    onChange={set('departmentId')}
                  >
                    <option value="">
                      {departmentRequired
                        ? t('common.select.placeholder')
                        : t('requests.noDepartment')}
                    </option>
                    {departments.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                )
              }
            </Field>

            <Field
              label={t('requests.destination')}
              hint={
                // REQ-REQUEST-023: say where a storage-room default came from.
                !isEdit && context?.defaultDestinationSource === 'TEACHER_STORAGE_ROOM'
                  ? `${t('requests.destinationHint')} ${t('requests.destinationStorageRoom')}`
                  : t('requests.destinationHint')
              }
              error={errorFor('destinationLocationId')}
            >
              {(fieldProps) =>
                canReadLocations ? (
                  <LocationSelector
                    id={fieldProps.id}
                    invalid={fieldProps.invalid}
                    value={form.destinationLocationId || null}
                    allowClear
                    onChange={(locationId) => {
                      setTouchedDestination(true);
                      setForm((current) => ({
                        ...current,
                        destinationLocationId: locationId ?? '',
                      }));
                    }}
                  />
                ) : (
                  <NativeSelect
                    {...fieldProps}
                    value={form.destinationLocationId}
                    onChange={(event) => {
                      setTouchedDestination(true);
                      set('destinationLocationId')(event);
                    }}
                  >
                    <option value="">{t('requests.noDestination')}</option>
                    {(context?.defaultDestinations ?? []).map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </NativeSelect>
                )
              }
            </Field>

            <Field label={t('requests.neededBy')} error={errorFor('neededBy')}>
              {(fieldProps) => (
                <DatePicker
                  id={fieldProps.id}
                  invalid={fieldProps.invalid}
                  value={form.neededBy || undefined}
                  clearable
                  onChange={(next) => setForm((current) => ({ ...current, neededBy: next ?? '' }))}
                />
              )}
            </Field>

            <Field
              label={t('requests.justification')}
              error={errorFor('justification')}
              className="sm:col-span-2"
            >
              {(fieldProps) => (
                <Textarea
                  {...fieldProps}
                  rows={3}
                  value={form.justification}
                  onChange={set('justification')}
                />
              )}
            </Field>
          </div>

          <FormErrorSummary
            error={save.error && !save.error.isValidation ? save.error : null}
            className="mt-4"
          />

          <div className="mt-4 flex justify-end gap-2">
            {isEdit ? (
              <Button type="button" variant="outline" onClick={() => navigate(`/requests/${id}`)}>
                {t(revising ? 'requests.revision.viewRequest' : 'requests.viewDraft')}
              </Button>
            ) : null}
            <Button type="submit" loading={save.isPending} disabled={!form.title.trim()}>
              {isEdit ? t('common.actions.save') : t('requests.saveDraft')}
            </Button>
          </div>
        </SectionCard>
      </form>

      {isEdit ? <RequestItemsEditor request={request} editable /> : null}

      {/*
        P1 (§64): submit from here, straight after the information and items —
        no detour to the request page. What is missing comes from the server.
      */}
      {isEdit ? (
        <RequestSubmitSection
          request={request}
          dirty={dirty}
          onSubmitted={(next) => navigate(`/requests/${next.id}`)}
        />
      ) : null}

      {/*
        The draft's documents, here as well as on the request page, so the
        requester completes information, items and documents in one place
        straight after creating it (UAT, 2026-09-28). Upload and delete follow
        the server's flags exactly as on the request page (`CR-014` §9).
      */}
      {isEdit ? <RequestDocumentsPanel request={request} /> : null}
    </DetailPage>
  );
}
