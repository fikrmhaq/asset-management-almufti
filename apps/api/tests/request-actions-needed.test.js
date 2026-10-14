import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ACTION_KINDS, fromDetail, sqlPredicates, actionNeededSql } = require(
  '../src/domain/requestActionsNeeded.js'
);

/**
 * Action Needed — P5 (`IMPLEMENTATION_PLAN.md` §64.5), REQ-REQUEST-016. The
 * detail form is pure; the SQL form is checked here only for its permission
 * gating — the database suite (`41`) holds the two equal on real data.
 */

const NONE = { submit: false, receive: false, close: false, edit: true, cancel: true };
const figure = (cancellableBlocked = 0) => ({ cancellableBlocked });

describe('fromDetail (P5)', () => {
  it('names nothing when only not-needed actions are possible', () => {
    expect(
      fromDetail({
        actions: { ...NONE, changeDestination: true, uploadDocument: true },
        steps: [],
        figures: [figure()],
      })
    ).toEqual([]);
  });

  it('lists SUBMIT, blocked or not', () => {
    const actions = { ...NONE, submit: true };
    expect(fromDetail({ actions, steps: [], figures: [] })).toEqual([
      { kind: 'SUBMIT', blocked: false },
    ]);
    expect(
      fromDetail({ actions, steps: [], figures: [], submitBlockers: [{ code: 'NO_ITEMS' }] })
    ).toEqual([{ kind: 'SUBMIT', blocked: true }]);
  });

  it('lists a step only where the caller can act on it', () => {
    const steps = [
      { id: 'd', stepType: 'DECIDE', canAct: false },
      { id: 'p', stepType: 'PROCURE', canAct: true },
      { id: 'r', stepType: 'REGISTER', canAct: true },
    ];
    expect(fromDetail({ actions: NONE, steps, figures: [] })).toEqual([
      { kind: 'PROCURE', stepId: 'p' },
      { kind: 'REGISTER', stepId: 'r' },
    ]);
  });

  it('lists RECEIVE exactly when receipt is offered', () => {
    expect(fromDetail({ actions: { ...NONE, receive: true }, steps: [], figures: [] })).toEqual([
      { kind: 'RECEIVE' },
    ]);
  });

  it('lists CLOSE only when a close is offered AND something is stranded', () => {
    const actions = { ...NONE, close: true };
    expect(fromDetail({ actions, steps: [], figures: [figure(0)] })).toEqual([]);
    expect(fromDetail({ actions, steps: [], figures: [figure(0), figure(1)] })).toEqual([
      { kind: 'CLOSE' },
    ]);
    expect(fromDetail({ actions: NONE, steps: [], figures: [figure(1)] })).toEqual([]);
  });

  it('orders the kinds as a request meets them', () => {
    const needed = fromDetail({
      actions: { ...NONE, submit: true, receive: true, close: true },
      steps: [
        { id: 'r', stepType: 'REGISTER', canAct: true },
        { id: 'd', stepType: 'DECIDE', canAct: true },
      ],
      figures: [figure(1)],
    });
    // SUBMIT (a DRAFT) and RESUBMIT (a returned request) never coexist.
    expect(needed.map((entry) => entry.kind)).toEqual(
      ACTION_KINDS.filter((kind) => kind !== 'PROCURE' && kind !== 'RESUBMIT')
    );
  });

  it('asks the requester to resubmit a returned request, blocked as SUBMIT is (REQ-REQUEST-018)', () => {
    expect(fromDetail({ actions: { ...NONE, resubmit: true }, steps: [], figures: [] })).toEqual([
      { kind: 'RESUBMIT', blocked: false },
    ]);
    expect(
      fromDetail({
        actions: { ...NONE, resubmit: true },
        steps: [],
        figures: [],
        submitBlockers: [{ code: 'NO_ITEMS' }],
      })
    ).toEqual([{ kind: 'RESUBMIT', blocked: true }]);
  });
});

describe('sqlPredicates — permission gating (P5)', () => {
  const sequelize = { escape: (value) => `'${value}'` };
  const principal = (permissions) => ({ userId: 'u-1', permissions: new Set(permissions) });

  it('asks no kind the caller holds no permission for', () => {
    const predicates = sqlPredicates('r', principal([]), { sequelize });
    expect(Object.values(predicates).every((value) => value === null)).toBe(true);
    expect(actionNeededSql('r', principal([]), { sequelize })).toBe('FALSE');
  });

  it('asks exactly the kinds whose permission is held', () => {
    const predicates = sqlPredicates(
      'r',
      principal(['request:submit', 'request-step:decide', 'request:close']),
      { sequelize }
    );
    expect(
      Object.entries(predicates)
        .filter(([, value]) => value !== null)
        .map(([kind]) => kind)
    ).toEqual(['SUBMIT', 'RESUBMIT', 'DECIDE', 'CLOSE']);
  });
});
