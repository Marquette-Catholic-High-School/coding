import { Group, MultiSelect, Text, type MultiSelectProps } from '@mantine/core';
import { useLanguages } from '../../api/languages';
import { LanguageIcon } from '../../components/LanguageIcon';

/**
 * Picks the languages a class may use. Only enabled languages are offered, plus any in `keepIds` (languages the
 * class already has, which may stay after an admin turns them off).
 */
export function ClassLanguagesSelect({ keepIds = [], error, ...props }: Omit<MultiSelectProps, 'data'> & { keepIds?: string[] }) {
  const languages = useLanguages();
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
      data={data}
      error={error || (languages.isError ? "Couldn't load the installed languages. Try again in a moment." : undefined)}
    />
  );
}
