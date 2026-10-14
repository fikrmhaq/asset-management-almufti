/**
 * A stand-in for `POST /inventory-codes/preview` (P4, §64.4), shaped like the
 * server's answer for ALM-1's format `{unit number}/{label}/{funding}/{year}`.
 *
 * Empty and repeated values are decided here the way the server decides them;
 * `issued` and `invalid` name values the test wants reported as such.
 */
export function fakePreview(
  body,
  { issued = [], invalid = [], recent = [], problems = [], perUnit = true } = {}
) {
  const parts = (value) => [
    {
      source: 'UNIT_NUMBER',
      tokenId: 'NUMBER_COMPOSITION',
      label: 'Unit number',
      text: value || null,
    },
    { source: 'SEPARATOR', text: '/' },
    {
      source: 'GENERATED',
      tokenId: 'CLASSIFICATION_LEAF_LABEL',
      label: 'Classification label',
      text: 'LAP_TOP',
    },
    { source: 'SEPARATOR', text: '/' },
    {
      source: 'GENERATED',
      tokenId: 'FUNDING_SOURCE_CODE',
      label: 'Funding source code',
      text: problems.length > 0 ? null : 'BOS_REG',
    },
    { source: 'SEPARATOR', text: '/' },
    { source: 'GENERATED', tokenId: 'REGISTRATION_YEAR', label: 'Registration year', text: '2026' },
  ];
  const code = (value) => `${value}/LAP_TOP/BOS_REG/2026`;

  const values = (body.unitNumbers ?? []).map((value) => String(value).trim());
  const counts = new Map();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);

  const units = values.map((value, index) => {
    const base = { index, unitNumber: value, parts: parts(value) };
    if (!value) return { ...base, status: 'EMPTY', inventoryCode: null };
    if (invalid.includes(value)) {
      return {
        ...base,
        status: 'INVALID',
        inventoryCode: null,
        issue: 'contains unsafe characters',
      };
    }
    if (counts.get(value) > 1)
      return { ...base, status: 'DUPLICATE_IN_BATCH', inventoryCode: null };
    if (problems.length > 0) return { ...base, status: 'INCOMPLETE', inventoryCode: null };
    return {
      ...base,
      status: issued.includes(value) ? 'ALREADY_ISSUED' : 'OK',
      inventoryCode: code(value),
    };
  });

  return {
    generated: true,
    unitNumber: { required: true, perUnit, maxLength: 16 },
    parts: parts(null),
    problems,
    units,
    recentUnitNumbers: recent.map((value, index) => ({
      unitNumber: value,
      inventoryCode: code(value),
      registeredAt: `2026-09-28T10:0${index}:00.000Z`,
    })),
  };
}
