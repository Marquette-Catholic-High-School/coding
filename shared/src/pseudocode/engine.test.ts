import { describe, expect, it } from 'vitest';
import {
  checkPseudocode,
  createPseudocodeConfig,
  runPseudocode,
  type PseudoDiagnostic,
  type PseudoIO,
  type PseudoRunOptions,
  type PseudocodeConfig,
} from './index';
import { TextIndex } from './values';

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

function config(overrides: Partial<PseudocodeConfig> = {}, preset = 'classroom'): PseudocodeConfig {
  return { ...createPseudocodeConfig(preset), ...overrides };
}

function withKeywords(keywords: Partial<PseudocodeConfig['keywords']>, overrides: Partial<PseudocodeConfig> = {}): PseudocodeConfig {
  const base = config(overrides);
  return { ...base, keywords: { ...base.keywords, ...keywords } };
}

function withConstructs(constructs: Partial<PseudocodeConfig['constructs']>, preset = 'classroom'): PseudocodeConfig {
  const base = config({}, preset);
  return { ...base, constructs: { ...base.constructs, ...constructs } };
}

function withBuiltins(builtins: Partial<PseudocodeConfig['builtins']>, preset = 'classroom'): PseudocodeConfig {
  const base = config({}, preset);
  return { ...base, builtins: { ...base.builtins, ...builtins } };
}

const CLASSROOM = config();
const BRACES = config({ blockStyle: 'braces' });

function run(source: string, cfg: PseudocodeConfig = CLASSROOM, inputs: string[] = [], options?: PseudoRunOptions) {
  let out = '';
  const queue = [...inputs];
  const prompts: Array<string | null> = [];
  const io: PseudoIO = {
    write: (text) => {
      out += text;
    },
    readLine: (prompt) => {
      prompts.push(prompt);
      return queue.length > 0 ? queue.shift()! : null;
    },
  };
  const result = runPseudocode(source, cfg, io, options);
  return { out, result, error: result.error, prompts };
}

/** Runs and expects success with exactly this output. */
function output(source: string, cfg: PseudocodeConfig = CLASSROOM, inputs: string[] = []): string {
  const r = run(source, cfg, inputs);
  expect(r.error, r.error ? `${r.error.message} (${r.error.line}:${r.error.column})` : '').toBeNull();
  expect(r.result.ok).toBe(true);
  return r.out;
}

/** Runs and expects an error. */
function failure(source: string, cfg: PseudocodeConfig = CLASSROOM, inputs: string[] = [], options?: PseudoRunOptions): PseudoDiagnostic {
  const r = run(source, cfg, inputs, options);
  expect(r.result.ok).toBe(false);
  expect(r.error).not.toBeNull();
  return r.error!;
}

const lines = (...l: string[]) => l.join('\n');

// ---------------------------------------------------------------------------------------------------------------------
// Constructs in keyword and brace style
// ---------------------------------------------------------------------------------------------------------------------

interface ConstructCase {
  name: string;
  keywords: string;
  braces: string;
  expected: string;
}

const CONSTRUCT_CASES: ConstructCase[] = [
  {
    name: 'output and variables',
    keywords: lines('SET a TO 2', 'b ← a * 3', 'b <- b + 1', 'OUTPUT "a is", a, "and b is", b'),
    braces: lines('SET a TO 2', 'b ← a * 3', 'b <- b + 1', 'OUTPUT "a is", a, "and b is", b'),
    expected: 'a is 2 and b is 7\n',
  },
  {
    name: 'IF / ELSE IF / ELSE',
    keywords: lines(
      'FOR EACH x IN [5, -5, 0]',
      '  IF x > 0 THEN',
      '    OUTPUT "positive"',
      '  ELSE IF x < 0 THEN',
      '    OUTPUT "negative"',
      '  ELSE',
      '    OUTPUT "zero"',
      '  END IF',
      'END FOR',
    ),
    braces: lines(
      'FOR EACH x IN [5, -5, 0] {',
      '  IF (x > 0) {',
      '    OUTPUT "positive"',
      '  } ELSE IF (x < 0) {',
      '    OUTPUT "negative"',
      '  } ELSE {',
      '    OUTPUT "zero"',
      '  }',
      '}',
    ),
    expected: 'positive\nnegative\nzero\n',
  },
  {
    name: 'IF without THEN or ELSE',
    keywords: lines('x ← 3', 'IF x = 3', '  OUTPUT "three"', 'END IF', 'IF x = 4', '  OUTPUT "four"', 'END IF'),
    braces: lines('x ← 3', 'IF x = 3 {', '  OUTPUT "three"', '}', 'IF x = 4 {', '  OUTPUT "four"', '}'),
    expected: 'three\n',
  },
  {
    name: 'WHILE',
    keywords: lines('n ← 0', 'WHILE n < 3 DO', '  OUTPUT n', '  n ← n + 1', 'END WHILE', 'WHILE n < 5', '  n ← n + 1', 'END WHILE', 'OUTPUT n'),
    braces: lines('n ← 0', 'WHILE (n < 3) {', '  OUTPUT n', '  n ← n + 1', '}', 'WHILE n < 5 DO {', '  n ← n + 1', '}', 'OUTPUT n'),
    expected: '0\n1\n2\n5\n',
  },
  {
    name: 'REPEAT … UNTIL (runs at least once)',
    keywords: lines('n ← 0', 'REPEAT', '  n ← n + 1', 'UNTIL n = 3', 'OUTPUT n', 'REPEAT', '  n ← n + 10', 'UNTIL TRUE', 'OUTPUT n'),
    braces: lines('n ← 0', 'REPEAT {', '  n ← n + 1', '} UNTIL n = 3', 'OUTPUT n', 'REPEAT {', '  n ← n + 10', '}', 'UNTIL TRUE', 'OUTPUT n'),
    expected: '3\n13\n',
  },
  {
    name: 'REPEAT UNTIL … (checks first)',
    keywords: lines('n ← 0', 'REPEAT UNTIL n = 3', '  n ← n + 1', 'END REPEAT', 'OUTPUT n', 'REPEAT UNTIL TRUE', '  OUTPUT "never"', 'END REPEAT'),
    braces: lines('n ← 0', 'REPEAT UNTIL (n = 3) {', '  n ← n + 1', '}', 'OUTPUT n', 'REPEAT UNTIL (TRUE) {', '  OUTPUT "never"', '}'),
    expected: '3\n',
  },
  {
    name: 'REPEAT n TIMES',
    keywords: lines('REPEAT 3 TIMES', '  OUTPUT "hip"', 'END REPEAT', 'REPEAT 0 TIMES', '  OUTPUT "never"', 'END REPEAT', 'n ← 2', 'REPEAT n + 1 TIMES', '  OUTPUT "hooray"', 'END REPEAT'),
    braces: lines('REPEAT 3 TIMES {', '  OUTPUT "hip"', '}', 'REPEAT 0 TIMES {', '  OUTPUT "never"', '}', 'n ← 2', 'REPEAT n + 1 TIMES {', '  OUTPUT "hooray"', '}'),
    expected: 'hip\nhip\nhip\nhooray\nhooray\nhooray\n',
  },
  {
    name: 'FOR with STEP, counting down and END FOR name',
    keywords: lines(
      'FOR i FROM 1 TO 5 STEP 2',
      '  OUTPUT i',
      'END FOR',
      'FOR i ← 3 TO 1 STEP -1',
      '  OUTPUT i',
      'END FOR i',
      'FOR i = 1 TO 2',
      '  OUTPUT i * 10',
      'END FOR',
      'FOR i FROM 5 TO 1',
      '  OUTPUT "never"',
      'END FOR',
    ),
    braces: lines(
      'FOR i FROM 1 TO 5 STEP 2 {',
      '  OUTPUT i',
      '}',
      'FOR i ← 3 TO 1 STEP -1 {',
      '  OUTPUT i',
      '}',
      'FOR i = 1 TO 2 {',
      '  OUTPUT i * 10',
      '}',
      'FOR i FROM 5 TO 1 {',
      '  OUTPUT "never"',
      '}',
    ),
    expected: '1\n3\n5\n3\n2\n1\n10\n20\n',
  },
  {
    name: 'FOR EACH over a list and text',
    keywords: lines('FOR EACH pet IN ["cat", "dog"]', '  OUTPUT pet', 'END FOR', 'FOR EACH letter IN "hi"', '  OUTPUT letter', 'END FOR'),
    braces: lines('FOR EACH pet IN ["cat", "dog"] {', '  OUTPUT pet', '}', 'FOR EACH letter IN "hi" {', '  OUTPUT letter', '}'),
    expected: 'cat\ndog\nh\ni\n',
  },
  {
    name: 'FUNCTION with RETURN (hoisted)',
    keywords: lines('OUTPUT double(4)', 'FUNCTION double(n)', '  RETURN n * 2', 'END FUNCTION', 'OUTPUT double(double(1))'),
    braces: lines('OUTPUT double(4)', 'FUNCTION double(n) {', '  RETURN n * 2', '}', 'OUTPUT double(double(1))'),
    expected: '8\n4\n',
  },
  {
    name: 'PROCEDURE with and without CALL',
    keywords: lines('PROCEDURE greet(name)', '  OUTPUT "Hello", name', 'END PROCEDURE', 'CALL greet("Sam")', 'greet("Jo")', 'PROCEDURE line', '  OUTPUT "---"', 'END PROCEDURE', 'CALL line'),
    braces: lines('PROCEDURE greet(name) {', '  OUTPUT "Hello", name', '}', 'CALL greet("Sam")', 'greet("Jo")', 'PROCEDURE line {', '  OUTPUT "---"', '}', 'CALL line'),
    expected: 'Hello Sam\nHello Jo\n---\n',
  },
  {
    name: 'single-line blocks',
    keywords: lines('x ← 5', 'IF x > 1 THEN OUTPUT "big" ELSE OUTPUT "small" END IF', 'REPEAT 2 TIMES OUTPUT "!" END REPEAT'),
    braces: lines('x ← 5', 'IF (x > 1) { OUTPUT "big" } ELSE { OUTPUT "small" }', 'REPEAT 2 TIMES { OUTPUT "!" }'),
    expected: 'big\n!\n!\n',
  },
];

describe('constructs', () => {
  for (const c of CONSTRUCT_CASES) {
    it(`${c.name} (keywords)`, () => {
      expect(output(c.keywords, CLASSROOM)).toBe(c.expected);
    });
    it(`${c.name} (braces)`, () => {
      expect(output(c.braces, BRACES)).toBe(c.expected);
    });
    it(`${c.name} (both styles allowed)`, () => {
      const both = config({ blockStyle: 'both' });
      expect(output(c.keywords, both)).toBe(c.expected);
      expect(output(c.braces, both)).toBe(c.expected);
    });
  }

  it('accepts braces on the next line (AP CSP reference sheet layout)', () => {
    const src = lines('x ← 2', 'IF (x > 1)', '{', '  OUTPUT "yes"', '}', 'ELSE', '{', '  OUTPUT "no"', '}', 'PROCEDURE p()', '{', '  OUTPUT "p"', '}', 'p()');
    expect(output(src, BRACES)).toBe('yes\np\n');
  });

  it('accepts THEN and DO on the next line (Cambridge layout)', () => {
    const src = lines('x ← 2', 'IF x > 1', '  THEN', '    OUTPUT "yes"', '  ELSE', '    OUTPUT "no"', 'END IF', 'WHILE x > 0', 'DO', '  x ← x - 1', 'END WHILE');
    expect(output(src)).toBe('yes\n');
  });

  it('treats ELSE followed by IF on the same line as ELSE IF', () => {
    const cfg = withKeywords({ elseIf: ['ELSEIF'] });
    const src = lines('x ← 2', 'IF x = 1 THEN', '  OUTPUT "one"', 'ELSE IF x = 2 THEN', '  OUTPUT "two"', 'END IF');
    expect(output(src, cfg)).toBe('two\n');
  });

  it('nests blocks deeply', () => {
    const src = lines(
      'FOR i FROM 1 TO 3',
      '  FOR j FROM 1 TO 3',
      '    IF i = j THEN',
      '      WHILE FALSE',
      '      END WHILE',
      '      OUTPUT i * j',
      '    END IF',
      '  END FOR',
      'END FOR',
    );
    expect(output(src)).toBe('1\n4\n9\n');
  });

  it('supports FOR x IN list (AQA style) as FOR EACH', () => {
    expect(output(lines('FOR x IN [1, 2]', '  OUTPUT x', 'END FOR'))).toBe('1\n2\n');
  });

  it('allows ; to separate statements on one line', () => {
    expect(output('x ← 1; OUTPUT x; OUTPUT x + 1')).toBe('1\n2\n');
  });

  it('uses decimals in FOR loops without float noise', () => {
    expect(output(lines('FOR x FROM 0 TO 0.5 STEP 0.1', '  OUTPUT x', 'END FOR'))).toBe('0\n0.1\n0.2\n0.3\n0.4\n0.5\n');
  });

  it('does not let the loop body change how many times FOR runs', () => {
    expect(output(lines('FOR i FROM 1 TO 3', '  OUTPUT i', '  i ← 100', 'END FOR', 'OUTPUT i'))).toBe('1\n2\n3\n100\n');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Expressions and values
// ---------------------------------------------------------------------------------------------------------------------

describe('operators and values', () => {
  it('does arithmetic with the usual precedence', () => {
    expect(output('OUTPUT 1 + 2 * 3, (1 + 2) * 3, 10 / 4, 2 ^ 10, 7 - -2')).toBe('7 9 2.5 1024 9\n');
  });

  it('makes ^ right-associative and tighter than unary minus', () => {
    expect(output('OUTPUT 2 ^ 3 ^ 2, -2 ^ 2, 2 ^ -1')).toBe('512 -4 0.5\n');
  });

  it('uses floor-based DIV and MOD', () => {
    expect(output('OUTPUT 7 DIV 2, -7 DIV 2, 7 MOD 2, -7 MOD 2, 7 MOD -2, 7.5 MOD 2')).toBe('3 -4 1 1 -1 1.5\n');
  });

  it('removes float noise when printing and comparing', () => {
    expect(output('OUTPUT 0.1 + 0.2, 1 / 3, 0.1 + 0.2 = 0.3, 0.3 <= 0.1 + 0.2, 0.1 * 3 > 0.3')).toBe('0.3 0.333333333333333 TRUE TRUE FALSE\n');
  });

  it('prints whole numbers without .0 and never prints -0', () => {
    expect(output('OUTPUT 10 / 2, 2.50, 0 * -1, -0')).toBe('5 2.5 0 0\n');
  });

  it('compares with every comparison operator', () => {
    expect(output('OUTPUT 1 = 1, 1 == 1, 1 ≠ 2, 1 != 1, 1 <> 2, 1 < 2, 2 > 1, 2 <= 2, 3 >= 4, 1 ≤ 1, 1 ≥ 2')).toBe(
      'TRUE TRUE TRUE FALSE TRUE TRUE TRUE TRUE FALSE TRUE FALSE\n',
    );
  });

  it('compares text alphabetically and values of different types as unequal', () => {
    expect(output('OUTPUT "apple" < "banana", "b" >= "a", "a" = 1, [1, [2]] = [1, [2]], TRUE = TRUE, "TRUE" = TRUE')).toBe(
      'TRUE TRUE FALSE TRUE TRUE FALSE\n',
    );
  });

  it('treats a number and text that looks like that number as equal, but only for = and its opposites', () => {
    expect(output('OUTPUT "5" = 5, 5 = "5.0", 1 = " 1 ", 7 = "007", "1" = 2, 0 = "", 0 = "zero"')).toBe('TRUE TRUE TRUE TRUE FALSE FALSE FALSE\n');
    expect(output('OUTPUT 5 != "5", 5 <> "6", 5 ≠ "5", "1" = "01"')).toBe('FALSE TRUE FALSE FALSE\n');
    expect(output('OUTPUT [1] = ["1"], [1, 2] = [1, 2]')).toBe('FALSE TRUE\n');
    const e = failure('OUTPUT 5 < "6"');
    expect(e.message).toBe('You can\'t compare a number with text using "<".');
    expect(e.hint).toBe('"6" is text because of its quote marks — write 6 to compare numbers. (Typed input that looks like a number becomes a number.)');
  });

  it('short-circuits AND / OR and supports NOT', () => {
    expect(output(lines('x ← 0', 'OUTPUT x <> 0 AND 10 / x > 1', 'OUTPUT x = 0 OR 10 / x > 1', 'OUTPUT NOT (x = 0), NOT FALSE'))).toBe(
      'FALSE\nTRUE\nFALSE TRUE\n',
    );
  });

  it('joins text with + and & (numbers become text)', () => {
    expect(output(lines('n ← 5', 'OUTPUT "Score: " + n', 'OUTPUT "Total: " & n + 1', 'OUTPUT 1 & 2', 'OUTPUT "x" + TRUE'))).toBe(
      'Score: 5\nTotal: 6\n12\nxTRUE\n',
    );
  });

  it('only joins with the configured operators', () => {
    const ampOnly = config({ concatOperators: ['&'] });
    expect(output('OUTPUT "a" & "b"', ampOnly)).toBe('ab\n');
    const e = failure('OUTPUT "a" + "b"', ampOnly);
    expect(e.message).toBe("You can't add text.");
    expect(e.hint).toContain('&');
    const plusOnly = config({ concatOperators: ['+'] });
    const e2 = failure('OUTPUT "a" & "b"', plusOnly);
    expect(e2.phase).toBe('syntax');
    expect(e2.message).toBe('In this language, text is joined with + instead of &.');
  });

  it('prints lists with quoted text, nested lists and the teacher’s TRUE/FALSE words', () => {
    expect(output('OUTPUT [1, 2, "a"], [], [[1, 2], [3]], [TRUE, FALSE]')).toBe('[1, 2, "a"] [] [[1, 2], [3]] [TRUE, FALSE]\n');
    expect(output('DISPLAY(1 < 2)\nDISPLAY([1 > 2])', config({}, 'ap-csp'))).toBe('true [false] ');
    expect(output('OUTPUT 1 < 2', config({}, 'aqa'))).toBe('True\n');
  });

  it('prints a list that contains itself without hanging', () => {
    expect(output(lines('x ← [1]', 'APPEND(x, x)', 'OUTPUT x'))).toBe('[1, […]]\n');
  });

  it('joins OUTPUT values with outputSeparator and ends lines per outputNewline', () => {
    expect(output('OUTPUT "a", 1, "b"', config({ outputSeparator: '' }))).toBe('a1b\n');
    expect(output('OUTPUT "a", 1\nOUTPUT "b"', config({ outputSeparator: ', ' }))).toBe('a, 1\nb\n');
    expect(output('OUTPUT "a", 1\nOUTPUT "b"', config({ outputNewline: false }))).toBe('a 1 b ');
    expect(output('OUTPUT', CLASSROOM)).toBe('\n');
  });

  it('treats = as comparison inside expressions even when it assigns at the start of a line', () => {
    const eq = config({ assignOperators: ['='] });
    expect(output(lines('x = 5', 'IF x = 5 THEN', '  OUTPUT x == 5', 'END IF', 'FOR i = 1 TO 2', '  OUTPUT i', 'END FOR'), eq)).toBe('TRUE\n1\n2\n');
    const e = failure('x ← 5', eq);
    expect(e.message).toBe('This language doesn\'t use "←" to store values.');
    expect(e.hint).toBe('Write x = …');
  });

  it('supports := and SET-only assignment', () => {
    expect(output('x := 2\nOUTPUT x', config({ assignOperators: [':='] }))).toBe('2\n');
    const setOnly = config({ assignOperators: [] });
    expect(output('SET x TO 3\nOUTPUT x', setOnly)).toBe('3\n');
    expect(failure('x ← 3', setOnly).hint).toBe('Write SET x TO …');
  });

  it('reads "x<-1" in a condition as x < -1 when <- is not an assignment operator, and as < - otherwise', () => {
    expect(output('x ← -5\nOUTPUT x<-1', config({ assignOperators: ['←'] }))).toBe('TRUE\n');
    expect(output('x ← -5\nOUTPUT x<-1')).toBe('TRUE\n');
  });

  it('indexes strings (read-only) and lists, including nested writes', () => {
    expect(output(lines('s ← "abc"', 'OUTPUT s[1], s[3]', 'g ← [[1, 2], [3, 4]]', 'g[2][1] ← 9', 'OUTPUT g', 'OUTPUT LENGTH(g[1])'))).toBe(
      'a c\n[[1, 2], [9, 4]]\n2\n',
    );
  });

  it('copies lists on assignment but shares them with procedures', () => {
    const src = lines(
      'a ← [1]',
      'b ← a',
      'APPEND(b, 2)',
      'OUTPUT a, b',
      'PROCEDURE addNine(list)',
      '  APPEND(list, 9)',
      'END PROCEDURE',
      'addNine(a)',
      'OUTPUT a',
      'OUTPUT [1] + [2, 3]',
    );
    expect(output(src)).toBe('[1] [1, 2]\n[1, 9]\n[1, 2, 3]\n');
  });

  it('accepts single, double and curly quotes', () => {
    expect(output(`OUTPUT 'it', "is", “curly”, ‘too’`)).toBe('it is curly too\n');
  });

  it('does not treat a comment prefix inside text as a comment', () => {
    expect(output('OUTPUT "http://example.com" // a comment')).toBe('http://example.com\n');
  });

  it('uses the configured comment prefixes', () => {
    const cfg = config({ commentPrefixes: ['#', '%'] });
    expect(output(lines('# heading', 'OUTPUT 1 % trailing', 'OUTPUT 5 - 2'), cfg)).toBe('1\n3\n');
    expect(output(lines('; heading', 'OUTPUT 1 ; trailing', 'OUTPUT 2'), config({ commentPrefixes: [';'] }))).toBe('1\n2\n');
  });

  it('keeps -- comments working (subtracting a negative number then needs a space)', () => {
    const cfg = config({ commentPrefixes: ['#', '--'] });
    expect(output(lines('-- heading', 'OUTPUT 1 -- note', 'OUTPUT 5 - -3', 'OUTPUT 5--3', 'OUTPUT 2 # note'), cfg)).toBe('1\n8\n5\n2\n');
  });

  it('ignores stored comment symbols that are not allowed (! would swallow !=)', () => {
    expect(output(lines('OUTPUT 5 != 3', 'OUTPUT 5--3', '# note'), config({ commentPrefixes: ['!', '#'] }))).toBe('TRUE\n8\n');
    expect(output('OUTPUT 5 != 3 // note', config({ commentPrefixes: ['!'] }))).toBe('TRUE\n');
    expect(output('OUTPUT [[1, 2], [3]], ((1 + 2) * 3), 2*(1+2) // note', config({ commentPrefixes: ['[[', '((', '*('] }))).toBe('[[1, 2], [3]] 9 6\n');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Scope and functions
// ---------------------------------------------------------------------------------------------------------------------

describe('functions and scope', () => {
  it('recurses', () => {
    const src = lines('FUNCTION fact(n)', '  IF n <= 1 THEN', '    RETURN 1', '  END IF', '  RETURN n * fact(n - 1)', 'END FUNCTION', 'OUTPUT fact(10)');
    expect(output(src)).toBe('3628800\n');
  });

  it('updates existing globals, otherwise creates locals', () => {
    const src = lines(
      'count ← 0',
      'PROCEDURE bump()',
      '  count ← count + 1',
      '  temp ← 99',
      'END PROCEDURE',
      'bump()',
      'bump()',
      'OUTPUT count',
      'OUTPUT temp',
    );
    const r = run(src);
    expect(r.out).toBe('2\n');
    expect(r.error?.message).toBe('I don\'t know a variable called "temp".');
    expect(r.error?.phase).toBe('runtime');
    expect(r.error?.line).toBe(9);
  });

  it('keeps parameters local', () => {
    const src = lines('x ← 1', 'PROCEDURE show(x)', '  x ← x + 10', '  OUTPUT x', 'END PROCEDURE', 'show(5)', 'OUTPUT x');
    expect(output(src)).toBe('15\n1\n');
  });

  it('exits a procedure early with RETURN', () => {
    const src = lines('PROCEDURE check(n)', '  IF n < 0 THEN', '    RETURN', '  END IF', '  OUTPUT n', 'END PROCEDURE', 'check(-1)', 'check(2)');
    expect(output(src)).toBe('2\n');
  });

  it('lets AP CSP procedures return values', () => {
    const src = lines('PROCEDURE add(a, b)', '{', '  RETURN(a + b)', '}', 'DISPLAY(add(2, 3))');
    expect(output(src, config({}, 'ap-csp'))).toBe('5 ');
  });

  it('returns from inside loops', () => {
    const src = lines(
      'FUNCTION firstEven(list)',
      '  FOR EACH n IN list',
      '    IF n MOD 2 = 0 THEN',
      '      RETURN n',
      '    END IF',
      '  END FOR',
      '  RETURN -1',
      'END FUNCTION',
      'OUTPUT firstEven([1, 3, 4, 6]), firstEven([1])',
    );
    expect(output(src)).toBe('4 -1\n');
  });

  it('tolerates type annotations and RETURNS', () => {
    const src = lines(
      'FUNCTION Max(A : INTEGER, B : INTEGER) RETURNS INTEGER',
      '  IF A > B THEN',
      '    RETURN A',
      '  END IF',
      '  RETURN B',
      'END FUNCTION',
      'PROCEDURE Show(Values : ARRAY[1:3] OF INTEGER)',
      '  OUTPUT Values',
      'END PROCEDURE',
      'OUTPUT Max(3, 9)',
      'CALL Show([1, 2, 3])',
    );
    expect(output(src)).toBe('9\n[1, 2, 3]\n');
  });

  it('reports a function that finishes without returning a value it was asked for', () => {
    const src = lines('FUNCTION sign(x)', '  IF x > 0 THEN', '    RETURN 1', '  END IF', 'END FUNCTION', 'OUTPUT sign(5)', 'OUTPUT sign(-5)');
    const r = run(src);
    expect(r.out).toBe('1\n');
    expect(r.error).toMatchObject({ phase: 'runtime', line: 7, message: '"sign" finished without giving back a value.' });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Teacher-chosen words
// ---------------------------------------------------------------------------------------------------------------------

describe('keywords, aliases and case', () => {
  it('accepts every alias and matches keywords case-insensitively by default', () => {
    const cfg = withKeywords({ output: ['SAY', 'PRINT'], endIf: ['END IF', 'ENDIF'] });
    expect(output(lines('say "a"', 'Print "b"', 'IF TRUE THEN', '  SAY "c"', 'endif', 'if true then say "d" end if'), cfg)).toBe('a\nb\nc\nd\n');
  });

  it('matches multi-word keywords greedily over any run of spaces or tabs', () => {
    const cfg = withKeywords({ output: ['SHOW ME'], endWhile: ['STOP LOOPING'] });
    expect(output(lines('n ← 0', 'WHILE n < 2', '  SHOW   ME n', '  n ← n + 1', 'STOP\tLOOPING'), cfg)).toBe('0\n1\n');
  });

  it('reads a longer spelling that ends in IF / UNTIL like the two words (ELSE / ELSE IF, REPEAT / REPEAT UNTIL)', () => {
    const repeat = withKeywords({ repeat: ['REPEAT', 'REPEAT UNTIL'] });
    expect(output(lines('n ← 0', 'REPEAT UNTIL n = 3', '  n ← n + 1', 'END REPEAT', 'REPEAT', '  n ← n - 1', 'UNTIL n = 0', 'OUTPUT n'), repeat)).toBe('0\n');
    const otherwise = withKeywords({ else: ['OTHERWISE', 'OTHERWISE IF'], elseIf: ['ELSEIF'] });
    const src = lines('FOR EACH x IN [1, 2, 3]', '  IF x = 1 THEN', '    OUTPUT "one"', '  OTHERWISE IF x = 2 THEN', '    OUTPUT "two"', '  OTHERWISE', '    OUTPUT "many"', '  END IF', 'END FOR');
    expect(output(src, otherwise)).toBe('one\ntwo\nmany\n');
    expect(output(lines('IF FALSE THEN', '  OUTPUT 1', 'END', 'IF TRUE THEN', '  OUTPUT 2', 'END IF'), withKeywords({ endIf: ['END IF', 'END'] }))).toBe('2\n');
  });

  it('lets students use the first word of a multi-word keyword as a variable', () => {
    expect(output(lines('end ← 5', 'each ← 2', 'OUTPUT end + each'))).toBe('7\n');
  });

  it('keeps variable names case-sensitive', () => {
    const e = failure(lines('Score ← 1', 'OUTPUT score'));
    expect(e.message).toBe('I don\'t know a variable called "score".');
    expect(e.hint).toBe('Did you mean "Score"? Capital letters matter in variable names.');
    expect(output(lines('a ← 1', 'A ← 2', 'OUTPUT a, A'))).toBe('1 2\n');
  });

  it('matches keywords exactly when the language is case-sensitive', () => {
    const cfg = config({ caseSensitive: true });
    expect(output('OUTPUT 1', cfg)).toBe('1\n');
    const e = failure('output 1', cfg);
    expect(e.message).toBe('I don\'t know the word "output".');
    expect(e.hint).toBe('Did you mean "OUTPUT"? Capital letters matter in this language.');
    expect(output('output ← 3\nOUTPUT output', cfg)).toBe('3\n');
  });

  it('reserves every keyword spelling that starts a statement or a value, even of locked constructs', () => {
    const starter = config({}, 'starter');
    const e2 = failure('while ← 5', starter);
    expect(e2.message).toBe('"while" is a special word in this language, so it can\'t be used as a name.');
    expect(failure('if ← 1').message).toContain('"if" is a special word');
    expect(failure('INPUT output').message).toContain('"output" is a special word');
    expect(failure('FOR end if FROM 1 TO 2\nEND FOR').message).toContain('"end if" is a special word');
    expect(failure('mod ← 1').message).toContain('"mod" is a special word');
  });

  it('uses renamed built-ins and suggests the new name for the old one', () => {
    const cfg = withBuiltins({ length: { name: 'LEN', enabled: true } });
    expect(output('OUTPUT LEN("abc"), len([1, 2])', cfg)).toBe('3 2\n');
    const e = failure('OUTPUT LENGTH("abc")', cfg);
    expect(e.message).toBe('I don\'t know a function called "LENGTH".');
    expect(e.hint).toBe("In this language it's called LEN.");
  });

  it('lets a student function shadow a built-in (e.g. writing their own LENGTH)', () => {
    const cfg = withBuiltins({ length: { name: 'LENGTH', enabled: false } });
    const src = lines('FUNCTION LENGTH(list)', '  count ← 0', '  FOR EACH x IN list', '    count ← count + 1', '  END FOR', '  RETURN count', 'END FUNCTION', 'OUTPUT LENGTH([4, 5, 6])');
    expect(output(src, cfg)).toBe('3\n');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Locked constructs and built-ins
// ---------------------------------------------------------------------------------------------------------------------

describe('constructs the class has not learned yet', () => {
  const starter = config({}, 'starter');

  it.each([
    ['WHILE x < 3\nEND WHILE', 'WHILE'],
    ['IF x > 3 THEN\nEND IF', 'IF'],
    ['REPEAT\nUNTIL TRUE', 'REPEAT … UNTIL'],
    ['REPEAT UNTIL TRUE\nEND REPEAT', 'REPEAT UNTIL'],
    ['REPEAT 3 TIMES\nEND REPEAT', 'REPEAT … TIMES'],
    ['FOR i FROM 1 TO 2\nEND FOR', 'FOR'],
    ['FOR EACH i IN x\nEND FOR', 'FOR EACH'],
    ['FUNCTION f()\nEND FUNCTION', 'FUNCTION'],
    ['PROCEDURE p()\nEND PROCEDURE', 'PROCEDURE'],
    ['OUTPUT TRUE', 'TRUE'],
    ['OUTPUT 1 = 1 AND 2 = 2', 'AND'],
    ['OUTPUT NOT 1 = 2', 'NOT'],
    ['OUTPUT 7 MOD 2', 'MOD'],
    ['OUTPUT 7 DIV 2', 'DIV'],
    ['CALL p()', 'CALL'],
    ['RETURN 1', 'RETURN'],
  ])('rejects %j with "not learned" for %s', (src, word) => {
    const diags = checkPseudocode(src, starter);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toBe(`You haven't learned "${word}" yet.`);
    expect(diags[0]!.phase).toBe('syntax');
    expect(run(src, starter).error?.message).toBe(`You haven't learned "${word}" yet.`);
  });

  it('names lists and variables as topics', () => {
    expect(checkPseudocode('OUTPUT [1]', starter)[0]!.message).toBe("You haven't learned about lists yet.");
    expect(checkPseudocode('x ← [1]\nOUTPUT x[1]', withConstructs({ lists: false }))[0]!.message).toBe("You haven't learned about lists yet.");
    expect(checkPseudocode('x ← 1', withConstructs({ variables: false }))[0]!.message).toBe("You haven't learned about variables yet.");
    expect(checkPseudocode('SET x TO 1', withConstructs({ variables: false }))[0]!.message).toBe('You haven\'t learned "SET" yet.');
  });

  it('suggests a learned alternative', () => {
    const noWhile = withConstructs({ while: false });
    expect(checkPseudocode('WHILE TRUE\nEND WHILE', noWhile)[0]!.hint).toBe('Try REPEAT … UNTIL instead.');
    const onlyTimes = withConstructs({ while: false, repeatUntil: false });
    expect(checkPseudocode('WHILE TRUE\nEND WHILE', onlyTimes)[0]!.hint).toBe('Try REPEAT … TIMES instead.');
    const noFor = withConstructs({ for: false });
    expect(checkPseudocode('FOR i FROM 1 TO 3\nEND FOR', noFor)[0]!.hint).toBe('Try REPEAT … TIMES instead.');
    const noElse = withConstructs({ else: false });
    expect(checkPseudocode('IF TRUE THEN\nELSE\nEND IF', noElse)[0]).toMatchObject({ message: 'You haven\'t learned "ELSE" yet.', hint: 'Use another IF instead.' });
    expect(checkPseudocode('IF TRUE THEN\nELSE IF FALSE THEN\nEND IF', noElse)[0]!.message).toBe('You haven\'t learned "ELSE IF" yet.');
    const noLogic = withConstructs({ logic: false });
    expect(checkPseudocode('IF 1 = 1 AND 2 = 2 THEN\nEND IF', noLogic)[0]!.hint).toBe('Put one IF inside another instead.');
    const noProcedures = withConstructs({ procedures: false });
    expect(checkPseudocode('PROCEDURE p()\nEND PROCEDURE', noProcedures)[0]!.hint).toBe(
      "Use FUNCTION instead — it doesn't have to give back a value.",
    );
  });

  it('allows RETURN and CALL when only procedures are learned (AP CSP)', () => {
    const cfg = withConstructs({ functions: false });
    expect(output(lines('PROCEDURE p(x)', '  RETURN x * 2', 'END PROCEDURE', 'OUTPUT p(2)', 'CALL p(1)'), cfg)).toBe('4\n');
  });

  it('rejects switched-off built-ins and list built-ins when lists are off', () => {
    const cfg = withBuiltins({ sqrt: { name: 'SQRT', enabled: false } });
    expect(checkPseudocode('OUTPUT SQRT(4)', cfg)[0]!.message).toBe('You haven\'t learned "SQRT" yet.');
    const noLists = withConstructs({ lists: false });
    expect(checkPseudocode('APPEND(x, 1)', noLists)[0]!.message).toBe('You haven\'t learned "APPEND" yet.');
    expect(checkPseudocode('OUTPUT LENGTH("abc")', noLists)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Lists and built-ins
// ---------------------------------------------------------------------------------------------------------------------

describe('lists and list index base', () => {
  it('starts at 1 by default', () => {
    expect(output(lines('x ← ["a", "b", "c"]', 'OUTPUT x[1], x[3]', 'x[2] ← "B"', 'OUTPUT x'))).toBe('a c\n["a", "B", "c"]\n');
  });

  it('starts at 0 when configured', () => {
    const zero = config({ listIndexBase: 0 });
    expect(output(lines('x ← ["a", "b", "c"]', 'OUTPUT x[0], x[2]', 'x[1] ← "B"', 'OUTPUT x', 'OUTPUT "hey"[0]'), zero)).toBe('a c\n["a", "B", "c"]\nh\n');
    const e = failure(lines('x ← [1, 2, 3]', 'OUTPUT x[3]'), zero);
    expect(e.message).toBe("List position 3 doesn't exist — the list has 3 items (positions 0 to 2).");
    expect(e.hint).toBe('In this language the first position is 0, so the last one is 2.');
  });

  it('reports positions that do not exist', () => {
    const e = failure(lines('x ← [1, 2, 3]', 'OUTPUT x[5]'));
    expect(e).toMatchObject({
      phase: 'runtime',
      line: 2,
      column: 10,
      endColumn: 11,
      message: "List position 5 doesn't exist — the list has 3 items (positions 1 to 3).",
    });
    expect(failure('x ← [1]\nOUTPUT x[0]').hint).toBe('In this language the first position is 1, not 0.');
    expect(failure('x ← []\nOUTPUT x[1]').message).toBe("List position 1 doesn't exist — the list is empty.");
    expect(failure('x ← [7]\nx[2] ← 1').message).toBe("List position 2 doesn't exist — the list has 1 item (position 1).");
    expect(failure('OUTPUT "abc"[4]').message).toBe("Position 4 doesn't exist — the text has 3 characters (positions 1 to 3).");
    expect(failure('x ← [1]\nOUTPUT x[1.5]').message).toBe('List positions must be whole numbers, but this is 1.5.');
    expect(failure('x ← [1]\nOUTPUT x["a"]').message).toBe('List positions must be numbers, but this is the text "a".');
    expect(failure('x ← 5\nOUTPUT x[1]').message).toBe("You can only use [ ] on a list or text, but this is the number 5.");
  });

  it('does not allow changing text with [ ]', () => {
    expect(failure('s ← "abc"\ns[1] ← "z"').message).toBe("You can't change part of some text using [ ].");
  });

  it('APPEND, INSERT, REMOVE and LENGTH respect the index base', () => {
    const src = lines('x ← [1, 2]', 'APPEND(x, 3)', 'INSERT(x, 1, 0)', 'OUTPUT x', 'removed ← REMOVE(x, 2)', 'OUTPUT removed, x, LENGTH(x)');
    expect(output(src)).toBe('[0, 1, 2, 3]\n1 [0, 2, 3] 3\n');
    const zero = config({ listIndexBase: 0 });
    expect(output(src, zero)).toBe('[1, 0, 2, 3]\n2 [1, 0, 3] 3\n');
    expect(output('x ← [1]\nINSERT(x, 2, 9)\nOUTPUT x')).toBe('[1, 9]\n');
    expect(failure('x ← [1]\nINSERT(x, 5, 9)').message).toBe("You can't insert at position 5 — use a position from 1 to 2.");
    expect(failure('x ← [1]\nREMOVE(x, 2)').message).toBe("List position 2 doesn't exist — the list has 1 item (position 1).");
    expect(failure('APPEND("abc", 1)').message).toBe('APPEND needs a list first, but got the text "abc".');
  });
});

describe('built-in functions', () => {
  it('works out numbers', () => {
    expect(output('OUTPUT ROUND(2.5), ROUND(-2.5), ROUND(1.005, 2), ROUND(3.14159, 3), ROUND(1234, -2)')).toBe('3 -3 1.01 3.142 1200\n');
    expect(output('OUTPUT INT(3.9), INT(-3.9), INT("7"), ABS(-3), SQRT(16), SQRT(2) > 1.41')).toBe('3 -3 7 3 4 TRUE\n');
  });

  it('converts between text and numbers', () => {
    expect(output('OUTPUT STR(5) + "!", NUM("3.5") + 1, NUM(4), STR(TRUE), STR([1, "a"])')).toBe('5! 4.5 4 TRUE [1, "a"]\n');
    expect(failure('OUTPUT NUM("abc")').message).toBe('NUM can\'t turn "abc" into a number.');
  });

  it('works with text', () => {
    expect(output('OUTPUT UPPER("Hi"), LOWER("Hi"), SUBSTRING("Hello", 2, 3), SUBSTRING("Hi", 2, 10), LENGTH("Hello")')).toBe(
      'HI hi ell i 5\n',
    );
    expect(output('OUTPUT SUBSTRING("Hello", 1, 3)', config({ listIndexBase: 0 }))).toBe('ell\n');
    expect(failure('OUTPUT SUBSTRING("Hi", 4, 1)').message).toBe("SUBSTRING can't start at position 4 — the text has 2 characters (positions 1 to 2).");
    expect(failure('OUTPUT UPPER(5)').message).toBe('UPPER needs some text, but got the number 5.');
  });

  it('counts an emoji as one character in LENGTH, [ ], SUBSTRING and FOR EACH', () => {
    expect(output('OUTPUT LENGTH("😀"), LENGTH("hi😀"), "😀x"[1], "a😀b"[3], SUBSTRING("😀x", 1, 1), SUBSTRING("a😀😀b", 2, 2)')).toBe('1 3 😀 b 😀 😀😀\n');
    expect(output('FOR EACH c IN "hi😀"\n  OUTPUT c\nEND FOR')).toBe('h\ni\n😀\n');
    expect(failure('OUTPUT "😀"[2]').message).toBe("Position 2 doesn't exist — the text has 1 character (position 1).");
    expect(failure('OUTPUT SUBSTRING("😀", 3, 1)').message).toBe("SUBSTRING can't start at position 3 — the text has 1 character (positions 1 to 1).");
    const built = lines('s ← ""', 'FOR i FROM 1 TO 40', '  s ← s & "😀" & i', 'END FOR', 'OUTPUT LENGTH(s), s[3], s[4], s[LENGTH(s)], SUBSTRING(s, 2, 3)');
    expect(output(built)).toBe('111 😀 2 0 1😀2\n');
  });

  it('keeps the remembered characters of joined text right (shared lists, emoji split across a join)', () => {
    const index = new TextIndex();
    const check = (text: string) => {
      const expected = Array.from(text);
      const view = index.view(text);
      expect(view.length).toBe(expected.length);
      expect(index.length(text)).toBe(expected.length);
      expect(Array.from({ length: view.length }, (_, n) => view.chars[n])).toEqual(expected);
    };
    const base = '😀'.repeat(20);
    check(base);
    const one = index.join(base, 'a😀');
    const other = index.join(base, 'b'); // `base`'s list already grew for `one`, so this one gets its own
    check(one);
    check(other);
    check(base);
    const high = `${'x'.repeat(40)}\uD83D`;
    check(high);
    check(index.join(high, '\uDE00!')); // the two halves of 😀 meet in the middle: one character
    let built = '';
    for (let n = 0; n < 50; n++) {
      built = index.join(built, n % 3 === 0 ? '😀' : 'é');
      expect(index.length(built)).toBe(n + 1);
    }
    check(built);
  });

  it('indexes long text (also text with emoji) in time proportional to its length', () => {
    for (const first of ['a', '€', '中', '😀']) {
      const scan = lines(
        `s ← "${first}bcdefgh"`,
        'REPEAT 13 TIMES',
        '  s ← s & s',
        'END REPEAT',
        'count ← 0',
        'FOR i FROM 1 TO LENGTH(s)',
        '  IF s[i] = "b" THEN',
        '    count ← count + 1',
        '  END IF',
        'END FOR',
        'OUTPUT count, LENGTH(s)',
      );
      const build = lines('t ← ""', 'WHILE LENGTH(t) < 65536 DO', `  t ← t & "${first}"`, '  last ← t[LENGTH(t)]', 'END WHILE', 'OUTPUT LENGTH(t), last');
      const started = Date.now();
      expect(output(scan)).toBe('8192 65536\n');
      expect(output(build)).toBe(`65536 ${first}\n`);
      // Re-reading the text for every s[i] took 2 s (€) to 18 s (emoji) here; reading it once takes a few ms.
      // Generous bound: a quadratic implementation takes many seconds here, a linear one a few hundred ms.
      expect(Date.now() - started).toBeLessThan(5000);
    }
  });

  it('gives RANDOM inclusive whole numbers using options.random', () => {
    const lowest = run('OUTPUT RANDOM(1, 6)', CLASSROOM, [], { random: () => 0 });
    const highest = run('OUTPUT RANDOM(1, 6)', CLASSROOM, [], { random: () => 0.999999 });
    expect(lowest.out).toBe('1\n');
    expect(highest.out).toBe('6\n');
    const values = new Set<string>();
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 200; i++) values.add(run('OUTPUT RANDOM(1, 3)', CLASSROOM, [], { random }).out);
    expect([...values].sort()).toEqual(['1\n', '2\n', '3\n']);
    expect(run('OUTPUT RANDOM()', CLASSROOM, [], { random: () => 0.25 }).out).toBe('0.25\n');
    expect(failure('OUTPUT RANDOM(6, 1)').message).toBe('RANDOM needs the smaller number first, like RANDOM(1, 6).');
  });

  it('checks argument counts and values', () => {
    const e = checkPseudocode('OUTPUT LENGTH(1, 2)', CLASSROOM)[0]!;
    expect(e.message).toBe('LENGTH needs 1 value in its brackets, but you gave 2.');
    expect(e.hint).toBe('Use it like this: LENGTH(listOrText)');
    expect(checkPseudocode('x ← APPEND([1], 2)', CLASSROOM)[0]!.message).toBe("APPEND changes the list but doesn't give back a value.");
    expect(failure('OUTPUT SQRT(-1)').message).toBe("You can't find the square root of a negative number.");
    expect(failure('OUTPUT ROUND(2.5, 1.5)').message).toBe('The number of decimal places for ROUND must be a whole number, but it\'s 1.5.');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------------------------------

describe('input', () => {
  it('turns numeric-looking input into numbers and keeps other text', () => {
    expect(output(lines('INPUT a', 'INPUT b', 'INPUT c', 'INPUT d', 'OUTPUT a + 1, b + 1, c, d + 1'), CLASSROOM, ['41', ' 2.5 ', 'Sam', '007'])).toBe('42 3.5 Sam 8\n');
    expect(output('INPUT a\nOUTPUT a = ""', CLASSROOM, [''])).toBe('TRUE\n');
  });

  it('supports the statement form with a prompt and several variables', () => {
    const r = run(lines('INPUT "Name? ", name', 'INPUT a, b', 'OUTPUT name, a + b'), CLASSROOM, ['Ava', '1', '2']);
    expect(r.error).toBeNull();
    expect(r.out).toBe('Name? Ava 3\n');
    expect(r.prompts).toEqual(['Name? ', null, null]);
  });

  it('supports INPUT as an expression: bare, () and (prompt)', () => {
    const r = run(lines('a ← INPUT', 'b ← INPUT()', 'c ← INPUT("Age? ")', 'OUTPUT a + b + c'), CLASSROOM, ['1', '2', '3']);
    expect(r.out).toBe('Age? 6\n');
    expect(r.prompts).toEqual([null, null, 'Age? ']);
    expect(output('name ← USERINPUT\nOUTPUT "Hi " + name', config({}, 'aqa'), ['Jo'])).toBe('Hi Jo\n');
    expect(output('x ← INPUT()\nDISPLAY(x * 2)', config({}, 'ap-csp'), ['21'])).toBe('42 ');
  });

  it('reads into a variable with INPUT(name) and discards a line with INPUT()', () => {
    expect(output(lines('INPUT(x)', 'INPUT()', 'INPUT("Press enter")', 'OUTPUT x'), CLASSROOM, ['5', 'skip', ''])).toBe('Press enter5\n');
  });

  it('reports running out of input', () => {
    const r = run(lines('INPUT a', 'INPUT b'), CLASSROOM, ['1']);
    expect(r.error).toMatchObject({ phase: 'runtime', line: 2, column: 7, message: "Your program asked for input, but there wasn't any left." });
    expect(run('x ← INPUT()', CLASSROOM).error?.message).toBe("Your program asked for input, but there wasn't any left.");
  });

  it('needs a variable after the INPUT statement', () => {
    expect(checkPseudocode('INPUT', CLASSROOM)[0]!.message).toBe('INPUT needs a variable name after it.');
  });

  it('matches numeric input against quoted text with = (menus, PINs, quiz answers)', () => {
    const menu = lines('INPUT choice', 'IF choice = "1" THEN', '  OUTPUT "one"', 'ELSE IF choice = "2" THEN', '  OUTPUT "two"', 'ELSE', '  OUTPUT "Invalid choice"', 'END IF');
    expect(output(menu, CLASSROOM, ['1'])).toBe('one\n');
    expect(output(menu, CLASSROOM, ['2'])).toBe('two\n');
    expect(output(menu, CLASSROOM, ['x'])).toBe('Invalid choice\n');
    expect(output('INPUT c\nOUTPUT c = "1", c <> "1", c ≠ "2"', CLASSROOM, ['1'])).toBe('TRUE FALSE TRUE\n');
    expect(output('INPUT code\nOUTPUT code = "007"', CLASSROOM, ['007'])).toBe('TRUE\n');
    const aqa = config({}, 'aqa');
    expect(output(lines('p ← USERINPUT', 'IF p = \'1234\' THEN', "  OUTPUT 'ok'", 'ELSE', "  OUTPUT 'wrong'", 'ENDIF'), aqa, ['1234'])).toBe('ok\n');
    const apCsp = config({}, 'ap-csp');
    expect(output(lines('answer ← INPUT()', 'IF (answer = "42") {', '  DISPLAY("right")', '} ELSE {', '  DISPLAY("wrong")', '}'), apCsp, ['42'])).toBe('right ');
  });

  it('explains ordering comparisons between numeric input and quoted numbers', () => {
    const e = failure('INPUT age\nIF age >= "18" THEN\nEND IF', CLASSROOM, ['15']);
    expect(e).toMatchObject({ phase: 'runtime', line: 2, column: 8, message: 'You can\'t compare a number with text using ">=".' });
    expect(e.hint).toBe('"18" is text because of its quote marks — write 18 to compare numbers. (Typed input that looks like a number becomes a number.)');
    expect(failure('s ← "18"\nOUTPUT 5 < s').hint).toBe('"18" is text. Turn it into a number first with NUM("18").');
    expect(failure('OUTPUT 5 < "abc"').hint).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Exam-board declarations and parameters
// ---------------------------------------------------------------------------------------------------------------------

describe('declarations, constants and parameters', () => {
  const cambridge = config({}, 'cambridge');
  const aqa = config({}, 'aqa');

  it('accepts DECLARE for a plain variable as a statement that does nothing', () => {
    expect(output(lines('DECLARE Total : INTEGER', 'DECLARE A, B : STRING', 'DECLARE Flag', 'Total ← 5', 'OUTPUT Total'), cambridge)).toBe('5\n');
    expect(failure('DECLARE Total : INTEGER\nOUTPUT Total', cambridge).message).toBe('I don\'t know a variable called "Total".');
    expect(output('DECLARE x : INTEGER\nx ← 1\nOUTPUT x')).toBe('1\n');
  });

  it('makes a sized list from DECLARE … ARRAY[low:high] OF type', () => {
    const src = lines('DECLARE Marks : ARRAY[1:3] OF INTEGER', 'FOR Index ← 1 TO 3', '  INPUT Marks[Index]', 'NEXT Index', 'OUTPUT Marks[2], LENGTH(Marks)');
    expect(output(src, cambridge, ['5', '6', '7'])).toBe('63\n');
    expect(output(lines('DECLARE N : ARRAY[1:2] OF STRING', 'DECLARE F : ARRAY[1:2] OF BOOLEAN', 'DECLARE R : ARRAY[1:2] OF REAL', 'OUTPUT N, F, R'), cambridge)).toBe(
      '["", ""][FALSE, FALSE][0, 0]\n',
    );
    expect(output(lines('Size ← 4', 'DECLARE L : ARRAY[1:Size]', 'DECLARE E : ARRAY[1:0] OF INTEGER', 'OUTPUT LENGTH(L), LENGTH(E)'), cambridge)).toBe('40\n');
    expect(output(lines('DECLARE A, B : ARRAY[1:2] OF INTEGER', 'A[1] ← 9', 'OUTPUT A, B'), cambridge)).toBe('[9, 0][0, 0]\n');
  });

  it('makes 2-D lists and reads and writes them with [row, column]', () => {
    const src = lines('DECLARE Board : ARRAY[1:2, 1:3] OF CHAR', 'Board[2, 3] ← "X"', 'OUTPUT Board[2, 3], Board[2][3], LENGTH(Board), LENGTH(Board[1])', 'OUTPUT Board');
    expect(output(src, cambridge)).toBe('XX23\n[["", "", ""], ["", "", "X"]]\n');
    expect(output('g ← [[1, 2], [3, 4]]\ng[1, 2] ← 7\nOUTPUT g[1, 2], g')).toBe('7 [[1, 7], [3, 4]]\n');
  });

  it('explains mistakes in DECLARE', () => {
    expect(checkPseudocode('DECLARE : INTEGER', cambridge)[0]!.message).toBe('DECLARE needs a variable name next, for example: DECLARE total : INTEGER');
    expect(checkPseudocode('DECLARE x ← 5', cambridge)[0]!.message).toBe('DECLARE only names a variable — give it a value on its own line.');
    expect(checkPseudocode('DECLARE x : 5', cambridge)[0]!.message).toBe('Put a type after the colon, like INTEGER or STRING.');
    expect(checkPseudocode('DECLARE x : ARRAY OF INTEGER', cambridge)[0]!.message).toBe('ARRAY needs its first and last positions in [ ].');
    expect(checkPseudocode('DECLARE x : ARRAY[1 TO 3] OF INTEGER', cambridge)[0]!.message).toBe('Put a colon between the first and last positions, like ARRAY[1:5].');
    expect(checkPseudocode('DECLARE x : ARRAY[1:3] OF', cambridge)[0]!.message).toBe('Put the type of the items after OF.');
    expect(failure('DECLARE x : ARRAY[3:1] OF INTEGER', cambridge).message).toBe('The last position (1) must not be before the first position (3).');
    expect(failure('DECLARE x : ARRAY[1:2.5] OF INTEGER', cambridge).message).toBe('The last position of an ARRAY must be a whole number, but it\'s 2.5.');
    expect(checkPseudocode('DECLARE x : ARRAY[1:3] OF INTEGER', withConstructs({ lists: false }, 'cambridge'))[0]!.message).toBe("You haven't learned about lists yet.");
    expect(checkPseudocode('DECLARE x : INTEGER', withConstructs({ variables: false }))[0]!.message).toBe('You haven\'t learned "DECLARE" yet.');
  });

  it('treats CONSTANT (Cambridge) and constant (AQA) as an assignment with ← or =', () => {
    expect(output('CONSTANT Pi ← 3.14\nCONSTANT Name = "Ada"\nOUTPUT Pi, Name', cambridge)).toBe('3.14Ada\n');
    expect(output('constant PI ← 3.141\nOUTPUT PI * 2', aqa)).toBe('6.282\n');
    expect(output('CONSTANT MAX = 10\nOUTPUT MAX', config({ assignOperators: [] }))).toBe('10\n');
    expect(checkPseudocode('CONSTANT Pi 3.14', cambridge)[0]!.message).toBe('CONSTANT needs ← and a value after the name.');
    expect(checkPseudocode('CONSTANT Pi := 3.14', cambridge)[0]!.message).toBe('This language doesn\'t use ":=" to store values.');
  });

  it('lets teachers rename DECLARE and CONSTANT, and keeps older configs without them working', () => {
    const renamed = withKeywords({ declare: ['DIM'], constant: ['CONST'] });
    expect(output('DIM a : ARRAY[1:2] OF INTEGER\nCONST b = 2\nOUTPUT a, b', renamed)).toBe('[0, 0] 2\n');
    const { declare: _d, constant: _c, ...oldKeywords } = CLASSROOM.keywords;
    const old = { ...CLASSROOM, keywords: oldKeywords } as unknown as PseudocodeConfig;
    expect(output('DECLARE n : INTEGER\nCONSTANT k = 3\nOUTPUT k', old)).toBe('3\n');
  });

  it('keeps "declare" and "constant" free as names everywhere except at the start of a DECLARE / CONSTANT line', () => {
    // Programs saved before DECLARE and CONSTANT existed (every preset is case-insensitive).
    expect(output(lines('constant ← 9.81', 'Constant ← 2', 'declare ← 1', 'OUTPUT constant * Constant + declare'))).toBe('20.62\n');
    expect(output(lines('SET constant TO 3', 'FOR declare FROM 1 TO 2', '  OUTPUT declare * constant', 'END FOR declare'))).toBe('3\n6\n');
    expect(output(lines('PROCEDURE p(constant, declare)', '  OUTPUT constant + declare', 'END PROCEDURE', 'p(1, 2)', 'CALL p(3, 4)'))).toBe('3\n7\n');
    expect(output(lines('FUNCTION constant(x)', '  RETURN x * 2', 'END FUNCTION', 'OUTPUT constant(4)'))).toBe('8\n');
    expect(output(lines('declare ← [1, 2]', 'declare[1] ← 9', 'FOR EACH constant IN declare', '  OUTPUT constant', 'END FOR'))).toBe('9\n2\n');
    expect(output(lines('INPUT constant, declare', 'OUTPUT constant + declare'), CLASSROOM, ['5', '6'])).toBe('11\n');
    expect(output(lines('constant ← TRUE', 'IF constant THEN', '  OUTPUT "yes"', 'END IF'))).toBe('yes\n');
    expect(output('constant ← 3\nOUTPUT constant', aqa)).toBe('3\n');
    expect(output('constant = 3\nOUTPUT constant', config({ assignOperators: ['='] }))).toBe('3\n');
    expect(output(lines('PROCEDURE P(BYREF constant : INTEGER)', '  constant ← 5', 'ENDPROCEDURE', 'X ← 1', 'CALL P(X)', 'OUTPUT X'), cambridge)).toBe('5\n');
    expect(checkPseudocode('constant ← 1\nconstant', CLASSROOM)[0]!.message).toBe('This line uses "constant" but doesn\'t do anything with it.');
    // …while the keywords still work, also with names that are connector words or the other keyword.
    expect(output(lines('CONSTANT to ← 5', 'DECLARE from : INTEGER', 'DECLARE constant : STRING', 'CONSTANT declare = 2', 'OUTPUT to, declare'), cambridge)).toBe('52\n');
    expect(output('IF TRUE THEN CONSTANT X ← 1 END IF\nOUTPUT X')).toBe('1\n');
    expect(output('CONSTANT X ← 3\nconstant ← X\nOUTPUT constant', config({ caseSensitive: true }))).toBe('3\n');
    expect(checkPseudocode('x ← 1 CONSTANT y ← 2', cambridge)[0]).toMatchObject({ message: 'I wasn\'t expecting "CONSTANT" here.', hint: 'Start a new line for each instruction.' });
    expect(checkPseudocode('CONSTANT X ← 1', withConstructs({ variables: false }))[0]!.message).toBe('You haven\'t learned "CONSTANT" yet.');
  });

  it('copies BYREF parameters back to the caller (until BYVAL), and tolerates BYVAL', () => {
    const swap = lines(
      'PROCEDURE Swap(BYREF X : INTEGER, Y : INTEGER)',
      '  Temp ← X',
      '  X ← Y',
      '  Y ← Temp',
      'ENDPROCEDURE',
      'A ← 1',
      'B ← 2',
      'CALL Swap(A, B)',
      'OUTPUT A, " ", B',
      'L ← [10, 20]',
      'CALL Swap(L[1], L[2])',
      'OUTPUT L',
      'CALL Swap(3, 4)',
    );
    expect(output(swap, cambridge)).toBe('2 1\n[20, 10]\n');
    const mixed = lines(
      'PROCEDURE Change(BYREF A, BYVAL B, BYREF C)',
      '  A ← A + 1',
      '  B ← B + 1',
      '  C ← C + 1',
      'ENDPROCEDURE',
      'X ← 0',
      'Y ← 0',
      'Z ← 0',
      'Change(X, Y, Z)',
      'OUTPUT X, Y, Z',
    );
    expect(output(mixed, cambridge)).toBe('101\n');
    const fn = lines('FUNCTION Bump(BYREF N : INTEGER) RETURNS INTEGER', '  N ← N + 1', '  RETURN N * 10', 'ENDFUNCTION', 'C ← 1', 'OUTPUT Bump(C), C');
    expect(output(fn, cambridge)).toBe('202\n');
    expect(output('PROCEDURE P(BYVAL X : INTEGER)\n  X ← 5\nENDPROCEDURE\nX ← 1\nP(X)\nOUTPUT X', cambridge)).toBe('1\n');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Connector keywords used as names
// ---------------------------------------------------------------------------------------------------------------------

describe('connector words as names', () => {
  const apCsp = config({}, 'ap-csp');
  const cambridge = config({}, 'cambridge');
  const aqa = config({}, 'aqa');

  it('lets exam-board students use words their board never uses (set, call, step, from, to, times)', () => {
    expect(output('set ← [1, 2]\nAPPEND(set, 3)\nDISPLAY(set)', apCsp)).toBe('[1, 2, 3] ');
    expect(output('call ← 1\nstep ← call + 1\nDISPLAY(step)', apCsp)).toBe('2 ');
    expect(output('PROCEDURE move(from, to)\n{\n  DISPLAY(from + to)\n}\nmove(1, 2)', apCsp)).toBe('3 ');
    expect(output('times ← 3\nset ← [times]\nOUTPUT times, set', aqa)).toBe('3 [3]\n');
    expect(output('PROCEDURE Move(from, to)\n  OUTPUT from, to\nENDPROCEDURE\nCALL Move(1, 2)', cambridge)).toBe('12\n');
  });

  it('accepts them wherever a name is expected', () => {
    expect(output(lines('SET to TO 5', 'INPUT step', 'INPUT "Again? ", from', 'OUTPUT to, step, from'), CLASSROOM, ['6', '7'])).toBe('Again? 5 6 7\n');
    expect(output(lines('FOR to ← 1 TO 2', '  OUTPUT to', 'NEXT to'), cambridge)).toBe('1\n2\n');
    expect(output(lines('FOR step FROM 1 TO 2', '  OUTPUT step', 'END FOR step'))).toBe('1\n2\n');
    expect(output(lines('FOR EACH in IN [4, 5]', '  OUTPUT in', 'END FOR'))).toBe('4\n5\n');
    expect(output(lines('FUNCTION times(a, b)', '  RETURN a * b', 'END FUNCTION', 'OUTPUT times(2, 3)', 'then ← [1]', 'then[1] ← 9', 'OUTPUT then'))).toBe('6\n[9]\n');
    expect(output(lines('PROCEDURE do(BYREF to)', '  to ← to * 2', 'END PROCEDURE', 'x ← 4', 'CALL do(x)', 'OUTPUT x'))).toBe('8\n');
  });

  it('still reads them as keywords in FOR, REPEAT, SET, IF and WHILE lines', () => {
    const src = lines(
      'to ← 3',
      'step ← 2',
      'times ← 2',
      'then ← TRUE',
      'do ← 1',
      'FOR i FROM 1 TO to STEP step',
      '  OUTPUT i',
      'END FOR',
      'REPEAT times TIMES',
      '  OUTPUT "r"',
      'END REPEAT',
      'SET x TO to + step',
      'IF then THEN',
      '  OUTPUT x',
      'END IF',
      'WHILE do < 3 DO',
      '  do ← do + 1',
      'END WHILE',
      'OUTPUT do',
      'FOR EACH v IN [to, step] DO',
    );
    expect(output(src.split('\n').slice(0, -1).join('\n'))).toBe('1\n3\nr\nr\n5\n3\n');
    expect(output(lines('IF 1 = 1', '  THEN', '    then ← 2', '    OUTPUT then', 'ENDIF'), cambridge)).toBe('2\n');
  });

  it('keeps the old messages when the word is not used as a name', () => {
    const syntax = (src: string, cfg = CLASSROOM) => checkPseudocode(src, cfg)[0]!;
    expect(syntax('IF THEN\nEND IF').message).toBe('I expected a value after "IF", but found "THEN".');
    expect(syntax('FOR FROM 1 TO 3\nEND FOR').message).toBe('"FROM" is a special word in this language, so it can\'t be used as a name.');
    expect(syntax('SET TO 5').message).toBe('"TO" is a special word in this language, so it can\'t be used as a name.');
    expect(syntax('OUTPUT step')).toMatchObject({ message: 'I expected a value after "OUTPUT", but found "step".' });
    expect(syntax('REPEAT TIMES\nEND REPEAT').message).toBe('I expected a value after "REPEAT", but found "TIMES".');
    expect(syntax('to = 5').message).toBe('To store a value in a variable, write to ← …');
    // Variables are case-sensitive, so TO is still the keyword when only "to" is a variable.
    expect(syntax('to ← 1\nOUTPUT TO').message).toBe('I expected a value after "OUTPUT", but found "TO".');
  });

  it('accepts FOR EACH with a loop variable named after a connector word', () => {
    for (const name of ['from', 'to', 'step', 'set', 'call', 'times', 'do', 'then', 'in']) {
      expect(output(lines(`FOR EACH ${name} IN [1, 2]`, `  OUTPUT ${name}`, 'END FOR'))).toBe('1\n2\n');
      expect(output(lines(`FOR ${name} FROM 1 TO 2`, `  OUTPUT ${name}`, 'END FOR'))).toBe('1\n2\n');
    }
    expect(output(lines('FOR EACH from IN [1, 2]', '{', '  DISPLAY(from)', '}'), apCsp)).toBe('1 2 ');
  });

  it('starts the block with a connector-named variable when THEN / DO is left out', () => {
    expect(output(lines('then ← [0]', 'IF TRUE', '  then[1] ← 2', 'END IF', 'OUTPUT then'))).toBe('[2]\n');
    expect(output(lines('PROCEDURE do(x)', '  OUTPUT x', 'END PROCEDURE', 'i ← 0', 'WHILE i < 1', '  do(i)', '  i ← i + 1', 'END WHILE'))).toBe('0\n');
    expect(output(lines('then ← [0]', 'IF TRUE', '  THEN', '    then[1] ← 2', 'ENDIF', 'OUTPUT then'), cambridge)).toBe('[2]\n');
    expect(output(lines('IF TRUE', '  THEN', '    OUTPUT "a"', 'ENDIF'), cambridge)).toBe('a\n');
  });

  it('explains a counting loop whose variable is called "each"', () => {
    const e = checkPseudocode('FOR each FROM 1 TO 3\n  OUTPUT each\nEND FOR', CLASSROOM)[0]!;
    expect(e).toMatchObject({ line: 1, column: 1, endColumn: 9, message: '"FOR each" is read as FOR EACH, so "each" can\'t be the name of the loop variable.' });
    expect(e.hint).toBe('Choose a different name, for example: FOR i FROM 1 TO 10');
    expect(checkPseudocode('FOR each ← 1 TO 3\nNEXT each', cambridge)[0]!.message).toContain('"each" can\'t be the name of the loop variable');
    expect(output('FOR EACH each IN [1, 2]\n  OUTPUT each\nEND FOR')).toBe('1\n2\n');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------------------------------

describe('limits', () => {
  it('stops never-ending loops at the step limit (default 5,000,000)', () => {
    const r = run(lines('x ← 0', 'WHILE TRUE DO', '  x ← x + 1', 'END WHILE'));
    expect(r.error).toMatchObject({
      phase: 'runtime',
      line: 2,
      column: 1,
      message: 'Your program took too many steps (more than 5,000,000). Is there a loop that never ends?',
    });
    expect(r.result.steps).toBe(5_000_001);
  });

  it('honours a custom step limit and points at the innermost loop', () => {
    const src = lines('REPEAT 3 TIMES', '  REPEAT', '  UNTIL FALSE', 'END REPEAT');
    const e = failure(src, CLASSROOM, [], { maxSteps: 1000 });
    expect(e.message).toBe('Your program took too many steps (more than 1,000). Is there a loop that never ends?');
    expect(e.line).toBe(2);
  });

  it('counts steps', () => {
    expect(run('OUTPUT 1\nOUTPUT 2').result.steps).toBe(2);
  });

  it('allows recursion up to the call depth limit (default 500)', () => {
    const src = (n: number) => lines('FUNCTION down(n)', '  IF n = 0 THEN', '    RETURN 0', '  END IF', '  RETURN down(n - 1)', 'END FUNCTION', `OUTPUT down(${n})`);
    expect(output(src(499))).toBe('0\n');
    const e = failure(src(500));
    expect(e.message).toBe('Your program called functions inside each other too many times (more than 500 deep).');
    expect(e.line).toBe(5);
    expect(failure(src(20), CLASSROOM, [], { maxCallDepth: 10 }).message).toContain('more than 10 deep');
  });

  it('turns a JavaScript stack overflow into the same friendly error', () => {
    const src = lines('FUNCTION f(n)', '  RETURN f(n + 1)', 'END FUNCTION', 'OUTPUT f(1)');
    const e = failure(src, CLASSROOM, [], { maxCallDepth: 10_000_000 });
    expect(e.message).toContain('called functions inside each other too many times');
    expect(e.phase).toBe('runtime');
  });

  it('stops a list growing past 10,000,000 items before it uses up the memory', () => {
    const doubling = failure(lines('l ← [1]', 'REPEAT 100 TIMES', '  l ← l + l', 'END REPEAT'));
    expect(doubling).toMatchObject({ phase: 'runtime', line: 3, message: 'That list would have more than 10,000,000 items — too many for the computer to handle.' });
    expect(doubling.hint).toBe('Check for a loop that keeps making a list bigger, like list ← list + list');
    expect(failure('DECLARE big : ARRAY[1:20000000] OF INTEGER').line).toBe(1);
    expect(failure('DECLARE big : ARRAY[1:5000, 1:5000] OF INTEGER').message).toContain('more than 10,000,000 items');
    expect(failure('DECLARE big : ARRAY[1:20000000, 1:0] OF INTEGER').message).toContain('more than 10,000,000 items');
  });

  it('reports lists nested too deeply to show at the line that shows them, not as recursion', () => {
    const deep = lines('l ← []', 'REPEAT 100000 TIMES', '  l ← [l]', 'END REPEAT', 'OUTPUT LENGTH(l)', 'OUTPUT l');
    const r = run(deep);
    expect(r.out).toBe('1\n');
    expect(r.error).toMatchObject({ phase: 'runtime', line: 6, message: 'A list in your program has lists inside lists too many levels deep for the computer to handle.' });
    const inProcedure = lines('PROCEDURE show(x)', '  OUTPUT x', 'END PROCEDURE', ...deep.split('\n').slice(0, 4), 'show(l)');
    expect(failure(inProcedure)).toMatchObject({ line: 2, message: 'A list in your program has lists inside lists too many levels deep for the computer to handle.' });
  });

  it('reports text that grows too long at the line that grows it', () => {
    expect(failure(lines('s ← "ab"', 'REPEAT 100 TIMES', '  s ← s + s', 'END REPEAT', 'OUTPUT LENGTH(s)'))).toMatchObject({
      phase: 'runtime',
      message: 'Some text in your program got too long for the computer to handle.',
    });
  });

  it('runs a 1,000,000-iteration loop in under 2 seconds', () => {
    const started = Date.now();
    const out = output(lines('SET total TO 0', 'FOR i FROM 1 TO 1000000', '  total ← total + i', 'END FOR', 'OUTPUT total'));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out).toBe('500000500000\n');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------------------------------------------------

describe('error messages', () => {
  const syntax = (src: string, cfg: PseudocodeConfig = CLASSROOM) => {
    const diags = checkPseudocode(src, cfg);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.phase).toBe('syntax');
    expect(diags[0]!.severity).toBe('error');
    // The runner reports the same problem without running anything.
    const r = run(src, cfg);
    expect(r.error).toEqual(diags[0]);
    expect(r.out).toBe('');
    return diags[0]!;
  };

  it('suggests keywords for unknown words', () => {
    expect(syntax('OUTPT "hi"')).toEqual({
      severity: 'error',
      phase: 'syntax',
      message: 'I don\'t know the word "OUTPT".',
      hint: 'Did you mean "OUTPUT"?',
      line: 1,
      column: 1,
      endColumn: 6,
    });
    expect(syntax('x ← 1\nIF x > 0 THEN\n  OUTPUT x\nENDIF').hint).toBe('Did you mean "END IF"?');
    expect(syntax('WHIEL x < 3\nEND WHILE').hint).toBe('Did you mean "WHILE"?');
    expect(syntax('PRINT "hi"').hint).toBe('To show something on the screen, use OUTPUT.');
    expect(syntax('VAR x : INTEGER').hint).toBe("You don't need to declare variables here — just give them a value, like total ← 0");
    expect(syntax('DIM marks : ARRAY[1:3] OF INTEGER').hint).toBe('To make a list, give it its starting items, like marks ← [0, 0, 0]');
    expect(syntax('INPUT x', config({}, 'aqa')).hint).toBe('To ask the user to type something, use USERINPUT.');
  });

  it('suggests variables, functions and built-ins too', () => {
    expect(syntax('score ← 1\nscroe').hint).toBe('Did you mean "score"?');
    expect(syntax('PROCEDURE greet()\nEND PROCEDURE\ngreeet()').hint).toBe('Did you mean "greet"?');
    expect(syntax('x ← LENGHT("a")').hint).toBe('Did you mean "LENGTH"?');
    expect(syntax('PROCEDURE greet()\nEND PROCEDURE\ngreet').message).toBe('To use "greet", put brackets after its name: greet(…)');
  });

  it('explains a half-typed multi-word keyword', () => {
    expect(syntax('WHILE TRUE\n  END')).toMatchObject({ message: '"END" needs another word after it.', hint: 'Did you mean "END WHILE"?' });
  });

  it('says that capital letters matter for multi-word keywords in a case-sensitive language', () => {
    const cs = config({ caseSensitive: true });
    const capitals = (s: string) => `Did you mean "${s}"? Capital letters matter in this language.`;
    expect(syntax('IF 1 = 1 THEN\n  OUTPUT 1\nEnd IF', cs)).toMatchObject({ message: 'I don\'t know the word "End".', hint: capitals('END IF'), line: 3 });
    expect(syntax('IF 1 = 1 THEN\n  OUTPUT 1\nend if', cs).hint).toBe(capitals('END IF'));
    expect(syntax('WHILE TRUE\n  OUTPUT 1\nend', cs).hint).toBe(capitals('END WHILE'));
    expect(syntax('IF TRUE THEN\n  WHILE TRUE\n  END WHILE\nEnd while', cs).hint).toBe(capitals('END WHILE'));
    expect(syntax('IF TRUE THEN\n  OUTPUT 1\nElse IF FALSE THEN\nEND IF', cs).hint).toBe(capitals('ELSE IF'));
    expect(syntax('IF TRUE THEN\n  OUTPUT 1\nEND If', cs)).toMatchObject({ message: 'I don\'t know the words "END If".', hint: capitals('END IF'), column: 1, endColumn: 7 });
    expect(syntax('IF TRUE THEN\n  OUTPUT 1\nElse\nEND IF', cs).hint).toBe(capitals('ELSE'));
  });

  it('says "here" for a connector in the middle of a line, with a hint for the block it is in', () => {
    expect(syntax('FOR i FROM 1 TO 3 DO\n  OUTPUT i\nEND FOR')).toMatchObject({
      message: 'I wasn\'t expecting "DO" here.',
      hint: "FOR lines don't use DO — remove it.",
      column: 19,
    });
    expect(syntax('IF x > 1 DO\nEND IF').hint).toBe('Use THEN after an IF condition instead.');
    expect(syntax('WHILE x > 1 THEN\nEND WHILE').hint).toBe('Use DO after a WHILE condition instead.');
    expect(syntax('x ← 1\nIF x > 1 THEN THEN\nEND IF')).toMatchObject({ message: 'I wasn\'t expecting "THEN" here.', hint: 'THEN goes at the end of an IF line, after the condition.' });
    expect(syntax('DO')).toMatchObject({ message: 'I wasn\'t expecting "DO" at the start of a line.', hint: 'DO goes at the end of a WHILE line.' });
  });

  it('reports unclosed blocks at the opening line', () => {
    expect(syntax(lines('x ← 1', '', 'IF x > 0 THEN', '  OUTPUT x'))).toMatchObject({
      message: 'This IF on line 3 needs an END IF.',
      line: 3,
      column: 1,
      endColumn: 3,
    });
    expect(syntax('REPEAT\n  OUTPUT 1').message).toBe('This REPEAT on line 1 needs an UNTIL.');
    expect(syntax('FOR EACH x IN y\nOUTPUT x').message).toBe('This FOR EACH on line 1 needs an END FOR.');
    expect(syntax('IF (x > 1) {\n  OUTPUT x', BRACES).message).toBe('This IF on line 1 needs a closing }.');
    expect(syntax('FUNCTION f()\n  RETURN 1', config({}, 'cambridge')).message).toBe('This FUNCTION on line 1 needs an ENDFUNCTION.');
  });

  it('reports mismatched closers', () => {
    expect(syntax(lines('WHILE TRUE', '  IF TRUE THEN', '  END WHILE'))).toMatchObject({
      message: 'The IF on line 2 needs an END IF before this END WHILE.',
      line: 3,
      column: 3,
    });
    expect(syntax(lines('IF TRUE THEN', 'END WHILE'))).toMatchObject({ message: "This END WHILE doesn't match the IF on line 1.", hint: 'Did you mean END IF?' });
    expect(syntax('END IF').message).toBe("This END IF doesn't have an IF to close.");
    expect(syntax('ELSE').message).toBe("This ELSE isn't part of an IF.");
    expect(syntax('UNTIL x = 1').message).toBe("This UNTIL doesn't have a REPEAT to go with it.");
    expect(syntax(lines('IF TRUE THEN', 'ELSE', 'ELSE', 'END IF')).message).toBe("ELSE can't come after ELSE — ELSE must be the last part of an IF.");
    expect(syntax(lines('FOR i FROM 1 TO 2', 'END FOR j')).message).toBe('This END FOR names "j", but the loop variable is "i".');
  });

  it('reports braces in a keyword language and keywords in a brace language', () => {
    expect(syntax('IF TRUE THEN {\n}')).toMatchObject({ message: 'This language ends blocks with END IF, not { }.', line: 1, column: 14 });
    expect(syntax('}').message).toBe("This language doesn't use { } — blocks end with words like END IF.");
    expect(syntax('IF (TRUE)\n  OUTPUT 1\nEND IF', BRACES)).toMatchObject({
      message: 'Put { after this IF line to start its block.',
      hint: 'In this language blocks look like this: IF (x > 1) { … }',
    });
    expect(syntax('END IF', BRACES).message).toBe("This language uses { } for blocks, so it doesn't need END IF.");
    expect(syntax('}', BRACES).message).toBe("This } doesn't close anything.");
    expect(syntax('IF (TRUE) {\n} ELSE\n  OUTPUT 1', BRACES).message).toBe('Put { after ELSE to start its block.');
  });

  it('reports unterminated text, bad numbers and unknown symbols', () => {
    expect(syntax('OUTPUT "hello\nOUTPUT 2')).toMatchObject({ message: 'This text is missing its closing quote mark (").', line: 1, column: 8, endColumn: 14 });
    expect(syntax('x ← 2x').message).toBe('"2x" isn\'t a number or a name — names can\'t start with a digit.');
    expect(syntax('OUTPUT 7 % 2').hint).toBe('For the remainder after dividing, use MOD — for example 7 MOD 2.');
    expect(syntax('IF a && b THEN\nEND IF').hint).toBe('Use AND instead.');
    expect(syntax('OUTPUT @').message).toBe('I don\'t recognise the symbol "@".');
  });

  it('reports the first problem in source order', () => {
    expect(syntax('OUTPT 1\nOUTPUT "oops').line).toBe(1);
    expect(syntax('OUTPUT nope(1)\nOUTPUT "oops').line).toBe(2);
  });

  it('reports missing words in headers', () => {
    expect(syntax('FOR i FROM 1 10\nEND FOR')).toMatchObject({ message: 'FOR needs TO before the end value.', hint: 'For example: FOR i FROM 1 TO 10' });
    expect(syntax('FOR i 1 TO 10\nEND FOR').message).toBe('FOR needs FROM after the variable name.');
    expect(syntax('SET x 5').message).toBe('SET needs TO after the variable name.');
    expect(syntax('REPEAT 3\nEND REPEAT').message).toBe('REPEAT needs TIMES after the number.');
    expect(syntax('FOR EACH x [1]\nEND FOR').message).toBe('FOR EACH needs IN after the variable name.');
    expect(syntax('x ←')).toMatchObject({ message: 'I expected a value after "←".', column: 4 });
    expect(syntax('IF THEN\nEND IF').message).toBe('I expected a value after "IF", but found "THEN".');
    expect(syntax('OUTPUT (1 + 2').message).toBe('This ( needs a closing ).');
    expect(syntax('OUTPUT max(1, 2\nOUTPUT 3').message).toBe('This ( needs a closing ).');
    expect(syntax('x ← [1, 2').message).toBe('This [ needs a closing ].');
  });

  it('reports calls to unknown functions, wrong argument counts and missing return values', () => {
    expect(syntax('OUTPUT foo(1)')).toMatchObject({ message: 'I don\'t know a function called "foo".', line: 1, column: 8, endColumn: 14 });
    expect(syntax(lines('FUNCTION f(a)', '  RETURN a', 'END FUNCTION', 'OUTPUT f(1, 2)'))).toMatchObject({
      message: '"f" needs 1 value in its brackets, but you gave 2.',
      hint: 'It was made on line 1 as f(a).',
      line: 4,
    });
    expect(syntax(lines('PROCEDURE p()', 'END PROCEDURE', 'p(1)')).message).toBe('"p" doesn\'t take any values in its brackets, but you gave 1.');
    expect(syntax(lines('PROCEDURE p()', '  OUTPUT 1', 'END PROCEDURE', 'x ← p()'))).toMatchObject({
      message: '"p" is a PROCEDURE, so it doesn\'t give back a value to use here.',
      hint: 'If you need a value, make it a FUNCTION that uses RETURN.',
    });
    expect(syntax(lines('FUNCTION f()', '  OUTPUT 1', 'END FUNCTION', 'OUTPUT f()')).message).toBe(
      '"f" never uses RETURN to give back a value, so there\'s nothing to use here.',
    );
    expect(syntax('x ← 1\nOUTPUT x(2)').message).toBe('"x" is a variable, not a function.');
  });

  it('reports misplaced definitions and RETURN', () => {
    expect(syntax(lines('IF TRUE THEN', '  FUNCTION f()', '  END FUNCTION', 'END IF'))).toMatchObject({
      message: "You can't make a FUNCTION inside another block.",
      hint: 'Move it outside the IF that starts on line 1.',
    });
    expect(syntax('RETURN 5').message).toBe('RETURN can only be used inside a FUNCTION or PROCEDURE.');
    expect(syntax(lines('FUNCTION f()', 'END FUNCTION', 'FUNCTION f()', 'END FUNCTION')).message).toBe('There\'s already a FUNCTION called "f" (on line 1).');
    expect(syntax('FUNCTION f(a, a)\nEND FUNCTION').message).toBe('"a" is used twice in the brackets.');
  });

  it('reports assignments written with = and lines that do nothing', () => {
    expect(syntax('x = 5')).toMatchObject({ message: 'To store a value in a variable, write x ← …', column: 3 });
    expect(syntax('"hello"')).toMatchObject({ message: 'This line has a value but no instruction.', hint: 'Did you mean OUTPUT "hello"?' });
    expect(syntax('x ← 5\nx')).toMatchObject({ message: 'This line uses "x" but doesn\'t do anything with it.' });
    expect(syntax('OUTPUT "a" "b"').hint).toBe('To show more than one thing, put commas between them.');
    expect(syntax('OUTPUT 1 OUTPUT 2').hint).toBe('Start a new line for each instruction.');
    expect(syntax('OUTPUT 1 < 2 < 3').message).toBe("You can't check two comparisons in a row like this.");
    expect(syntax('x ← 1\nIF x = 1 OR 2 THEN\nEND IF')).toMatchObject({
      message: 'OR needs TRUE or FALSE on each side, but the right side is the number 2.',
      hint: 'Write each comparison in full, like x = 1 OR x = 2.',
    });
  });

  it('reports type errors while running', () => {
    expect(failure('OUTPUT "a" - 1')).toMatchObject({ phase: 'runtime', message: "You can't subtract text.", column: 12 });
    expect(failure('OUTPUT 2 * "3"')).toMatchObject({ message: "You can't multiply text.", hint: '"3" is text. Turn it into a number first with NUM("3").' });
    const times = failure('OUTPUT [1] * 2');
    expect(times.message).toBe("You can't multiply lists.");
    expect(times.hint).toBeUndefined();
    expect(failure('OUTPUT [1] + 2')).toMatchObject({ message: "You can't add lists.", hint: 'To add an item to a list, use APPEND(list, item).' });
    expect(failure('OUTPUT TRUE + 1').message).toBe("You can't add TRUE/FALSE values.");
    expect(failure('OUTPUT -"a"').message).toBe("You can't make text negative.");
    expect(failure('OUTPUT "a" < 1').message).toBe('You can\'t compare text with a number using "<".');
    expect(failure('OUTPUT 5 / 0').message).toBe("You can't divide by zero.");
    expect(failure('OUTPUT 5 DIV 0').message).toBe("You can't divide by zero.");
    expect(failure('OUTPUT 5 MOD 0').message).toBe("You can't divide by zero.");
    expect(failure('OUTPUT 10 ^ 400').message).toBe('That number is too big for the computer to work with.');
    expect(failure('IF 5 THEN\nEND IF').message).toBe("The IF condition must be TRUE or FALSE, but here it's the number 5.");
    expect(failure('x ← 3\nOUTPUT x > 1 AND x').message).toBe('AND needs TRUE or FALSE on each side, but the right side is the number 3.');
    expect(failure('REPEAT 2.5 TIMES\nEND REPEAT').message).toBe('REPEAT needs a whole number of times, but got 2.5.');
    expect(failure('FOR i FROM 1 TO "x"\nEND FOR').message).toBe('FOR needs numbers, but the end value is the text "x".');
    expect(failure('FOR i FROM 1 TO 2 STEP 0\nEND FOR')).toMatchObject({ message: "STEP can't be 0 — the loop would never finish.", column: 24 });
    expect(failure('FOR EACH x IN 5\nEND FOR').message).toBe('FOR EACH needs a list (or some text) to go through, but got the number 5.');
  });

  it('reports unknown variables with suggestions', () => {
    expect(failure('score ← 1\nOUTPUT scroe')).toMatchObject({
      message: 'I don\'t know a variable called "scroe".',
      hint: 'Did you mean "score"?',
      line: 2,
      column: 8,
      endColumn: 13,
    });
    expect(failure('OUTPUT total').hint).toBe('Give it a value before this line runs, for example: total ← 0');
  });

  it('uses the teacher’s words in messages', () => {
    const cfg = withKeywords({ if: ['WHEN'], endIf: ['DONE'], while: ['LOOP WHILE'] });
    expect(checkPseudocode('WHEN TRUE\n  OUTPUT 1', cfg)[0]!.message).toBe('This WHEN on line 1 needs a DONE.');
    const locked = { ...cfg, constructs: { ...cfg.constructs, while: false } };
    expect(checkPseudocode('LOOP WHILE TRUE\nEND WHILE', locked)[0]!.message).toBe('You haven\'t learned "LOOP WHILE" yet.');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------------------------------------------------

describe('robustness', () => {
  it('checkPseudocode only parses: runtime problems are not reported', () => {
    expect(checkPseudocode('OUTPUT 1\nINPUT x\nOUTPUT undefinedVariable / 0', CLASSROOM)).toEqual([]);
  });

  it('never throws, whatever it is given', () => {
    const io: PseudoIO = { write: () => {}, readLine: () => null };
    const garbage = [null, undefined, 42, 'x', [], { keywords: 5 }] as unknown as PseudocodeConfig[];
    for (const cfg of garbage) {
      expect(() => checkPseudocode('OUTPUT 1', cfg)).not.toThrow();
      expect(runPseudocode('OUTPUT 1', cfg, io).ok).toBe(true);
    }
    expect(() => checkPseudocode(undefined as unknown as string, CLASSROOM)).not.toThrow();
    expect(runPseudocode(null as unknown as string, CLASSROOM, io).ok).toBe(true);
    const deep = `OUTPUT ${'('.repeat(50_000)}1${')'.repeat(50_000)}`;
    const diags = checkPseudocode(deep, CLASSROOM);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toBe('This program is nested too deeply for me to read.');
  });

  it('reports a failing io as an error instead of throwing', () => {
    const io: PseudoIO = {
      write: () => {
        throw new Error('console closed');
      },
      readLine: () => null,
    };
    const r = runPseudocode('OUTPUT 1', CLASSROOM, io);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe('Something went wrong while running your program: console closed');
  });

  it('strips a trailing carriage return from input lines', () => {
    expect(output('INPUT a\nOUTPUT a + 1', CLASSROOM, ['4\r'])).toBe('5\n');
  });

  it('handles Windows line endings and tabs', () => {
    expect(output('x ← 1\r\nIF x = 1 THEN\r\n\tOUTPUT "ok"\r\nEND IF\r\n')).toBe('ok\n');
  });
});
