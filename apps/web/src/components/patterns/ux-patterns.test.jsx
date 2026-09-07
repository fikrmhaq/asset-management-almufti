import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { z } from 'zod';

import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/stores/session';
import { ApiError, ERROR_CODES } from '@/api/errors';
import { Field } from '@/components/form/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { DerivedField } from './derived-field';
import { CreateRelatedEntity } from './create-related-entity';
import { DependentSelect } from './dependent-select';
import { DirectVsDescendantToggle } from './scope-toggle';
import { EntityTimeline } from './entity-timeline';

/**
 * Reusable UX patterns — the audit's systemic findings, built once.
 */

function renderWithQuery(ui) {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);
}

function signIn(permissions) {
  useSessionStore.getState().setSession({
    accessToken: 'token',
    user: { id: 'u1', username: 'ratna', roles: [], permissions, isSystemWide: false },
  });
}

beforeEach(() => {
  useSessionStore.getState().clearSession();
});

describe('Alert', () => {
  it('carries an icon as well as a colour, so the variant is not hue-only', () => {
    const { container } = render(<Alert variant="warning">Contracts cannot be reopened.</Alert>);

    expect(screen.getByText('Contracts cannot be reopened.')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('announces only the error variant', () => {
    const { unmount } = render(<Alert variant="error">That did not work.</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('That did not work.');
    unmount();

    // Static explanatory copy is present from first paint; announcing it would
    // talk over whatever the user was actually doing.
    render(<Alert variant="info">Supplier comes from the contract.</Alert>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('DerivedField', () => {
  it('is read-only rather than disabled, and says so to assistive technology', () => {
    render(
      <DerivedField
        label="Supplier"
        value="PT ABC Indonesia"
        explanation="Determined by the selected contract."
      />
    );

    const field = screen.getByText('PT ABC Indonesia').closest('[aria-readonly]');

    // Read-only means "not yours to set"; disabled would mean "not available to
    // you", which implies a permission problem that does not exist here.
    expect(field).toHaveAttribute('aria-readonly', 'true');
    expect(field).not.toHaveAttribute('aria-disabled');
    expect(screen.getByText('Determined by the selected contract.')).toBeInTheDocument();
  });

  it('renders the value as text, not as a form control', () => {
    const { container } = render(<DerivedField label="Supplier" value="PT ABC Indonesia" />);

    // Nothing submittable and nothing focus-trapping — the value stays
    // selectable and copyable.
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });

  it('prompts rather than looking broken when there is nothing to derive from', () => {
    render(<DerivedField label="Supplier" emptyLabel="Select a contract first" />);
    expect(screen.getByText('Select a contract first')).toBeInTheDocument();
  });

  it('reports that it is waiting while the value is in flight', () => {
    render(<DerivedField label="Supplier" loading />);
    expect(screen.getByLabelText('Supplier')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('CreateRelatedEntity', () => {
  const options = [{ value: 'mu-1', label: 'piece' }];

  const schema = z.object({ name: z.string().min(1, 'is required') });

  // `permission` is NOT defaulted here: a default parameter would swallow an
  // explicit `undefined`, which is exactly the case the fail-closed test needs
  // to exercise.
  function Harness({ onCreate, permission, onChange = () => {} }) {
    return (
      <CreateRelatedEntity
        options={options}
        value={null}
        onChange={onChange}
        permission={permission}
        createLabel="Create measurement unit"
        schema={schema}
        defaultValues={{ name: '' }}
        onCreate={onCreate}
      >
        {(form) => (
          <Field label="Name" error={form.formState.errors.name?.message} required>
            {({ invalid, ...dom }) => (
              <Input {...dom} {...form.register('name')} aria-invalid={invalid || undefined} />
            )}
          </Field>
        )}
      </CreateRelatedEntity>
    );
  }

  it('hides the create affordance from a session that may read but not create', async () => {
    signIn(['measurement-unit:read']);
    renderWithQuery(<Harness onCreate={vi.fn()} permission="measurement-unit:create" />);

    await userEvent.click(screen.getByRole('combobox'));

    // Hidden, not disabled (§6) — and the existing records are still selectable.
    expect(
      screen.queryByRole('button', { name: 'Create measurement unit' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('piece')).toBeInTheDocument();
  });

  it('fails closed when no permission code is supplied', async () => {
    signIn(['measurement-unit:read', 'measurement-unit:create']);
    renderWithQuery(<Harness onCreate={vi.fn()} permission={undefined} />);

    await userEvent.click(screen.getByRole('combobox'));
    expect(
      screen.queryByRole('button', { name: 'Create measurement unit' })
    ).not.toBeInTheDocument();
  });

  it('creates, then selects what the SERVER returned', async () => {
    signIn(['measurement-unit:create']);
    const onCreate = vi.fn().mockResolvedValue({ id: 'mu-2', name: 'box' });
    const onChange = vi.fn();

    renderWithQuery(
      <Harness onCreate={onCreate} onChange={onChange} permission="measurement-unit:create" />
    );

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('button', { name: 'Create measurement unit' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'box');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: 'box' }));
    // Selected only after the server answered — nothing was inserted
    // optimistically.
    expect(onChange).toHaveBeenCalledWith('mu-2');
  });

  it('keeps the dialog and its input when the server rejects the creation', async () => {
    signIn(['measurement-unit:create']);
    const onCreate = vi.fn().mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.CONFLICT,
        message: 'That name is already in use',
        status: 409,
      })
    );
    const onChange = vi.fn();

    renderWithQuery(
      <Harness onCreate={onCreate} onChange={onChange} permission="measurement-unit:create" />
    );

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('button', { name: 'Create measurement unit' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'piece');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(screen.getByText('That name is already in use')).toBeInTheDocument()
    );
    // Still open, still holding what was typed, and nothing was selected.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByLabelText(/name/i)).toHaveValue('piece');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('DependentSelect', () => {
  it('is disabled AND explains itself until the parent is chosen', () => {
    render(<DependentSelect dependsOn={null} options={[]} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole('combobox')).toBeDisabled();
    // The explanation sits OUTSIDE the disabled control, where a screen reader
    // will still reach it.
    expect(screen.getByText(/choose the field above/i)).toBeInTheDocument();
  });

  it('does not clear a value that arrived with the form', () => {
    const onChange = vi.fn();
    render(
      <DependentSelect
        dependsOn="contract-1"
        options={[{ value: 'item-1', label: 'Item 1' }]}
        value="item-1"
        onChange={onChange}
      />
    );

    // An edit form mounts with both fields already set; clearing on mount would
    // silently wipe the second one.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the stale selection when the parent actually changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DependentSelect
        dependsOn="contract-1"
        options={[{ value: 'item-1', label: 'Item 1' }]}
        value="item-1"
        onChange={onChange}
      />
    );

    rerender(
      <DependentSelect
        dependsOn="contract-2"
        options={[{ value: 'item-9', label: 'Item 9' }]}
        value="item-1"
        onChange={onChange}
      />
    );

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('does not mark a pristine form dirty when the parent changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DependentSelect dependsOn="contract-1" options={[]} value={null} onChange={onChange} />
    );

    rerender(
      <DependentSelect dependsOn="contract-2" options={[]} value={null} onChange={onChange} />
    );

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('DirectVsDescendantToggle', () => {
  it('reports the selected scope through aria-pressed, not only through colour', async () => {
    function Harness() {
      const [scope, setScope] = useState('all');
      return <DirectVsDescendantToggle value={scope} onChange={setScope} />;
    }

    render(<Harness />);

    const all = screen.getByRole('button', { name: 'Everything inside' });
    const direct = screen.getByRole('button', { name: 'Here only' });

    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(direct).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(direct);
    expect(direct).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
  });

  it('lets a module supply better words than the generic ones', () => {
    render(
      <DirectVsDescendantToggle
        value="all"
        onChange={vi.fn()}
        labels={{ all: 'Include sub-locations', direct: 'This room only' }}
      />
    );

    expect(screen.getByRole('button', { name: 'This room only' })).toBeInTheDocument();
  });
});

describe('EntityTimeline', () => {
  const items = [
    {
      id: '1',
      title: 'Moved to Computer Lab 2',
      timestamp: '2026-03-01T08:30:00.000Z',
      actor: 'Ratna Wulandari',
      description: 'Condition recorded as Good.',
    },
    { id: '2', title: 'Registered', timestamp: '2026-02-01T02:00:00.000Z' },
  ];

  it('renders events in the order it is given, as an ordered list', () => {
    render(<EntityTimeline items={items} />);

    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    // Sequence is carried by the list itself, not by the decorative rail.
    expect(entries[0]).toHaveTextContent('Moved to Computer Lab 2');
    expect(entries[1]).toHaveTextContent('Registered');
  });

  it('exposes each timestamp in machine-readable form', () => {
    const { container } = render(<EntityTimeline items={items} />);
    const times = container.querySelectorAll('time');

    expect(times).toHaveLength(2);
    expect(times[0]).toHaveAttribute('dateTime', '2026-03-01T08:30:00.000Z');
    expect(times[0].textContent).not.toBe('');
  });

  it('shows the shared empty and loading states rather than its own', () => {
    const { unmount } = render(<EntityTimeline items={[]} />);
    expect(screen.getByText('Nothing recorded yet')).toBeInTheDocument();
    unmount();

    render(<EntityTimeline items={[]} isLoading />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('surfaces a failure through the shared error presentation', () => {
    render(<EntityTimeline items={[]} error={{ code: ERROR_CODES.FORBIDDEN }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this');
  });
});
