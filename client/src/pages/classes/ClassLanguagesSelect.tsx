import { Group, MultiSelect, Text, type MultiSelectProps } from '@mantine/core';
import { useRef, useState } from 'react';
import { useLanguages } from '../../api/languages';
import { LanguageIcon } from '../../components/LanguageIcon';
import { firstLanguageMatch, languagePickerEnterSubmits } from './classForm';

/**
 * Picks the languages a class may use. Only enabled languages are offered, plus any in `keepIds` (languages the
 * class already has, which may stay after an admin turns them off).
 *
 * Enter adds the option highlighted with the arrow keys or the mouse; with nothing highlighted it adds the first
 * language matching the typed filter, and with no filter it adds nothing. Enter never submits the surrounding form
 * while the user is choosing (dropdown open or a filter typed), even when nothing matches.
 *
 * Works with uncontrolled forms (`defaultValue` + `onChange`) and controlled ones (`value`).
 */
export function ClassLanguagesSelect({
  keepIds = [],
  error,
  value,
  defaultValue,
  onChange,
  searchValue,
  onSearchChange,
  onKeyDown,
  onDropdownOpen,
  onDropdownClose,
  ...props
}: Omit<MultiSelectProps, 'data'> & { keepIds?: string[] }) {
  const languages = useLanguages();
  const dropdownOpen = useRef(false);
  const [ownValue, setOwnValue] = useState<string[]>(defaultValue ?? []);
  const [ownSearch, setOwnSearch] = useState('');
  const selected = value ?? ownValue;
  const search = searchValue ?? ownSearch;

  const all = languages.data?.languages ?? [];
  const byId = new Map(all.map((l) => [l.id, l]));
  const data = all
    .filter((l) => l.enabled || keepIds.includes(l.id))
    .map((l) => ({ value: l.id, label: l.enabled ? l.name : `${l.name} (turned off)` }));

  const setSelected = (next: string[]) => {
    if (value === undefined) setOwnValue(next);
    onChange?.(next);
  };
  const setSearch = (next: string) => {
    if (searchValue === undefined) setOwnSearch(next);
    onSearchChange?.(next);
  };

  return (
    <MultiSelect
      label="Languages"
      description="Students can only use these languages in this class"
      placeholder={languages.isPending ? 'Loading languages…' : 'Pick one or more'}
      searchable
      clearable
      hidePickedOptions
      nothingFoundMessage={data.length === 0 ? 'No languages are installed yet — an admin can add them on the Languages page.' : 'No matching languages'}
      renderOption={({ option }) => {
        const language = byId.get(option.value);
        return (
          <Group gap="xs" wrap="nowrap">
            {language && <LanguageIcon kind={language.kind} />}
            <Text size="sm">{option.label}</Text>
          </Group>
        );
      }}
      {...props}
      value={selected}
      onChange={setSelected}
      searchValue={search}
      onSearchChange={setSearch}
      onDropdownOpen={() => {
        dropdownOpen.current = true;
        onDropdownOpen?.();
      }}
      onDropdownClose={() => {
        dropdownOpen.current = false;
        onDropdownClose?.();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key !== 'Enter') return;
        // Mantine adds the highlighted option itself (after this handler). With none highlighted, add the first match.
        const listId = event.currentTarget.getAttribute('aria-controls');
        const highlighted = listId ? document.getElementById(listId)?.querySelector('[data-combobox-selected]') : null;
        if (!highlighted) {
          const match = firstLanguageMatch(data, selected, search);
          if (match) {
            setSelected([...selected, match]);
            setSearch('');
          }
        }
        if (!languagePickerEnterSubmits(dropdownOpen.current, search)) event.preventDefault();
      }}
      data={data}
      error={error || (languages.isError ? "Couldn't load the installed languages. Try again in a moment." : undefined)}
    />
  );
}
