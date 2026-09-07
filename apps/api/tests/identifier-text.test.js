import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { normalize, isSafe } = require('../src/domain/identifierText.js');

/**
 * Free text made safe for an identifier — Phase 26 (`CR-007`), `BR-027`.
 *
 * The cases below are drawn from the live classification catalog rather than
 * invented: 3,409 of its 13,536 leaf names carry punctuation, and five carry
 * characters that have no safe representation at all.
 */

describe('the transformation (`BR-027`)', () => {
  it.each([
    ['Computer Equipment', 'COMPUTER_EQUIPMENT'],
    ['Lap Top', 'LAP_TOP'],
    ['  Padded  ', 'PADDED'],
    ['Multiple   Spaces', 'MULTIPLE_SPACES'],
    ['lower case', 'LOWER_CASE'],
  ])('%s → %s', (input, expected) => {
    expect(normalize(input).value).toBe(expected);
  });

  it.each([
    ['Minyak Cat/Thinner', 'MINYAK_CAT_THINNER'],
    ['Bahan/Bibit Tanaman Pertanian', 'BAHAN_BIBIT_TANAMAN_PERTANIAN'],
    ['Waduk, Dan Pintu', 'WADUK_DAN_PINTU'],
    ['Alat (Khusus)', 'ALAT_KHUSUS'],
    ['Sungai & Pantai', 'SUNGAI_PANTAI'],
    ['A + B', 'A_B'],
    ['Rasio 1:2', 'RASIO_1_2'],
  ])('maps the punctuation the catalog really contains: %s → %s', (input, expected) => {
    expect(normalize(input).value).toBe(expected);
  });

  it('keeps the characters that are already in the alphabet', () => {
    // `-`, `.` and `_` survive as themselves rather than becoming separators.
    expect(normalize('ALM-1.2_A').value).toBe('ALM-1.2_A');
  });

  it('collapses runs and strips the edges, so no code has a doubled separator', () => {
    expect(normalize('  (A) ,  (B)  ').value).toBe('A_B');
  });
});

describe('refusal, never repair (`BR-027`)', () => {
  it.each([
    ['Stage With 4 Inde[endent', '['],
    ['Rescue Jaring?harnes', '?'],
    ['Magnifier #7540', '#'],
    ['Early Warning.>300Nm', '>'],
  ])('refuses %s because of %s', (input, offending) => {
    const result = normalize(input);

    expect(result.value).toBeNull();
    expect(result.reason).toBe('unrepresentable');
    expect(result.offending).toContain(offending);
  });

  it('does not silently drop the character it cannot represent', () => {
    // The failure mode `BR-027` exists to prevent: `MAGNIFIER_7540` looks
    // entirely reasonable and is permanently wrong.
    expect(normalize('Magnifier #7540').value).not.toBe('MAGNIFIER_7540');
  });

  it('names every offending character, not just the first', () => {
    expect(normalize('A#B?C').offending).toBe('#?');
  });

  it.each([['', 'empty'], ['   ', 'empty'], ['( , )', 'empty']])(
    'refuses %s as empty',
    (input) => {
      expect(normalize(input)).toMatchObject({ value: null, reason: 'empty' });
    }
  );

  it.each([[null], [undefined], [42], [{}]])('refuses the non-string %s', (input) => {
    expect(normalize(input).value).toBeNull();
  });

  it('never truncates — length is the caller’s budget to apply', () => {
    // A 104-character name exists in the catalog. This module returns it whole;
    // the format decides whether it fits, because that depends on the format.
    const long = 'A'.repeat(104);

    expect(normalize(long).value).toHaveLength(104);
  });
});

describe('typed values are validated, not transformed', () => {
  it.each(['001-02-03', 'ABC.1', 'a_b-c.1'])('accepts %s', (value) => {
    expect(isSafe(value)).toBe(true);
  });

  it.each(['001/02', '001 02', 'A#1', ''])('rejects %s', (value) => {
    expect(isSafe(value)).toBe(false);
  });

  it('does not rewrite a typed value into something safe', () => {
    // A person meant what they wrote; turning `001/02` into `001_02` would issue
    // a permanent code they never asked for.
    expect(isSafe('001/02')).toBe(false);
    expect(normalize('001/02').value).toBe('001_02');
  });
});
