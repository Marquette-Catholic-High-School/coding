import { describe, expect, it } from 'vitest';
import {
  BUILTIN_INFO,
  CONSTRUCT_INFO,
  PSEUDOCODE_PRESETS,
  buildBuiltinVocabulary,
  buildVocabulary,
  checkPseudocode,
  createPseudocodeConfig,
  highlightWords,
  renderExample,
  runPseudocode,
  starterProgram,
  type PseudocodeConfig,
} from './index';

function run(source: string, config: PseudocodeConfig): string {
  let out = '';
  const r = runPseudocode(source, config, { write: (t) => (out += t), readLine: () => '7' });
  expect(r.error).toBeNull();
  return out;
}

function custom(): PseudocodeConfig {
  const c = createPseudocodeConfig('classroom');
  c.keywords.output = ['SAY'];
  c.keywords.if = ['WHEN'];
  c.keywords.then = ['DO THIS'];
  c.keywords.endIf = ['DONE'];
  c.keywords.while = ['LOOP WHILE'];
  c.keywords.do = ['AND THEN'];
  c.keywords.endWhile = ['END LOOP'];
  c.keywords.forEach = ['FOR EVERY'];
  c.blockStyle = 'keywords';
  c.listIndexBase = 0;
  c.assignOperators = ['='];
  return c;
}

describe('renderExample', () => {
  it('reproduces the Classroom examples from CONSTRUCT_INFO', () => {
    const classroom = createPseudocodeConfig('classroom');
    const same = ['output', 'variables', 'if', 'else', 'logic', 'modDiv', 'while', 'repeatUntil', 'repeatTimes', 'for', 'lists', 'forEach', 'functions'];
    for (const info of CONSTRUCT_INFO) {
      if (same.includes(info.id)) expect(renderExample(info.id, classroom)).toBe(info.example);
    }
    expect(renderExample('input', classroom)).toBe('INPUT name\nOUTPUT "Hi", name');
    expect(renderExample('procedures', classroom)).toBe('PROCEDURE greet(name)\n  OUTPUT "Hello", name\nEND PROCEDURE\nCALL greet("Sam")');
  });

  for (const preset of PSEUDOCODE_PRESETS) {
    it(`gives examples that parse under ${preset.id} for every learned construct`, () => {
      for (const info of CONSTRUCT_INFO) {
        if (!preset.config.constructs[info.id]) continue;
        const example = renderExample(info.id, preset.config);
        expect(example.length).toBeGreaterThan(0);
        expect(checkPseudocode(example, preset.config), `${info.id}:\n${example}`).toEqual([]);
      }
    });
  }

  it('parses every example once all constructs are switched on, for every preset style', () => {
    for (const preset of PSEUDOCODE_PRESETS) {
      const all = { ...preset.config, constructs: Object.fromEntries(Object.keys(preset.config.constructs).map((k) => [k, true])) } as PseudocodeConfig;
      for (const info of CONSTRUCT_INFO) {
        expect(checkPseudocode(renderExample(info.id, all), all), `${preset.id} ${info.id}`).toEqual([]);
      }
    }
  });

  it('writes AP CSP examples with braces and call-style DISPLAY / INPUT() / RETURN()', () => {
    const ap = createPseudocodeConfig('ap-csp');
    expect(renderExample('if', ap)).toBe('IF (age >= 13) {\n  DISPLAY("Teen")\n}');
    expect(renderExample('input', ap)).toBe('name ← INPUT()\nDISPLAY("Hi")\nDISPLAY(name)');
    expect(renderExample('repeatUntil', ap)).toBe('REPEAT UNTIL (count = 5) {\n  count ← count + 1\n}');
    expect(renderExample('repeatTimes', ap)).toBe('REPEAT 3 TIMES {\n  DISPLAY("Hip hip hooray!")\n}');
    expect(renderExample('procedures', ap)).toBe('PROCEDURE greet(name) {\n  DISPLAY("Hello")\n  DISPLAY(name)\n}\ngreet("Sam")');
  });

  it('writes Cambridge examples in Cambridge layout', () => {
    const cam = createPseudocodeConfig('cambridge');
    expect(renderExample('if', cam)).toBe('IF age >= 13\n  THEN\n    OUTPUT "Teen"\nENDIF');
    expect(renderExample('for', cam)).toBe('FOR i ← 1 TO 10\n  OUTPUT i\nNEXT i');
    expect(renderExample('input', cam)).toBe('INPUT name\nOUTPUT "Hi ", name');
    expect(renderExample('else', cam)).toContain('  ELSE\n    IF x < 0\n');
  });

  it('writes AQA examples with USERINPUT, FOR … IN and 0-based lists', () => {
    const aqa = createPseudocodeConfig('aqa');
    expect(renderExample('input', aqa)).toBe('name ← USERINPUT\nOUTPUT "Hi", name');
    expect(renderExample('forEach', aqa)).toBe('FOR pet IN pets\n  OUTPUT pet\nENDFOR');
    expect(renderExample('lists', aqa)).toBe('pets ← ["cat", "dog"]\nOUTPUT pets[0]');
    expect(renderExample('while', aqa)).toBe('WHILE count < 5\n  count ← count + 1\nENDWHILE');
    expect(renderExample('functions', aqa)).toBe('SUBROUTINE double(n)\n  RETURN n * 2\nENDSUBROUTINE\nOUTPUT double(4)');
  });

  it('uses a teacher’s own words, assignment operator and list base', () => {
    const c = custom();
    expect(renderExample('if', c)).toBe('WHEN age >= 13 DO THIS\n  SAY "Teen"\nDONE');
    expect(renderExample('while', c)).toBe('LOOP WHILE count < 5 AND THEN\n  count = count + 1\nEND LOOP');
    expect(renderExample('lists', c)).toBe('SET pets TO ["cat", "dog"]\nSAY pets[0]');
    expect(renderExample('forEach', c)).toBe('FOR EVERY pet IN pets\n  SAY pet\nEND FOR');
    for (const info of CONSTRUCT_INFO) expect(checkPseudocode(renderExample(info.id, c), c), info.id).toEqual([]);
  });

  it('uses braces for brace-style languages and SET when there is no assignment operator', () => {
    const c = { ...createPseudocodeConfig('classroom'), blockStyle: 'braces' as const, assignOperators: [] };
    expect(renderExample('while', c)).toBe('WHILE (count < 5) {\n  SET count TO count + 1\n}');
    expect(renderExample('variables', c)).toBe('SET score TO 0\nSET score TO score + 1');
    for (const info of CONSTRUCT_INFO) expect(checkPseudocode(renderExample(info.id, c), c), info.id).toEqual([]);
  });

  it('gives examples that actually run', () => {
    const classroom = createPseudocodeConfig('classroom');
    expect(run(renderExample('output', classroom), classroom)).toBe('Hello, world!\n');
    expect(run(renderExample('repeatTimes', classroom), classroom)).toBe('Hip hip hooray!\n'.repeat(3));
    expect(run(renderExample('functions', classroom), classroom)).toBe('8\n');
    expect(run(renderExample('procedures', classroom), classroom)).toBe('Hello Sam\n');
    expect(run(renderExample('repeatUntil', classroom), classroom)).toBe('');
    const ap = createPseudocodeConfig('ap-csp');
    expect(run(renderExample('procedures', ap), ap)).toBe('Hello Sam ');
  });

  it('copes with a broken draft config', () => {
    const broken = { ...createPseudocodeConfig('classroom'), keywords: { output: [] } } as unknown as PseudocodeConfig;
    expect(renderExample('output', broken)).toBe('OUTPUT "Hello, world!"');
  });
});

describe('buildVocabulary', () => {
  it('lists every construct in CONSTRUCT_INFO order with the teacher’s words', () => {
    const vocab = buildVocabulary(custom());
    expect(vocab.map((v) => v.construct)).toEqual(CONSTRUCT_INFO.map((c) => c.id));
    const ifEntry = vocab.find((v) => v.construct === 'if')!;
    expect(ifEntry).toMatchObject({ label: 'If', description: 'Make decisions.', enabled: true, words: ['WHEN', 'DO THIS', 'DONE'] });
    expect(ifEntry.example).toBe(renderExample('if', custom()));
    expect(vocab.find((v) => v.construct === 'variables')!.words).toEqual(['SET', 'TO', '=']);
  });

  it('marks locked constructs and keeps their examples', () => {
    const vocab = buildVocabulary(createPseudocodeConfig('starter'));
    expect(vocab.filter((v) => v.enabled).map((v) => v.construct)).toEqual(['output', 'variables', 'input']);
    const whileEntry = vocab.find((v) => v.construct === 'while')!;
    expect(whileEntry.enabled).toBe(false);
    expect(whileEntry.example).toContain('WHILE count < 5 DO');
  });

  it('leaves out END words in brace style and shows RETURN for AP CSP procedures', () => {
    const vocab = buildVocabulary(createPseudocodeConfig('ap-csp'));
    const words = (c: string) => vocab.find((v) => v.construct === c)!.words;
    expect(words('if')).toEqual(['IF']);
    expect(words('repeatTimes')).toEqual(['REPEAT', 'TIMES']);
    expect(words('procedures')).toEqual(['PROCEDURE', 'RETURN']);
    expect(words('output')).toEqual(['DISPLAY']);
    expect(words('variables')).toEqual(['←']);
    expect(words('logic')).toEqual(['AND', 'OR', 'NOT', 'true', 'false']);
  });

  it('shows the words each exam board uses', () => {
    const cam = buildVocabulary(createPseudocodeConfig('cambridge'));
    expect(cam.find((v) => v.construct === 'for')!.words).toEqual(['FOR', 'TO', 'STEP', 'NEXT']);
    const aqa = buildVocabulary(createPseudocodeConfig('aqa'));
    expect(aqa.find((v) => v.construct === 'forEach')!.words).toEqual(['FOR', 'IN', 'ENDFOR']);
    expect(aqa.find((v) => v.construct === 'while')!.words).toEqual(['WHILE', 'ENDWHILE']);
    expect(cam.find((v) => v.construct === 'variables')!.words).toEqual(['←', 'DECLARE', 'CONSTANT']);
    expect(aqa.find((v) => v.construct === 'variables')!.words).toEqual(['←', 'constant']);
  });
});

describe('buildBuiltinVocabulary', () => {
  it('describes every built-in with its signature', () => {
    const vocab = buildBuiltinVocabulary(createPseudocodeConfig('classroom'));
    expect(vocab.map((b) => b.id)).toEqual(BUILTIN_INFO.map((b) => b.id));
    expect(vocab[0]).toEqual({
      id: 'length',
      name: 'LENGTH',
      signature: 'LENGTH(listOrText)',
      description: 'Number of items in a list or characters in text.',
      enabled: true,
    });
    expect(vocab.find((b) => b.id === 'substring')!.signature).toBe('SUBSTRING(text, start, length)');
    expect(vocab.every((b) => b.enabled)).toBe(true);
  });

  it('uses renamed built-ins and switches off list built-ins when lists are off', () => {
    const aqa = buildBuiltinVocabulary(createPseudocodeConfig('aqa'));
    expect(aqa.find((b) => b.id === 'length')).toMatchObject({ name: 'LEN', signature: 'LEN(listOrText)', enabled: true });
    expect(aqa.find((b) => b.id === 'random')).toMatchObject({ name: 'RANDOM_INT', signature: 'RANDOM_INT(low, high)' });
    expect(aqa.find((b) => b.id === 'upper')!.enabled).toBe(false);
    const c = createPseudocodeConfig('classroom');
    c.constructs.lists = false;
    const vocab = buildBuiltinVocabulary(c);
    expect(vocab.find((b) => b.id === 'append')!.enabled).toBe(false);
    expect(vocab.find((b) => b.id === 'length')!.enabled).toBe(true);
  });
});

describe('highlightWords', () => {
  it('lists every keyword spelling, longest first, plus the specific groups', () => {
    const words = highlightWords(createPseudocodeConfig('classroom'));
    expect(words.keywords).toContain('END IF');
    expect(words.keywords).toContain('FOR EACH');
    expect(words.keywords).toContain('OUTPUT');
    expect(words.keywords.indexOf('FOR EACH')).toBeLessThan(words.keywords.indexOf('FOR'));
    expect(words.keywords.indexOf('ELSE IF')).toBeLessThan(words.keywords.indexOf('ELSE'));
    expect(words.keywords).toEqual(expect.arrayContaining(['DECLARE', 'CONSTANT']));
    expect(words.lockedKeywords).toEqual([]);
    expect(words.builtins).toContain('LENGTH');
    expect(words.builtins).toHaveLength(BUILTIN_INFO.length);
    expect(words.constants.sort()).toEqual(['FALSE', 'TRUE']);
    expect(words.wordOperators.sort()).toEqual(['AND', 'DIV', 'MOD', 'NOT', 'OR']);
    expect(words.symbolOperators).toEqual(expect.arrayContaining(['+', '-', '*', '/', '^', '&', '=', '≠', '<>', '<=', '≥', '←', '<-']));
    expect(words.symbolOperators.indexOf('<-')).toBeLessThan(words.symbolOperators.indexOf('<'));
    expect(words.commentPrefixes).toEqual(['//']);
    expect(words.caseSensitive).toBe(false);
  });

  it('marks locked keywords and leaves out switched-off built-ins', () => {
    const words = highlightWords(createPseudocodeConfig('starter'));
    expect(words.lockedKeywords).toEqual(expect.arrayContaining(['WHILE', 'IF', 'END IF', 'FOR EACH', 'TRUE', 'AND']));
    expect(words.lockedKeywords).not.toContain('OUTPUT');
    expect(words.lockedKeywords).not.toContain('SET');
    expect(words.lockedKeywords).not.toContain('TO');
    expect(words.builtins).toEqual([]);
  });

  it('follows the config’s spellings, operators and comments', () => {
    const ap = highlightWords(createPseudocodeConfig('ap-csp'));
    expect(ap.keywords).toContain('DISPLAY');
    expect(ap.constants.sort()).toEqual(['false', 'true']);
    expect(ap.symbolOperators).not.toContain('&');
    expect(ap.builtins.sort()).toEqual(['APPEND', 'INSERT', 'LENGTH', 'RANDOM', 'REMOVE']);
    expect(ap.lockedKeywords).toContain('WHILE');
    expect(ap.lockedKeywords).not.toContain('RETURN');
    const aqa = highlightWords(createPseudocodeConfig('aqa'));
    expect(aqa.commentPrefixes).toEqual(['#']);
    expect(aqa.keywords).toContain('USERINPUT');
    const sensitive = highlightWords({ ...createPseudocodeConfig('classroom'), caseSensitive: true });
    expect(sensitive.caseSensitive).toBe(true);
  });
});

describe('starterProgram', () => {
  it('writes a comment and a hello-world in each preset’s style', () => {
    expect(starterProgram(createPseudocodeConfig('classroom'))).toBe('// Write your program below\nOUTPUT "Hello, world!"\n');
    expect(starterProgram(createPseudocodeConfig('ap-csp'))).toBe('// Write your program below\nDISPLAY("Hello, world!")\n');
    expect(starterProgram(createPseudocodeConfig('aqa'))).toBe('# Write your program below\nOUTPUT "Hello, world!"\n');
    expect(starterProgram(custom())).toBe('// Write your program below\nSAY "Hello, world!"\n');
  });

  it('runs and passes the check in every preset', () => {
    for (const p of PSEUDOCODE_PRESETS) {
      const code = starterProgram(p.config);
      expect(checkPseudocode(code, p.config)).toEqual([]);
      expect(run(code, p.config)).toBe(p.config.outputNewline ? 'Hello, world!\n' : 'Hello, world! ');
    }
  });

  it('only uses learned constructs', () => {
    const c = createPseudocodeConfig('classroom');
    c.constructs.output = false;
    expect(starterProgram(c)).toBe('// Write your program below\n');
  });
});
