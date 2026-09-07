import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { z } from 'zod';

import { ApiError, ERROR_CODES } from '@/api/errors';
import { Field, FormErrorSummary } from '@/components/form/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useZodForm } from './useZodForm';

/**
 * Form infrastructure — `IMPLEMENTATION_PLAN.md` §15.6, `07-ui.md` §4.3.
 */

const schema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
  contractNumber: z.string().trim().min(1, 'is required'),
});

function TestForm({ onSubmit, onError }) {
  const { form, submit } = useZodForm({
    schema,
    defaultValues: { name: '', contractNumber: '' },
    onSubmit,
    onError,
  });

  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  return (
    <form onSubmit={submit} noValidate>
      <FormErrorSummary error={errors.root?.server} />

      <Field label="Name" error={errors.name?.message} required>
        {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
      </Field>

      <Field label="Contract number" error={errors.contractNumber?.message}>
        {(fieldProps) => <Input {...fieldProps} {...register('contractNumber')} />}
      </Field>

      <Button type="submit" loading={isSubmitting}>
        Save
      </Button>
    </form>
  );
}

const validationError = (details) =>
  new ApiError({
    code: ERROR_CODES.VALIDATION_ERROR,
    message: 'Some of the information provided is not valid.',
    status: 400,
    details,
  });

describe('useZodForm', () => {
  it('blocks submission on client-side validation', async () => {
    const onSubmit = vi.fn();
    render(<TestForm onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the validated values', async () => {
    const onSubmit = vi.fn().mockResolvedValue({});
    render(<TestForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/name/i), 'Laptop');
    await userEvent.type(screen.getByLabelText(/contract number/i), 'CTR-1');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Laptop', contractNumber: 'CTR-1' })
      )
    );
  });

  it('maps a server VALIDATION_ERROR onto the offending field (§4.3)', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(validationError([{ field: 'contractNumber', issue: 'must be unique' }]));

    render(<TestForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/name/i), 'Laptop');
    await userEvent.type(screen.getByLabelText(/contract number/i), 'CTR-DUP');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByText('must be unique')).toBeInTheDocument());
    // Reported against the field, not as a generic banner.
    expect(screen.getByLabelText(/contract number/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('surfaces a server error for a field the form does not have', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        validationError([{ field: 'institutionId', issue: 'is outside your scope' }])
      );

    render(<TestForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/name/i), 'Laptop');
    await userEvent.type(screen.getByLabelText(/contract number/i), 'CTR-1');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(screen.getByText(/institutionId: is outside your scope/)).toBeInTheDocument()
    );
  });

  it('hands a non-validation failure to the caller instead of the fields', async () => {
    const onError = vi.fn();
    const conflict = new ApiError({
      code: ERROR_CODES.CONFLICT,
      message: 'A contract with that number already exists',
      status: 409,
    });
    const onSubmit = vi.fn().mockRejectedValue(conflict);

    render(<TestForm onSubmit={onSubmit} onError={onError} />);

    await userEvent.type(screen.getByLabelText(/name/i), 'Laptop');
    await userEvent.type(screen.getByLabelText(/contract number/i), 'CTR-1');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(conflict));
  });
});

describe('Field', () => {
  it('wires the label, hint and error to the control', () => {
    render(
      <Field label="Borrow date" hint="When the item leaves" error={undefined}>
        {(fieldProps) => <Input {...fieldProps} />}
      </Field>
    );

    const input = screen.getByLabelText(/borrow date/i);
    expect(input).toHaveAccessibleDescription('When the item leaves');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('replaces the hint with the error and marks the control invalid', () => {
    render(
      <Field label="Borrow date" hint="When the item leaves" error="is required">
        {(fieldProps) => <Input {...fieldProps} />}
      </Field>
    );

    const input = screen.getByLabelText(/borrow date/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('is required');
    expect(screen.queryByText('When the item leaves')).not.toBeInTheDocument();
  });
});
