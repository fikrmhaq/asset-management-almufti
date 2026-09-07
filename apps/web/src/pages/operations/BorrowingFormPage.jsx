import { useNavigate } from 'react-router-dom';

import { useSession } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { useUnsavedChanges } from '@/lib/forms/useUnsavedChanges';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormErrorSummary } from '@/components/form/field';
import { FormPage, SectionCard } from '@/components/patterns/page';
import {
  BorrowingFields,
  borrowingSchema,
  emptyBorrowing,
  toBorrowingBody,
} from './BorrowingFields';
import { borrowings } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Borrowing create — `07-ui.md` §5.6, `IMPLEMENTATION_PLAN.md` §20.2;
 * REQ-BORROW-001–005.
 *
 * The record is always created `DRAFT` (`06-api.md` §7.2) with no units: units
 * are added on the detail page, because `POST /borrowings/:id/items` needs the
 * borrowing to exist first. So this page ends by navigating there — creating a
 * borrowing and leaving it empty is not a finished job (a `DRAFT` with no units
 * cannot be activated at all).
 *
 * There is no edit route: a `DRAFT` is edited in place on its detail page
 * (`DEC-042`).
 */
export function BorrowingFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = borrowings.useCreate();
  const { user } = useSession();

  // `borrowings.institution_id` is NOT NULL, unlike assets and contracts. A
  // caller whose role is not scoped to an institution therefore has to name one:
  // there is no scope for the server to fall back on.
  const institutionRequired = !user?.institutionId;

  const { form, submit } = useZodForm({
    schema: borrowingSchema,
    defaultValues: emptyBorrowing,
    onSubmit: async (values) => {
      const created = await create.mutateAsync(toBorrowingBody(values));

      form.reset(values);
      navigate(`/operations/borrowings/${created.id}`);
    },
  });

  const { formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  const blocker = useUnsavedChanges(isDirty && !isSubmitting);

  return (
    <>
      <FormPage
        title={t('operations.borrowings.newTitle')}
        description={t('operations.borrowings.newDescription')}
        onSubmit={submit}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/operations/borrowings')}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Create draft
            </Button>
          </>
        }
      >
        <SectionCard title={t('operations.borrowings.section')}>
          <div className="space-y-4">
            <FormErrorSummary error={errors.root?.server} />
            <BorrowingFields form={form} institutionRequired={institutionRequired} />
          </div>
        </SectionCard>
      </FormPage>

      <ConfirmDialog
        open={blocker?.state === 'blocked'}
        onOpenChange={(open) => !open && blocker?.reset?.()}
        title={t('operations.borrowings.discardTitle')}
        description={t('operations.borrowings.discardDescription')}
        confirmLabel={t('operations.borrowings.discard')}
        destructive
        onConfirm={() => blocker?.proceed?.()}
      />
    </>
  );
}
