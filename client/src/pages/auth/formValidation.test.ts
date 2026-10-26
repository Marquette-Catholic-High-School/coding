import { describe, expect, it } from 'vitest';
import { EMAIL_REQUIRED_MESSAGE, validateJoinAccount, withPasswordConfirm, type JoinAccountValues } from './formValidation';

const valid: JoinAccountValues = {
  name: 'Sam Patel',
  username: 'sam.patel',
  email: '',
  password: 'correct horse',
  confirmPassword: 'correct horse',
};

describe('withPasswordConfirm', () => {
  const validate = withPasswordConfirm<{ password: string; confirm: string }>(() => ({}), 'password', 'confirm');

  it('asks for the password again and checks that it matches', () => {
    expect(validate({ password: 'abcdefgh', confirm: '' })).toEqual({ confirm: 'Type the password again' });
    expect(validate({ password: 'abcdefgh', confirm: 'abcdefgx' })).toEqual({ confirm: "Passwords don't match" });
    expect(validate({ password: 'abcdefgh', confirm: 'abcdefgh' })).toEqual({});
  });
});

describe('validateJoinAccount', () => {
  it('accepts an account without an email when the student has a class code', () => {
    expect(validateJoinAccount(valid, 'K7M2QX')).toEqual({});
    expect(validateJoinAccount({ ...valid, email: 'sam@school.org' }, 'K7M2QX')).toEqual({});
  });

  it('requires the email when signing up without a class code', () => {
    expect(validateJoinAccount(valid, null)).toEqual({ email: EMAIL_REQUIRED_MESSAGE });
    expect(validateJoinAccount({ ...valid, email: '   ' }, null).email).toBeTruthy();
    expect(validateJoinAccount({ ...valid, email: 'sam@school.org' }, null)).toEqual({});
  });

  it('checks the email format in both modes', () => {
    expect(validateJoinAccount({ ...valid, email: 'not-an-email' }, 'K7M2QX').email).toBe('Enter a valid email');
    expect(validateJoinAccount({ ...valid, email: 'not-an-email' }, null).email).toBe('Enter a valid email');
  });

  it('reports the account fields and the password confirmation together', () => {
    const errors = validateJoinAccount({ name: ' ', username: 'x', email: '', password: 'short', confirmPassword: 'other' }, null);
    expect(Object.keys(errors).sort()).toEqual(['confirmPassword', 'email', 'name', 'password', 'username']);
  });

  it('never reports the class code, which the first step checks', () => {
    expect(validateJoinAccount(valid, 'bad')).toEqual({});
  });
});
