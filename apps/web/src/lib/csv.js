/**
 * CSV export — `DEC-052`, `IMPLEMENTATION_PLAN.md` §21.3.
 *
 * Client-side, over the rows already loaded. No request, no dependency, and no
 * `?format=csv`: `06-api.md` §9 defines no export endpoint, no content type and
 * no requirement mentions one, so inventing that contract here would be a
 * larger decision than the feature.
 *
 * Its limitation is real and the UI states it: this exports what is DISPLAYED,
 * which for a paginated report is the current page. Whether a full-result-set
 * export is required is a §22 question, not an assumption to make here.
 */

/**
 * One CSV field.
 *
 * Everything is quoted rather than only the fields that need it: a value
 * containing a comma, a quote or a newline breaks the file otherwise, and asset
 * descriptions contain all three. Embedded quotes are doubled, per RFC 4180.
 */
function escapeField(value) {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * @param {{key: string, header: string, value?: (row: object) => unknown}[]} columns
 * @param {object[]} rows
 * @returns {string} RFC 4180 text, CRLF-terminated
 */
export function toCsv(columns, rows) {
  const header = columns.map((column) => escapeField(column.header)).join(',');

  const body = rows.map((row) =>
    columns
      .map((column) => escapeField(column.value ? column.value(row) : row[column.key]))
      .join(',')
  );

  return [header, ...body].join('\r\n');
}

/**
 * Hands the text to the browser as a download.
 *
 * The object URL is revoked immediately after the click: the blob is already
 * captured by the download, and leaving it alive would pin the whole export in
 * memory for the life of the document.
 */
export function downloadCsv(filename, text) {
  // A UTF-8 BOM, so Excel opens accented and non-Latin names correctly rather
  // than as mojibake — the asset names in this system are Indonesian.
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
