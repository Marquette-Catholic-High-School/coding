// Logic behind the "Copy assignments" dialog (CopyAssignmentsModal); kept free of React so it can be unit tested.

import type { AssignmentListItem, ClassSummary, CopyAssignmentsResponse, Language } from '@codeclass/shared';

/** The most assignments one copy request may carry (copyAssignmentsSchema's `.max`). */
export const MAX_COPY_AT_ONCE = 100;

export interface ClassOptionGroup {
  group: string;
  items: { value: string; label: string }[];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "Python", "Python and Scratch", "Python, Scratch and Web". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Select data for the source class: the viewer's active classes, then archived ones, then the class being copied
 * into ("This class") last. Classes someone else teaches (admins see every class) carry the teacher's name.
 */
export function sourceClassOptions(
  active: readonly ClassSummary[],
  archived: readonly ClassSummary[],
  current: Pick<ClassSummary, 'id' | 'name'>,
  viewerId: number,
): ClassOptionGroup[] {
  const seen = new Set<number>([current.id]);
  const items = (list: readonly ClassSummary[]) =>
    list
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      })
      .map((c) => ({ value: String(c.id), label: c.ownerId === viewerId ? c.name : `${c.name} (${c.ownerName})` }));
  const groups: ClassOptionGroup[] = [
    { group: 'Active classes', items: items(active) },
    { group: 'Archived classes', items: items(archived) },
    { group: 'This class', items: [{ value: String(current.id), label: current.name }] },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Warning lines for the selected assignments: like a new assignment, a copy needs an installed language that is turned
 * on (even one the class already has), else the server skips it; a usable language the class doesn't have yet is
 * added to the class. `languages` is undefined while the languages are still loading (no warnings until they are known).
 */
export function languageWarnings(
  selected: readonly Pick<AssignmentListItem, 'languageId'>[],
  classLanguageIds: readonly string[],
  languages: ReadonlyMap<string, Pick<Language, 'name' | 'enabled'>> | undefined,
): string[] {
  if (!languages) return [];
  const inClass = new Set(classLanguageIds);
  const added: string[] = [];
  const blocked = new Map<string, number>();
  for (const { languageId } of selected) {
    const language = languages.get(languageId);
    if (!language?.enabled) blocked.set(languageId, (blocked.get(languageId) ?? 0) + 1);
    else if (!inClass.has(languageId) && !added.includes(language.name)) added.push(language.name);
  }
  const lines = added.length > 0 ? [`${joinNames(added)} will be added to this class.`] : [];
  for (const [id, count] of blocked) {
    const language = languages.get(id);
    const why = language ? `${language.name} is turned off` : `${id} isn't installed any more`;
    const which = count === 1 ? 'the assignment that uses it' : `the ${count} assignments that use it`;
    lines.push(`${why}, so ${which} can't be copied.`);
  }
  return lines;
}

/** Footer button label: "Copy assignments" with nothing picked, else "Copy 1 assignment" / "Copy 3 assignments". */
export function copyButtonLabel(count: number): string {
  return count === 0 ? 'Copy assignments' : `Copy ${plural(count, 'assignment')}`;
}

/** Title of the list of assignments the server skipped. */
export function skippedTitle(result: Pick<CopyAssignmentsResponse, 'copied' | 'skipped'>): string {
  if (result.copied.length === 0) return 'Nothing was copied';
  const n = result.skipped.length;
  return `${plural(n, 'assignment')} ${n === 1 ? "wasn't" : "weren't"} copied`;
}

/**
 * Success notification for a copy: what was copied, whether the copies are drafts, the languages added to the class,
 * how many were skipped (the dialog lists why) and the server's notes. Null when nothing was copied.
 */
export function copySummary(
  result: CopyAssignmentsResponse,
  languageName: (id: string) => string,
  published: boolean,
): { title: string; message: string } | null {
  const n = result.copied.length;
  if (n === 0) return null;
  const parts = [
    published
      ? `${n === 1 ? "It's" : "They're"} published, so students can see ${n === 1 ? 'it' : 'them'} now.`
      : `${n === 1 ? "It's a draft" : "They're drafts"}: publish ${n === 1 ? 'it' : 'them'} when ${n === 1 ? "it's" : "they're"} ready.`,
  ];
  if (result.addedLanguageIds.length > 0) {
    const names = result.addedLanguageIds.map(languageName);
    parts.push(`${joinNames(names)} ${names.length === 1 ? 'was' : 'were'} added to this class.`);
  }
  if (result.skipped.length > 0) {
    parts.push(`${plural(result.skipped.length, 'assignment')} couldn't be copied.`);
  }
  parts.push(...result.notes);
  return { title: `${plural(n, 'assignment')} copied`, message: parts.join(' ') };
}
