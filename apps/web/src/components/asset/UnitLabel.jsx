import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';

/**
 * A single printable asset unit label — `07-ui.md` §5.3, REQ-UNIT-009.
 *
 * WHAT IS ON IT is the whole design. A label is printed once and may stay stuck
 * to a machine for years, so it carries only facts that hold for the life of the
 * unit (`BR-021`): institution, asset name, inventory code, classification.
 * Location, condition, lifecycle state and holder are deliberately absent — they
 * change with every movement and loan, and a sticker cannot be recalled to be
 * corrected. Those live on the record the QR resolves to.
 *
 * THE QR ENCODES AN ADDRESS, not the unit's data. Two reasons:
 *
 *   - A phone camera opens a URL and does nothing useful with a JSON blob, so a
 *     data payload would need a special-purpose scanner app to be worth anything.
 *   - Data baked into a label is frozen at print time while the record keeps
 *     moving. An address stays correct because it resolves live.
 *
 * It also keeps the code physically small: a URL is a few dozen characters and
 * stays scannable at 20 mm, where a few hundred characters would not.
 *
 * The classification is printed as CODE AND NAME. A classification can be
 * renamed (REQ-CLASS-016) but its code cannot change, so a label carrying both
 * remains resolvable after a rename even though its printed name has aged.
 */

/**
 * The address the QR resolves to. Absolute, because a scanner has no origin.
 *
 * A QUERY VALUE since `CR-008`, not a path segment. A code may contain a slash,
 * and `%2F` inside a path is the least portable construct in HTTP routing —
 * proxies decode it and then split on it, and React Router decodes it before
 * matching. In a query string it is simply a character. The application still
 * serves `/u/:inventoryCode` for every label printed before this, which a
 * sticker on a cabinet makes permanent.
 */
export function labelUrl(inventoryCode, origin = window.location.origin) {
  return `${origin}/u?c=${encodeURIComponent(inventoryCode)}`;
}

export function UnitLabel({ label, origin }) {
  const { t } = useTranslation();
  const url = labelUrl(label.inventoryCode, origin);

  return (
    <article
      className="unit-label flex gap-3 rounded-md border border-border bg-white p-3 text-neutral-900"
      aria-label={t('assets.label.labelFor', { code: label.inventoryCode })}
    >
      {/* `level="M"` tolerates roughly 15% damage, which is the realistic
          allowance for a sticker on equipment that gets handled. */}
      <QRCodeSVG value={url} size={96} level="M" marginSize={0} className="shrink-0" />

      <div className="flex min-w-0 flex-col justify-between">
        <div className="min-w-0">
          {label.institution ? (
            <p className="truncate text-[10px] font-medium tracking-wide uppercase">
              {label.institution.name}
            </p>
          ) : null}
          <p className="truncate text-sm font-semibold">{label.assetName}</p>
          {label.classification ? (
            <p className="truncate text-[10px] text-neutral-600">
              <span className="font-mono">{label.classification.id}</span>{' '}
              {label.classification.name}
            </p>
          ) : null}
          {label.department ? (
            <p className="truncate text-[10px] text-neutral-600">{label.department.name}</p>
          ) : null}
        </div>

        {/* The fallback when the QR is scuffed past reading — so it is the
            largest thing on the label, not a footnote. */}
        <p className="font-mono text-sm font-bold break-all">{label.inventoryCode}</p>
      </div>
    </article>
  );
}

/**
 * A sheet of labels.
 *
 * A grid that repeats down the page. Each label avoids a page break inside
 * itself, so a label is never split across two sheets — half a QR code is not a
 * QR code.
 */
export function UnitLabelSheet({ labels, origin }) {
  return (
    <div className="unit-label-sheet grid gap-3 sm:grid-cols-2">
      {labels.map((label) => (
        <UnitLabel key={label.assetUnitId} label={label} origin={origin} />
      ))}
    </div>
  );
}
