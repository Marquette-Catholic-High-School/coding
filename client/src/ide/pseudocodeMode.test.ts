import { CompletionContext } from '@codemirror/autocomplete';
import { ensureSyntaxTree, StreamLanguage, StringStream } from '@codemirror/language';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { createPseudocodeConfig, type HighlightWords } from '@codeclass/shared/pseudocode';
import { describe, expect, it } from 'vitest';
import { createPseudocodeParser, multiWordStart, pseudocodeCompletionSource, type PseudocodeState } from './pseudocodeMode';

const WORDS: HighlightWords = {
  keywords: ['OUTPUT', 'INPUT', 'SET', 'TO', 'IF', 'THEN', 'ELSE IF', 'ELSE', 'END IF', 'FOR', 'FROM', 'END FOR', 'FOR EACH', 'IN', 'WHILE', 'END WHILE'],
  lockedKeywords: ['WHILE', 'END WHILE', 'FOR EACH', 'IN'],
  builtins: ['LENGTH', 'RANDOM'],
  constants: ['TRUE', 'FALSE'],
  wordOperators: ['AND', 'OR', 'NOT', 'MOD'],
  symbolOperators: ['←', '<-', '=', '+'],
  commentPrefixes: ['//'],
  caseSensitive: false,
};

const KEYWORDS = {
  if: ['IF'],
  elseIf: ['ELSE IF'],
  else: ['ELSE'],
  endIf: ['END IF'],
  for: ['FOR'],
  endFor: ['END FOR'],
  forEach: ['FOR EACH'],
  while: ['WHILE'],
  endWhile: ['END WHILE'],
};

type Token = [text: string, style: string | null];

function tokenize(lines: string[], words: HighlightWords = WORDS) {
  const parser = createPseudocodeParser({ words, keywords: KEYWORDS });
  const state = parser.startState!(2);
  const out: Token[][] = [];
  for (const line of lines) {
    const tokens: Token[] = [];
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      const style = parser.token(stream, state);
      tokens.push([stream.current(), style]);
      stream.start = stream.pos;
    }
    out.push(tokens.filter(([text]) => text.trim() !== ''));
  }
  return { tokens: out, state, parser };
}

function styled(line: string, words?: HighlightWords): Token[] {
  return tokenize([line], words).tokens[0]!;
}

describe('pseudocode highlighting', () => {
  it('classifies keywords, strings, variables and separators', () => {
    expect(styled('OUTPUT "Total: ", total')).toEqual([
      ['OUTPUT', 'keyword'],
      ['"Total: "', 'string'],
      [',', 'separator'],
      ['total', 'variableName'],
    ]);
  });

  it('matches multi-word keywords as one token, case-insensitively and across extra spaces', () => {
    expect(styled('END IF')).toEqual([['END IF', 'keyword']]);
    expect(styled('end   if')).toEqual([['end   if', 'keyword']]);
    expect(styled('ELSE IF x = 1 THEN')[0]).toEqual(['ELSE IF', 'keyword']);
  });

  it('prefers the longest keyword and marks locked keywords', () => {
    expect(styled('FOR EACH pet IN pets')).toEqual([
      ['FOR EACH', 'lockedKeyword'],
      ['pet', 'variableName'],
      ['IN', 'lockedKeyword'],
      ['pets', 'variableName'],
    ]);
    expect(styled('FOR i FROM 1 TO 3')[0]).toEqual(['FOR', 'keyword']);
    expect(styled('WHILE x < 3')[0]).toEqual(['WHILE', 'lockedKeyword']);
  });

  it('does not treat keyword prefixes of identifiers as keywords', () => {
    expect(styled('ifCount ← total')).toEqual([
      ['ifCount', 'variableName'],
      ['←', 'operator'],
      ['total', 'variableName'],
    ]);
  });

  it('styles built-ins, constants, word operators, numbers and comments', () => {
    expect(styled('SET n TO LENGTH(list) MOD 2 // remainder')).toEqual([
      ['SET', 'keyword'],
      ['n', 'variableName'],
      ['TO', 'keyword'],
      ['LENGTH', 'variableName.function.standard'],
      ['(', 'paren'],
      ['list', 'variableName'],
      [')', 'paren'],
      ['MOD', 'operatorKeyword'],
      ['2', 'number'],
      ['// remainder', 'comment'],
    ]);
    expect(styled('x <- TRUE')).toEqual([
      ['x', 'variableName'],
      ['<-', 'operator'],
      ['TRUE', 'bool'],
    ]);
    expect(styled('double(4)')[0]).toEqual(['double', 'variableName.function']);
  });

  it('respects case-sensitive languages and custom comment prefixes', () => {
    const words = { ...WORDS, caseSensitive: true, commentPrefixes: ['#'] };
    expect(styled('output x', words)[0]).toEqual(['output', 'variableName']);
    expect(styled('OUTPUT x # note', words)).toEqual([
      ['OUTPUT', 'keyword'],
      ['x', 'variableName'],
      ['# note', 'comment'],
    ]);
  });

  it('keeps unterminated strings on their line', () => {
    expect(styled('OUTPUT "oops')).toEqual([
      ['OUTPUT', 'keyword'],
      ['"oops', 'string'],
    ]);
  });
});

describe('pseudocode indentation', () => {
  function indentAfter(lines: string[], textAfter = ''): number | null {
    const { state, parser } = tokenize(lines);
    return parser.indent!(state as PseudocodeState, textAfter, { unit: 2 } as never);
  }

  it('indents after a block opener and keeps the level inside blocks', () => {
    expect(indentAfter(['IF x > 1 THEN'])).toBe(2);
    expect(indentAfter(['IF x > 1 THEN', '  OUTPUT x'])).toBe(2);
    expect(indentAfter(['OUTPUT x'])).toBe(0);
  });

  it('dedents closers and re-opens after ELSE', () => {
    expect(indentAfter(['IF x > 1 THEN', '  OUTPUT x'], 'END IF')).toBe(0);
    expect(indentAfter(['IF x > 1 THEN', '  OUTPUT x'], 'ELSE')).toBe(0);
    expect(indentAfter(['IF x > 1 THEN', '  OUTPUT x', 'ELSE'])).toBe(2);
  });

  it('handles brace blocks', () => {
    expect(indentAfter(['REPEAT 3 TIMES {'])).toBe(2);
    expect(indentAfter(['REPEAT 3 TIMES {', '  OUTPUT x'], '}')).toBe(0);
  });
});

describe('multiWordStart', () => {
  it('finds the start of a half-typed multi-word keyword', () => {
    expect(multiWordStart('  END I', 'END IF', false)).toBe(2);
    expect(multiWordStart('  end   i', 'END IF', false)).toBe(2);
    expect(multiWordStart('x ← 1 END ', 'END IF', false)).toBe(6);
  });

  it('returns null when the text does not lead into the phrase', () => {
    expect(multiWordStart('  END W', 'END IF', false)).toBeNull();
    expect(multiWordStart('  SEND I', 'END IF', false)).toBeNull();
    expect(multiWordStart('  end i', 'END IF', true)).toBeNull();
    expect(multiWordStart('  OUT', 'OUTPUT', false)).toBeNull();
  });
});

describe('pseudocode autocomplete', () => {
  const config = createPseudocodeConfig('classroom');

  async function complete(doc: string) {
    const language = StreamLanguage.define(createPseudocodeParser({ words: WORDS, keywords: KEYWORDS }));
    const state = EditorState.create({ doc, extensions: [language] });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const source = pseudocodeCompletionSource(config, WORDS);
    const result = await source(new CompletionContext(state, doc.length, false));
    return { state, result };
  }

  it('offers keywords, constants and program variables but not locked keywords', async () => {
    const { result } = await complete('SET score TO 1\nSET total TO 2\nOUTPUT s');
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['OUTPUT', 'END IF', 'TRUE', 'score', 'total', 'LENGTH']));
    expect(labels).not.toContain('WHILE');
    expect(labels).not.toContain('FOR EACH');
    // Keywords are never offered as variables, and neither is the word being typed.
    expect(labels.filter((l) => l === 'SET')).toHaveLength(1);
    expect(labels).not.toContain('s');
  });

  it('completes a half-typed multi-word keyword in place', async () => {
    const { state, result } = await complete('IF x THEN\n  OUTPUT x\nEND I');
    const option = result!.options.find((o) => o.label === 'END IF')!;
    expect(typeof option.apply).toBe('function');
    let next = state;
    const view = { dispatch: (spec: TransactionSpec) => (next = state.update(spec).state) };
    (option.apply as (v: unknown, c: unknown, from: number, to: number) => void)(view, option, result!.from, state.doc.length);
    expect(next.doc.toString()).toBe('IF x THEN\n  OUTPUT x\nEND IF');
  });

  it('stays quiet inside strings and comments', async () => {
    expect((await complete('OUTPUT "Hel')).result).toBeNull();
    expect((await complete('// OUT')).result).toBeNull();
  });
});
