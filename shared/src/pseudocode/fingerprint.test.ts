import { describe, expect, it } from 'vitest';
import type { CompareMode } from '../types';
import { runPseudocode } from './engine';
import { normalizeLiteral, pseudocodeFingerprint, samePseudocodeProgram } from './fingerprint';
import { createPseudocodeConfig, PSEUDOCODE_PRESETS } from './presets';
import type { PseudocodeConfig } from './types';

const classroom = createPseudocodeConfig('classroom');
const apcsp = createPseudocodeConfig('ap-csp');
const cambridge = createPseudocodeConfig('cambridge');
const aqa = createPseudocodeConfig('aqa');
const bothEndIf: PseudocodeConfig = {
  ...classroom,
  keywords: { ...classroom.keywords, endIf: ['END IF', 'ENDIF'], endWhile: ['END WHILE', 'ENDWHILE'] },
};
const caseSensitive: PseudocodeConfig = { ...classroom, caseSensitive: true };
const bothBlocks: PseudocodeConfig = { ...classroom, blockStyle: 'both' };

const MODES: CompareMode[] = ['exact', 'trim', 'ignore-whitespace', 'ignore-case'];

/** Output of a run with the given input lines (or the error), to check that "same" pairs really run the same. */
function run(code: string, config: PseudocodeConfig, input: string[]): string {
  let out = '';
  const queue = [...input];
  const result = runPseudocode(code, config, { write: (t) => (out += t), readLine: () => queue.shift() ?? null });
  return result.ok ? out : `ERROR: ${result.error?.message}`;
}

interface Pair {
  name: string;
  config: PseudocodeConfig;
  solution: string;
  student: string;
  /** Inputs to run both with (cross-check for "same" pairs). */
  inputs?: string[][];
}

const SOL_IF = 'INPUT n\nIF n > 0 THEN\n  OUTPUT "positive"\nELSE\n  OUTPUT "not positive"\nEND IF\n';
const SOL_LOOP = 'SET total TO 0\nFOR i FROM 1 TO 5\n  total ← total + i\nEND FOR\nOUTPUT "Total:", total\n';
const DOUBLE = 'INPUT n\nOUTPUT n * 2\n';

// The same program typed differently: same in every compare mode.
const SAME: Pair[] = [
  { name: 'n*2 vs n * 2', config: classroom, solution: DOUBLE, student: 'INPUT n\nOUTPUT n*2\n', inputs: [['4']] },
  { name: 'extra spaces everywhere', config: classroom, solution: DOUBLE, student: '  INPUT   n\n OUTPUT    n   *   2   \n', inputs: [['4']] },
  { name: 'tab indent vs 2 spaces', config: classroom, solution: SOL_IF, student: SOL_IF.replace(/ {2}/g, '\t'), inputs: [['3'], ['-1']] },
  { name: 'no indentation', config: classroom, solution: SOL_IF, student: SOL_IF.replace(/^ +/gm, ''), inputs: [['3'], ['-1']] },
  { name: 'blank lines and CRLF', config: classroom, solution: SOL_IF, student: `\n${SOL_IF.replace(/\n/g, '\r\n\r\n')}\n\n`, inputs: [['3']] },
  { name: 'kept starter comment', config: classroom, solution: DOUBLE, student: `// Write your program below\n${DOUBLE}`, inputs: [['4']] },
  { name: 'end-of-line comments', config: classroom, solution: DOUBLE, student: 'INPUT n // the number\nOUTPUT n * 2 // doubled\n', inputs: [['4']] },
  {
    name: 'lowercase keywords (case-insensitive language)',
    config: classroom,
    solution: SOL_IF,
    student: SOL_IF.replace(/INPUT|IF|THEN|OUTPUT|ELSE|END/g, (w) => w.toLowerCase()),
    inputs: [['3']],
  },
  { name: 'THEN left out (optional)', config: classroom, solution: SOL_IF, student: SOL_IF.replace(' THEN', ''), inputs: [['3']] },
  { name: 'SET x TO v vs x ← v', config: classroom, solution: SOL_LOOP, student: SOL_LOOP.replace('SET total TO 0', 'total ← 0') },
  { name: '← vs <-', config: classroom, solution: SOL_LOOP, student: SOL_LOOP.replace(/←/g, '<-') },
  { name: "' vs \" quotes", config: classroom, solution: 'OUTPUT "Hello"\n', student: "OUTPUT 'Hello'\n" },
  { name: 'END IF vs ENDIF (both listed by the teacher)', config: bothEndIf, solution: SOL_IF, student: SOL_IF.replace('END IF', 'ENDIF'), inputs: [['3']] },
  { name: 'END  IF (two spaces)', config: classroom, solution: SOL_IF, student: SOL_IF.replace('END IF', 'END  IF'), inputs: [['3']] },
  { name: 'LENGTH vs length built-in', config: classroom, solution: 'SET s TO "abc"\nOUTPUT LENGTH(s)\n', student: 'SET s TO "abc"\nOUTPUT length(s)\n' },
  { name: 'redundant brackets', config: classroom, solution: DOUBLE, student: 'INPUT n\nOUTPUT (n * 2)\n', inputs: [['4']] },
  { name: '!= vs <>', config: classroom, solution: 'INPUT n\nIF n != 0 THEN\n  OUTPUT n\nEND IF\n', student: 'INPUT n\nIF n <> 0 THEN\n  OUTPUT n\nEND IF\n', inputs: [['2']] },
  { name: 'two statements on a line with ;', config: classroom, solution: 'SET a TO 1\nSET b TO 2\nOUTPUT a + b\n', student: 'SET a TO 1; SET b TO 2\nOUTPUT a + b\n' },
  {
    name: 'function defined after use (hoisted)',
    config: classroom,
    solution: 'FUNCTION dbl(x)\n  RETURN x * 2\nEND FUNCTION\nOUTPUT dbl(4)\n',
    student: 'OUTPUT dbl(4)\nFUNCTION dbl(x)\n  RETURN x * 2\nEND FUNCTION\n',
  },
  { name: 'AP CSP: DISPLAY(x) vs DISPLAY (x), IF(...) vs IF (...)', config: apcsp, solution: 'x ← 5\nIF(x > 1)\n{\n  DISPLAY(x)\n}\n', student: 'x ← 5\nIF (x > 1) {\n    DISPLAY (x)\n}\n' },
  {
    name: 'Cambridge: THEN on its own line vs the same line',
    config: cambridge,
    solution: 'INPUT N\nIF N > 0\n  THEN\n    OUTPUT "pos"\nENDIF\n',
    student: 'INPUT N\nIF N > 0 THEN\nOUTPUT "pos"\nENDIF\n',
    inputs: [['3']],
  },
  { name: 'Cambridge: DECLARE x : INTEGER added', config: cambridge, solution: 'X ← 5\nOUTPUT X\n', student: 'DECLARE X : INTEGER\nX ← 5\nOUTPUT X\n' },
  { name: 'AQA: # comment', config: aqa, solution: 'x ← 5\nOUTPUT x\n', student: '# Write your program below\nx ← 5\nOUTPUT x\n' },
  {
    name: 'braces vs END IF (the language allows both)',
    config: bothBlocks,
    solution: SOL_IF,
    student: 'INPUT n\nIF n > 0 THEN {\n  OUTPUT "positive"\n} ELSE {\n  OUTPUT "not positive"\n}\n',
    inputs: [['3'], ['-1']],
  },
];

// Programs that look alike but aren't the same. `from` is the first compare mode in which they do count as the same
// (only the text inside quotes differs, and that mode ignores the difference); without it, never the same.
const DIFFERENT: Array<Pair & { from?: CompareMode }> = [
  { name: 'spaces inside text', config: classroom, solution: 'OUTPUT "a b"\n', student: 'OUTPUT "a  b"\n', from: 'ignore-whitespace' },
  { name: 'space left out inside text', config: classroom, solution: 'OUTPUT "Total: ", t\n', student: 'OUTPUT "Total:", t\n', from: 'ignore-whitespace' },
  { name: 'capitals inside text', config: classroom, solution: 'OUTPUT "Hello"\n', student: 'OUTPUT "hello"\n', from: 'ignore-case' },
  { name: 'variable name case (variables are case-sensitive)', config: classroom, solution: 'total ← 1\nOUTPUT total\n', student: 'Total ← 1\nOUTPUT Total\n' },
  { name: 'precedence (1 + 2) * 3 vs 1 + 2 * 3', config: classroom, solution: 'OUTPUT (1 + 2) * 3\n', student: 'OUTPUT 1 + 2 * 3\n' },
  { name: 'OUTPUT a, b vs OUTPUT a & b', config: classroom, solution: 'OUTPUT "a", "b"\n', student: 'OUTPUT "a" & "b"\n' },
  {
    name: 'statement moved out of the IF',
    config: classroom,
    solution: 'INPUT n\nIF n > 0 THEN\n  OUTPUT "a"\n  OUTPUT "b"\nEND IF\n',
    student: 'INPUT n\nIF n > 0 THEN\n  OUTPUT "a"\nEND IF\nOUTPUT "b"\n',
  },
  { name: 'code commented out', config: classroom, solution: 'OUTPUT 1\nOUTPUT 2\n', student: 'OUTPUT 1\n// OUTPUT 2\n' },
  { name: '+ vs & join', config: classroom, solution: 'OUTPUT "a" + "b"\n', student: 'OUTPUT "a" & "b"\n' },
  { name: '2 vs 2.5', config: classroom, solution: 'OUTPUT 2\n', student: 'OUTPUT 2.5\n' },
  { name: 'a space vs nothing as text (split/join separators)', config: classroom, solution: 'OUTPUT "a" & " " & "b"\n', student: 'OUTPUT "a" & "" & "b"\n' },
  { name: 'statements in another order', config: classroom, solution: 'OUTPUT 1\nOUTPUT 2\n', student: 'OUTPUT 2\nOUTPUT 1\n' },
  // Text that isn't printed as it is counts as typed in every mode: it changes what the program does.
  {
    name: 'spaces in text compared in an IF',
    config: classroom,
    solution: 'INPUT a\nIF a = "yes please" THEN\n  OUTPUT "ok"\nEND IF\n',
    student: 'INPUT a\nIF a = "yesplease" THEN\n  OUTPUT "ok"\nEND IF\n',
  },
  { name: 'capitals in text compared in an IF', config: classroom, solution: 'INPUT a\nIF a = "yes" THEN\n  OUTPUT "ok"\nEND IF\n', student: 'INPUT a\nIF a = "YES" THEN\n  OUTPUT "ok"\nEND IF\n' },
  { name: 'text compared inside OUTPUT', config: classroom, solution: 'INPUT a\nOUTPUT a = "a b"\n', student: 'INPUT a\nOUTPUT a = "a  b"\n' },
  { name: 'text stored before it is printed', config: classroom, solution: 'SET s TO "a b"\nOUTPUT s\n', student: 'SET s TO "a  b"\nOUTPUT s\n' },
  { name: 'the length of text', config: classroom, solution: 'OUTPUT LENGTH("a b")\n', student: 'OUTPUT LENGTH("ab")\n' },
  // Printed text: joined to other printed text, and input prompts.
  { name: 'printed text joined with &', config: classroom, solution: 'SET t TO 8\nOUTPUT "Total: " & t\n', student: 'SET t TO 8\nOUTPUT "Total:" & t\n', from: 'ignore-whitespace' },
  { name: 'an INPUT prompt', config: classroom, solution: 'INPUT "Name: ", n\n', student: 'INPUT "name:", n\n', from: 'ignore-case' },
];

const rank = (mode: CompareMode) => MODES.indexOf(mode);

describe('samePseudocodeProgram', () => {
  for (const p of SAME) {
    it(`same program: ${p.name}`, () => {
      for (const mode of MODES) expect(samePseudocodeProgram(p.student, p.solution, p.config, mode), mode).toBe(true);
      // Cross-check with the engine: the two really behave the same.
      for (const input of p.inputs ?? [[]]) expect(run(p.student, p.config, input)).toBe(run(p.solution, p.config, input));
    });
  }

  for (const p of DIFFERENT) {
    it(`not the same: ${p.name}`, () => {
      for (const mode of MODES) {
        const same = p.from !== undefined && rank(mode) >= rank(p.from);
        expect(samePseudocodeProgram(p.student, p.solution, p.config, mode), mode).toBe(same);
      }
    });
  }

  it('is null when either program does not parse', () => {
    expect(samePseudocodeProgram('OUTPUT "a', 'OUTPUT "a"\n', classroom, 'trim')).toBeNull();
    expect(samePseudocodeProgram('OUTPUT "a"\n', 'IF x THEN\n', classroom, 'trim')).toBeNull();
    // In a case-sensitive language a lowercase keyword is just another word.
    expect(samePseudocodeProgram('INPUT n\noutput n\n', 'INPUT n\nOUTPUT n\n', caseSensitive, 'ignore-case')).toBeNull();
  });

  it('matches nothing to a blank solution', () => {
    expect(samePseudocodeProgram('', '', classroom, 'trim')).toBe(false);
    expect(samePseudocodeProgram('OUTPUT 1\n', '  \n', classroom, 'trim')).toBe(false);
  });
});

describe('pseudocodeFingerprint', () => {
  it('parses every preset sample', () => {
    for (const preset of PSEUDOCODE_PRESETS) expect(pseudocodeFingerprint(preset.sample, preset.config, 'trim'), preset.id).not.toBeNull();
  });

  it('is null for a program that does not parse', () => {
    expect(pseudocodeFingerprint('OUTPUT (1 +\n', classroom, 'exact')).toBeNull();
  });
});

describe('normalizeLiteral', () => {
  it('keeps text exactly in the exact and trim modes', () => {
    expect(normalizeLiteral(' Total:  8 \n', 'exact')).toBe(' Total:  8 \n');
    expect(normalizeLiteral('Total:  8 ', 'trim')).toBe('Total:  8 ');
  });

  it('removes every kind of whitespace in the ignore modes, and capitals for ignore-case', () => {
    expect(normalizeLiteral('Total : \t8\n', 'ignore-whitespace')).toBe('Total:8');
    expect(normalizeLiteral('a b c​d　e', 'ignore-whitespace')).toBe('abcde');
    expect(normalizeLiteral('Hello  World', 'ignore-case')).toBe('helloworld');
  });

  it('keeps a literal that is only whitespace as typed', () => {
    expect(normalizeLiteral(' ', 'ignore-whitespace')).toBe(' ');
    expect(normalizeLiteral('', 'ignore-case')).toBe('');
  });

  it('keeps escapes as typed when asked to', () => {
    expect(normalizeLiteral('a\\ b c', 'ignore-whitespace', true)).toBe('a\\ bc');
    expect(normalizeLiteral('A\\N{BULLET} B', 'ignore-case', true)).toBe('a\\N{bullet}b');
    expect(normalizeLiteral('a\\ b', 'ignore-whitespace')).toBe('a\\b');
  });
});
