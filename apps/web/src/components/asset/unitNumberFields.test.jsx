import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as assetCoreApi from '@/api/assetCore';
import { changeLanguage } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { fakePreview } from '@/test/inventoryCodePreview';
import { UnitNumberFields } from './UnitNumberFields';
import { localUnitNumberStatus, unitNumbersReady } from './unitNumbers';

/**
 * Unit number fields with the live inventory code — P4 (`IMPLEMENTATION_PLAN.md`
 * §64.4). One field per unit; the typed part stands apart from what the format
 * fills in; empty and repeated values caught at once; the server's advice
 * (invalid, already issued) shown against the value it was given for; the
 * recently used unit numbers for reference, never a "next number".
 */

const REQUEST = { assetId: 'asset-1', departmentId: null };

function Harness({ count = 1, perUnit = true, previewRequest = REQUEST, showErrors = false }) {
  const [values, setValues] = useState(Array.from({ length: count }, () => ''));
  return (
    <UnitNumberFields
      values={values}
      onChange={setValues}
      perUnit={perUnit}
      maxLength={16}
      unitCount={count}
      previewRequest={previewRequest}
      waitingFor="Choose the asset to see the inventory code."
      showErrors={showErrors}
    />
  );
}

let preview;
const answer = (options) =>
  preview.mockImplementation((body) => Promise.resolve(fakePreview(body, options)));

beforeEach(() => {
  signInWith(['asset-unit:create']);
  preview = vi.spyOn(assetCoreApi.inventoryCodesApi, 'preview');
  answer({ recent: ['1.5', '1.4'] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const inputs = () => screen.getAllByLabelText(/^Unit number/);
const code = (index) => screen.getByTestId(`inventory-code-${index}`);
const row = (index) => within(screen.getByTestId(`unit-number-${index}`));

describe('UnitNumberFields (P4)', () => {
  it('gives each unit its own Unit number field', async () => {
    renderScreen(<Harness count={3} />);
    expect(inputs()).toHaveLength(3);
    expect(screen.getByText('Unit 1')).toBeInTheDocument();
    expect(screen.getByText('Unit 3')).toBeInTheDocument();
  });

  it('shows the inventory code as the unit number is typed, the typed part apart', async () => {
    renderScreen(<Harness />);
    await userEvent.type(inputs()[0], '1.6');

    // Shown at once, from what was typed; confirmed by the server after a pause.
    expect(code(0)).toHaveTextContent('1.6');
    await waitFor(() =>
      expect(preview).toHaveBeenLastCalledWith({ ...REQUEST, unitNumbers: ['1.6'] })
    );
    expect(await row(0).findByText('Not issued yet.')).toBeInTheDocument();
    expect(code(0)).toHaveTextContent('1.6/LAP_TOP/BOS_REG/2026');
    const typed = code(0).querySelector('[data-source="UNIT_NUMBER"]');
    expect(typed).toHaveTextContent('1.6');
    const generated = [...code(0).querySelectorAll('[data-source="GENERATED"]')];
    expect(generated.map((part) => part.textContent)).toEqual(['LAP_TOP', 'BOS_REG', '2026']);
  });

  it('shows the recently used unit numbers, labelled as such — never a next number', async () => {
    renderScreen(<Harness />);
    const recent = await screen.findByTestId('recent-unit-numbers');
    expect(within(recent).getByText('Recently used unit numbers')).toBeInTheDocument();
    expect(within(recent).getByText('1.5')).toBeInTheDocument();
    expect(within(recent).getByText('1.4')).toBeInTheDocument();
    expect(screen.queryByText(/next/i)).not.toBeInTheDocument();
  });

  it('catches a repeated value at once, before the server answers', async () => {
    preview.mockImplementation(() => new Promise(() => {}));
    renderScreen(<Harness count={2} />);
    await userEvent.type(inputs()[0], '1.9');
    await userEvent.type(inputs()[1], '1.9');
    expect(
      row(0).getByText('Already typed for another unit in this registration.')
    ).toBeInTheDocument();
    expect(
      row(1).getByText('Already typed for another unit in this registration.')
    ).toBeInTheDocument();
  });

  it('fills the fields from a pasted column, from the field pasted into', async () => {
    renderScreen(<Harness count={3} />);
    await userEvent.click(inputs()[1]);
    await userEvent.paste('1.9\n1.10\n1.11');
    expect(inputs().map((input) => input.value)).toEqual(['', '1.9', '1.10']);
  });

  it('treats 1.9 and 1.10 as different values', async () => {
    renderScreen(<Harness count={2} />);
    await userEvent.type(inputs()[0], '1.9');
    await userEvent.type(inputs()[1], '1.10');
    await waitFor(() => expect(code(1)).toHaveTextContent('1.10/LAP_TOP/BOS_REG/2026'));
    expect(screen.queryByText(/Already typed/)).not.toBeInTheDocument();
  });

  it('reports what the server says of a value: invalid, or already issued', async () => {
    answer({ invalid: ['1/6'], issued: ['1.1'] });
    renderScreen(<Harness count={2} />);
    await userEvent.type(inputs()[0], '1/6');
    await userEvent.type(inputs()[1], '1.1');
    expect(
      await row(0).findByText('Cannot be used in an inventory code: contains unsafe characters')
    ).toBeInTheDocument();
    expect(
      await row(1).findByText(
        'This inventory code has already been issued. Choose another unit number.'
      )
    ).toBeInTheDocument();
  });

  it('says an empty field needs a value, and insists once a save was tried', async () => {
    const { unmount } = renderScreen(<Harness />);
    expect(row(0).getByText('Type a unit number.')).toBeInTheDocument();
    unmount();
    renderScreen(<Harness showErrors />);
    expect(row(0).getByText('A unit number is required.')).toBeInTheDocument();
  });

  it('names what else the code is missing, and does not call it ready', async () => {
    answer({
      problems: [{ field: 'fundingSourceId', issue: 'choose the funding source (REQ-UNIT-012)' }],
    });
    renderScreen(<Harness />);
    await userEvent.type(inputs()[0], '2');
    expect(await screen.findByText('choose the funding source (REQ-UNIT-012)')).toBeInTheDocument();
    expect(
      await row(0).findByText('The rest of the code is not complete yet — see below.')
    ).toBeInTheDocument();
    expect(code(0).querySelector('[data-source="GENERATED"]')).toBeInTheDocument();
  });

  it('asks for nothing from the server until the asset is known', async () => {
    renderScreen(<Harness previewRequest={null} />);
    expect(code(0)).toHaveTextContent('Choose the asset to see the inventory code.');
    expect(preview).not.toHaveBeenCalled();
  });

  it('explains a batch sharing one value when a sequence separates the units', async () => {
    renderScreen(<Harness perUnit={false} count={1} />);
    expect(inputs()).toHaveLength(1);
    expect(screen.getByText(/each unit gets its own sequence number/)).toBeInTheDocument();
  });

  it('speaks Indonesian: Nomor unit, Kode inventaris', async () => {
    changeLanguage('id');
    renderScreen(<Harness />);
    expect(screen.getAllByText('Nomor unit').length).toBeGreaterThan(0);
    expect(screen.getByText('Kode inventaris')).toBeInTheDocument();
    expect(await screen.findByText('Nomor unit yang baru digunakan')).toBeInTheDocument();
  });

  it('decides readiness from empty and repeated values only', () => {
    expect(localUnitNumberStatus(['1', '', '1', ' 2 '])).toEqual([
      'DUPLICATE_IN_BATCH',
      'EMPTY',
      'DUPLICATE_IN_BATCH',
      null,
    ]);
    expect(unitNumbersReady(['1.9', '1.10'])).toBe(true);
    expect(unitNumbersReady(['1.9', ''])).toBe(false);
    expect(unitNumbersReady(['1', '1'])).toBe(false);
  });
});
