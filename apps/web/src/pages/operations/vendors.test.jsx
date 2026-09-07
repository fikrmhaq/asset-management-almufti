import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, ERROR_CODES } from '@/api/errors';
import * as procurementApi from '@/api/procurement';
import { renderScreen, signInWith } from '@/test/harness';
import { VendorsPage } from './VendorsPage';
import { VendorDetailPage } from './VendorDetailPage';

/**
 * Vendor screens — `07-ui.md` §5.6, `IMPLEMENTATION_PLAN.md` §19.2.
 *
 * Built in Phase 13 with the rest of procurement (`DEC-034`), while living in
 * the Operations nav group.
 */

const ALL = ['vendor:read', 'vendor:create', 'vendor:update', 'vendor:deactivate', 'asset:read'];

const page = (rows, meta = {}) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1, ...meta },
});

const VENDOR = {
  id: 'ven-1',
  name: 'PT Teknologi Nusantara',
  contactInfo: '021-5550000',
  address: 'Jl. Sudirman 10',
  isActive: true,
};

beforeEach(() => {
  signInWith(ALL);
  vi.spyOn(procurementApi.vendorsApi, 'list').mockResolvedValue(page([VENDOR]));
  vi.spyOn(procurementApi.vendorsApi, 'get').mockResolvedValue(VENDOR);
  vi.spyOn(procurementApi.vendorsApi, 'assets').mockResolvedValue(page([]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VendorsPage', () => {
  it('lists vendors with their status', async () => {
    renderScreen(<VendorsPage />);

    expect(await screen.findByText('PT Teknologi Nusantara')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('has no institution filter — vendors are global (DEC-007)', async () => {
    renderScreen(<VendorsPage />);
    await screen.findByText('PT Teknologi Nusantara');

    expect(screen.queryByLabelText(/institution/i)).not.toBeInTheDocument();
  });

  it('creates a vendor', async () => {
    const create = vi.spyOn(procurementApi.vendorsApi, 'create').mockResolvedValue(VENDOR);
    renderScreen(<VendorsPage />);
    await screen.findByText('PT Teknologi Nusantara');

    await userEvent.click(screen.getByRole('button', { name: /new vendor/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'CV Elektronik');
    await userEvent.type(within(dialog).getByLabelText(/contact/i), '0812');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'CV Elektronik',
        contactInfo: '0812',
        address: undefined,
      })
    );
  });

  it('hides the create action without vendor:create (§6)', async () => {
    signInWith(['vendor:read']);
    renderScreen(<VendorsPage />);
    await screen.findByText('PT Teknologi Nusantara');

    expect(screen.queryByRole('button', { name: /new vendor/i })).not.toBeInTheDocument();
  });

  it('shows an error state rather than an empty table', async () => {
    procurementApi.vendorsApi.list.mockRejectedValue(
      new ApiError({ code: ERROR_CODES.FORBIDDEN, message: 'No', status: 403 })
    );

    renderScreen(<VendorsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');
  });
});

describe('VendorDetailPage', () => {
  it('lists the vendor’s assets (REQ-VENDOR-004)', async () => {
    procurementApi.vendorsApi.assets.mockResolvedValue(
      page([
        { id: 'asset-1', name: 'Laptop Dell', classificationId: '117010101001', isActive: true },
      ])
    );

    renderScreen(<VendorDetailPage />, { path: '/:id', route: '/ven-1' });
    await screen.findByRole('heading', { name: 'PT Teknologi Nusantara' });

    await userEvent.click(screen.getByRole('tab', { name: 'Assets' }));

    expect(await screen.findByRole('link', { name: 'Laptop Dell' })).toHaveAttribute(
      'href',
      '/assets/asset-1'
    );
    expect(procurementApi.vendorsApi.assets).toHaveBeenCalledWith('ven-1');
  });

  it('hides the Assets tab without asset:read, which is what the endpoint needs (DEC-032)', async () => {
    signInWith(['vendor:read']);
    renderScreen(<VendorDetailPage />, { path: '/:id', route: '/ven-1' });
    await screen.findByRole('heading', { name: 'PT Teknologi Nusantara' });

    expect(screen.queryByRole('tab', { name: 'Assets' })).not.toBeInTheDocument();
    expect(procurementApi.vendorsApi.assets).not.toHaveBeenCalled();
  });

  it('confirms before deactivating and only then calls the API (§4.4)', async () => {
    const setActive = vi
      .spyOn(procurementApi.vendorsApi, 'setActive')
      .mockResolvedValue({ ...VENDOR, isActive: false });

    renderScreen(<VendorDetailPage />, { path: '/:id', route: '/ven-1' });
    await screen.findByRole('heading', { name: 'PT Teknologi Nusantara' });

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(setActive).not.toHaveBeenCalled();

    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate' })
    );
    await waitFor(() => expect(setActive).toHaveBeenCalledWith('ven-1', false));
  });

  it('keeps Save disabled until something changes', async () => {
    renderScreen(<VendorDetailPage />, { path: '/:id', route: '/ven-1' });
    await screen.findByRole('heading', { name: 'PT Teknologi Nusantara' });

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^name/i), ' Jaya');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
  });
});
