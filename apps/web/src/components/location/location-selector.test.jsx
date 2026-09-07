import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { createQueryClient } from '@/lib/queryClient';
import * as assetCore from '@/api/assetCore';
import { LocationSelector } from './LocationSelector';

/**
 * Location selector — arbitrary-depth hierarchy.
 *
 * The point of these tests is the DEPTH-AGNOSTIC guarantee. The fixture below is
 * six levels deep on purpose: `Site → Building → Floor → Wing → Room → Cabinet`.
 * Nothing in the component may treat any of those levels specially, and a
 * selection must be possible at every one of them.
 */

const TREE = {
  root: [{ id: 'site', name: 'Site A', parentLocationId: null }],
  site: [{ id: 'building', name: 'Building 2', parentLocationId: 'site' }],
  building: [{ id: 'floor', name: 'Floor 3', parentLocationId: 'building' }],
  floor: [{ id: 'wing', name: 'East Wing', parentLocationId: 'floor' }],
  wing: [{ id: 'room', name: 'Computer Lab 2', parentLocationId: 'wing' }],
  room: [{ id: 'cabinet', name: 'Cabinet 4', parentLocationId: 'room' }],
  cabinet: [],
};

const PATHS = {
  cabinet: [
    { id: 'site', name: 'Site A' },
    { id: 'building', name: 'Building 2' },
    { id: 'floor', name: 'Floor 3' },
    { id: 'wing', name: 'East Wing' },
    { id: 'room', name: 'Computer Lab 2' },
    { id: 'cabinet', name: 'Cabinet 4' },
  ],
};

function renderSelector({ value = null, onChange = vi.fn(), ...props } = {}) {
  function Harness() {
    const [current, setCurrent] = useState(value);
    return (
      <LocationSelector
        value={current}
        onChange={(next) => {
          setCurrent(next);
          onChange(next);
        }}
        {...props}
      />
    );
  }

  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.spyOn(assetCore.locationsApi, 'list').mockImplementation(async (params = {}) => {
    const all = Object.values(TREE).flat();

    if (params.q) {
      const term = params.q.toLowerCase();
      return { data: all.filter((row) => row.name.toLowerCase().includes(term)) };
    }

    // The server does the root filtering now (`?rootsOnly=true`); the mock
    // mirrors that so the component cannot quietly go back to filtering a page
    // of everything client-side and still pass.
    if (params.rootsOnly) return { data: all.filter((row) => !row.parentLocationId) };

    return { data: all };
  });

  /*
   * The COLLECTION envelope, which is what `/locations/:id/children` answers in.
   *
   * This mock is the reason the drill-down bug survived: it used to hand back
   * one shape while the endpoint sent another, so these tests passed against a
   * response no caller ever receives and a real drill-down came back empty. The
   * endpoint and the mock now agree, and `meta` describes the complete set
   * because the endpoint returns every child rather than a page of them.
   */
  vi.spyOn(assetCore.locationsApi, 'children').mockImplementation(async (id) => {
    const rows = TREE[id] ?? [];
    return { data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } };
  });

  vi.spyOn(assetCore.locationsApi, 'context').mockImplementation(async (id) => ({
    path: PATHS[id] ?? [{ id, name: id }],
    floorPlan: null,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LocationSelector', () => {
  it('drills through six levels without any of them being special', async () => {
    const onChange = vi.fn();
    renderSelector({ onChange });

    await userEvent.click(screen.getByRole('button', { name: /select a location/i }));
    const dialog = await screen.findByRole('dialog');

    // Every level is reached by the same control, named the same way.
    for (const name of ['Site A', 'Building 2', 'Floor 3', 'East Wing', 'Computer Lab 2']) {
      await userEvent.click(await within(dialog).findByRole('button', { name: `Open ${name}` }));
    }

    // Six levels down, and the deepest node is selectable like any other.
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Cabinet 4' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cabinet'));
  });

  it('allows selecting a location at ANY depth, not only a leaf', async () => {
    const onChange = vi.fn();
    renderSelector({ onChange });

    await userEvent.click(screen.getByRole('button', { name: /select a location/i }));
    const dialog = await screen.findByRole('dialog');

    // A building holds units perfectly well. This is the crucial difference
    // from the classification picker, where only a leaf is a valid answer.
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Site A' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('site'));
  });

  it('attaches to a location that is not top-level', async () => {
    const onChange = vi.fn();
    renderSelector({ onChange });

    await userEvent.click(screen.getByRole('button', { name: /select a location/i }));
    const dialog = await screen.findByRole('dialog');

    // The reported failure, in the shape a user hits it: on the location form,
    // only top-level locations could be chosen as the parent. Everything below
    // the first level came back empty, because the drill-down read a list
    // envelope off a response that is a bare array.
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Open Site A' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Open Building 2' }));

    expect(await within(dialog).findByRole('button', { name: 'Floor 3' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Floor 3' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('floor'));
  });

  it('asks the SERVER for the roots rather than filtering a page client-side', async () => {
    renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /select a location/i }));
    await screen.findByRole('dialog');

    // Client-side filtering silently missed any root past the page cap, which
    // is why `rootsOnly` exists.
    await waitFor(() =>
      expect(assetCore.locationsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ rootsOnly: true })
      )
    );
  });

  it('offers "select" and "look inside" as separate controls on the same row', async () => {
    renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /select a location/i }));
    const dialog = await screen.findByRole('dialog');

    // Two different intentions, so two different controls — a single row that
    // guessed would get one of them wrong.
    expect(await within(dialog).findByRole('button', { name: 'Site A' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Open Site A' })).toBeInTheDocument();
  });

  it('shows the whole ancestor path of the current value, however long it is', async () => {
    renderSelector({ value: 'cabinet' });

    // The name alone is not an answer to "where is it" — the trail is.
    expect(await screen.findByText('Cabinet 4')).toBeInTheDocument();
    expect(
      screen.getByText('Site A › Building 2 › Floor 3 › East Wing › Computer Lab 2')
    ).toBeInTheDocument();
  });

  it('searches by name across every level', async () => {
    const onChange = vi.fn();
    renderSelector({ onChange });

    await userEvent.click(screen.getByRole('button', { name: /select a location/i }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(within(dialog).getByLabelText(/search locations/i), 'Cabinet');

    // A search hit carries its ancestor path inside the row, so its accessible
    // name is the name PLUS the trail — which is the point: two rooms called
    // "Lab 2" have to be tellable apart. There is no drill control in search
    // mode, so the partial match is unambiguous.
    const hit = await within(dialog).findByRole('button', { name: /Cabinet 4/ });
    expect(hit).toHaveTextContent('Site A');

    // Reached in one step from the top, without drilling six levels.
    await userEvent.click(hit);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cabinet'));
  });

  it('keeps a restricted picker inside its subtree', async () => {
    renderSelector({ rootId: 'floor' });

    await userEvent.click(screen.getByRole('button', { name: /select a location/i }));
    const dialog = await screen.findByRole('dialog');

    // `rootId` starts the drill-down at that node's children, so nothing above
    // it is offered — REQ-LOC-012's containment rule, enforced before the
    // server has to reject anything.
    expect(await within(dialog).findByRole('button', { name: 'East Wing' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Site A' })).not.toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(/search locations/i), 'Cabinet');
    await waitFor(() =>
      expect(assetCore.locationsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ descendantsOf: 'floor' })
      )
    );
  });

  it('clears an optional value without opening the picker', async () => {
    const onChange = vi.fn();
    renderSelector({ value: 'cabinet', allowClear: true, onChange });

    await userEvent.click(await screen.findByRole('button', { name: /clear location/i }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
