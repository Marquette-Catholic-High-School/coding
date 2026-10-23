import type { FormErrors } from '@mantine/form';

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
