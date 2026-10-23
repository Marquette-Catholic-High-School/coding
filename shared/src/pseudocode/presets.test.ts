import { describe, expect, it } from 'vitest';
import {
  BUILTIN_INFO,
  DEFAULT_PRESET_ID,
  KEYWORD_INFO,
  PSEUDOCODE_PRESETS,
  checkPseudocode,
  createPseudocodeConfig,
  normalizePseudocodeConfig,
  pseudocodeConfigSchema,
  runPseudocode,
  validatePseudocodeConfig,
  type PseudocodeConfig,
} from './index';

function run(source: string, config: PseudocodeConfig, inputs: string[] = []) {
  let out = '';
  const queue = [...inputs];
  const result = runPseudocode(source, config, { write: (t) => (out += t), readLine: () => queue.shift() ?? null }, { random: () => 0 });
  return { out, result };
}

const SAMPLE_RUNS: Record<string, { inputs: string[]; output: string }> = {
  classroom: {
    inputs: [],
    output: 'The first 5 square numbers add up to 55\ncat has 3 letters\ndog has 3 letters\nrabbit has 6 letters\n3\n2\n1\nLift off!\n',
  },
  starter: { inputs: ['Sam'], output: 'Hello! What is your name?\nNice to meet you, Sam\nNext year you will be 12\n' },
  'ap-csp': { inputs: [], output: 'Great work! 87.5 3 3 ' },
  cambridge: { inputs: [], output: 'Total: 220\nThat is more than 200\n*****\n' },
  aqa: { inputs: [], output: 'First score: 12\nPass\n3\n2\n1\n45\n' },
};

describe('PSEUDOCODE_PRESETS', () => {
  it('has the documented presets, classroom first and default', () => {
    expect(PSEUDOCODE_PRESETS.map((p) => p.id)).toEqual(['classroom', 'starter', 'ap-csp', 'cambridge', 'aqa']);
    expect(DEFAULT_PRESET_ID).toBe('classroom');
  });

  for (const preset of PSEUDOCODE_PRESETS) {
    describe(preset.id, () => {
      it('is a valid, complete config with a description', () => {
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(40);
        expect(preset.config.presetId).toBe(preset.id);
        expect(() => pseudocodeConfigSchema.parse(preset.config)).not.toThrow();
        expect(validatePseudocodeConfig(preset.config)).toEqual([]);
        expect(normalizePseudocodeConfig(preset.config)).toEqual(preset.config);
      });

      it('runs its sample program with the exact expected output', () => {
        expect(checkPseudocode(preset.sample, preset.config)).toEqual([]);
        const expected = SAMPLE_RUNS[preset.id]!;
        const { out, result } = run(preset.sample, preset.config, expected.inputs);
        expect(result.error).toBeNull();
        expect(out).toBe(expected.output);
      });
    });
  }

  it('classroom uses the Classroom defaults from KEYWORD_INFO with everything switched on', () => {
    const c = createPseudocodeConfig('classroom');
    for (const k of KEYWORD_INFO) expect(c.keywords[k.id]).toEqual(k.defaults);
    expect(Object.values(c.constructs).every(Boolean)).toBe(true);
    for (const b of BUILTIN_INFO) expect(c.builtins[b.id]).toEqual({ name: b.defaultName, enabled: true });
    expect(c).toMatchObject({ blockStyle: 'keywords', listIndexBase: 1, outputNewline: true, outputSeparator: ' ', commentPrefixes: ['//'] });
  });

  it('starter only has output, input and variables', () => {
    const c = createPseudocodeConfig('starter');
    const on = Object.entries(c.constructs).filter(([, v]) => v).map(([k]) => k);
    expect(on.sort()).toEqual(['input', 'output', 'variables']);
    expect(Object.values(c.builtins).some((b) => b.enabled)).toBe(false);
  });

  it('ap-csp follows the AP CSP reference sheet', () => {
    const c = createPseudocodeConfig('ap-csp');
    expect(c.keywords.output).toEqual(['DISPLAY']);
    expect(c).toMatchObject({ blockStyle: 'braces', outputNewline: false, listIndexBase: 1 });
    expect(c.constructs).toMatchObject({ while: false, for: false, functions: false, repeatTimes: true, repeatUntil: true, forEach: true, procedures: true });
    const enabled = BUILTIN_INFO.filter((b) => c.builtins[b.id].enabled).map((b) => b.id);
    expect(enabled).toEqual(['length', 'append', 'insert', 'remove', 'random']);
    const src = ['aList ← [10, 20, 30]', 'INSERT(aList, 2, 15)', 'REMOVE(aList, 4)', 'DISPLAY(aList)', 'DISPLAY(LENGTH(aList))', 'DISPLAY(RANDOM(1, 6))', 'DISPLAY(3 ≠ 4)'].join('\n');
    expect(run(src, c).out).toBe('[10, 15, 20] 3 1 true ');
  });

  it('cambridge uses Cambridge keywords and functions', () => {
    const c = createPseudocodeConfig('cambridge');
    expect(c.keywords).toMatchObject({ endIf: ['ENDIF'], endWhile: ['ENDWHILE'], endFor: ['NEXT'], endProcedure: ['ENDPROCEDURE'] });
    expect(c).toMatchObject({ concatOperators: ['&'], outputSeparator: '' });
    expect(c.builtins.upper.name).toBe('UCASE');
    const src = [
      'OUTPUT MOD(10, 3), " ", DIV(10, 3), " ", 10 MOD 3',
      'OUTPUT UCASE("a") & LCASE("B") & NUM_TO_STR(5) & SUBSTRING("Happy Days", 1, 5)',
      'Count ← 0',
      'WHILE Count < 2 DO',
      '  Count ← Count + 1',
      'ENDWHILE',
      'REPEAT',
      '  Count ← Count - 1',
      'UNTIL Count = 0',
      'FOR Index ← 1 TO 5 STEP 2',
      '  OUTPUT Index',
      'NEXT Index',
    ].join('\n');
    expect(run(src, c).out).toBe('1 3 1\nAb5Happy\n1\n3\n5\n');
  });

  it('aqa uses AQA keywords, # comments and arrays from 0', () => {
    const c = createPseudocodeConfig('aqa');
    expect(c.keywords).toMatchObject({ input: ['USERINPUT'], function: ['SUBROUTINE'], endFunction: ['ENDSUBROUTINE'], endFor: ['ENDFOR'] });
    expect(c).toMatchObject({ commentPrefixes: ['#'], listIndexBase: 0, concatOperators: ['+'] });
    expect(c.builtins.length.name).toBe('LEN');
    expect(c.builtins.random.name).toBe('RANDOM_INT');
    const src = [
      '# comment',
      'names ← ["Ali", "Bo"]',
      'OUTPUT names[0], LEN(names), RANDOM_INT(1, 6)',
      'FOR i ← 0 TO LEN(names) - 1',
      '  OUTPUT STRING_TO_INT("4") + i',
      'ENDFOR',
      'FOR n IN names',
      '  OUTPUT n',
      'ENDFOR',
    ].join('\n');
    expect(run(src, c).out).toBe('Ali 2 1\n4\n5\nAli\nBo\n');
  });
});

describe('createPseudocodeConfig', () => {
  it('returns a deep copy', () => {
    const a = createPseudocodeConfig('classroom');
    a.keywords.output.push('SAY');
    a.constructs.while = false;
    a.builtins.length.name = 'LEN';
    const b = createPseudocodeConfig('classroom');
    expect(b.keywords.output).toEqual(['OUTPUT']);
    expect(b.constructs.while).toBe(true);
    expect(b.builtins.length.name).toBe('LENGTH');
    expect(PSEUDOCODE_PRESETS[0]!.config.keywords.output).toEqual(['OUTPUT']);
  });

  it('falls back to the default preset', () => {
    expect(createPseudocodeConfig()).toEqual(createPseudocodeConfig('classroom'));
    expect(createPseudocodeConfig('no-such-preset')).toEqual(createPseudocodeConfig('classroom'));
    expect(createPseudocodeConfig('aqa').presetId).toBe('aqa');
  });
});

describe('normalizePseudocodeConfig', () => {
  const classroom = createPseudocodeConfig('classroom');

  it.each([null, undefined, 42, 'abc', [], true, () => 1])('turns %p into the Classroom config', (raw) => {
    expect(normalizePseudocodeConfig(raw)).toEqual(classroom);
  });

  it('deep-merges partial configs with the Classroom defaults and drops unknown keys', () => {
    const n = normalizePseudocodeConfig({
      presetId: 'mine',
      keywords: { output: ['SAY'], bogus: ['X'] },
      constructs: { while: false },
      builtins: { length: { name: 'LEN' } },
      extra: 1,
      outputNewline: false,
    });
    expect(n.presetId).toBe('mine');
    expect(n.keywords.output).toEqual(['SAY']);
    expect(n.keywords.if).toEqual(['IF']);
    expect(n.constructs.while).toBe(false);
    expect(n.constructs.for).toBe(true);
    expect(n.builtins.length).toEqual({ name: 'LEN', enabled: true });
    expect(n.outputNewline).toBe(false);
    expect('extra' in n).toBe(false);
    expect('bogus' in n.keywords).toBe(false);
  });

  it('repairs empty and invalid slots', () => {
    const n = normalizePseudocodeConfig({
      caseSensitive: 'yes',
      keywords: {
        output: [],
        input: ['  ASK   FOR  ', 'ask for', 'BAD-WORD', 7, '', '9LIVES'],
        endIf: 'ENDIF',
        while: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
      },
      builtins: { length: { name: 'two words', enabled: 'no' }, abs: 5 },
      assignOperators: ['←', '=>', '←', ' = ', 7],
      commentPrefixes: ['REM', '/', ' # ', '#', 'a', '<-'],
      blockStyle: 'curly',
      outputSeparator: 'too long',
      listIndexBase: 2,
      concatOperators: ['*'],
      constructs: { output: 'on' },
    });
    expect(n.caseSensitive).toBe(false);
    expect(n.keywords.output).toEqual(['OUTPUT']);
    expect(n.keywords.input).toEqual(['ASK FOR']);
    expect(n.keywords.endIf).toEqual(['ENDIF']);
    expect(n.keywords.while).toHaveLength(8);
    expect(n.builtins.length).toEqual({ name: 'LENGTH', enabled: true });
    expect(n.builtins.abs).toEqual({ name: 'ABS', enabled: true });
    expect(n.assignOperators).toEqual(['←', '=']);
    expect(n.commentPrefixes).toEqual(['#']);
    expect(n.blockStyle).toBe('keywords');
    expect(n.outputSeparator).toBe('too ');
    expect(n.listIndexBase).toBe(1);
    expect(n.concatOperators).toEqual(['+', '&']);
    expect(n.constructs.output).toBe(true);
  });

  it('always produces a config that matches the schema and runs', () => {
    const inputs: unknown[] = [
      {},
      { keywords: null, constructs: [], builtins: 'x' },
      { keywords: { output: [{}] }, commentPrefixes: [] },
      { assignOperators: 'nope', concatOperators: null, outputSeparator: 5 },
    ];
    for (const raw of inputs) {
      const n = normalizePseudocodeConfig(raw);
      expect(() => pseudocodeConfigSchema.parse(n)).not.toThrow();
      let out = '';
      const r = runPseudocode('OUTPUT 1 + 1', n, { write: (t) => (out += t), readLine: () => null });
      expect(r.ok).toBe(true);
      expect(out).toBe('2\n');
    }
  });

  it('gives configs stored before DECLARE and CONSTANT existed the default spellings', () => {
    const { declare: _d, constant: _c, ...oldKeywords } = classroom.keywords;
    const old = { ...classroom, keywords: oldKeywords };
    expect(normalizePseudocodeConfig(old)).toEqual(classroom);
    const parsed = pseudocodeConfigSchema.parse(old);
    expect(parsed.keywords.declare).toEqual(['DECLARE']);
    expect(parsed.keywords.constant).toEqual(['CONSTANT']);
    expect(validatePseudocodeConfig(parsed)).toEqual([]);
    expect(createPseudocodeConfig('aqa').keywords.constant).toEqual(['constant']);
  });

  it('keeps the case-sensitivity setting when removing duplicate spellings', () => {
    expect(normalizePseudocodeConfig({ keywords: { output: ['SAY', 'say'] } }).keywords.output).toEqual(['SAY']);
    expect(normalizePseudocodeConfig({ caseSensitive: true, keywords: { output: ['SAY', 'say'] } }).keywords.output).toEqual(['SAY', 'say']);
  });
});

describe('validatePseudocodeConfig', () => {
  const edit = (change: (c: PseudocodeConfig) => void): PseudocodeConfig => {
    const c = createPseudocodeConfig('classroom');
    change(c);
    return c;
  };

  it('accepts every preset', () => {
    for (const p of PSEUDOCODE_PRESETS) expect(validatePseudocodeConfig(p.config)).toEqual([]);
  });

  it('checks keyword spellings', () => {
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.endIf = ['END-IF'])))).toEqual([
      '"END-IF" (End if) isn\'t a valid spelling — use letters, digits and _ only, start with a letter, and put a single space between words.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.endIf = ['END  IF'])))).toHaveLength(1);
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.endIf = [' END IF'])))).toHaveLength(1);
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.output = ['2PRINT'])))).toHaveLength(1);
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.output = [])))).toEqual(['"Output" needs at least one spelling.']);
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.output = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])))).toEqual([
      '"Output" can have at most 8 spellings.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.output = ['END_IF_2', 'my_word'])))).toEqual([]);
  });

  it('rejects a spelling used by two keywords or by a keyword and a built-in', () => {
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.output = ['OUTPUT', 'end if'])))).toEqual([
      '"END IF" is used for both "Output" and "End if" — each word can only mean one thing.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.builtins.length.name = 'output')))).toEqual([
      '"output" is used for both the "Output" keyword and the LENGTH built-in.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.builtins.abs.name = 'LENGTH')))).toEqual([
      'Two built-ins (LENGTH and ABS) are both called "LENGTH".',
    ]);
    // Case-sensitive languages may use the same letters in different cases.
    expect(validatePseudocodeConfig(edit((c) => {
      c.caseSensitive = true;
      c.keywords.output = ['OUTPUT', 'End If'];
    }))).toEqual([]);
  });

  it('checks built-in names, operators, comments and other settings', () => {
    expect(validatePseudocodeConfig(edit((c) => (c.builtins.length.name = 'LEN GTH')))).toEqual([
      'The LENGTH built-in needs a one-word name (letters, digits and _), like LENGTH.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.assignOperators = ['←', '=>'])))).toEqual([
      '"=>" can\'t be used to store values — choose from ←, <-, =, :=.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.assignOperators = [])))).toEqual([]);
    expect(validatePseudocodeConfig(edit((c) => (c.commentPrefixes = ['REM'])))).toEqual([
      'Comment symbol "REM" can\'t contain letters or digits.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.commentPrefixes = ['/'])))).toEqual([
      '"/" can\'t start comments because it\'s already an operator.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.commentPrefixes = [])))).toEqual(['Add at least one comment symbol, such as //.']);
    expect(validatePseudocodeConfig(edit((c) => (c.commentPrefixes = ['#', '%%', '!!', '/*'])))).toEqual([]);
    expect(validatePseudocodeConfig(edit((c) => (c.constructs.output = false)))).toEqual([
      'Output must stay switched on — students need it to see what their program does.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.concatOperators = [])))).toEqual(['Choose at least one way to join text (+ or &).']);
    expect(validatePseudocodeConfig(edit((c) => (c.outputSeparator = 'abcdef')))).toEqual(['The output separator can be at most 4 characters long.']);
    expect(validatePseudocodeConfig(edit((c) => ((c as { listIndexBase: number }).listIndexBase = 2)))).toEqual(['Lists must start at position 0 or 1.']);
    expect(validatePseudocodeConfig(edit((c) => ((c as { blockStyle: string }).blockStyle = 'curly')))).toEqual([
      'Block style must be keywords, braces or both.',
    ]);
  });

  it('rejects comment symbols that would swallow operators written without spaces', () => {
    const problems = (prefix: string) => validatePseudocodeConfig(edit((c) => (c.commentPrefixes = [prefix])));
    expect(problems('!')).toEqual(['"!" can\'t start comments because the "!=" operator starts with it.']);
    expect(problems('--')).toEqual(['"--" can\'t start comments because code like 5--2 uses those symbols.']);
    expect(problems('*-')).toEqual(['"*-" can\'t start comments because code like 5*-2 uses those symbols.']);
    expect(problems('=+')).toEqual(['"=+" can\'t start comments because code like 5=+2 uses those symbols.']);
    expect(problems('(-')).toEqual(['"(-" can\'t start comments because code like (-2) uses those symbols.']);
    expect(problems('[-')).toEqual(['"[-" can\'t start comments because code like [-2] uses those symbols.']);
    expect(problems(',-')).toEqual(['",-" can\'t start comments because code like (1,-2) uses those symbols.']);
    expect(problems('--->')).toHaveLength(1);
    expect(problems('//')).toEqual([]);
    expect(problems('->')).toEqual([]);
    // Stored configs are repaired the same way, so the operators keep working.
    expect(normalizePseudocodeConfig({ commentPrefixes: ['!', '--', '#'] }).commentPrefixes).toEqual(['#']);
    expect(normalizePseudocodeConfig({ commentPrefixes: ['!'] }).commentPrefixes).toEqual(['//']);
  });

  it('rejects a spelling that starts with another spelling of the same keyword', () => {
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.output = ['PRINT', 'PRINT LINE'])))).toEqual([
      '"PRINT LINE" and "PRINT" are both spellings of "Output", so PRINT followed by a name called LINE would be read as PRINT LINE. Keep just one of them.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.endIf = ['end if more', 'END IF'])))).toEqual([
      '"end if more" and "END IF" are both spellings of "End if", so END IF followed by a name called more would be read as end if more. Keep just one of them.',
    ]);
    expect(validatePseudocodeConfig(edit((c) => (c.keywords.output = ['PRINT', 'PRINTLINE', 'SHOW ME'])))).toEqual([]);
    expect(validatePseudocodeConfig(edit((c) => {
      c.caseSensitive = true;
      c.keywords.output = ['Print', 'PRINT LINE'];
    }))).toEqual([]);
    // Different keywords may share a first word (FOR and FOR EACH, ELSE and ELSE IF).
    expect(validatePseudocodeConfig(createPseudocodeConfig('classroom'))).toEqual([]);
  });

  it('reports several problems at once and never throws on garbage', () => {
    const problems = validatePseudocodeConfig(
      edit((c) => {
        c.keywords.output = [];
        c.constructs.output = false;
        c.commentPrefixes = ['x'];
      }),
    );
    expect(problems).toHaveLength(3);
    for (const raw of [null, undefined, 5, 'x', {}, { keywords: [] }]) {
      expect(() => validatePseudocodeConfig(raw as unknown as PseudocodeConfig)).not.toThrow();
      expect(validatePseudocodeConfig(raw as unknown as PseudocodeConfig).length).toBeGreaterThan(0);
    }
  });
});
