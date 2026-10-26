import type { User } from '@codeclass/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by the `loadUser` middleware when the session cookie is valid. */
      user?: User;
      /** Set by `loadUser` with `user` when a teacher or admin is signed in as that student. */
      impersonator?: User;
    }
  }
}

export {};
