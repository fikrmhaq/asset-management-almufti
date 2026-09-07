/**
 * Money formatting — `DEC-039`.
 *
 * `contract_value`, `unit_price` and the derived `total_value` are
 * `NUMERIC(15,2)` (`04-data-model.md` §5.4.3, §5.4.4), which the driver hands
 * back as STRINGS, not numbers. Formatting therefore starts from the string the
 * server sent rather than from arithmetic done here — `totalValue` in particular
 * is the server's derived value (`03-domain.md` §4.17) and is never recomputed
 * in the browser.
 *
 * No currency symbol: nothing in the data model names a currency, so adding one
 * would invent semantics the system does not have.
 */

const MONEY = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `"1200.00"` or `1200` → `"1,200.00"`. Empty for a missing value. */
export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '';

  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? MONEY.format(numeric) : '';
}

/**
 * A money input's string → the number the API expects, or `undefined` when the
 * field was left blank (the columns are nullable).
 */
export function parseMoney(value) {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/**
 * An ordered amount and the unit it is counted in — `03-domain.md` §4.17.
 *
 * THREE DIFFERENT THINGS share the word "unit" in this system, and this function
 * exists so the first two are never rendered as one:
 *
 *   Quantity        `contract_items.quantity`  — how many were ordered: 10
 *   Unit of measure `contract_items.unit_type` — what they are counted in: piece
 *   Asset Unit      `public.asset_units`       — an individually tracked item
 *
 * `10 piece` reads as an order; a bare `10` beside a field labelled "Unit" reads
 * as nothing at all. The Asset Unit is a separate record entirely and is never
 * formatted here.
 *
 * @param {number|string|null|undefined} quantity
 * @param {string|null|undefined} unitType free text, `VARCHAR(50)`
 * @returns {string} empty when no quantity was recorded — the column is nullable
 */
export function formatQuantity(quantity, unitType) {
  if (quantity === null || quantity === undefined || quantity === '') return '';

  const unit = typeof unitType === 'string' ? unitType.trim() : '';
  return unit ? `${quantity} ${unit}` : String(quantity);
}
