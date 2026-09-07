import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Input, Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Filter controls — `07-ui.md` §4.1.
 *
 * Each maps 1:1 onto an API query param (`06-api.md` §1.6) and writes straight
 * through `useListParams`, so the URL and the request never disagree.
 *
 * THE DEFAULTS ARE TRANSLATED HERE, not at every call site. These three render
 * on every list screen in the application, so an English word baked in as a
 * default parameter was an English filter bar on twenty screens no matter which
 * language was chosen. A caller that passes its own `label` still wins — several
 * do, because "Actor" or "Scope" says more than "Status" would.
 */

export function SearchFilter({ value = '', onChange, label, placeholder }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <Label htmlFor="filter-q">{label ?? t('common.actions.search')}</Label>
      <div className="relative">
        <Search
          className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="filter-q"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? t('common.filters.searchPlaceholder')}
          className="w-56 pl-8"
        />
      </div>
    </div>
  );
}

/** The `status` filter every soft-deletable resource shares (`06-api.md` §1.7). */
export function StatusFilter({ value = 'all', onChange }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <Label htmlFor="filter-status">{t('common.filters.status')}</Label>
      <Select value={value} onValueChange={(next) => onChange(next === 'all' ? '' : next)}>
        <SelectTrigger id="filter-status" className="w-40">
          <SelectValue placeholder={t('common.filters.all')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('common.filters.all')}</SelectItem>
          {/* The same two words the status badge uses, from the same keys — a
              filter and the rows it produces must not name a state differently. */}
          <SelectItem value="active">{t('enums.active')}</SelectItem>
          <SelectItem value="inactive">{t('enums.inactive')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** A generic single-select filter, for `institutionId`, `scope` and friends. */
export function SelectFilter({ id, label, value = 'all', options, onChange, width = 'w-52' }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || 'all'} onValueChange={(next) => onChange(next === 'all' ? '' : next)}>
        <SelectTrigger id={id} className={width}>
          <SelectValue placeholder={t('common.filters.all')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('common.filters.all')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
