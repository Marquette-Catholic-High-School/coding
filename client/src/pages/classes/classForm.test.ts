import { describe, expect, it } from 'vitest';
import { firstLanguageMatch, languagePickerEnterSubmits, validateClassLanguages } from './classForm';

describe('validateClassLanguages', () => {
  it('requires at least one language', () => {
    expect(validateClassLanguages([])).toBe('Pick at least one language');
  });

  it('accepts one or more languages', () => {
    expect(validateClassLanguages(['python'])).toBeNull();
    expect(validateClassLanguages(['python', 'javascript'])).toBeNull();
  });
});

describe('languagePickerEnterSubmits', () => {
  it('keeps Enter in the picker while a filter is typed, even with the dropdown closed', () => {
    expect(languagePickerEnterSubmits(false, 'pyth')).toBe(false);
  });

  it('keeps Enter in the picker while the dropdown is open', () => {
    expect(languagePickerEnterSubmits(true, '')).toBe(false);
    expect(languagePickerEnterSubmits(true, 'zzz')).toBe(false);
  });

  it('lets Enter submit the form once the user has finished choosing', () => {
    expect(languagePickerEnterSubmits(false, '')).toBe(true);
    expect(languagePickerEnterSubmits(false, '   ')).toBe(true);
  });
});

describe('firstLanguageMatch', () => {
  const options = [
    { value: 'javascript', label: 'JavaScript' },
    { value: 'python', label: 'Python' },
    { value: 'pseudo', label: 'Classroom Pseudocode' },
  ];

  it('adds the first unpicked language containing the filter, ignoring case and spaces', () => {
    expect(firstLanguageMatch(options, [], ' PYTH ')).toBe('python');
    expect(firstLanguageMatch(options, [], 'script')).toBe('javascript');
    expect(firstLanguageMatch(options, ['javascript'], 'script')).toBeNull();
  });

  it('adds nothing without a filter (a second Enter after a pick must not add the next language)', () => {
    expect(firstLanguageMatch(options, ['python'], '')).toBeNull();
    expect(firstLanguageMatch(options, [], '  ')).toBeNull();
  });

  it('adds nothing when nothing matches', () => {
    expect(firstLanguageMatch(options, [], 'rust')).toBeNull();
  });
});
