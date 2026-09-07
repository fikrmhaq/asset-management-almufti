import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { changeLanguage, DEFAULT_LANGUAGE, readStoredLanguage, t } from '@/i18n';
import { LanguageSwitcher } from '@/components/shell/LanguageSwitcher';
import { StatusBadge } from '@/components/ui/badge';
import { en } from './en';
import { id } from './id';

/**
 * Localization — `07-ui.md` §1.3.
 */

afterEach(async () => {
  await changeLanguage(DEFAULT_LANGUAGE);
  globalThis.localStorage.clear();
});

describe('dictionaries', () => {
  /** Every key reachable in the object, as dotted paths. */
  const paths = (object, prefix = '') =>
    Object.entries(object).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return value && typeof value === 'object' ? paths(value, path) : [path];
    });

  it('translates every English key into Indonesian', () => {
    const missing = paths(en).filter((path) => !paths(id).includes(path));

    // A gap here is not fatal at runtime — English shows through — but it is a
    // gap, and it should be visible here rather than to a user.
    expect(missing).toEqual([]);
  });

  it('carries no Indonesian key that English does not define', () => {
    // The other direction matters too: a key only Indonesian has is dead weight,
    // or a typo that will silently never be used.
    expect(paths(id).filter((path) => !paths(en).includes(path))).toEqual([]);
  });

  it('leaves no value empty in either language', () => {
    for (const [language, dictionary] of [
      ['en', en],
      ['id', id],
    ]) {
      for (const path of paths(dictionary)) {
        const value = path.split('.').reduce((node, key) => node[key], dictionary);
        expect(typeof value, `${language}:${path}`).toBe('string');
        expect(value.trim(), `${language}:${path}`).not.toBe('');
      }
    }
  });

  it('keeps the interpolation placeholders identical across languages', () => {
    const placeholders = (value) => (value.match(/\{\{\w+\}\}/g) ?? []).sort();

    for (const path of paths(en)) {
      const enValue = path.split('.').reduce((node, key) => node[key], en);
      const idValue = path.split('.').reduce((node, key) => node[key], id);

      // A translation that dropped `{{name}}` would render a sentence with a
      // hole in it, which no fallback can repair.
      expect(placeholders(idValue), path).toEqual(placeholders(enValue));
    }
  });
});

describe('language switching', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('defaults to English, as the application always has', () => {
    expect(readStoredLanguage()).toBe('en');
    expect(t('nav.items.assets')).toBe('Assets');
  });

  it('switches the whole interface, not just the navigation', async () => {
    await changeLanguage('id');

    expect(t('nav.items.assets')).toBe('Aset');
    expect(t('units.fields.currentLocation')).toBe('Lokasi saat ini');
    expect(t('common.actions.save')).toBe('Simpan');
    expect(t('procurement.items.unitOfMeasure')).toBe('Satuan');
    expect(t('common.errors.notFound')).toBe('Data tidak ditemukan.');
  });

  it('persists the choice across a reload', async () => {
    await changeLanguage('id');

    // What a fresh boot would read.
    expect(readStoredLanguage()).toBe('id');
  });

  it('interpolates in the target language', async () => {
    await changeLanguage('id');
    expect(t('common.pagination.range', { first: 1, last: 20, total: 134 })).toBe('1–20 dari 134');
  });

  it('falls back to English rather than showing a key or nothing', async () => {
    await changeLanguage('id');

    // A key neither dictionary defines still renders something readable.
    expect(t('nav.items.thisDoesNotExist')).toBe('thisDoesNotExist');
    expect(t('nav.items.thisDoesNotExist')).not.toContain('undefined');
  });

  it('switches back', async () => {
    await changeLanguage('id');
    await changeLanguage('en');

    expect(t('nav.items.assets')).toBe('Assets');
  });
});

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('shows which language is active and changes it on click', async () => {
    render(<LanguageSwitcher />);

    const indonesian = screen.getByRole('button', { name: 'Bahasa Indonesia' });
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(indonesian);

    expect(indonesian).toHaveAttribute('aria-pressed', 'true');
    expect(readStoredLanguage()).toBe('id');
  });

  it('re-renders translated content when the language changes', async () => {
    render(
      <>
        <LanguageSwitcher />
        <StatusBadge value="UNDER_MAINTENANCE" />
      </>
    );

    expect(screen.getByText('Under maintenance')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Bahasa Indonesia' }));

    expect(screen.getByText('Dalam perbaikan')).toBeInTheDocument();
    expect(screen.queryByText('Under maintenance')).not.toBeInTheDocument();
  });
});
