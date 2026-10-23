// Logic shared by the class forms (create class, class settings).

/** A new class needs at least one language, or nobody can write an assignment for it. */
export function validateClassLanguages(languageIds: readonly string[]): string | null {
  return languageIds.length > 0 ? null : 'Pick at least one language';
}

/**
 * Whether Enter in the languages picker may submit the form. While the user is choosing (dropdown open or a filter
 * typed) Enter belongs to the picker, which adds the highlighted language, even when nothing matches.
 */
export function languagePickerEnterSubmits(dropdownOpen: boolean, search: string): boolean {
  return !dropdownOpen && search.trim() === '';
}

/**
 * The language Enter adds when nothing is highlighted: the first unpicked option whose label contains the typed filter
 * (the same match Mantine's list uses). Null when no filter is typed or nothing matches.
 */
export function firstLanguageMatch(
  options: ReadonlyArray<{ value: string; label: string }>,
  picked: readonly string[],
  search: string,
): string | null {
  const query = search.trim().toLowerCase();
  if (!query) return null;
  return options.find((o) => !picked.includes(o.value) && o.label.toLowerCase().includes(query))?.value ?? null;
}
