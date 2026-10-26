// Wording and navigation for classes a student joins by signing up or by saving their email (`UserResponse.joinedClasses`).

export interface JoinedClass {
  id: number;
  name: string;
}

/** "Algebra" · "Algebra and Biology" · "Algebra, Biology and Chemistry". */
export function listClassNames(classes: readonly JoinedClass[]): string {
  const names = classes.map((c) => c.name);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Where a new student goes after signing up: straight into the class when they joined exactly one, else the dashboard. */
export function pathAfterSignUp(joined: readonly JoinedClass[] | undefined): string {
  return joined?.length === 1 ? `/classes/${joined[0]!.id}` : '/dashboard';
}

/**
 * Notification after signing up. `codeClassName` is the class of the code the student entered (null when they signed
 * up with an invited email only); it is used when the server doesn't list the classes.
 */
export function signUpNotice(
  joined: readonly JoinedClass[] | undefined,
  codeClassName: string | null,
): { title: string; message: string } {
  if (joined && joined.length > 1) {
    return {
      title: `You joined ${joined.length} classes`,
      message: `${listClassNames(joined)}. Your assignments will show up on your dashboard.`,
    };
  }
  const only = joined?.[0]?.name ?? codeClassName;
  if (only) return { title: `Welcome to ${only}!`, message: 'Your account is ready. Your assignments will show up in the class.' };
  return {
    title: 'Your account is ready',
    message: "No class has added this email address yet. Ask your teacher to check the address they used, or join with a class code.",
  };
}

/** Notification after saving a profile email that teachers had added to classes; null when nothing was joined. */
export function profileJoinNotice(joined: readonly JoinedClass[] | undefined): { title: string; message: string } | null {
  if (!joined?.length) return null;
  if (joined.length === 1) {
    return { title: `You joined ${joined[0]!.name}`, message: 'Your teacher added your email address to this class. Find it on your dashboard.' };
  }
  return {
    title: `You joined ${joined.length} classes`,
    message: `${listClassNames(joined)} — your teachers added your email address. Find them on your dashboard.`,
  };
}
