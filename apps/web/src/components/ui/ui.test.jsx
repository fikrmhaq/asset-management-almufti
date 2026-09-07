import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useForm } from 'react-hook-form';

import { ERROR_CODES } from '@/api/errors';
import { Button } from './button';
import { Checkbox, Radio } from './checkbox';
import { StatusBadge, statusVariant } from './badge';
import { ConfirmDialog } from './confirm-dialog';
import { toDate, toIsoDate } from '@/lib/dates';
import { DatePicker } from './date-picker';
import { Pagination } from './pagination';
import { EmptyState, ErrorState, LoadingState } from './states';

/**
 * UI foundation — `IMPLEMENTATION_PLAN.md` §15.4, `07-ui.md` §4, §8.
 */

describe('Button', () => {
  it('cannot be pressed twice while a mutation is in flight', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>
    );

    const button = screen.getByRole('button', { name: /save/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    await userEvent.click(button, { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets a later className override the variant', () => {
    render(<Button className="bg-transparent">Ghosted</Button>);

    expect(screen.getByRole('button')).toHaveClass('bg-transparent');
    expect(screen.getByRole('button')).not.toHaveClass('bg-primary');
  });
});

/**
 * These are restyled NATIVE inputs rather than Radix controls, specifically so
 * `register()` keeps working — Radix renders a `<button role="checkbox">`, which
 * React Hook Form cannot register without a `Controller`. These tests pin that
 * down, because it is the whole reason for the implementation choice.
 */
describe('Checkbox and Radio', () => {
  it('are real native inputs, so the platform owns their semantics', () => {
    render(
      <>
        <Checkbox aria-label="Include descendants" />
        <Radio name="scope" aria-label="Direct only" />
      </>
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Include descendants' });
    const radio = screen.getByRole('radio', { name: 'Direct only' });

    expect(checkbox.tagName).toBe('INPUT');
    expect(checkbox).toHaveAttribute('type', 'checkbox');
    expect(radio.tagName).toBe('INPUT');
    expect(radio).toHaveAttribute('type', 'radio');
  });

  it('toggles by keyboard, not only by pointer', async () => {
    render(<Checkbox aria-label="System-wide" />);
    const checkbox = screen.getByRole('checkbox');

    checkbox.focus();
    await userEvent.keyboard(' ');
    expect(checkbox).toBeChecked();

    await userEvent.keyboard(' ');
    expect(checkbox).not.toBeChecked();
  });

  it('registers with React Hook Form the way a plain checkbox does', async () => {
    const onSubmit = vi.fn();

    function Form() {
      const { register, handleSubmit } = useForm({ defaultValues: { isSystemWide: false } });
      return (
        <form onSubmit={handleSubmit(onSubmit)}>
          <Checkbox aria-label="System-wide" {...register('isSystemWide')} />
          <button type="submit">Save</button>
        </form>
      );
    }

    render(<Form />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'System-wide' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({ isSystemWide: true });
  });

  it('cannot be toggled while disabled', async () => {
    render(<Checkbox aria-label="Locked" disabled />);
    const checkbox = screen.getByRole('checkbox');

    await userEvent.click(checkbox, { pointerEventsCheck: 0 });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
  });

  it('reports invalidity to assistive technology, not only in colour', () => {
    render(<Checkbox aria-label="Accept" invalid />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('StatusBadge', () => {
  it('maps each documented enum value to a consistent variant', () => {
    expect(statusVariant('OVERDUE')).toBe('destructive');
    expect(statusVariant('ACTIVE')).toBe('success');
    expect(statusVariant('DRAFT')).toBe('neutral');
    expect(statusVariant('GOOD')).toBe('success');
    // An unknown value degrades rather than throwing.
    expect(statusVariant('SOMETHING_NEW')).toBe('neutral');
  });

  it('renders a readable label, never the stored enum value', () => {
    render(<StatusBadge value="BORROWED" />);

    expect(screen.getByText('On loan')).toBeInTheDocument();
    expect(screen.queryByText('BORROWED')).not.toBeInTheDocument();
  });

  it('disambiguates ACTIVE, which two enums share', () => {
    const { rerender } = render(<StatusBadge value="ACTIVE" kind="lifecycle" />);
    expect(screen.getByText('In use')).toBeInTheDocument();

    rerender(<StatusBadge value="ACTIVE" kind="borrowing" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('falls back to the value itself for an enum it does not know', () => {
    render(<StatusBadge value="SOMETHING_NEW" />);
    expect(screen.getByText('SOMETHING_NEW')).toBeInTheDocument();
  });
});

describe('shared states', () => {
  it('announces loading to assistive technology', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows distinct copy for an empty result', () => {
    render(<EmptyState title="No assets" description="Create one to get started" />);

    expect(screen.getByText('No assets')).toBeInTheDocument();
    expect(screen.getByText('Create one to get started')).toBeInTheDocument();
  });

  it('is specific about FORBIDDEN, NOT_FOUND and CONFLICT (§4)', () => {
    const { unmount } = render(
      <ErrorState error={{ code: ERROR_CODES.FORBIDDEN, message: 'No permission' }} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this');
    unmount();

    render(<ErrorState error={{ code: ERROR_CODES.CONFLICT, message: 'Already active' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('That conflicts with the current state');
    expect(screen.getByRole('alert')).toHaveTextContent('Already active');
  });

  it('offers a retry only where retrying could help', () => {
    const onRetry = vi.fn();
    const { unmount } = render(
      <ErrorState error={{ code: ERROR_CODES.FORBIDDEN }} onRetry={onRetry} />
    );
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    unmount();

    render(<ErrorState error={{ code: ERROR_CODES.NETWORK_ERROR }} onRetry={onRetry} />);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('reports the range from the API meta block, not from row count', () => {
    render(<Pagination meta={{ page: 3, pageSize: 20, total: 134, totalPages: 7 }} />);

    expect(screen.getByText('41–60 of 134')).toBeInTheDocument();
    expect(screen.getByText('Page 3 of 7')).toBeInTheDocument();
  });

  it('disables the edges of the range', () => {
    const { unmount } = render(
      <Pagination meta={{ page: 1, pageSize: 20, total: 40, totalPages: 2 }} />
    );
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next page/i })).toBeEnabled();
    unmount();

    render(<Pagination meta={{ page: 2, pageSize: 20, total: 40, totalPages: 2 }} />);
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  it('handles an empty result set', () => {
    render(<Pagination meta={{ page: 1, pageSize: 20, total: 0, totalPages: 0 }} />);

    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.getByText('Page 0 of 0')).toBeInTheDocument();
  });

  it('asks for the next page', async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        meta={{ page: 1, pageSize: 20, total: 40, totalPages: 2 }}
        onPageChange={onPageChange}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe('ConfirmDialog', () => {
  it('confirms without closing itself, so the server decides the outcome', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Deactivate this asset?"
        description="Its units and history are preserved."
        confirmLabel="Deactivate"
        onConfirm={onConfirm}
        destructive
      />
    );

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Deactivate this asset?');

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Still open: the caller closes it once the mutation resolves (§4.3).
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('blocks both actions while the mutation is running', () => {
    render(<ConfirmDialog open title="Return this borrowing?" loading onConfirm={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});

describe('DatePicker', () => {
  it('exchanges YYYY-MM-DD strings, never Date objects', () => {
    expect(toIsoDate(toDate('2026-03-01'))).toBe('2026-03-01');
    // No zone shift: a date parsed and re-serialized is the same calendar day.
    expect(toIsoDate(toDate('2026-01-01'))).toBe('2026-01-01');
    expect(toIsoDate(toDate('2026-12-31'))).toBe('2026-12-31');
  });

  it('ignores an unparseable value rather than rendering Invalid Date', () => {
    expect(toDate('not-a-date')).toBeUndefined();
    expect(toDate(null)).toBeUndefined();
    expect(toIsoDate(undefined)).toBeNull();
  });

  it('shows the placeholder until a date is chosen', () => {
    render(<DatePicker placeholder="Borrow date" />);
    expect(screen.getByRole('button', { name: 'Borrow date' })).toBeInTheDocument();
  });

  it('formats a selected value for display', () => {
    render(<DatePicker value="2026-03-01" />);
    expect(screen.getByRole('button', { name: '1 Mar 2026' })).toBeInTheDocument();
  });

  it('opens a styled calendar with month and year dropdowns', async () => {
    render(<DatePicker value="2026-03-01" />);

    await userEvent.click(screen.getByRole('button', { name: '1 Mar 2026' }));

    // The dropdowns are what make a date years away reachable without one click
    // per month.
    expect(await screen.findByRole('combobox', { name: /month/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /year/i })).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(27);
  });

  it('reaches a future year, which the dropdown default would have cut off', async () => {
    render(<DatePicker value="2026-03-01" />);

    await userEvent.click(screen.getByRole('button', { name: '1 Mar 2026' }));

    const years = await screen.findByRole('combobox', { name: /year/i });
    const options = within(years)
      .getAllByRole('option')
      .map((option) => Number(option.textContent));

    expect(Math.max(...options)).toBeGreaterThan(new Date().getFullYear());
  });

  it('keeps a value outside the default window reachable when editing it', async () => {
    render(<DatePicker value="1935-06-12" />);

    await userEvent.click(screen.getByRole('button', { name: '12 Jun 1935' }));

    const years = await screen.findByRole('combobox', { name: /year/i });
    expect(within(years).getByRole('option', { name: '1935' })).toBeInTheDocument();
  });

  it('clears an optional date without opening the calendar', async () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-03-01" clearable onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Clear date' }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('offers no clear control on a required field, or an empty one', () => {
    const { rerender } = render(<DatePicker value="2026-03-01" />);
    expect(screen.queryByRole('button', { name: 'Clear date' })).not.toBeInTheDocument();

    rerender(<DatePicker clearable />);
    expect(screen.queryByRole('button', { name: 'Clear date' })).not.toBeInTheDocument();
  });

  it('refuses days before the minimum the field allows', async () => {
    render(<DatePicker value="2026-03-10" min="2026-03-10" />);

    await userEvent.click(screen.getByRole('button', { name: '10 Mar 2026' }));
    await screen.findByRole('grid');

    const dayButton = (day) =>
      screen
        .getAllByRole('gridcell')
        .map((cell) => cell.querySelector('button'))
        .find((button) => button?.textContent.trim() === String(day));

    // The 9th is a day the borrow-date rule would reject; it is not offered.
    expect(dayButton(9)).toBeDisabled();
    expect(dayButton(10)).toBeEnabled();
  });

  it('carries the id and description the form field gives it', () => {
    render(<DatePicker id="borrow-date" aria-describedby="borrow-date-hint" value="2026-03-01" />);

    const trigger = screen.getByRole('button', { name: '1 Mar 2026' });
    expect(trigger).toHaveAttribute('id', 'borrow-date');
    expect(trigger).toHaveAttribute('aria-describedby', 'borrow-date-hint');
  });
});
