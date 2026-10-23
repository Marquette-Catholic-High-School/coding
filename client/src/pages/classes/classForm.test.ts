import { describe, expect, it } from 'vitest';
import { languagePickerEnterSubmits, validateClassLanguages } from './classForm';

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
