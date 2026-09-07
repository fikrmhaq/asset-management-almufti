import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { ERROR_CODES } from '@/api/errors';
import { DataTable } from './data-table';
import { DetailTabs, ListPage } from './page';

/**
 * Page patterns — `IMPLEMENTATION_PLAN.md` §15.5, `07-ui.md` §4.1, §4.2.
 */

const columns = [
  { accessorKey: 'name', header: 'Name', meta: { sortField: 'name' } },
  { accessorKey: 'status', header: 'Status' },
];

const rows = [
  { id: '1', name: 'Laptop', status: 'active' },
  { id: '2', name: 'Projector', status: 'inactive' },
];

describe('DataTable', () => {
  it('renders one page of server-supplied rows', () => {
    render(<DataTable columns={columns} data={rows} />);

    expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
    expect(screen.getByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('Projector')).toBeInTheDocument();
  });

  it('shows the loading state instead of an empty table', () => {
    render(<DataTable columns={columns} data={[]} isLoading />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the error state, and prefers it over loading', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        isLoading
        error={{ code: ERROR_CODES.FORBIDDEN, message: 'Not allowed' }}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('distinguishes empty from loading', () => {
    render(<DataTable columns={columns} data={[]} emptyTitle="No assets found" />);

    expect(screen.getByText('No assets found')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reports sort intent upward rather than sorting locally', async () => {
    const onSortChange = vi.fn();
    render(<DataTable columns={columns} data={rows} onSortChange={onSortChange} />);

    await userEvent.click(screen.getByRole('button', { name: /sort by name/i }));
    expect(onSortChange).toHaveBeenCalledWith('name', 'asc');

    // Row order is untouched — the server owns it (§33).
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[0]).toBe('Laptop');
  });

  it('toggles direction on the column already sorted', async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        sort="name"
        order="asc"
        onSortChange={onSortChange}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /sort by name/i }));
    expect(onSortChange).toHaveBeenCalledWith('name', 'desc');
  });

  it('offers no sort control for a column the API cannot sort by', () => {
    render(<DataTable columns={columns} data={rows} onSortChange={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /sort by status/i })).not.toBeInTheDocument();
  });

  it('exposes row selection to the caller', async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={rows} onRowClick={onRowClick} />);

    await userEvent.click(screen.getByText('Projector'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });
});

describe('ListPage', () => {
  it('lays out header, filters, content and the API-driven footer', () => {
    render(
      <MemoryRouter>
        <ListPage
          title="Assets"
          description="Everything in the registry"
          actions={<button type="button">New asset</button>}
          filters={<input aria-label="Search" />}
          meta={{ page: 1, pageSize: 20, total: 40, totalPages: 2 }}
        >
          <p>table goes here</p>
        </ListPage>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New asset' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /pagination/i })).toBeInTheDocument();
  });
});

describe('DetailTabs', () => {
  it('renders only the selected panel, so an unreadable sub-collection is never fetched', async () => {
    render(
      <DetailTabs
        tabs={[
          { value: 'overview', label: 'Overview', content: <p>overview panel</p> },
          { value: 'attachments', label: 'Attachments', content: <p>attachments panel</p> },
        ]}
      />
    );

    expect(screen.getByText('overview panel')).toBeInTheDocument();
    expect(screen.queryByText('attachments panel')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Attachments' }));
    expect(screen.getByText('attachments panel')).toBeInTheDocument();
  });

  it('can disable a tab the caller may not read', () => {
    render(
      <DetailTabs
        tabs={[
          { value: 'overview', label: 'Overview', content: <p>overview</p> },
          { value: 'units', label: 'Units', content: <p>units</p>, disabled: true },
        ]}
      />
    );

    expect(screen.getByRole('tab', { name: 'Units' })).toBeDisabled();
  });
});
