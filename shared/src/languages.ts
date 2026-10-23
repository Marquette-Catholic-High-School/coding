// The catalog of installable language packs. Every pack runs in the student's browser (Web Worker or sandboxed
// iframe), so installing a pack only records it in the database and makes it selectable; runtimes are loaded on
// first use.

import type { LanguageKind } from './types';

export type PackKind = Exclude<LanguageKind, 'pseudocode'>;

export interface LanguagePack {
  kind: PackKind;
  /** Id used when the pack is installed. */
  id: string;
  name: string;
  version: string;
  description: string;
  /** Approximate download on a student's first run, for the catalog card. */
  downloadSize: string;
  fileExtension: string;
  starterCode: string;
  /** Programs can read typed input (input(), prompt(), io.read()). */
  supportsInput: boolean;
  /** Assignments can have input/expected-output tests. */
  supportsTests: boolean;
  docsUrl: string;
}

export const PYODIDE_VERSION = '314.0.7';
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export const LANGUAGE_PACKS: readonly LanguagePack[] = [
  {
    kind: 'python',
    id: 'python',
    name: 'Python',
    version: `Python 3.14 (Pyodide ${PYODIDE_VERSION})`,
    description: 'The full Python language with the standard library, running in the browser via Pyodide.',
    downloadSize: '≈ 10 MB on first run (cached afterwards)',
    fileExtension: 'py',
    starterCode: 'name = input("What is your name? ")\nprint(f"Hello, {name}!")\n',
    supportsInput: true,
    supportsTests: true,
    docsUrl: 'https://docs.python.org/3/tutorial/',
  },
  {
    kind: 'javascript',
    id: 'javascript',
    name: 'JavaScript',
    version: 'ES2023 (browser engine)',
    description: 'Modern JavaScript. Use console.log() for output and input() / prompt() to read a line.',
    downloadSize: 'Built in — no download',
    fileExtension: 'js',
    starterCode: 'const name = input("What is your name? ");\nconsole.log(`Hello, ${name}!`);\n',
    supportsInput: true,
    supportsTests: true,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide',
  },
  {
    kind: 'typescript',
    id: 'typescript',
    name: 'TypeScript',
    version: 'TypeScript syntax (types are stripped, not checked)',
    description: 'JavaScript with type annotations. Types are removed before running.',
    downloadSize: '≈ 300 KB on first run',
    fileExtension: 'ts',
    starterCode: 'const name: string = input("What is your name? ");\nconsole.log(`Hello, ${name}!`);\n',
    supportsInput: true,
    supportsTests: true,
    docsUrl: 'https://www.typescriptlang.org/docs/handbook/intro.html',
  },
  {
    kind: 'lua',
    id: 'lua',
    name: 'Lua',
    version: 'Lua 5.4 (wasmoon)',
    description: 'A small, friendly scripting language popular in game making.',
    downloadSize: '≈ 400 KB on first run',
    fileExtension: 'lua',
    starterCode: 'io.write("What is your name? ")\nlocal name = io.read()\nprint("Hello, " .. name .. "!")\n',
    supportsInput: true,
    supportsTests: true,
    docsUrl: 'https://www.lua.org/pil/contents.html',
  },
  {
    kind: 'sql',
    id: 'sql',
    name: 'SQL',
    version: 'SQLite 3 (sql.js)',
    description: 'Write SQL against an in-browser SQLite database. Results print as text tables.',
    downloadSize: '≈ 650 KB on first run',
    fileExtension: 'sql',
    starterCode:
      "CREATE TABLE pets (name TEXT, kind TEXT, age INTEGER);\nINSERT INTO pets VALUES ('Rex', 'dog', 3), ('Tom', 'cat', 5);\n\nSELECT name, age FROM pets WHERE age > 2 ORDER BY age;\n",
    supportsInput: false,
    supportsTests: true,
    docsUrl: 'https://www.sqlite.org/lang.html',
  },
  {
    kind: 'web',
    id: 'web',
    name: 'Web page (HTML/CSS/JS)',
    version: 'HTML5',
    description: 'Build a web page with HTML, CSS and JavaScript and see it live in a sandboxed preview.',
    downloadSize: 'Built in — no download',
    fileExtension: 'html',
    starterCode:
      '<!doctype html>\n<html>\n  <head>\n    <style>\n      body { font-family: sans-serif; }\n      h1 { color: seagreen; }\n    </style>\n  </head>\n  <body>\n    <h1>Hello, web!</h1>\n    <button onclick="this.textContent = \'Clicked!\'">Click me</button>\n  </body>\n</html>\n',
    supportsInput: false,
    supportsTests: false,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Learn',
  },
];

export function findPack(kind: LanguageKind): LanguagePack | undefined {
  return LANGUAGE_PACKS.find((p) => p.kind === kind);
}

/** Pseudocode languages always support input and tests. */
export function kindSupportsTests(kind: LanguageKind): boolean {
  return kind === 'pseudocode' || (findPack(kind)?.supportsTests ?? false);
}

export function kindSupportsInput(kind: LanguageKind): boolean {
  return kind === 'pseudocode' || (findPack(kind)?.supportsInput ?? false);
}

export const LANGUAGE_KIND_LABELS: Record<LanguageKind, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  lua: 'Lua',
  sql: 'SQL',
  web: 'Web page',
  pseudocode: 'Pseudocode',
};
