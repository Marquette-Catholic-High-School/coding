import type { TestCase } from '@codeclass/shared';
import { createPseudocodeConfig } from '@codeclass/shared/pseudocode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanguageRunner, RunIO } from './lang/io';
import type { MainToWorker, WorkerToMain } from './protocol';
import type { OutputChunk } from './types';

// Input prompts end to end: index.ts, worker.ts (running in this thread behind a stand-in Worker) and the real
// pseudocode and JavaScript runners. Python and Lua download their runtimes in the browser, so stand-ins use the
// worker's IO the way those runners do: Python's input() writes its prompt to stdout and then reads a line, telling
// the worker its prompt (any other read tells it there's none), and a Lua program calls io.write() before io.read(),
// which says nothing about a prompt. The stand-in runs the program named by the code.

function standIn(programs: Record<string, (io: RunIO) => void>): LanguageRunner {
  return {
    loaded: () => true,
    load: async () => {},
    run: async (code, io) => {
      programs[code]!(io);
      return { status: 'ok', error: null };
    },
  };
}

vi.mock('./lang/python', () => ({
  pythonRunner: standIn({
    // name = input("Name: ")
    // print("Hi", name)
    greet: (io) => {
      io.write('stdout', 'Name: ');
      io.write('stdout', `Hi ${io.readLine('Name: ') ?? ''}\n`);
    },
    // for _ in range(3):
    //     print(int(input()) * 2, end=" ")
    // print()
    doubles: (io) => {
      for (let i = 0; i < 3; i++) io.write('stdout', `${Number(io.readLine('')) * 2} `);
      io.write('stdout', '\n');
    },
    // print("Enter a number:")
    // n = int(input())
    // print(n * 2)
    ownLine: (io) => {
      io.write('stdout', 'Enter a number:\n');
      io.write('stdout', `${Number(io.readLine('')) * 2}\n`);
    },
    // n = int(input("Enter a number:\n"))
    // print(n * 2)
    promptLine: (io) => {
      io.write('stdout', 'Enter a number:\n');
      io.write('stdout', `${Number(io.readLine('Enter a number:\n')) * 2}\n`);
    },
  }),
}));

vi.mock('./lang/lua', () => ({
  luaRunner: standIn({
    // print("Ages")
    // io.write("Age? ") local age = io.read("n")
    // io.write("Next year: ", age + 1, "\n")
    ages: (io) => {
      io.write('stdout', 'Ages\n');
      io.write('stdout', 'Age? ');
      io.write('stdout', `Next year: ${Number(io.readLine()) + 1}\n`);
    },
    // for i = 1, 3 do io.write(io.read("n") * 2, " ") end
    // print()
    doubles: (io) => {
      for (let i = 0; i < 3; i++) io.write('stdout', `${Number(io.readLine()) * 2} `);
      io.write('stdout', '\n');
    },
  }),
}));

// The JavaScript runner blocks the network by replacing globals such as Worker, which would remove the stand-in.
vi.mock('./lang/network', async (importOriginal) => ({ ...(await importOriginal<object>()), blockNetwork: () => {} }));

/** worker.ts's message listener, and the stand-in workers index.ts created (they all share that one worker). */
let deliver: ((event: { data: MainToWorker }) => void) | null = null;
const workers: InProcessWorker[] = [];

class InProcessWorker {
  private readonly listeners: ((event: { data: WorkerToMain }) => void)[] = [];

  constructor() {
    workers.push(this);
  }

  postMessage(message: MainToWorker): void {
    setTimeout(() => deliver?.({ data: message }), 0);
  }

  addEventListener(type: string, listener: (event: { data: WorkerToMain }) => void): void {
    if (type === 'message') this.listeners.push(listener);
  }

  receive(message: WorkerToMain): void {
    for (const listener of this.listeners) listener({ data: message });
  }

  terminate(): void {}
}

async function load(isolated = false) {
  vi.resetModules();
  workers.length = 0;
  deliver = null;
  vi.stubGlobal('Worker', InProcessWorker);
  vi.stubGlobal('crossOriginIsolated', isolated);
  vi.stubGlobal('addEventListener', (type: string, listener: (event: { data: MainToWorker }) => void) => {
    if (type === 'message') deliver = listener;
  });
  vi.stubGlobal('removeEventListener', () => {});
  vi.stubGlobal('postMessage', (message: WorkerToMain) => setTimeout(() => workers.forEach((w) => w.receive(message)), 0));
  await import('./worker');
  return import('./index');
}

function test(id: string, input: string, expectedOutput: string): TestCase {
  return { id, name: id, input, expectedOutput, hidden: false, points: 1 };
}

const pseudocode = { kind: 'pseudocode' as const, pseudocode: createPseudocodeConfig() };
const DOUBLER = 'INPUT "Enter a number: ", n\nOUTPUT n * 2\n';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('input prompts', () => {
  it('are left out of pseudocode output, and the console still shows them', async () => {
    const rt = await load();
    const shown: OutputChunk[] = [];
    const outcome = await rt.startRun(pseudocode, `OUTPUT "Doubles"\n${DOUBLER}`, { stdin: ['4'], onOutput: (c) => shown.push(c) }).done;
    expect(outcome).toMatchObject({ status: 'ok', stdout: 'Doubles\nEnter a number: 8\n', promptlessStdout: 'Doubles\n8\n' });
    expect(shown.map((c) => c.text).join('')).toBe('Doubles\nEnter a number: 4\n8\n');
  });

  it('are left out when a pseudocode run gets its input typed (replayed without SharedArrayBuffer)', async () => {
    const rt = await load();
    const handle = rt.startRun(pseudocode, `${DOUBLER}${DOUBLER}`, { interactive: true, onInputRequest: () => handle.provideInput('5') });
    expect(await handle.done).toMatchObject({ status: 'ok', stdout: 'Enter a number: 10\nEnter a number: 10\n', promptlessStdout: '10\n10\n' });
  });

  it('are left out when the output also comes through the output tail', async () => {
    const rt = await load(true);
    const outcome = await rt.startRun(pseudocode, `${DOUBLER}${DOUBLER}`, { stdin: ['1', '2'] }).done;
    expect(outcome).toMatchObject({ stdout: 'Enter a number: 2\nEnter a number: 4\n', promptlessStdout: '2\n4\n' });
  });

  it("are left out of JavaScript output, prompt() at the end of the input included", async () => {
    const rt = await load();
    const code = 'let line;\nwhile ((line = prompt("Next:")) !== null) console.log(line.toUpperCase());\nconsole.log("done");';
    const outcome = await rt.startRun({ kind: 'javascript' }, code, { stdin: ['a', 'b'] }).done;
    expect(outcome).toMatchObject({ status: 'ok', stdout: 'Next:A\nNext:B\nNext:done\n', promptlessStdout: 'A\nB\ndone\n' });
  });

  it('are left out of Python and Lua output', async () => {
    const rt = await load();
    expect(await rt.startRun({ kind: 'python' }, 'greet', { stdin: ['Sam'] }).done).toMatchObject({
      stdout: 'Name: Hi Sam\n',
      promptlessStdout: 'Hi Sam\n',
    });
    expect(await rt.startRun({ kind: 'lua' }, 'ages', { stdin: ['14'] }).done).toMatchObject({
      stdout: 'Ages\nAge? Next year: 15\n',
      promptlessStdout: 'Ages\nNext year: 15\n',
    });
  });

  it('are only what the input call printed: output printed before a later read on the same line stays', async () => {
    const rt = await load();
    for (const [kind, code] of [
      ['python', 'doubles'],
      ['lua', 'doubles'],
      ['javascript', 'for (let i = 0; i < 3; i++) { const n = Number(input()); process.stdout.write(n * 2 + " "); }\nconsole.log();'],
      ['javascript', 'let line;\nwhile ((line = prompt()) !== null) process.stdout.write(String(Number(line) * 2) + " ");\nconsole.log();'],
    ] as const) {
      const outcome = await rt.startRun({ kind }, code, { stdin: ['1', '2', '3'] }).done;
      expect(outcome, `${kind}: ${code}`).toMatchObject({ status: 'ok', stdout: '2 4 6 \n', promptlessStdout: '2 4 6 \n' });
    }
    const greeting = 'const name = prompt("Name: ");\nprocess.stdout.write("Hello " + name + "! ");\nconst age = prompt("Age: ");\nconsole.log(age);';
    expect(await rt.startRun({ kind: 'javascript' }, greeting, { stdin: ['Sam', '12'] }).done).toMatchObject({
      stdout: 'Name: Hello Sam! Age: 12\n',
      promptlessStdout: 'Hello Sam! 12\n',
    });
  });

  it('stay in the output when printed on a line of their own', async () => {
    const rt = await load();
    const cambridge = { kind: 'pseudocode' as const, pseudocode: createPseudocodeConfig('cambridge') };
    expect(await rt.startRun(cambridge, 'OUTPUT "Enter a number"\nINPUT n\nOUTPUT n * 2\n', { stdin: ['4'] }).done).toMatchObject({
      stdout: 'Enter a number\n8\n',
      promptlessStdout: 'Enter a number\n8\n',
    });
    expect(await rt.startRun({ kind: 'python' }, 'ownLine', { stdin: ['4'] }).done).toMatchObject({ promptlessStdout: 'Enter a number:\n8\n' });
    // A prompt that ends with a line break is still the input call's own.
    expect(await rt.startRun({ kind: 'python' }, 'promptLine', { stdin: ['4'] }).done).toMatchObject({
      stdout: 'Enter a number:\n8\n',
      promptlessStdout: '8\n',
    });
  });

  it('are left out of JavaScript readline questions and prompts', async () => {
    const rt = await load();
    const question = 'const rl = require("readline").createInterface({});\nrl.question("Name? ", (name) => { console.log("Hi " + name); rl.close(); });';
    expect(await rt.startRun({ kind: 'javascript' }, question, { stdin: ['Sam'] }).done).toMatchObject({
      stdout: 'Name? Hi Sam\n',
      promptlessStdout: 'Hi Sam\n',
    });
    const lines =
      'const rl = require("readline").createInterface({});\nrl.setPrompt("> ");\nrl.prompt();\nrl.on("line", (line) => { console.log(line.toUpperCase()); rl.prompt(); });';
    expect(await rt.startRun({ kind: 'javascript' }, lines, { stdin: ['a', 'b'] }).done).toMatchObject({
      stdout: '> A\n> B\n> ',
      promptlessStdout: 'A\nB\n',
    });
  });

  it("don't let filled expected outputs lose output, so wrong work fails", async () => {
    const rt = await load();
    const { expectedFromOutput } = await import('../pages/assignments/editorForm');
    const solution = 'for (let i = 0; i < 3; i++) { const n = Number(input()); process.stdout.write(n * 2 + " "); }\nconsole.log();';
    const outcome = await rt.startRun({ kind: 'javascript' }, solution, { stdin: ['1', '2', '3'] }).done;
    const wrong = 'let n;\nfor (let i = 0; i < 3; i++) n = Number(input());\nconsole.log(n * 2);';
    for (const mode of ['exact', 'trim', 'ignore-whitespace'] as const) {
      const expected = expectedFromOutput(outcome.promptlessStdout, mode);
      expect(expected, mode).toContain('2 4 6');
      const [wrongResult] = await rt.runTests({ kind: 'javascript' }, wrong, [test('t', '1\n2\n3', expected)], { compareMode: mode });
      expect(wrongResult!.passed, mode).toBe(false);
      const [rightResult] = await rt.runTests({ kind: 'javascript' }, solution, [test('t', '1\n2\n3', expected)], { compareMode: mode });
      expect(rightResult!.passed, mode).toBe(true);
    }
  });

  it('may be left out of expected outputs or kept in them', async () => {
    const rt = await load();
    const tests = [test('bare', '4', '8'), test('prompted', '4', 'Enter a number: 8'), test('wrong', '4', '9'), test('half', '4', 'Enter: 8')];
    const results = await rt.runTests(pseudocode, DOUBLER, tests, { compareMode: 'ignore-whitespace' });
    expect(results.map((r) => [r.testId, r.passed, r.actualOutput])).toEqual([
      ['bare', true, 'Enter a number: 8\n'],
      ['prompted', true, 'Enter a number: 8\n'],
      ['wrong', false, 'Enter a number: 8\n'],
      ['half', false, 'Enter a number: 8\n'],
    ]);
  });
});
