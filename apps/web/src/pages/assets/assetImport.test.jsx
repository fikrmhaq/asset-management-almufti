import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as assetCoreApi from '@/api/assetCore';
import * as organizationApi from '@/api/organization';
import * as procurementApi from '@/api/procurement';
import { renderScreen, signInWith } from '@/test/harness';
import { AssetImportPage } from './AssetImportPage';
import { AssetsPage } from './AssetsPage';

/**
 * Asset import screen — an addition beside "New asset", which is unchanged.
 */

const REGISTRAR = ['asset:read', 'asset:create', 'asset-unit:create', 'institution:read'];

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
});

const VALID = {
  dryRun: true,
  imported: false,
  valid: true,
  fileIssues: [],
  issues: [],
  warnings: [],
  summary: { rows: 2, assets: 1, units: 5 },
  assets: [
    {
      id: null,
      name: 'Kursi siswa',
      classificationId: '117010101001',
      classificationName: 'Aspal',
      existing: false,
      unitCount: 5,
      rows: [
        {
          row: 2,
          quantity: 3,
          department: 'TKJ',
          fundingSource: null,
          location: 'Kelas X-1',
          condition: 'GOOD',
          inventoryCodes: ['ALPHA-2026-00001', 'ALPHA-2026-00002', 'ALPHA-2026-00003'],
        },
        {
          row: 3,
          quantity: 2,
          department: null,
          fundingSource: null,
          location: null,
          condition: null,
          inventoryCodes: ['ALPHA-2026-00004', 'ALPHA-2026-00005'],
        },
      ],
    },
  ],
};

const INVALID = {
  ...VALID,
  valid: false,
  summary: { rows: 2, assets: 0, units: 0 },
  assets: [],
  issues: [
    {
      row: 3,
      column: 'Lokasi',
      code: 'LOCATION_NOT_FOUND',
      message: 'no active location of this institution is called "Gudang"',
      params: { value: 'Gudang' },
    },
    {
      row: 4,
      column: 'Komposisi nomor',
      code: 'RULE',
      message: 'Each unit needs its own number composition: supply 2 values',
      params: {},
    },
  ],
};

const csvFile = () =>
  new File(['Nama aset,Klasifikasi\nKursi,117010101001'], 'aset.csv', { type: 'text/csv' });

beforeEach(() => {
  vi.spyOn(organizationApi.institutionsApi, 'list').mockResolvedValue(
    page([{ id: 'inst-1', name: 'SMK Alpha' }])
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssetImportPage', () => {
  it('previews a chosen file and imports it', async () => {
    signInWith(REGISTRAR, { institutionId: 'inst-1', isSystemWide: false });
    const preview = vi.spyOn(assetCoreApi.assetImportApi, 'preview').mockResolvedValue(VALID);
    const commit = vi
      .spyOn(assetCoreApi.assetImportApi, 'import')
      .mockResolvedValue({
        ...VALID,
        dryRun: false,
        imported: true,
        assets: [{ ...VALID.assets[0], id: 'asset-9' }],
      });
    const user = userEvent.setup();

    renderScreen(<AssetImportPage />);

    await user.upload(await screen.findByLabelText('Choose file'), csvFile());

    expect(preview).toHaveBeenCalledWith(expect.any(File), undefined);
    expect(await screen.findByText('Kursi siswa')).toBeInTheDocument();
    expect(screen.getByText('ALPHA-2026-00001 … ALPHA-2026-00005')).toBeInTheDocument();
    expect(screen.getByText(/Kelas X-1 · Good/)).toBeInTheDocument();
    expect(screen.getByText(/not placed yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Import 1 assets, 5 units' }));

    await waitFor(() => expect(commit).toHaveBeenCalledWith(expect.any(File), undefined));
    expect(await screen.findByText('Imported')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kursi siswa' })).toHaveAttribute(
      'href',
      '/assets/asset-9'
    );
  });

  it('lists each problem by row and column, and does not offer the import', async () => {
    signInWith(REGISTRAR, { institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(assetCoreApi.assetImportApi, 'preview').mockResolvedValue(INVALID);
    const commit = vi.spyOn(assetCoreApi.assetImportApi, 'import');
    const user = userEvent.setup();

    renderScreen(<AssetImportPage />);
    await user.upload(await screen.findByLabelText('Choose file'), csvFile());

    // A known code is translated; a shared rule keeps the server's wording.
    expect(
      await screen.findByText('No active location of this institution is called "Gudang"')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Each unit needs its own number composition: supply 2 values')
    ).toBeInTheDocument();
    expect(screen.getByText('2 problems')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Import/ })).toBeDisabled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('asks a user without an institution to choose one first', async () => {
    signInWith(REGISTRAR);
    const preview = vi.spyOn(assetCoreApi.assetImportApi, 'preview').mockResolvedValue(VALID);
    const user = userEvent.setup();

    renderScreen(<AssetImportPage />);

    const chooser = await screen.findByLabelText('Choose file');
    expect(chooser).toBeDisabled();
    expect(screen.getByRole('button', { name: /Download template/ })).toBeDisabled();

    await user.selectOptions(await screen.findByLabelText('Institution'), 'inst-1');
    await user.upload(screen.getByLabelText('Choose file'), csvFile());

    expect(preview).toHaveBeenCalledWith(expect.any(File), 'inst-1');
  });
});

describe('the Import entry point on the asset list', () => {
  beforeEach(() => {
    vi.spyOn(assetCoreApi.assetsApi, 'scope').mockResolvedValue({
      departmentScoped: false,
      departments: [],
      createStandaloneAsset: true,
    });
    vi.spyOn(assetCoreApi.assetsApi, 'list').mockResolvedValue(page([]));
    vi.spyOn(assetCoreApi.locationsApi, 'list').mockResolvedValue(page([]));
    vi.spyOn(procurementApi.vendorsApi, 'list').mockResolvedValue(page([]));
    vi.spyOn(procurementApi.contractsApi, 'list').mockResolvedValue(page([]));
  });

  it('sits beside "New asset" for a registrar', async () => {
    signInWith(REGISTRAR);
    renderScreen(<AssetsPage />);

    expect(await screen.findByRole('link', { name: 'Import' })).toHaveAttribute(
      'href',
      '/assets/import'
    );
    expect(screen.getByRole('link', { name: 'New asset' })).toHaveAttribute('href', '/assets/new');
  });

  it('is hidden without asset-unit:create, while "New asset" stays', async () => {
    signInWith(['asset:read', 'asset:create']);
    renderScreen(<AssetsPage />);

    expect(await screen.findByRole('link', { name: 'New asset' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Import' })).not.toBeInTheDocument();
  });
});
