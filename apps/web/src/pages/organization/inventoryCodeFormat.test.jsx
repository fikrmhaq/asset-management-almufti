import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, ERROR_CODES } from '@/api/errors';
import * as organizationApi from '@/api/organization';
import { renderScreen, signInWith } from '@/test/harness';
import { changeLanguage } from '@/i18n';
import { InventoryCodeFormatBuilder } from '@/components/organization/InventoryCodeFormatBuilder';
import { InventoryCodeFormatPage } from './InventoryCodeFormatPage';

/**
 * The inventory code format builder — Phase 25 (`CR-006`), REQ-ORG-007,
 * `07-ui.md` §5.1.
 */

const READ = 'inventory-code-format:read';
const UPDATE = 'inventory-code-format:update';

const token = (id, name, overrides = {}) => ({
  id,
  name,
  description: `${name} description`,
  source: 'somewhere',
  alwaysAvailable: true,
  maxLength: 25,
  sample: id,
  resolvable: true,
  ...overrides,
});

const TOKENS = [
  token('INSTITUTION_CODE', 'Institution code', { sample: 'ALM-1' }),
  token('REGISTRATION_YEAR', 'Registration year', { sample: '2026', maxLength: 4 }),
  token('REGISTRATION_YEAR_SHORT', 'Registration year (2-digit)', { sample: '26', maxLength: 2 }),
  token('CLASSIFICATION_CODE', 'Classification code', { sample: '202010500200', maxLength: 12 }),
  token('DEPARTMENT_CODE', 'Department code', {
    sample: 'TKJ',
    maxLength: 8,
    alwaysAvailable: false,
  }),
  token('NUMBER_COMPOSITION', 'Unit number', {
    sample: '001-02-03',
    maxLength: 16,
    alwaysAvailable: false,
  }),
  token('SEQUENCE', 'Sequence', { sample: '00001', maxLength: 8 }),
];

const config = (overrides = {}) => ({
  format: '{INSTITUTION_CODE}-{REGISTRATION_YEAR}-{SEQUENCE}',
  isDefault: true,
  preview: 'ALM-1-2026-00001',
  unresolved: [],
  maxLength: 64,
  tokens: TOKENS,
  ...overrides,
});

const preview = () => screen.getByTestId('inventory-code-preview');

/**
 * The chips, scoped.
 *
 * A token's display name appears twice on the screen — once as a chip and once
 * as an option in the add control — so an unscoped query is ambiguous by
 * design rather than by accident.
 */
const chips = () => within(screen.getByTestId('inventory-code-segments'));

const chipFor = (name) => chips().getByText(name).closest('li');

/**
 * Waits for the row to be laid out, scoped to it.
 *
 * `screen.findByText('Institution code')` is not the same thing and must not be
 * used for it: the name is also an option in the add control, so an unscoped
 * query resolves against whichever of the two renders first and starts throwing
 * "found multiple elements" the moment it does not win that race.
 */
const findChip = (name) => waitFor(() => chipFor(name));

beforeEach(() => {
  signInWith([READ, UPDATE]);
  vi.spyOn(organizationApi.institutionsApi, 'inventoryCodeFormat').mockResolvedValue(config());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rendering the configured format', () => {
  it('shows each token by its display name, not its identifier', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);

    await screen.findByTestId('inventory-code-segments');

    expect(chips().getByText('Institution code')).toBeInTheDocument();
    expect(chips().getByText('Registration year')).toBeInTheDocument();
    expect(chips().getByText('Sequence')).toBeInTheDocument();
    // The user never sees, or types, the stored form.
    expect(screen.queryByText('{INSTITUTION_CODE}')).not.toBeInTheDocument();
  });

  it('previews the code from the server-supplied samples', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);

    expect(await screen.findByTestId('inventory-code-preview')).toHaveTextContent(
      'ALM-1-2026-00001'
    );
  });

  it('offers the four safe separators, the slash among them (CR-008)', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    for (const separator of ['-', '_', '.', '/']) {
      expect(screen.getByRole('button', { name: separator })).toBeInTheDocument();
    }
  });

  it('does not offer a second sequence while the format already has one', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    const options = [...screen.getByLabelText('Add a value').querySelectorAll('option')];

    expect(options.map((option) => option.value)).not.toContain('SEQUENCE');
  });

  it('offers the sequence once the format has none (CR-007)', async () => {
    organizationApi.institutionsApi.inventoryCodeFormat.mockResolvedValue(
      config({
        format: '{INSTITUTION_CODE}-{NUMBER_COMPOSITION}',
        isDefault: false,
        preview: 'ALM-1-001-02-03',
      })
    );

    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    const options = [...screen.getByLabelText('Add a value').querySelectorAll('option')];

    expect(options.map((option) => option.value)).toContain('SEQUENCE');
  });

  it('says that a change affects only future registrations', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);

    expect(await screen.findByText(/affects only units registered afterwards/i)).toBeInTheDocument();
  });
});

describe('editing', () => {
  it('adds a token before the sequence, which stays last', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    await userEvent.selectOptions(screen.getByLabelText('Add a value'), 'CLASSIFICATION_CODE');

    await waitFor(() => expect(preview()).toHaveTextContent('ALM-1-2026-20201050020000001'));
  });

  it('removes a token', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Registration year');

    await userEvent.click(within(chipFor('Registration year')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(preview()).toHaveTextContent('ALM-1--00001'));
  });

  it('reorders tokens', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Registration year');

    await userEvent.click(
      within(chipFor('Registration year')).getByRole('button', { name: 'Move earlier' })
    );

    // The year swaps with the separator before it, so the code becomes
    // institution + year, then the two separators, then the sequence.
    await waitFor(() => expect(preview()).toHaveTextContent('ALM-12026--00001'));
  });

  it('gives the sequence no reorder control, so it cannot be taken off the end', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Sequence');

    const chip = within(chipFor('Sequence'));

    expect(chip.queryByRole('button', { name: 'Move earlier' })).not.toBeInTheDocument();
    expect(chip.queryByRole('button', { name: 'Move later' })).not.toBeInTheDocument();
  });

  /**
   * The `CR-007` rule, from both sides — the builder must let a composition
   * format drop the sequence, and must not let any format drop the last thing
   * telling two units apart.
   */
  it('refuses to remove the sequence while nothing else distinguishes units, and says why', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Sequence');

    await userEvent.click(within(chipFor('Sequence')).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText(/only thing separating one unit from another/i)).toBeInTheDocument();
    expect(preview()).toHaveTextContent('ALM-1-2026-00001');
  });

  it('removes the sequence once a number composition distinguishes the units', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Sequence');

    await userEvent.selectOptions(screen.getByLabelText('Add a value'), 'NUMBER_COMPOSITION');
    await userEvent.click(within(chipFor('Sequence')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(preview()).toHaveTextContent('ALM-1-2026-001-02-03'));
    expect(chips().queryByText('Sequence')).not.toBeInTheDocument();
  });

  it('refuses to remove the composition once it is the only thing left', async () => {
    organizationApi.institutionsApi.inventoryCodeFormat.mockResolvedValue(
      config({
        format: '{INSTITUTION_CODE}-{NUMBER_COMPOSITION}',
        isDefault: false,
        preview: 'ALM-1-001-02-03',
      })
    );

    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Unit number');

    await userEvent.click(
      within(chipFor('Unit number')).getByRole('button', { name: 'Remove' })
    );

    expect(await screen.findByText(/only thing separating one unit from another/i)).toBeInTheDocument();
    expect(preview()).toHaveTextContent('ALM-1-001-02-03');
  });

  /**
   * With no sequence there is no pinned last chip, and the arrangeable region
   * runs to the end of the row. A ceiling computed from a missing sequence
   * would read as -1 and freeze every arrow.
   */
  it('still reorders when the format allocates no sequence', async () => {
    organizationApi.institutionsApi.inventoryCodeFormat.mockResolvedValue(
      config({
        format: '{INSTITUTION_CODE}-{NUMBER_COMPOSITION}',
        isDefault: false,
        preview: 'ALM-1-001-02-03',
      })
    );

    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Unit number');

    await userEvent.click(
      within(chipFor('Institution code')).getByRole('button', { name: 'Move later' })
    );

    await waitFor(() => expect(preview()).toHaveTextContent('-ALM-1001-02-03'));
  });

  it('puts a re-added sequence back on the end', async () => {
    organizationApi.institutionsApi.inventoryCodeFormat.mockResolvedValue(
      config({
        format: '{NUMBER_COMPOSITION}-{INSTITUTION_CODE}',
        isDefault: false,
        preview: '001-02-03-ALM-1',
      })
    );

    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Unit number');

    await userEvent.selectOptions(screen.getByLabelText('Add a value'), 'SEQUENCE');

    await waitFor(() => expect(preview()).toHaveTextContent('001-02-03-ALM-100001'));
  });

  it('saves the stored template form, not the preview', async () => {
    const save = vi
      .spyOn(organizationApi.institutionsApi, 'setInventoryCodeFormat')
      .mockResolvedValue(config({ isDefault: false }));

    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    await userEvent.selectOptions(screen.getByLabelText('Add a value'), 'DEPARTMENT_CODE');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'inst-1',
        '{INSTITUTION_CODE}-{REGISTRATION_YEAR}-{DEPARTMENT_CODE}{SEQUENCE}'
      )
    );
  });

  it('builds a slashed format, which is the shape CR-008 exists for', async () => {
    organizationApi.institutionsApi.inventoryCodeFormat.mockResolvedValue(
      config({ format: '{INSTITUTION_CODE}{SEQUENCE}', isDefault: false, preview: 'ALM-100001' })
    );
    const save = vi
      .spyOn(organizationApi.institutionsApi, 'setInventoryCodeFormat')
      .mockResolvedValue(config({ isDefault: false }));

    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    await userEvent.click(screen.getByRole('button', { name: '/' }));

    await waitFor(() => expect(preview()).toHaveTextContent('ALM-1/00001'));

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('inst-1', '{INSTITUTION_CODE}/{SEQUENCE}')
    );
  });

  it('clears the format with null when reset to the default', async () => {
    vi.spyOn(organizationApi.institutionsApi, 'inventoryCodeFormat').mockResolvedValue(
      config({ isDefault: false, format: '{INSTITUTION_CODE}-{SEQUENCE}' })
    );
    const save = vi
      .spyOn(organizationApi.institutionsApi, 'setInventoryCodeFormat')
      .mockResolvedValue(config());

    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    await userEvent.click(screen.getByRole('button', { name: /use the default/i }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('inst-1', null));
  });

  it('keeps save disabled until something changes', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });
});

describe('consequences are stated at the control', () => {
  it('warns that an optional token makes the underlying field required', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    await userEvent.selectOptions(screen.getByLabelText('Add a value'), 'DEPARTMENT_CODE');

    expect(
      await screen.findByText(/every unit registered from now on must have it/i)
    ).toBeInTheDocument();
  });

  it('warns that a sequenceless format needs a typed value for every unit of a batch', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Sequence');

    await userEvent.selectOptions(screen.getByLabelText('Add a value'), 'NUMBER_COMPOSITION');

    // Still allocating a sequence: one typed value covers a whole batch.
    expect(screen.queryByText(/including every unit of a procurement batch/i)).not.toBeInTheDocument();

    await userEvent.click(within(chipFor('Sequence')).getByRole('button', { name: 'Remove' }));

    expect(
      await screen.findByText(/including every unit of a procurement batch/i)
    ).toBeInTheDocument();
  });

  it('warns when the format drops the institution code', async () => {
    vi.spyOn(organizationApi.institutionsApi, 'inventoryCodeFormat').mockResolvedValue(
      config({ format: '{CLASSIFICATION_CODE}-{SEQUENCE}', isDefault: false })
    );

    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);

    expect(await screen.findByText(/numbering is shared with any other institution/i)).toBeInTheDocument();
  });

  it('marks an unresolvable token instead of inventing a value for it', async () => {
    vi.spyOn(organizationApi.institutionsApi, 'inventoryCodeFormat').mockResolvedValue(
      config({
        format: '{DEPARTMENT_CODE}-{SEQUENCE}',
        isDefault: false,
        tokens: TOKENS.map((entry) =>
          entry.id === 'DEPARTMENT_CODE' ? { ...entry, resolvable: false } : entry
        ),
      })
    );

    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);

    expect(await screen.findByTestId('inventory-code-preview')).toHaveTextContent(
      '{DEPARTMENT_CODE}-00001'
    );
    expect(screen.getByText(/no value available to preview/i)).toBeInTheDocument();
  });
});

describe('server validation is shown against the builder', () => {
  it('lists the reasons rather than toasting them (§4.3)', async () => {
    vi.spyOn(organizationApi.institutionsApi, 'setInventoryCodeFormat').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'The inventory code format is not valid',
        status: 400,
        details: [{ field: 'format', issue: 'must end with {SEQUENCE} — nothing may follow it' }],
      })
    );

    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    await userEvent.selectOptions(screen.getByLabelText('Add a value'), 'DEPARTMENT_CODE');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/must end with \{SEQUENCE\}/)).toBeInTheDocument();
  });
});

describe('permission gating (§6)', () => {
  it('renders read-only without the update permission', async () => {
    signInWith([READ]);
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    await findChip('Institution code');

    expect(screen.queryByLabelText('Add a value')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    expect(chips().queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

describe('the scoped entry point', () => {
  it("configures the caller's own institution without asking which", async () => {
    signInWith([READ, UPDATE], { institutionId: 'inst-9', isSystemWide: false });

    renderScreen(<InventoryCodeFormatPage />);

    await waitFor(() =>
      expect(organizationApi.institutionsApi.inventoryCodeFormat).toHaveBeenCalledWith('inst-9')
    );
  });

  it('sends a caller with no institution to the institution screen instead', async () => {
    signInWith([READ, UPDATE], { institutionId: null });

    renderScreen(<InventoryCodeFormatPage />);

    expect(await screen.findByText(/no institution to configure/i)).toBeInTheDocument();
    expect(organizationApi.institutionsApi.inventoryCodeFormat).not.toHaveBeenCalled();
  });
});

/**
 * P4 (`IMPLEMENTATION_PLAN.md` §64.4): who provides each part — the Unit number
 * typed by the registrar, the rest filled in or assigned — with an example.
 */
describe('explaining who provides each part (P4)', () => {
  const unitNumberFormat = () =>
    config({
      format: '{NUMBER_COMPOSITION}/{CLASSIFICATION_CODE}/{REGISTRATION_YEAR}',
      isDefault: false,
    });

  it('marks the unit number as typed and every other part as filled in', async () => {
    vi.spyOn(organizationApi.institutionsApi, 'inventoryCodeFormat').mockResolvedValue(
      unitNumberFormat()
    );
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);

    const roles = within(await screen.findByTestId('inventory-code-roles'));
    expect(roles.getByText('Who provides each part')).toBeInTheDocument();
    expect(roles.getByText('Unit number')).toBeInTheDocument();
    expect(roles.getByText('Typed by the person registering, for each unit')).toBeInTheDocument();
    expect(
      roles.getByText("Filled in automatically from the asset's classification")
    ).toBeInTheDocument();
    expect(
      roles.getByText('Filled in automatically from the year the unit is registered')
    ).toBeInTheDocument();
    expect(roles.getByText(/never this format or its parts/)).toBeInTheDocument();
  });

  it('gives an example with the typed unit number inside the code', async () => {
    vi.spyOn(organizationApi.institutionsApi, 'inventoryCodeFormat').mockResolvedValue(
      unitNumberFormat()
    );
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);

    expect(await screen.findByTestId('inventory-code-example')).toHaveTextContent(
      'The person registering types 1.6 and the inventory code becomes 1.6/202010500200/2026'
    );
  });

  it('says nothing is typed when the format has no unit number', async () => {
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);
    const roles = within(await screen.findByTestId('inventory-code-roles'));
    expect(roles.getByText(/nothing is typed at registration/)).toBeInTheDocument();
    expect(
      roles.getByText('Assigned automatically at registration, counting up')
    ).toBeInTheDocument();
  });

  it('names the parts in Indonesian', async () => {
    changeLanguage('id');
    vi.spyOn(organizationApi.institutionsApi, 'inventoryCodeFormat').mockResolvedValue(
      unitNumberFormat()
    );
    renderScreen(<InventoryCodeFormatBuilder institutionId="inst-1" />);

    await waitFor(() => chipFor('Nomor unit'));
    const roles = within(screen.getByTestId('inventory-code-roles'));
    expect(roles.getByText('Siapa mengisi setiap bagian')).toBeInTheDocument();
    expect(
      roles.getByText('Diketik oleh petugas yang mendaftarkan, untuk setiap unit')
    ).toBeInTheDocument();
  });
});
