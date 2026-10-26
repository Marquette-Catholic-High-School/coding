import { describe, expect, it } from 'vitest';
import { listClassNames, pathAfterSignUp, profileJoinNotice, signUpNotice } from './joinedClasses';

const algebra = { id: 3, name: 'Algebra' };
const biology = { id: 5, name: 'Biology' };
const chemistry = { id: 8, name: 'Chemistry' };

describe('listClassNames', () => {
  it('joins names in plain English', () => {
    expect(listClassNames([])).toBe('');
    expect(listClassNames([algebra])).toBe('Algebra');
    expect(listClassNames([algebra, biology])).toBe('Algebra and Biology');
    expect(listClassNames([algebra, biology, chemistry])).toBe('Algebra, Biology and Chemistry');
  });
});

describe('pathAfterSignUp', () => {
  it('opens the class when exactly one was joined, else the dashboard', () => {
    expect(pathAfterSignUp([algebra])).toBe('/classes/3');
    expect(pathAfterSignUp([algebra, biology])).toBe('/dashboard');
    expect(pathAfterSignUp([])).toBe('/dashboard');
    expect(pathAfterSignUp(undefined)).toBe('/dashboard');
  });
});

describe('signUpNotice', () => {
  it('welcomes the student to the one class they joined', () => {
    expect(signUpNotice([algebra], null).title).toBe('Welcome to Algebra!');
    expect(signUpNotice([algebra], 'Code class').title).toBe('Welcome to Algebra!');
  });

  it('names every class when they joined several', () => {
    expect(signUpNotice([algebra, biology, chemistry], 'Algebra')).toEqual({
      title: 'You joined 3 classes',
      message: 'Algebra, Biology and Chemistry. Your assignments will show up on your dashboard.',
    });
  });

  it("falls back to the class code's class when the server doesn't list them", () => {
    expect(signUpNotice(undefined, 'Algebra').title).toBe('Welcome to Algebra!');
    expect(signUpNotice([], 'Algebra').title).toBe('Welcome to Algebra!');
  });

  it('explains when no class was waiting for the email', () => {
    const notice = signUpNotice([], null);
    expect(notice.title).toBe('Your account is ready');
    expect(notice.message).toMatch(/No class has added this email/);
  });
});

describe('profileJoinNotice', () => {
  it('is null when nothing was joined', () => {
    expect(profileJoinNotice(undefined)).toBeNull();
    expect(profileJoinNotice([])).toBeNull();
  });

  it('names the classes joined', () => {
    expect(profileJoinNotice([biology])?.title).toBe('You joined Biology');
    expect(profileJoinNotice([algebra, biology])).toEqual({
      title: 'You joined 2 classes',
      message: 'Algebra and Biology — your teachers added your email address. Find them on your dashboard.',
    });
  });
});
