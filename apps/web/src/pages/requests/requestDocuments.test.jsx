import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { apiClient } from '@/api/client';
import { requestsApi } from '@/api/requests';
import { renderScreen, signInWith } from '@/test/harness';
import { RequestDetailPage } from './RequestDetailPage';

/**
 * Request documents — Phase 39 (`CR-014` §9), `07-ui.md` §5.10: the documents
 * panel and the optional documents of the acquisition declaration. Upload
 * follows `actions.uploadDocument`, delete follows each document's `canDelete`;
 * no type is ever marked required, and RECEIPT reads "Payment receipt".
 */

const ME = { id: 'user-1', username: 'tester', firstName: 'Test', lastName: 'User' };

const NONE = {
  edit: false,
  submit: false,
  discard: false,
  cancel: false,
  changeDestination: false,
  uploadDocument: false,
};

const request = (overrides = {}) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  requestNumber: 'REQ/2026/0001',
  category: 'COMMON',
  title: 'Proyektor',
  justification: null,
  status: 'SUBMITTED',
  requesterUserId: ME.id,
  requester: ME,
  requesterAssignmentId: 'pa-1',
  requesterAssignmentCurrent: true,
  requesterPositionCode: 'COMMON_TEACHER',
  requesterDepartment: null,
  department: null,
  destinationLocationId: null,
  destination: null,
  neededBy: null,
  workflowDefinitionId: 'wf-1',
  closedAt: null,
  closeReason: null,
  items: [],
  steps: [],
  actions: NONE,
  ...overrides,
});

const doc = (overrides = {}) => ({
  id: 'doc-1',
  requestId: 'req-1',
  documentType: 'RECEIPT',
  title: null,
  fileName: 'kuitansi.pdf',
  fileType: 'application/pdf',
  fileSize: 2048,
  uploadedBy: ME,
  createdAt: '2026-09-25T00:00:00.000Z',
  canDelete: false,
  ...overrides,
});

const procureStep = {
  id: 'step-p',
  sequence: 2,
  stepType: 'PROCURE',
  actorPositionCode: 'WAKASEK_SARPRAS',
  procurementMode: 'INTERNAL',
  skipIfRequesterIsActor: false,
  state: 'ACTIVE',
  skipReason: null,
  comment: null,
  activatedAt: '2026-09-25T00:00:00.000Z',
  completedAt: null,
  actedByUserId: null,
  actedBy: null,
  actedAs: null,
  resolvedActors: [{ userId: ME.id, name: 'Test User' }],
  vacant: false,
  canAct: true,
};

const pdf = (name = 'faktur.pdf') => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

function renderDetail(data, documents = []) {
  vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
  const list = vi.spyOn(requestsApi, 'listDocuments').mockResolvedValue(documents);
  renderScreen(<RequestDetailPage />, { route: `/requests/${data.id}`, path: '/requests/:id' });
  return { list };
}

const READ = ['request:read', 'request-document:read'];

beforeEach(() => {
  signInWith([...READ, 'request-document:create', 'request-document:delete'], {
    id: ME.id,
    institutionId: 'inst-1',
    isSystemWide: false,
  });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:doc');
  globalThis.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the documents panel', () => {
  it('is not shown, and nothing is fetched, without request-document:read', async () => {
    signInWith(['request:read'], { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
    const { list } = renderDetail(request());

    expect(await screen.findByText('REQ/2026/0001 — Proyektor')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Documents' })).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it('lists documents with their type, and labels RECEIPT as a payment receipt', async () => {
    renderDetail(request(), [
      doc(),
      doc({ id: 'doc-2', documentType: 'BAST', title: 'BAST penyerahan', fileName: 'bast.pdf' }),
    ]);

    expect(await screen.findByText('Payment receipt')).toBeInTheDocument();
    expect(screen.getByText('BAST penyerahan')).toBeInTheDocument();
    expect(screen.getByText(/bast\.pdf · 2 KB · uploaded by Test User/)).toBeInTheDocument();
    expect(screen.queryByText(/receipt of goods/i)).not.toBeInTheDocument();
    // No type is ever marked required (`CR-014` §17.2).
    expect(screen.queryByText(/^\(?required\)?$/i)).not.toBeInTheDocument();
  });

  it('shows an empty state that marks nothing as required', async () => {
    renderDetail(request());

    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Proposals, invoices, payment receipts and BAST appear here. None is required.'
      )
    ).toBeInTheDocument();
  });

  it('downloads through the API with ?download=true', async () => {
    const get = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ data: new Blob(['%PDF']), status: 200 });
    renderDetail(request(), [doc()]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Download kuitansi.pdf' }));

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/request-documents/doc-1?download=true',
        expect.objectContaining({ responseType: 'blob' })
      )
    );
  });

  it('offers delete only where the server says canDelete, and deletes after confirmation', async () => {
    renderDetail(request({ status: 'DRAFT' }), [
      doc({ id: 'mine', fileName: 'mine.pdf', canDelete: true }),
      doc({ id: 'theirs', fileName: 'theirs.pdf', canDelete: false }),
    ]);
    const remove = vi.spyOn(requestsApi, 'removeDocument').mockResolvedValue(undefined);
    const user = userEvent.setup();

    expect(
      screen.queryByRole('button', { name: 'Delete theirs.pdf' }) ??
        (await screen.findByRole('button', { name: 'Delete mine.pdf' }))
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete theirs.pdf' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete mine.pdf' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    );

    await waitFor(() => expect(remove).toHaveBeenCalledWith('mine'));
  });

  it('offers no upload form unless the server says uploadDocument', async () => {
    renderDetail(request());

    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload document' })).not.toBeInTheDocument();
  });

  it('requires a type and a file, then uploads them', async () => {
    renderDetail(request({ actions: { ...NONE, uploadDocument: true } }));
    const upload = vi.spyOn(requestsApi, 'uploadDocument').mockResolvedValue(doc());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Upload document' }));
    expect(screen.getByText('Choose a type for each document.')).toBeInTheDocument();
    expect(screen.getByText('Choose a file.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText('Type'), 'SUPPORTING');
    await user.type(screen.getByLabelText('Title (optional)'), 'Brosur');
    await user.upload(screen.getByLabelText('Choose file'), pdf('brosur.pdf'));
    await user.click(screen.getByRole('button', { name: 'Upload document' }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const [id, formData] = upload.mock.calls[0];
    expect(id).toBe('req-1');
    expect(formData.get('documentType')).toBe('SUPPORTING');
    expect(formData.get('title')).toBe('Brosur');
    expect(formData.get('file').name).toBe('brosur.pdf');
  });

  it('refuses a disallowed file before sending it', async () => {
    renderDetail(request({ actions: { ...NONE, uploadDocument: true } }));
    const upload = vi.spyOn(requestsApi, 'uploadDocument');
    const user = userEvent.setup({ applyAccept: false });

    await user.selectOptions(await screen.findByLabelText('Type'), 'OTHER');
    await user.upload(
      screen.getByLabelText('Choose file'),
      new File(['MZ'], 'evil.exe', { type: 'application/x-msdownload' })
    );
    await user.click(screen.getByRole('button', { name: 'Upload document' }));

    expect(await screen.findByText('Choose a file.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('documents with the acquisition declaration (H2)', () => {
  const approved = (actions) =>
    request({ status: 'APPROVED', steps: [procureStep], actions: { ...NONE, ...actions } });

  it('uploads the documents first, then declares', async () => {
    renderDetail(approved({ uploadDocument: true }));
    const upload = vi.spyOn(requestsApi, 'uploadDocument').mockResolvedValue(doc());
    const complete = vi
      .spyOn(requestsApi, 'complete')
      .mockResolvedValue(approved({ uploadDocument: true }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Procurement completed' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(within(dialog).getByLabelText('Add a document'), pdf('faktur.pdf'));
    await user.selectOptions(within(dialog).getByLabelText('Type of faktur.pdf'), 'INVOICE');
    await user.click(within(dialog).getByRole('button', { name: 'Declare completed' }));

    await waitFor(() => expect(complete).toHaveBeenCalledWith('step-p', null));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1].get('documentType')).toBe('INVOICE');
    expect(upload.mock.invocationCallOrder[0]).toBeLessThan(complete.mock.invocationCallOrder[0]);
  });

  it('needs a type for each attached document, and declares nothing without one', async () => {
    renderDetail(approved({ uploadDocument: true }));
    const complete = vi.spyOn(requestsApi, 'complete');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Procurement completed' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(within(dialog).getByLabelText('Add a document'), pdf());
    await user.click(within(dialog).getByRole('button', { name: 'Declare completed' }));

    expect(within(dialog).getByText('Choose a type for each document.')).toBeInTheDocument();
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not declare when an upload fails', async () => {
    renderDetail(approved({ uploadDocument: true }));
    vi.spyOn(requestsApi, 'uploadDocument').mockRejectedValue(new Error('upload failed'));
    const complete = vi.spyOn(requestsApi, 'complete');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Procurement completed' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(within(dialog).getByLabelText('Add a document'), pdf());
    await user.selectOptions(within(dialog).getByLabelText('Type of faktur.pdf'), 'BAST');
    await user.click(within(dialog).getByRole('button', { name: 'Declare completed' }));

    await waitFor(() => expect(requestsApi.uploadDocument).toHaveBeenCalled());
    expect(complete).not.toHaveBeenCalled();
  });

  it('declares with no documents exactly as before', async () => {
    renderDetail(approved({ uploadDocument: true }));
    const upload = vi.spyOn(requestsApi, 'uploadDocument');
    const complete = vi.spyOn(requestsApi, 'complete').mockResolvedValue(approved({}));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Procurement completed' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Declare completed' })
    );

    await waitFor(() => expect(complete).toHaveBeenCalledWith('step-p', null));
    expect(upload).not.toHaveBeenCalled();
  });

  it('offers no documents in the dialog when the caller may not upload', async () => {
    renderDetail(approved({ uploadDocument: false }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Procurement completed' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Documents (optional)')).not.toBeInTheDocument();
  });
});
