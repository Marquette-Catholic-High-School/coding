import { schemaResolver, type FormErrors } from '@mantine/form';
import { registerSchema } from '@codeclass/shared';

/**
 * Wraps a form validator (usually `schemaResolver(sharedSchema, { sync: true })`) with a
 * "confirm password" check, which the API schemas don't include.
 */
export function withPasswordConfirm<V extends Record<string, unknown>>(
  validate: (values: V) => FormErrors,
  passwordField: keyof V & string,
  confirmField: keyof V & string,
): (values: V) => FormErrors {
  return (values) => {
    const errors = validate(values);
    if (!values[confirmField]) errors[confirmField] = 'Type the password again';
    else if (values[confirmField] !== values[passwordField]) errors[confirmField] = "Passwords don't match";
    return errors;
  };
}

/** The account step of the join page (`registerSchema` without the class code, plus a password confirmation). */
export interface JoinAccountValues extends Record<string, unknown> {
  name: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export const EMAIL_REQUIRED_MESSAGE = 'Enter the email address your teacher added';

const resolveRegister = schemaResolver(registerSchema, { sync: true });

/**
 * Validates the join page's account step. `joinCode` is the class code from the first step, or null when the student
 * signs up with an email address a teacher added instead — then the email is required, since it is what finds their
 * classes. The class code itself was checked on the first step, so its errors are not reported here.
 */
export function validateJoinAccount(values: JoinAccountValues, joinCode: string | null): FormErrors {
  return withPasswordConfirm<JoinAccountValues>(
    ({ confirmPassword: _confirm, ...account }) => {
      // Submit trims the email (phones often add a trailing space), so validate the trimmed value too.
      const errors = resolveRegister({ ...account, email: account.email.trim(), joinCode: joinCode ?? undefined });
      delete errors.joinCode;
      if (joinCode === null && !account.email.trim()) errors.email = EMAIL_REQUIRED_MESSAGE;
      return errors;
    },
    'password',
    'confirmPassword',
  )(values);
}
