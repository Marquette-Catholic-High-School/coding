// TypeScript runner: sucrase strips the types (keeping every line where it was), then the JavaScript runner runs it.

import { failure, type LanguageRunner } from './io';
import { runJavaScript } from './javascript';
import { sucraseErrorLocation, sucraseErrorMessage } from './jsErrors';

type Sucrase = typeof import('sucrase');

let sucrase: Sucrase | null = null;
let loading: Promise<void> | null = null;

export const typescriptRunner: LanguageRunner = {
  loaded: () => sucrase !== null,
  load: () => {
    loading ??= import('sucrase').then(
      (module) => {
        sucrase = module;
      },
      (err: unknown) => {
        loading = null;
        throw new Error("Couldn't load the TypeScript tools. Check your connection and try again.", { cause: err });
      },
    );
    return loading;
  },
  run: async (code, io) => {
    if (!sucrase) await typescriptRunner.load();
    let js: string;
    try {
      js = sucrase!.transform(code, { transforms: ['typescript'], disableESTransforms: true }).code;
    } catch (err) {
      return failure({ message: `SyntaxError: ${sucraseErrorMessage(err)}`, ...sucraseErrorLocation(err) });
    }
    return runJavaScript(js, io, code);
  },
};
