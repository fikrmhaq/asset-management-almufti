import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { apiClient } from '@/api/client';
import * as assetCoreApi from '@/api/assetCore';
import { renderScreen, signInWith } from '@/test/harness';
import { AttachmentsPanel } from './AttachmentsPanel';
import { isPreviewable, previewKind } from './AttachmentPreview';

/**
 * Attachments — `06-api.md` §5.4, REQ-FILE-001/005.
 *
 * The download assertion is a regression test with a specific history: the
 * client called `GET /attachments/:id` without `?download=true`, so the endpoint
 * answered with its metadata envelope and the browser saved that JSON under the
 * attachment's real file name. Nothing about it looked wrong until the saved
 * file was opened, and no test reached the URL that was actually requested —
 * which is why this one asserts on the request, not on the mock.
 */

const ALL = ['attachment:read', 'attachment:create', 'attachment:delete'];

const PHOTO = {
  id: 'att-1',
  assetId: 'asset-1',
  assetUnitId: null,
  fileName: 'laptop.png',
  fileType: 'image/png',
  fileSize: 20480,
  uploadedBy: 'user-1',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const INVOICE = {
  ...PHOTO,
  id: 'att-2',
  fileName: 'invoice.pdf',
  fileType: 'application/pdf',
};

const SPREADSHEET = {
  ...PHOTO,
  id: 'att-3',
  fileName: 'inventory.xlsx',
  fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const renderPanel = () => renderScreen(<AttachmentsPanel assetId="asset-1" />);

/** @type {import('vitest').MockInstance} */
let anchorClick;
/** Whether the download anchor was in the document at the moment it was clicked. */
let attachedWhenClicked = false;

beforeEach(() => {
  signInWith(ALL);
  // jsdom implements neither, and both the download path and the preview build
  // an object URL from the fetched bytes.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:attachment');
  globalThis.URL.revokeObjectURL = vi.fn();

  // Stubbed for every test, not just the one that asserts on it: letting the
  // real click through makes jsdom attempt a navigation it does not implement,
  // and the resulting stack trace is printed for any test that downloads.
  attachedWhenClicked = false;
  anchorClick = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function mockClick() {
      attachedWhenClicked = document.body.contains(this);
    });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('attachment file types', () => {
  it('previews images and PDFs, and nothing else', () => {
    expect(previewKind('image/png')).toBe('image');
    expect(previewKind('image/jpeg')).toBe('image');
    expect(previewKind('application/pdf')).toBe('pdf');

    // Uploadable, but with no in-browser renderer.
    expect(isPreviewable(SPREADSHEET.fileType)).toBe(false);
    expect(isPreviewable('application/msword')).toBe(false);

    // Not uploadable at all, and must never become renderable here: this is
    // what stops a preview turning into script execution.
    expect(isPreviewable('text/html')).toBe(false);
    expect(isPreviewable('image/svg+xml')).toBe(false);

    expect(isPreviewable(undefined)).toBe(false);
  });
});

describe('AttachmentsPanel', () => {
  it('asks for the BYTES when downloading, not the metadata', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'listAttachments').mockResolvedValue([PHOTO]);
    // Spied at the HTTP client, deliberately: mocking `attachmentsApi.download`
    // would mock away the exact line that was wrong.
    const get = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ data: new Blob(['bytes'], { type: 'image/png' }) });

    renderPanel();
    await screen.findByText('laptop.png');

    await userEvent.click(screen.getByRole('button', { name: 'Download laptop.png' }));

    await waitFor(() => expect(get).toHaveBeenCalled());
    const [url, config] = get.mock.calls[0];
    expect(url).toBe('/attachments/att-1?download=true');
    expect(config.responseType).toBe('blob');
  });

  it('downloads under the attachment name through an anchor in the document', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'listAttachments').mockResolvedValue([PHOTO]);
    vi.spyOn(assetCoreApi.attachmentsApi, 'download').mockResolvedValue(new Blob(['bytes']));

    renderPanel();
    await screen.findByText('laptop.png');
    await userEvent.click(screen.getByRole('button', { name: 'Download laptop.png' }));

    await waitFor(() => expect(anchorClick).toHaveBeenCalled());
    // A detached anchor's `click()` is a no-op in Firefox, so the anchor has to
    // be in the document at the moment it is clicked.
    expect(attachedWhenClicked).toBe(true);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:attachment');
  });

  it('opens an image in place without leaving the page', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'listAttachments').mockResolvedValue([PHOTO]);
    const download = vi
      .spyOn(assetCoreApi.attachmentsApi, 'download')
      .mockResolvedValue(new Blob(['bytes'], { type: 'image/png' }));

    renderPanel();
    await screen.findByText('laptop.png');

    // Nothing is fetched until a preview is asked for — an asset may hold a
    // dozen 10 MB photographs, and the list must not download all of them.
    expect(download).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Preview laptop.png' }));

    const image = await screen.findByRole('img', { name: 'laptop.png' });
    expect(image).toHaveAttribute('src', 'blob:attachment');
    expect(download).toHaveBeenCalledWith('att-1');
  });

  it('opens a PDF in a frame', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'listAttachments').mockResolvedValue([INVOICE]);
    vi.spyOn(assetCoreApi.attachmentsApi, 'download').mockResolvedValue(
      new Blob(['bytes'], { type: 'application/pdf' })
    );

    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Preview invoice.pdf' }));

    await waitFor(() =>
      expect(document.querySelector('iframe[title="invoice.pdf"]')).toBeInTheDocument()
    );
  });

  it('offers no preview for a file the browser cannot render', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'listAttachments').mockResolvedValue([SPREADSHEET]);

    renderPanel();
    await screen.findByText('inventory.xlsx');

    expect(screen.queryByRole('button', { name: /^Preview/ })).not.toBeInTheDocument();
    // Still reachable — it just has to be opened elsewhere.
    expect(screen.getByRole('button', { name: 'Download inventory.xlsx' })).toBeInTheDocument();
  });

  it('opens the preview from the file name too', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'listAttachments').mockResolvedValue([PHOTO]);
    vi.spyOn(assetCoreApi.attachmentsApi, 'download').mockResolvedValue(
      new Blob(['bytes'], { type: 'image/png' })
    );

    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'laptop.png' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('reports a failed preview rather than showing an empty frame', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'listAttachments').mockResolvedValue([PHOTO]);
    vi.spyOn(assetCoreApi.attachmentsApi, 'download').mockRejectedValue(
      Object.assign(new Error('The stored file could not be read'), { code: 'INTERNAL_ERROR' })
    );

    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Preview laptop.png' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'laptop.png' })).not.toBeInTheDocument();
  });
});
