import { Group, MultiSelect, Text, type MultiSelectProps } from '@mantine/core';
import { useRef } from 'react';
import { useLanguages } from '../../api/languages';
import { LanguageIcon } from '../../components/LanguageIcon';
import { languagePickerEnterSubmits } from './classForm';

/**
 * Picks the languages a class may use. Only enabled languages are offered, plus any in `keepIds` (languages the
 * class already has, which may stay after an admin turns them off).
 *
 * Typing filters the list with the first match highlighted, so Enter picks it. Enter never submits the surrounding
 * form while the user is choosing (dropdown open or a filter typed), even when nothing matches.
 */
export function ClassLanguagesSelect({
  keepIds = [],
  error,
  onKeyDown,
  onDropdownOpen,
  onDropdownClose,
  ...props
}: Omit<MultiSelectProps, 'data'> & { keepIds?: string[] }) {
  const languages = useLanguages();
  const dropdownOpen = useRef(false);
  const all = languages.data?.languages ?? [];
  const byId = new Map(all.map((l) => [l.id, l]));
  const data = all
    .filter((l) => l.enabled || keepIds.includes(l.id))
    .map((l) => ({ value: l.id, label: l.enabled ? l.name : `${l.name} (turned off)` }));

  return (
    <MultiSelect
      label="Languages"
      description="Students can only use these languages in this class"
      placeholder={languages.isPending ? 'Loading languages…' : 'Pick one or more'}
      searchable
      clearable
      hidePickedOptions
      selectFirstOptionOnChange
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
        // Mantine still adds the highlighted option on Enter; this only stops the form from submitting.
        if (event.key === 'Enter' && !languagePickerEnterSubmits(dropdownOpen.current, event.currentTarget.value)) event.preventDefault();
      }}
      data={data}
      error={error || (languages.isError ? "Couldn't load the installed languages. Try again in a moment." : undefined)}
    />
  );
}
