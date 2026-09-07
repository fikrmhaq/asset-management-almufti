import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as referenceApi from '@/api/reference';
import { renderScreen, signInWith } from '@/test/harness';
import { ClassificationPicker } from '@/components/reference/ClassificationPicker';
import { ClassificationsPage } from './ClassificationsPage';
import { AttributeDefinitionsPage } from './AttributeDefinitionsPage';
import { LookupsPage } from './LookupsPage';

/**
 * Reference screens and the classification picker — `07-ui.md` §4.5, §5.2;
 * `IMPLEMENTATION_PLAN.md` §17.5, §17.6.
 */

const ALL = [
  'classification:read',
  'attribute-definition:read',
  'attribute-definition:create',
  'attribute-definition:update',
  'attribute-definition:deactivate',
  'measurement-unit:read',
  'measurement-unit:create',
  'measurement-unit:delete',
  'contract-type:read',
  'funding-source:read',
  'transaction-type:read',
  'account-code:read',
  'category:read',
];

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: 100, total: rows.length, totalPages: 1 },
});

const ROOTS = [
  { id: '100000000000', name: 'Aset Tetap', parentId: null, isLeaf: false },
  { id: '200000000000', name: 'Aset Lainnya', parentId: null, isLeaf: false },
];

const CHILDREN = [{ id: '110000000000', name: 'Tanah', parentId: '100000000000', isLeaf: false }];
const GRANDCHILDREN = [
  { id: '117010101001', name: 'Aspal', parentId: '110000000000', isLeaf: true },
];

beforeEach(() => {
  signInWith(ALL);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClassificationPicker — drill-down (§4.5)', () => {
  beforeEach(() => {
    vi.spyOn(referenceApi.classificationsApi, 'list').mockResolvedValue(page(ROOTS));
    vi.spyOn(referenceApi.classificationsApi, 'children').mockImplementation((id) =>
      Promise.resolve(page(id === '100000000000' ? CHILDREN : GRANDCHILDREN))
    );
  });

  it('starts at the root level', async () => {
    renderScreen(<ClassificationPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText('Aset Tetap')).toBeInTheDocument();
    expect(screen.getByText('Aset Lainnya')).toBeInTheDocument();
    // Root nodes come from `/classifications` with no parentId.
    expect(referenceApi.classificationsApi.list).toHaveBeenCalled();
  });

  it('narrows one level at a time and builds a breadcrumb', async () => {
    renderScreen(<ClassificationPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    await userEvent.click(await screen.findByText('Aset Tetap'));
    expect(await screen.findByText('Tanah')).toBeInTheDocument();

    const trail = screen.getByRole('navigation', { name: /classification path/i });
    expect(trail).toHaveTextContent('Aset Tetap');
  });

  it('selects a leaf instead of drilling into it', async () => {
    const onSelect = vi.fn();
    renderScreen(<ClassificationPicker open onOpenChange={vi.fn()} onSelect={onSelect} />);

    await userEvent.click(await screen.findByText('Aset Tetap'));
    await userEvent.click(await screen.findByText('Tanah'));
    await userEvent.click(await screen.findByText('Aspal'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: '117010101001' }));
  });

  it('jumps back up through the breadcrumb', async () => {
    renderScreen(<ClassificationPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    await userEvent.click(await screen.findByText('Aset Tetap'));
    await screen.findByText('Tanah');

    await userEvent.click(
      within(screen.getByRole('navigation', { name: /classification path/i })).getByText('All')
    );

    expect(await screen.findByText('Aset Lainnya')).toBeInTheDocument();
  });
});

describe('ClassificationPicker — leaf search (§4.5)', () => {
  beforeEach(() => {
    vi.spyOn(referenceApi.classificationsApi, 'list').mockResolvedValue(page(ROOTS));
    vi.spyOn(referenceApi.classificationsApi, 'searchLeaves').mockResolvedValue(
      page(GRANDCHILDREN)
    );
  });

  it('switches to leaf search once a term is typed', async () => {
    renderScreen(<ClassificationPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);
    await screen.findByText('Aset Tetap');

    await userEvent.type(screen.getByLabelText(/search classifications/i), 'aspal');

    await waitFor(() =>
      expect(referenceApi.classificationsApi.searchLeaves).toHaveBeenCalledWith(
        'aspal',
        // The scope the offered set follows (`BR-019`) — empty when the caller's
        // own institution is the one in view.
        {}
      )
    );
    expect(await screen.findByText('Aspal')).toBeInTheDocument();
    // The drill-down breadcrumb is irrelevant while searching.
    expect(
      screen.queryByRole('navigation', { name: /classification path/i })
    ).not.toBeInTheDocument();
  });

  it('does not search on a single character', async () => {
    renderScreen(<ClassificationPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);
    await screen.findByText('Aset Tetap');

    await userEvent.type(screen.getByLabelText(/search classifications/i), 'a');

    expect(referenceApi.classificationsApi.searchLeaves).not.toHaveBeenCalled();
  });

  it('selecting a search result closes the picker like reaching a leaf does', async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    renderScreen(<ClassificationPicker open onOpenChange={onOpenChange} onSelect={onSelect} />);
    await screen.findByText('Aset Tetap');

    await userEvent.type(screen.getByLabelText(/search classifications/i), 'aspal');
    await userEvent.click(await screen.findByText('Aspal'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: '117010101001' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ClassificationsPage', () => {
  beforeEach(() => {
    vi.spyOn(referenceApi.classificationsApi, 'list').mockResolvedValue(page(ROOTS));
    vi.spyOn(referenceApi.classificationsApi, 'children').mockResolvedValue(page(GRANDCHILDREN));
    // Keyed by id rather than one answer for every call: the page now resolves
    // the parent through this same endpoint, and a single canned response would
    // have made the parent indistinguishable from the node itself.
    vi.spyOn(referenceApi.classificationsApi, 'get').mockImplementation((id) =>
      Promise.resolve(
        id === '110000000000'
          ? {
              id: '110000000000',
              name: 'Tanah',
              parentId: '100000000000',
              origin: 1,
              categoryId: null,
              institutionId: null,
              isAppDefined: false,
              acceptsChildren: false,
            }
          : {
              id: '117010101001',
              name: 'Aspal',
              parentId: '110000000000',
              origin: 1,
              categoryId: 3,
              institutionId: null,
              isAppDefined: false,
              acceptsChildren: false,
            }
      )
    );
    vi.spyOn(referenceApi.classificationsApi, 'attributeDefinitions').mockResolvedValue([]);
    vi.spyOn(referenceApi.categoriesApi, 'list').mockResolvedValue(
      page([{ id: 3, name: 'Peralatan dan Mesin' }])
    );
  });

  /** Opens the picker and drills down to the leaf the mocks above describe. */
  async function selectAspal() {
    const [openPicker] = await screen.findAllByRole('button', { name: /browse classifications/i });
    await userEvent.click(openPicker);
    await userEvent.click(await screen.findByText('Aset Tetap'));
    await userEvent.click(await screen.findByText('Aspal'));
  }

  it('offers no rename or delete on a government classification (BR-016)', async () => {
    renderScreen(<ClassificationsPage />);
    await selectAspal();
    await screen.findByText('Aspal');

    // The controls are ABSENT, not disabled: the server would refuse them, and a
    // control that always fails teaches nothing.
    for (const label of [/rename/i, /delete/i, /share with all/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('offers no add on a node that cannot accept one (REQ-CLASS-012)', async () => {
    renderScreen(<ClassificationsPage />);
    await selectAspal();
    await screen.findByText('Aspal');

    expect(screen.queryByRole('button', { name: /add entry/i })).not.toBeInTheDocument();
  });

  it('shows a classification and its configured attributes once one is chosen', async () => {
    renderScreen(<ClassificationsPage />);

    // The header action and the empty-state call-to-action share a label; either
    // opens the picker.
    await selectAspal();

    expect(await screen.findByText('117010101001')).toBeInTheDocument();
    expect(screen.getByText('No attributes configured')).toBeInTheDocument();
  });

  it('names the parent and the category instead of printing their keys', async () => {
    renderScreen(<ClassificationsPage />);
    await selectAspal();

    // The stored values are a `CHAR(12)` code and an integer; neither says
    // anything on its own. The code stays visible beside the name because it is
    // the natural key people quote.
    expect(await screen.findByText('Tanah')).toBeInTheDocument();
    expect(screen.getByText('110000000000')).toBeInTheDocument();
    expect(await screen.findByText('Peralatan dan Mesin')).toBeInTheDocument();
  });

  it('does not ask for categories on behalf of a caller who cannot read them', async () => {
    signInWith(['classification:read', 'attribute-definition:read']);
    renderScreen(<ClassificationsPage />);
    await selectAspal();

    expect(await screen.findByText('117010101001')).toBeInTheDocument();
    // Hidden work, not a hidden 403: the request is never made, and the stored
    // id is shown rather than a blank.
    expect(referenceApi.categoriesApi.list).not.toHaveBeenCalled();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('AttributeDefinitionsPage', () => {
  beforeEach(() => {
    vi.spyOn(referenceApi.attributeDefinitionsApi, 'list').mockResolvedValue(
      page([
        {
          id: 'a1',
          name: 'Serial number',
          classificationId: '117010101001',
          attributeType: 'TEXT',
          scope: 'ASSET_UNIT',
          isRequired: true,
          isActive: true,
        },
      ])
    );
    vi.spyOn(referenceApi.lookupApis['measurement-units'], 'list').mockResolvedValue(page([]));
  });

  it('lists definitions with type and scope', async () => {
    renderScreen(<AttributeDefinitionsPage />);

    expect(await screen.findByText('Serial number')).toBeInTheDocument();
    // The stored values are `TEXT` and `ASSET_UNIT`; what a reader gets is a
    // label, as for every other enum on every other screen.
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Asset unit')).toBeInTheDocument();
  });

  it('offers SELECTION as a type (REQ-ATTR-003)', async () => {
    renderScreen(<AttributeDefinitionsPage />);
    await screen.findByText('Serial number');

    await userEvent.click(screen.getByRole('button', { name: /new definition/i }));

    const typeSelect = within(screen.getByRole('dialog')).getByLabelText(/type/i);
    const selection = within(typeSelect).getByRole('option', { name: 'Selection' });
    expect(selection).toBeInTheDocument();
    // The label is presentation only — the value posted to the API is still the
    // enum member the server accepts.
    expect(selection).toHaveValue('SELECTION');
  });

  it('keeps `invalid` off the DOM on the native selects it deliberately kept', async () => {
    renderScreen(<AttributeDefinitionsPage />);
    await screen.findByText('Serial number');
    await userEvent.click(screen.getByRole('button', { name: /new definition/i }));

    const dialog = screen.getByRole('dialog');
    for (const label of [/type/i, /scope/i]) {
      const select = within(dialog).getByLabelText(label);
      // `invalid` is the `Field` render-prop contract, not an HTML attribute.
      // Spreading it onto the element made React warn on every render.
      expect(select).not.toHaveAttribute('invalid');
      expect(select).not.toHaveAttribute('aria-invalid');
    }
  });

  it('states the SELECTION limitation instead of inventing an options editor (GAP-001)', async () => {
    renderScreen(<AttributeDefinitionsPage />);
    await screen.findByText('Serial number');
    await userEvent.click(screen.getByRole('button', { name: /new definition/i }));

    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/type/i), 'SELECTION');

    expect(within(dialog).getByRole('note')).toHaveTextContent(
      /allowed values cannot be configured yet/i
    );
    // No options editor of any kind is offered.
    expect(within(dialog).queryByLabelText(/allowed values/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /add option/i })).not.toBeInTheDocument();
  });

  it('offers a measurement unit only for a NUMBER attribute', async () => {
    renderScreen(<AttributeDefinitionsPage />);
    await screen.findByText('Serial number');
    await userEvent.click(screen.getByRole('button', { name: /new definition/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(/carries a measurement unit/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(within(dialog).getByLabelText(/type/i), 'NUMBER');
    expect(within(dialog).getByLabelText(/carries a measurement unit/i)).toBeInTheDocument();
  });

  it('lets a missing measurement unit be created without losing the form', async () => {
    renderScreen(<AttributeDefinitionsPage />);
    await screen.findByText('Serial number');
    await userEvent.click(screen.getByRole('button', { name: /new definition/i }));

    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/type/i), 'NUMBER');
    await userEvent.click(within(dialog).getByLabelText(/carries a measurement unit/i));

    // Named for the resource, not by position: the type and scope fields are
    // native selects, which carry the combobox role too.
    await userEvent.click(within(dialog).getByRole('combobox', { name: /measurement unit/i }));
    expect(screen.getByRole('button', { name: /create measurement unit/i })).toBeInTheDocument();
  });

  it('hides that affordance from a caller who may read units but not create them', async () => {
    signInWith([
      'attribute-definition:read',
      'attribute-definition:create',
      'measurement-unit:read',
    ]);
    renderScreen(<AttributeDefinitionsPage />);
    await screen.findByText('Serial number');
    await userEvent.click(screen.getByRole('button', { name: /new definition/i }));

    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/type/i), 'NUMBER');
    await userEvent.click(within(dialog).getByLabelText(/carries a measurement unit/i));

    // Hidden, not disabled (`07-ui.md` §6) — the existing units stay selectable.
    // Named for the resource, not by position: the type and scope fields are
    // native selects, which carry the combobox role too.
    await userEvent.click(within(dialog).getByRole('combobox', { name: /measurement unit/i }));
    expect(
      screen.queryByRole('button', { name: /create measurement unit/i })
    ).not.toBeInTheDocument();
  });

  it('hides the unit selector entirely without `measurement-unit:read`', async () => {
    signInWith(['attribute-definition:read', 'attribute-definition:create']);
    renderScreen(<AttributeDefinitionsPage />);
    await screen.findByText('Serial number');
    await userEvent.click(screen.getByRole('button', { name: /new definition/i }));

    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/type/i), 'NUMBER');
    await userEvent.click(within(dialog).getByLabelText(/carries a measurement unit/i));

    expect(
      within(dialog).queryByRole('combobox', { name: /measurement unit/i })
    ).not.toBeInTheDocument();
    // The list was never requested either — a hidden control does not fire a
    // request that would only answer 403.
    expect(referenceApi.lookupApis['measurement-units'].list).not.toHaveBeenCalled();
  });

  it('scopes the list by classification through the shared picker (§5.2)', async () => {
    vi.spyOn(referenceApi.classificationsApi, 'list').mockResolvedValue(page(ROOTS));
    vi.spyOn(referenceApi.classificationsApi, 'children').mockResolvedValue(page(GRANDCHILDREN));

    renderScreen(<AttributeDefinitionsPage />);
    await screen.findByText('Serial number');

    const filter = screen.getByLabelText('Classification');
    expect(filter).toHaveTextContent('Any classification');

    await userEvent.click(filter);
    await userEvent.click(await screen.findByText('Aset Tetap'));
    await userEvent.click(await screen.findByText('Aspal'));

    // The filter maps onto `06-api.md` §4.3's own `classificationId` param…
    await waitFor(() =>
      expect(referenceApi.attributeDefinitionsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ classificationId: '117010101001' })
      )
    );
    // …and the bar names the classification rather than repeating its code.
    expect(screen.getByLabelText('Classification')).toHaveTextContent('Aspal');
  });

  /**
   * Editing — `07-ui.md` §5.2 calls this screen List/Edit, and `06-api.md` §4.3
   * exposes `PATCH`. Without it a mistyped attribute name could only be retired
   * and recreated, which orphans the values already stored against it.
   */
  it('edits a definition without offering to move its classification or scope', async () => {
    const update = vi
      .spyOn(referenceApi.attributeDefinitionsApi, 'update')
      .mockResolvedValue({ id: 'a1', name: 'Serial no.' });

    renderScreen(<AttributeDefinitionsPage />);
    await screen.findByText('Serial number');

    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const dialog = screen.getByRole('dialog');

    // Both are shown — they are what the definition means — but neither can be
    // changed, because the server refuses to move them.
    expect(within(dialog).getByLabelText(/classification/i)).toBeDisabled();
    expect(within(dialog).getByLabelText(/scope/i)).toBeDisabled();

    const name = within(dialog).getByLabelText(/name/i);
    expect(name).toHaveValue('Serial number');
    await userEvent.clear(name);
    await userEvent.type(name, 'Serial no.');
    await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const [id, body] = update.mock.calls[0];
    expect(id).toBe('a1');
    expect(body.name).toBe('Serial no.');
    // The two fields the endpoint rejects are never sent.
    expect(body).not.toHaveProperty('classificationId');
    expect(body).not.toHaveProperty('scope');
  });

  it('hides editing from a caller without `attribute-definition:update`', async () => {
    signInWith(['attribute-definition:read', 'attribute-definition:deactivate']);
    renderScreen(<AttributeDefinitionsPage />);
    await screen.findByText('Serial number');

    // Hidden, not disabled (`07-ui.md` §6) — and retiring it is still offered.
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument();
  });

  it('names the classification a shared link arrived with (§4.1)', async () => {
    vi.spyOn(referenceApi.classificationsApi, 'get').mockResolvedValue({
      id: '117010101001',
      name: 'Aspal',
      parentId: '110000000000',
      origin: 'PERMENDAGRI',
      categoryId: null,
    });

    // The URL carries the code; the picker's node is not in it. A filtered view
    // that arrives as a link must still say what it is filtered to.
    renderScreen(<AttributeDefinitionsPage />, {
      route: '/?classificationId=117010101001',
      path: '/',
    });

    expect(await screen.findByText('Serial number')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Classification')).toHaveTextContent('Aspal'));
  });
});

describe('LookupsPage', () => {
  beforeEach(() => {
    for (const key of Object.keys(referenceApi.lookupApis)) {
      vi.spyOn(referenceApi.lookupApis[key], 'list').mockResolvedValue(
        page([{ id: 1, code: 'X', name: `${key} row` }])
      );
    }
    vi.spyOn(referenceApi.categoriesApi, 'list').mockResolvedValue(
      page([{ id: 1, name: 'Peralatan' }])
    );
  });

  it('presents the five editable lookups plus categories as one tabbed page (§5.2)', async () => {
    renderScreen(<LookupsPage />);

    for (const label of [
      'Measurement units',
      'Contract types',
      'Funding sources',
      'Transaction types',
      'Account codes',
      'Categories',
    ]) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });

  it('allows editing an ordinary lookup', async () => {
    renderScreen(<LookupsPage />);

    expect(
      await screen.findByRole('button', { name: /new measurement unit/i })
    ).toBeInTheDocument();
  });

  it('keeps Categories strictly read-only (DEC-027, REQ-CLASS-002)', async () => {
    renderScreen(<LookupsPage />);

    await userEvent.click(screen.getByRole('tab', { name: 'Categories' }));
    expect(await screen.findByText('Peralatan')).toBeInTheDocument();

    // No create, no delete, no edit — the API exposes none of them.
    expect(screen.queryByRole('button', { name: /new categor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be edited here/i)).toBeInTheDocument();
  });

  it('hides create and delete from a read-only caller', async () => {
    signInWith(['measurement-unit:read', 'category:read']);
    renderScreen(<LookupsPage />);

    await screen.findByRole('tab', { name: 'Measurement units' });
    expect(screen.queryByRole('button', { name: /new measurement unit/i })).not.toBeInTheDocument();
  });

  /**
   * The funding source business code — `CR-007`, REQ-REF-007, `07-ui.md` §5.2.
   *
   * Its own column and its own field, because a source with no code cannot be
   * used by an inventory code format that includes it: a registration relying on
   * one is refused rather than given a code with the segment missing. Editing
   * exists so a row created before the column can be given one — no migration
   * could decide the abbreviation on an administrator's behalf.
   */
  describe('funding source codes (CR-007)', () => {
    const FUNDING = [
      { id: 1, name: 'Dana Bos', code: 'BOS' },
      { id: 2, name: 'Anggaran', code: null },
    ];

    const openFundingTab = async () => {
      referenceApi.lookupApis['funding-sources'].list.mockResolvedValue(page(FUNDING));
      signInWith([...ALL, 'funding-source:create', 'funding-source:update']);
      renderScreen(<LookupsPage />);
      await userEvent.click(screen.getByRole('tab', { name: 'Funding sources' }));
      return screen.findByText('Dana Bos');
    };

    it('shows the code as its own column and flags a row that has none', async () => {
      await openFundingTab();

      expect(screen.getByText('BOS')).toBeInTheDocument();
      // Flagged, not blank: blank reads as "nothing to see here", which is the
      // opposite of what an empty code means here.
      expect(screen.getByText(/no code yet/i)).toBeInTheDocument();
    });

    it('assigns a code to a source that has none', async () => {
      const update = vi
        .spyOn(referenceApi.lookupApis['funding-sources'], 'update')
        .mockResolvedValue({ id: 2, name: 'Anggaran', code: 'APBD' });

      await openFundingTab();

      const row = screen.getByText('Anggaran').closest('tr');
      await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));

      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/^code/i), 'APBD');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(update).toHaveBeenCalledWith(2, { name: 'Anggaran', code: 'APBD' }));
    });

    it('says the code is not derived from the name, because the server will not derive it', async () => {
      await openFundingTab();

      await userEvent.click(screen.getByRole('button', { name: /new funding source/i }));

      expect(await screen.findByText(/not derived from the name/i)).toBeInTheDocument();
    });

    it('refuses a code the inventory code alphabet cannot carry', async () => {
      const update = vi.spyOn(referenceApi.lookupApis['funding-sources'], 'update');

      await openFundingTab();

      const row = screen.getByText('Anggaran').closest('tr');
      await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));

      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/^code/i), 'AP BD');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(await screen.findByText(/letters, digits, hyphen/i)).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    });

    it('offers no edit control without funding-source:update', async () => {
      referenceApi.lookupApis['funding-sources'].list.mockResolvedValue(page(FUNDING));
      signInWith(['funding-source:read', 'category:read']);
      renderScreen(<LookupsPage />);

      await userEvent.click(screen.getByRole('tab', { name: 'Funding sources' }));
      await screen.findByText('Dana Bos');

      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    });
  });
});

/**
 * Classification management — Phase 17 (`CR-001`), REQ-CLASS-011 through
 * REQ-CLASS-017.
 *
 * What is asserted here is WHERE the controls appear. The rules themselves live
 * on the server and are covered by its own suite; this checks that the screen
 * shows an affordance exactly when the server would honour it, because a control
 * that always fails is worse than no control.
 */
describe('ClassificationsPage — managing local additions', () => {
  const WRITE = [
    'classification:read',
    'classification:create',
    'classification:update',
    'classification:delete',
    'classification:promote',
    'attribute-definition:read',
  ];

  /** A second-to-last-level node — the one place an addition may attach. */
  const BRANCH = {
    id: '132080141000',
    name: 'Alat Laboratorium Pertanian',
    parentId: '132080100000',
    origin: 1,
    categoryId: null,
    institutionId: null,
    isAppDefined: false,
    isLeaf: false,
    acceptsChildren: true,
  };

  /** A leaf this application created, owned by one institution. */
  const LOCAL = {
    id: '132080141999',
    name: 'Mikroskop Batik',
    parentId: '132080141000',
    origin: 3,
    categoryId: null,
    institutionId: 'inst-a',
    isAppDefined: true,
    isLeaf: true,
    acceptsChildren: false,
  };

  beforeEach(() => {
    signInWith(WRITE, { isSystemWide: true });

    vi.spyOn(referenceApi.classificationsApi, 'list').mockResolvedValue(page(ROOTS));
    vi.spyOn(referenceApi.classificationsApi, 'children').mockResolvedValue(page([BRANCH]));
    vi.spyOn(referenceApi.classificationsApi, 'attributeDefinitions').mockResolvedValue([]);
    vi.spyOn(referenceApi.categoriesApi, 'list').mockResolvedValue(page([]));
  });

  /** Drills into the branch and opens it with the picker's branch-select. */
  async function openBranch(node = BRANCH) {
    vi.spyOn(referenceApi.classificationsApi, 'get').mockResolvedValue(node);

    const [openPicker] = await screen.findAllByRole('button', { name: /browse classifications/i });
    await userEvent.click(openPicker);
    await userEvent.click(await screen.findByText('Aset Tetap'));
    await userEvent.click(await screen.findByRole('button', { name: /open "aset tetap"/i }));
  }

  it('offers add on a node that accepts children, and not rename or delete', async () => {
    renderScreen(<ClassificationsPage />);
    await openBranch();

    expect(await screen.findByRole('button', { name: /add entry/i })).toBeInTheDocument();
    // It is government data — only additions beneath it are permitted.
    expect(screen.queryByRole('button', { name: /rename/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('creates without ever sending an identifier (REQ-CLASS-013)', async () => {
    const create = vi
      .spyOn(referenceApi.classificationsApi, 'create')
      .mockResolvedValue({ ...LOCAL, name: 'Mesin Batik' });

    renderScreen(<ClassificationsPage />);
    await openBranch();

    await userEvent.click(await screen.findByRole('button', { name: /add entry/i }));
    await userEvent.type(await screen.findByLabelText(/^name$/i), 'Mesin Batik');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const body = create.mock.calls[0][0];
    expect(body).toMatchObject({ parentId: BRANCH.id, name: 'Mesin Batik' });
    expect(body).not.toHaveProperty('id');
  });

  it('lets a system-wide user choose a global addition', async () => {
    const create = vi
      .spyOn(referenceApi.classificationsApi, 'create')
      .mockResolvedValue({ ...LOCAL, institutionId: null });

    renderScreen(<ClassificationsPage />);
    await openBranch();

    await userEvent.click(await screen.findByRole('button', { name: /add entry/i }));
    await userEvent.type(await screen.findByLabelText(/^name$/i), 'Untuk Semua');
    await userEvent.selectOptions(screen.getByLabelText(/available to/i), 'global');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // `null` is what makes it global; omitting the field would mean "mine".
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ institutionId: null }))
    );
  });

  it('offers rename, delete and share on a local addition (BR-016)', async () => {
    renderScreen(<ClassificationsPage />);
    await openBranch(LOCAL);

    expect(await screen.findByRole('button', { name: /rename/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /share with all/i })).toBeInTheDocument();
    // It is a leaf, so nothing may attach beneath it.
    expect(screen.queryByRole('button', { name: /add entry/i })).not.toBeInTheDocument();
  });

  it('does not offer share on a node that is already global', async () => {
    renderScreen(<ClassificationsPage />);
    await openBranch({ ...LOCAL, institutionId: null });

    await screen.findByRole('button', { name: /rename/i });
    expect(screen.queryByRole('button', { name: /share with all/i })).not.toBeInTheDocument();
  });

  it('warns that sharing cannot be undone (REQ-CLASS-015)', async () => {
    const promote = vi.spyOn(referenceApi.classificationsApi, 'promote').mockResolvedValue(LOCAL);

    renderScreen(<ClassificationsPage />);
    await openBranch(LOCAL);

    await userEvent.click(await screen.findByRole('button', { name: /share with all/i }));
    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /share with all/i }));
    await waitFor(() => expect(promote).toHaveBeenCalledWith(LOCAL.id));
  });

  it('confirms before deleting', async () => {
    const remove = vi.spyOn(referenceApi.classificationsApi, 'remove').mockResolvedValue(undefined);

    renderScreen(<ClassificationsPage />);
    await openBranch(LOCAL);

    await userEvent.click(await screen.findByRole('button', { name: /delete/i }));
    expect(await screen.findByText(/removed permanently/i)).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(LOCAL.id));
  });

  it('hides every control from a reader who only holds classification:read', async () => {
    signInWith(['classification:read', 'attribute-definition:read']);

    renderScreen(<ClassificationsPage />);
    await openBranch(LOCAL);

    // The name appears in both the heading and the badge row, so this only
    // waits for the detail to have rendered at all.
    await screen.findAllByText(LOCAL.name);
    for (const label of [/add entry/i, /rename/i, /delete/i, /share with all/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });
});
