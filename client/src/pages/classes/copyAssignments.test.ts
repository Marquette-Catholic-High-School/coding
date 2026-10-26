import type { ClassSummary, CopyAssignmentsResponse } from '@codeclass/shared';
import { describe, expect, it } from 'vitest';
import { copyButtonLabel, copySummary, joinNames, languageWarnings, skippedTitle, sourceClassOptions } from './copyAssignments';

function cls(id: number, name: string, ownerId = 1, ownerName = 'Ms Lee'): ClassSummary {
  return {
    id,
    name,
    description: '',
    joinCode: 'ABC123',
    joinEnabled: true,
    archived: false,
    ownerId,
    ownerName,
    studentCount: 0,
    assignmentCount: 0,
    languageIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function response(overrides: Partial<CopyAssignmentsResponse> = {}): CopyAssignmentsResponse {
  return { copied: [], addedLanguageIds: [], skipped: [], notes: [], ...overrides };
}

const copied = (n: number) => Array.from({ length: n }, (_, i) => ({ sourceId: i + 1, id: 100 + i, title: `A${i}` }));

describe('joinNames', () => {
  it('joins names with commas and a final "and"', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Python'])).toBe('Python');
    expect(joinNames(['Python', 'Scratch'])).toBe('Python and Scratch');
    expect(joinNames(['Python', 'Scratch', 'Web'])).toBe('Python, Scratch and Web');
  });
});

describe('sourceClassOptions', () => {
  const current = cls(2, 'Period 3');

  it('lists active classes, then archived ones, then this class last', () => {
    const groups = sourceClassOptions([cls(1, 'Period 1'), current], [cls(3, 'Last year')], current, 1);
    expect(groups).toEqual([
      { group: 'Active classes', items: [{ value: '1', label: 'Period 1' }] },
      { group: 'Archived classes', items: [{ value: '3', label: 'Last year' }] },
      { group: 'This class', items: [{ value: '2', label: 'Period 3' }] },
    ]);
  });

  it('leaves out empty groups and keeps an archived current class only under "This class"', () => {
    const archivedCurrent = { ...current, archived: true };
    expect(sourceClassOptions([], [archivedCurrent], archivedCurrent, 1)).toEqual([
      { group: 'This class', items: [{ value: '2', label: 'Period 3' }] },
    ]);
  });

  it("names the teacher of classes the viewer doesn't own (admins see every class)", () => {
    const groups = sourceClassOptions([cls(5, 'Robotics', 9, 'Mr Patel')], [], current, 1);
    expect(groups[0]!.items).toEqual([{ value: '5', label: 'Robotics (Mr Patel)' }]);
  });

  it('lists a class once even if it shows up in both lists', () => {
    const groups = sourceClassOptions([cls(1, 'Period 1')], [cls(1, 'Period 1')], current, 1);
    expect(groups.map((g) => g.group)).toEqual(['Active classes', 'This class']);
  });
});

describe('languageWarnings', () => {
  const languages = new Map([
    ['python', { name: 'Python', enabled: true }],
    ['web', { name: 'Web', enabled: true }],
    ['scratch', { name: 'Scratch', enabled: false }],
  ]);

  it('says nothing when the class already uses every language and they are all turned on', () => {
    expect(languageWarnings([{ languageId: 'python' }, { languageId: 'web' }], ['python', 'web'], languages)).toEqual([]);
  });

  it('names each language that will be added, once', () => {
    const selected = [{ languageId: 'python' }, { languageId: 'web' }, { languageId: 'python' }];
    expect(languageWarnings(selected, ['javascript'], languages)).toEqual(['Python and Web will be added to this class.']);
  });

  it("warns that assignments in a turned-off or uninstalled language can't be copied", () => {
    const selected = [{ languageId: 'scratch' }, { languageId: 'scratch' }, { languageId: 'lua' }, { languageId: 'python' }];
    expect(languageWarnings(selected, [], languages)).toEqual([
      'Python will be added to this class.',
      "Scratch is turned off, so the 2 assignments that use it can't be copied.",
      "lua isn't installed any more, so the assignment that uses it can't be copied.",
    ]);
  });

  it('warns about a turned-off language even when the class already has it', () => {
    expect(languageWarnings([{ languageId: 'scratch' }], ['scratch'], languages)).toEqual([
      "Scratch is turned off, so the assignment that uses it can't be copied.",
    ]);
  });

  it('waits for the languages to load', () => {
    expect(languageWarnings([{ languageId: 'python' }], [], undefined)).toEqual([]);
  });
});

describe('copyButtonLabel', () => {
  it('counts the selected assignments', () => {
    expect(copyButtonLabel(0)).toBe('Copy assignments');
    expect(copyButtonLabel(1)).toBe('Copy 1 assignment');
    expect(copyButtonLabel(4)).toBe('Copy 4 assignments');
  });
});

describe('skippedTitle', () => {
  const skip = { sourceId: 9, title: 'Old one', reason: 'Scratch is turned off' };

  it('says nothing was copied when everything was skipped', () => {
    expect(skippedTitle(response({ skipped: [skip] }))).toBe('Nothing was copied');
  });

  it('counts the skipped assignments', () => {
    expect(skippedTitle(response({ copied: copied(1), skipped: [skip] }))).toBe("1 assignment wasn't copied");
    expect(skippedTitle(response({ copied: copied(1), skipped: [skip, { ...skip, sourceId: 10 }] }))).toBe(
      "2 assignments weren't copied",
    );
  });
});

describe('copySummary', () => {
  const name = (id: string) => ({ python: 'Python', web: 'Web' })[id] ?? id;

  it('is null when nothing was copied', () => {
    expect(copySummary(response({ skipped: [{ sourceId: 1, title: 'A', reason: 'x' }] }), name, false)).toBeNull();
  });

  it('reminds the teacher that drafts need publishing', () => {
    expect(copySummary(response({ copied: copied(1) }), name, false)).toEqual({
      title: '1 assignment copied',
      message: "It's a draft: publish it when it's ready.",
    });
    expect(copySummary(response({ copied: copied(3) }), name, false)?.message).toBe("They're drafts: publish them when they're ready.");
  });

  it('says published copies are already visible', () => {
    expect(copySummary(response({ copied: copied(2) }), name, true)).toEqual({
      title: '2 assignments copied',
      message: "They're published, so students can see them now.",
    });
  });

  it('mentions added languages, skipped assignments and the server notes', () => {
    const result = response({
      copied: copied(2),
      addedLanguageIds: ['python', 'lua'],
      skipped: [{ sourceId: 7, title: 'Old', reason: 'Scratch is turned off' }],
      notes: ['"Loops" has no due date, so its solution is now for teachers only.'],
    });
    expect(copySummary(result, name, false)?.message).toBe(
      "They're drafts: publish them when they're ready. Python and lua were added to this class. 1 assignment couldn't be copied. " +
        '"Loops" has no due date, so its solution is now for teachers only.',
    );
    expect(copySummary({ ...result, addedLanguageIds: ['web'] }, name, false)?.message).toContain('Web was added to this class.');
  });
});
