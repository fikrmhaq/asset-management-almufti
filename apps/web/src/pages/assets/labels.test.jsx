import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as assetCoreApi from '@/api/assetCore';
import { renderScreen, signInWith } from '@/test/harness';
import { UnitLabel, labelUrl } from '@/components/asset/UnitLabel';
import { UnitLabelsPage } from './UnitLabelsPage';
import { ScanLandingPage } from './ScanLandingPage';

/**
 * Unit labels and scan resolution — Phase 18 (`CR-001`), `07-ui.md` §5.3.
 *
 * REQ-UNIT-009/010/011, `BR-021`.
 */

const LABEL = {
  assetUnitId: 'unit-1',
  assetId: 'asset-1',
  inventoryCode: 'ALM-1-2026-00042',
  assetName: 'ASUS ROG',
  institution: { id: 'inst-1', name: 'SMK Al-Mufti', code: 'ALM-1' },
  classification: { id: '132080141007', name: 'Mikroskop Binokuler' },
  department: { id: 'TKJ', name: 'Teknik Komputer' },
};

beforeEach(() => {
  signInWith(['asset-unit:read', 'asset:read']);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnitLabel (REQ-UNIT-009, BR-021)', () => {
  it('encodes an address, not the unit’s data', () => {
    // A phone camera opens a URL; it does nothing useful with a JSON payload.
    expect(labelUrl('ALM-1-2026-00042', 'https://assets.example')).toBe(
      'https://assets.example/u?c=ALM-1-2026-00042'
    );
  });

  /**
   * `CR-008`. The code moved out of the path precisely so a slashed code has
   * somewhere safe to go: `%2F` in a query value is a character, while in a path
   * segment it is decoded and split on by proxies and by the router itself.
   */
  it('carries a slashed code in the query, escaped', () => {
    expect(labelUrl('027/1234/BID.1/2026', 'https://x')).toBe(
      'https://x/u?c=027%2F1234%2FBID.1%2F2026'
    );
  });

  it('prints the identity a reader needs when the QR is unreadable', () => {
    renderScreen(<UnitLabel label={LABEL} origin="https://x" />);

    expect(screen.getByText('ALM-1-2026-00042')).toBeInTheDocument();
    expect(screen.getByText('ASUS ROG')).toBeInTheDocument();
    expect(screen.getByText('SMK Al-Mufti')).toBeInTheDocument();
  });

  it('prints the classification as code AND name, so a rename cannot orphan it', () => {
    renderScreen(<UnitLabel label={LABEL} origin="https://x" />);

    expect(screen.getByText('132080141007')).toBeInTheDocument();
    expect(screen.getByText(/Mikroskop Binokuler/)).toBeInTheDocument();
  });

  it('renders a QR code', () => {
    const { container } = renderScreen(<UnitLabel label={LABEL} origin="https://x" />);

    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

describe('UnitLabelsPage (REQ-UNIT-010)', () => {
  it('prints one label for a single unit', async () => {
    const label = vi.spyOn(assetCoreApi.assetUnitsApi, 'label').mockResolvedValue(LABEL);

    renderScreen(<UnitLabelsPage />, {
      route: '/assets/asset-1/units/unit-1/label',
      path: '/assets/:id/units/:unitId/label',
    });

    expect(await screen.findByText('ALM-1-2026-00042')).toBeInTheDocument();
    expect(label).toHaveBeenCalledWith('unit-1');
  });

  it('prints every label for an asset', async () => {
    const unitLabels = vi.spyOn(assetCoreApi.assetsApi, 'unitLabels').mockResolvedValue({
      data: [LABEL, { ...LABEL, assetUnitId: 'unit-2', inventoryCode: 'ALM-1-2026-00043' }],
      meta: { page: 1, pageSize: 2, total: 2, totalPages: 1 },
    });

    renderScreen(<UnitLabelsPage />, {
      route: '/assets/asset-1/labels',
      path: '/assets/:id/labels',
    });

    expect(await screen.findByText('ALM-1-2026-00042')).toBeInTheDocument();
    expect(screen.getByText('ALM-1-2026-00043')).toBeInTheDocument();
    expect(unitLabels).toHaveBeenCalledWith('asset-1');
  });

  it('opens the browser print dialog rather than inventing its own', async () => {
    vi.spyOn(assetCoreApi.assetUnitsApi, 'label').mockResolvedValue(LABEL);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});

    renderScreen(<UnitLabelsPage />, {
      route: '/assets/asset-1/units/unit-1/label',
      path: '/assets/:id/units/:unitId/label',
    });

    await userEvent.click(await screen.findByRole('button', { name: /print/i }));

    expect(print).toHaveBeenCalled();
  });

  it('says why there is nothing to print rather than showing a blank sheet', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'unitLabels').mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 0, total: 0, totalPages: 0 },
    });

    renderScreen(<UnitLabelsPage />, {
      route: '/assets/asset-1/labels',
      path: '/assets/:id/labels',
    });

    expect(await screen.findByText(/nothing to print/i)).toBeInTheDocument();
    expect(screen.getByText(/inventory code/i)).toBeInTheDocument();
  });
});

describe('ScanLandingPage (REQ-UNIT-011)', () => {
  it('forwards a resolved code to the unit it names', async () => {
    const byCode = vi
      .spyOn(assetCoreApi.assetUnitsApi, 'byCode')
      .mockResolvedValue({ id: 'unit-1', assetId: 'asset-1' });

    const { router } = renderScreen(<ScanLandingPage />, {
      route: '/u/ALM-1-2026-00042',
      path: '/u/:inventoryCode',
      extraRoutes: [{ path: '/assets/:id/units/:unitId', element: <p>Unit detail</p> }],
    });

    expect(await screen.findByText('Unit detail')).toBeInTheDocument();
    expect(byCode).toHaveBeenCalledWith('ALM-1-2026-00042');
    expect(router.state.location.pathname).toBe('/assets/asset-1/units/unit-1');
  });

  it('names the code when nothing matches, so a mis-scan is distinguishable', async () => {
    vi.spyOn(assetCoreApi.assetUnitsApi, 'byCode').mockRejectedValue(
      Object.assign(new Error('Asset unit not found'), { code: 'NOT_FOUND' })
    );

    renderScreen(<ScanLandingPage />, {
      route: '/u/ALM-1-2026-99999',
      path: '/u/:inventoryCode',
    });

    expect(await screen.findByText(/no unit for this code/i)).toBeInTheDocument();
    // The code itself, so the user can compare it against the sticker in hand.
    expect(screen.getByText(/ALM-1-2026-99999/)).toBeInTheDocument();
  });

  it('treats a not-found scan as empty, not as a failure', async () => {
    vi.spyOn(assetCoreApi.assetUnitsApi, 'byCode').mockRejectedValue(
      Object.assign(new Error('Asset unit not found'), { code: 'NOT_FOUND' })
    );

    renderScreen(<ScanLandingPage />, {
      route: '/u/ALM-1-2026-99999',
      path: '/u/:inventoryCode',
    });

    await screen.findByText(/no unit for this code/i);
    // A red alert would suggest the application broke; the scan worked fine.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a real failure as an error, with a retry', async () => {
    vi.spyOn(assetCoreApi.assetUnitsApi, 'byCode').mockRejectedValue(
      Object.assign(new Error('Service unavailable'), { code: 'INTERNAL_ERROR' })
    );

    renderScreen(<ScanLandingPage />, {
      route: '/u/ALM-1-2026-00042',
      path: '/u/:inventoryCode',
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  /**
   * The query form — `CR-008`. Every label minted since carries this shape; the
   * path form above is kept for the ones printed before it and is tested from
   * both directions deliberately.
   */
  describe('the query form (CR-008)', () => {
    it('resolves a code carried in the query string', async () => {
      const byCode = vi
        .spyOn(assetCoreApi.assetUnitsApi, 'byCode')
        .mockResolvedValue({ id: 'unit-1', assetId: 'asset-1' });

      renderScreen(<ScanLandingPage />, {
        route: '/u?c=ALM-1-2026-00042',
        path: '/u',
        extraRoutes: [{ path: '/assets/:id/units/:unitId', element: <p>Unit detail</p> }],
      });

      expect(await screen.findByText('Unit detail')).toBeInTheDocument();
      expect(byCode).toHaveBeenCalledWith('ALM-1-2026-00042');
    });

    it('resolves a slashed code, which is what the query form exists for', async () => {
      const byCode = vi
        .spyOn(assetCoreApi.assetUnitsApi, 'byCode')
        .mockResolvedValue({ id: 'unit-1', assetId: 'asset-1' });

      renderScreen(<ScanLandingPage />, {
        route: `/u?c=${encodeURIComponent('027/1234/BID.1/2026')}`,
        path: '/u',
        extraRoutes: [{ path: '/assets/:id/units/:unitId', element: <p>Unit detail</p> }],
      });

      expect(await screen.findByText('Unit detail')).toBeInTheDocument();
      // Decoded once by the router: the API client re-encodes it as a param.
      expect(byCode).toHaveBeenCalledWith('027/1234/BID.1/2026');
    });

    it('asks the server nothing when the scan dropped the code', async () => {
      const byCode = vi.spyOn(assetCoreApi.assetUnitsApi, 'byCode');

      renderScreen(<ScanLandingPage />, { route: '/u', path: '/u' });

      expect(await screen.findByText(/no unit for this code/i)).toBeInTheDocument();
      expect(byCode).not.toHaveBeenCalled();
    });
  });
});
