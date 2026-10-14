import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { requestsApi } from '@/api/requests';
import { ApiError, ERROR_CODES } from '@/api/errors';
import { changeLanguage, DEFAULT_LANGUAGE } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { RequestItemsEditor } from './RequestItemsEditor';

/**
 * Request item reference link on screen — REQ-REQUEST-019. One optional field
 * after Specification, checked by the same rules as the server before saving;
 * shown as its host, opening in a new tab, and never as a link when unsafe.
 */

const REQUESTER = [
  'request:read',
  'request-item:create',
  'request-item:update',
  'request-item:delete',
];
const ME = { id: 'user-1' };
const LINK = 'https://toko.example/produk/proyektor?warna=hitam#spesifikasi';

const item = (overrides = {}) => ({
  id: 'item-1',
  requestId: 'req-1',
  lineNo: 1,
  description: 'Proyektor',
  specification: 'Epson, 3000 lumen',
  referenceUrl: null,
  quantityRequested: 1,
  quantityCancelled: 0,
  quantityRequired: 1,
  measurementUnitId: null,
  measurementUnit: null,
  estimatedUnitPrice: null,
  classificationId: null,
  classification: null,
  ...overrides,
});

const request = (overrides = {}) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  status: 'DRAFT',
  steps: [],
  items: [],
  ...overrides,
});

const render = (data, editable = true) =>
  renderScreen(<RequestItemsEditor request={data} editable={editable} />);

const BODY = {
  description: 'Proyektor',
  specification: null,
  quantityRequested: 1,
  measurementUnitId: null,
  estimatedUnitPrice: null,
  classificationId: null,
};

beforeEach(() => {
  signInWith(REQUESTER, { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await changeLanguage(DEFAULT_LANGUAGE);
});

async function openAdd(user) {
  await user.click(await screen.findByRole('button', { name: 'Add item' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText(/Description/), 'Proyektor');
  return dialog;
}

describe('the field', () => {
  it('follows Specification, as plain text with its hint', async () => {
    render(request());
    const user = userEvent.setup();
    const dialog = await openAdd(user);

    const labels = [...dialog.querySelectorAll('label')].map((label) =>
      label.textContent.replace('*', '').trim()
    );
    expect(labels.slice(0, 4)).toEqual([
      'Description',
      'Specification',
      'Reference link',
      'Quantity',
    ]);

    const input = within(dialog).getByLabelText('Reference link');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).not.toBeRequired();
    expect(input).toHaveAccessibleDescription(
      'Optional. A product page for reference. The system does not open or check it.'
    );
  });

  it('sends none when left empty, and the trimmed link when given — POST', async () => {
    const add = vi.spyOn(requestsApi, 'addItem').mockResolvedValue(item());
    render(request());
    const user = userEvent.setup();

    let dialog = await openAdd(user);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(add).toHaveBeenLastCalledWith('req-1', { ...BODY, referenceUrl: null })
    );

    dialog = await openAdd(user);
    await user.type(within(dialog).getByLabelText('Reference link'), `  ${LINK}  `);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(add).toHaveBeenLastCalledWith('req-1', { ...BODY, referenceUrl: LINK })
    );
  });

  it('changes and clears an existing link — PATCH', async () => {
    const update = vi.spyOn(requestsApi, 'updateItem').mockResolvedValue(item());
    render(request({ items: [item({ referenceUrl: LINK })] }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    let dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Reference link');
    expect(input).toHaveValue(LINK);
    await user.clear(input);
    await user.type(input, 'https://toko.example/lain');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        'item-1',
        expect.objectContaining({ referenceUrl: 'https://toko.example/lain' })
      )
    );

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Reference link'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        'item-1',
        expect.objectContaining({ referenceUrl: null })
      )
    );
  });

  it('is edited the same way during a revision (REQ-REQUEST-018)', async () => {
    const update = vi.spyOn(requestsApi, 'updateItem').mockResolvedValue(item());
    render(request({ status: 'REVISION_REQUESTED', items: [item({ referenceUrl: LINK })] }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Reference link'));
    await user.type(within(dialog).getByLabelText('Reference link'), 'https://toko.example/revisi');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ referenceUrl: 'https://toko.example/revisi' })
      )
    );
  });
});

describe('validation messages (EN / ID)', () => {
  const attempt = async (text) => {
    const add = vi.spyOn(requestsApi, 'addItem').mockResolvedValue(item());
    render(request());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Add item|Tambah barang/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Description|Uraian/), 'Proyektor');
    await user.type(within(dialog).getByLabelText(/Reference link|Tautan referensi/), text);
    await user.click(within(dialog).getByRole('button', { name: /Save|Simpan/ }));
    return { add, dialog };
  };

  it.each([
    ['javascript:alert(1)', 'must start with http:// or https://'],
    ['ftp://files.example/a', 'must start with http:// or https://'],
    ['https://user:pw@example.com', 'must not contain a user name or password'],
    ['https://', 'is not a valid web address'],
    ['https://exa mple.com', 'must not contain spaces or control characters'],
  ])('refuses %s before saving, in English', async (text, message) => {
    const { add, dialog } = await attempt(text);

    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Reference link')).toHaveAttribute('aria-invalid', 'true');
    expect(add).not.toHaveBeenCalled();
  });

  it('speaks Indonesian when the interface does', async () => {
    await changeLanguage('id');
    const { add, dialog } = await attempt('javascript:alert(1)');

    expect(within(dialog).getByLabelText('Tautan referensi')).toBeInTheDocument();
    expect(
      await within(dialog).findByText('harus diawali http:// atau https://')
    ).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal under the field', async () => {
    vi.spyOn(requestsApi, 'addItem').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Request validation failed',
        status: 400,
        details: [{ field: 'body.referenceUrl', issue: 'must name a website' }],
      })
    );
    render(request());
    const user = userEvent.setup();
    const dialog = await openAdd(user);
    await user.type(within(dialog).getByLabelText('Reference link'), 'https://ok.example/');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('must name a website')).toBeInTheDocument();
  });
});

describe('the read-only display', () => {
  it('shows the host as a safe external link, the full address on hover', async () => {
    render(request({ status: 'SUBMITTED', items: [item({ referenceUrl: LINK })] }), false);

    const link = await screen.findByRole('link', {
      name: 'Reference link: toko.example (opens in a new tab)',
    });
    expect(link).toHaveAttribute('href', LINK);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('title', LINK);
    expect(link).toHaveTextContent('toko.example');
    expect(link).not.toHaveTextContent('/produk');
    // Directly after the specification.
    const row = screen.getByTestId('item-1');
    expect(row.textContent.indexOf('Epson')).toBeLessThan(row.textContent.indexOf('toko.example'));
  });

  it('never renders an unsafe stored value as a link', async () => {
    render(
      request({
        status: 'SUBMITTED',
        items: [
          item({ referenceUrl: 'javascript:alert(document.cookie)' }),
          item({ id: 'item-2', lineNo: 2, referenceUrl: 'data:text/html,<script>x</script>' }),
        ],
      }),
      false
    );

    await screen.findByTestId('item-1');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript"], a[href^="data"]')).toBeNull();
    expect(screen.getByTestId('item-reference-1')).toHaveTextContent(
      'Reference link (not a valid web address): javascript:alert(document.cookie)'
    );
    expect(screen.getByTestId('item-reference-2').tagName).toBe('SPAN');
  });

  it('shows nothing for an item without a link', async () => {
    render(request({ status: 'SUBMITTED', items: [item()] }), false);

    await screen.findByTestId('item-1');
    expect(screen.queryByTestId('item-reference-1')).not.toBeInTheDocument();
  });
});
