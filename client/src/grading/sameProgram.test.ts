import { describe, expect, it } from 'vitest';
import type { CompareMode, LanguageKind } from '@codeclass/shared';
import { createPseudocodeConfig } from '@codeclass/shared/pseudocode';
import { programFingerprint, pythonIndentationValid, sameProgram } from './sameProgram';

const MODES: CompareMode[] = ['exact', 'trim', 'ignore-whitespace', 'ignore-case'];
const rank = (mode: CompareMode) => MODES.indexOf(mode);

interface Pair {
  kind: LanguageKind;
  name: string;
  solution: string;
  student: string;
}

const JS_SOL = 'const n = Number(input());\nfor (let i = 0; i < n; i++) {\n  console.log(i * 2);\n}\n';
const PY_SOL = 'n = int(input())\nfor i in range(n):\n    if i % 2 == 0:\n        print(i, "is even")\nprint("done")\n';
const PAGE = '<!doctype html>\n<html>\n  <body>\n    <h1>My Page</h1>\n    <p>Welcome!</p>\n  </body>\n</html>\n';

// The same program typed differently: the same in every compare mode.
const SAME: Pair[] = [
  // JavaScript / TypeScript
  { kind: 'javascript', name: 'spacing inside lines', solution: JS_SOL, student: 'const n=Number(input());\nfor(let i=0;i<n;i++){\n  console.log(i*2);\n}\n' },
  { kind: 'javascript', name: 'tab indent', solution: JS_SOL, student: JS_SOL.replace(/ {2}/g, '\t') },
  { kind: 'javascript', name: 'no semicolons', solution: JS_SOL, student: JS_SOL.replace(/;\n/g, '\n') },
  { kind: 'javascript', name: "'single' vs \"double\" quotes", solution: 'console.log("Hello");\n', student: "console.log('Hello');\n" },
  { kind: 'javascript', name: 'comments', solution: JS_SOL, student: `// my answer\n${JS_SOL.replace('{\n', '{ /* loop */\n')}` },
  { kind: 'javascript', name: 'brace on its own line', solution: JS_SOL, student: JS_SOL.replace(') {\n', ')\n{\n') },
  { kind: 'javascript', name: 'for ( ; ; ) header spacing', solution: 'for (let i = 0; i < 3; i++) console.log(i);\n', student: 'for(let i=0;i<3;i++)console.log(i)\n' },
  {
    kind: 'javascript',
    name: 'starter code reformatted',
    solution: 'const name = input("What is your name? ");\nconsole.log(`Hello, ${name}!`);\n',
    student: 'const name = input("What is your name? ")\n\nconsole.log(`Hello, ${ name }!`)\n',
  },
  { kind: 'javascript', name: 'CRLF line ends and blank lines', solution: JS_SOL, student: `\n${JS_SOL.replace(/\n/g, '\r\n\r\n')}` },
  { kind: 'typescript', name: 'spacing and semicolons', solution: 'const n: number = Number(input());\nconsole.log(n * 2);\n', student: 'const n:number=Number(input())\nconsole.log(n*2)\n' },
  // Python
  {
    kind: 'python',
    name: 'spacing inside lines',
    solution: PY_SOL,
    student: 'n=int(input())\nfor i in range(n):\n    if i%2==0:\n        print(i,"is even")\nprint("done")\n',
  },
  { kind: 'python', name: '2-space indent instead of 4', solution: PY_SOL, student: PY_SOL.replace(/ {4}/g, '  ') },
  { kind: 'python', name: 'tab indent', solution: PY_SOL, student: PY_SOL.replace(/ {4}/g, '\t') },
  { kind: 'python', name: 'comments and blank lines', solution: PY_SOL, student: `# my answer\n\n${PY_SOL.replace('print("done")', 'print("done")  # finished')}` },
  { kind: 'python', name: "'single' vs \"double\" quotes", solution: 'print("Hello")\n', student: "print('Hello')\n" },
  { kind: 'python', name: 'print (x) vs print(x)', solution: 'x = 1\nprint(x)\n', student: 'x = 1\nprint (x)\n' },
  { kind: 'python', name: 'continuation line inside brackets', solution: 'x = [1,\n     2]\nprint(x)\n', student: 'x = [1,\n  2]\nprint(x)\n' },
  {
    kind: 'python',
    name: 'n*2 and quotes in the starter program',
    solution: 'n = int(input("Enter a number: "))\nprint("Double:", n * 2)\n',
    student: "n = int(input('Enter a number: '))\nprint('Double:', n*2)\n",
  },
  { kind: 'python', name: 'f-string expression spacing', solution: 'x = 2\nprint(f"Total: {x * 2}")\n', student: 'x = 2\nprint(f"Total: {x*2}")\n' },
  {
    kind: 'python',
    name: 'a comment line indented differently',
    solution: 'for i in range(2):\n    y = i\n    print(y)\n',
    student: 'for i in range(2):\n    y = i\n  # show it\n    print(y)\n',
  },
  { kind: 'python', name: 'a line continued with a backslash', solution: 'total = 1 + \\\n    2\nprint(total)\n', student: 'total = 1 + \\\n2\nprint(total)\n' },
  { kind: 'python', name: 'a triple-quoted string over several lines', solution: 'if True:\n    s = """a\nb"""\n    print(s)\n', student: 'if True:\n  s = """a\nb"""\n  print(s)\n' },
  // Lua
  { kind: 'lua', name: 'spacing around ..', solution: 'local name = io.read()\nprint("Hello, " .. name)\n', student: 'local name=io.read()\nprint("Hello, "..name)\n' },
  { kind: 'lua', name: 'spacing around - and .', solution: 'local x = 5\nprint(x - 1, math.floor(x / 2))\n', student: 'local x=5\nprint(x-1,math . floor(x/2))\n' },
  { kind: 'lua', name: 'indentation and comments', solution: 'for i = 1, 3 do\n  print(i)\nend\n', student: '-- loop\nfor i = 1, 3 do\n\tprint(i) -- show it\nend\n' },
  { kind: 'lua', name: 'multi-line comment', solution: 'print(1)\n', student: '--[[ my\nanswer ]]\nprint(1)\n' },
  { kind: 'lua', name: "'single' vs \"double\" quotes", solution: 'print("Hi")\n', student: "print('Hi')\n" },
  { kind: 'lua', name: '; at line ends', solution: 'local a = 1\nprint(a)\n', student: 'local a = 1;\nprint(a);\n' },
  // SQL
  { kind: 'sql', name: 'keyword case', solution: 'SELECT name FROM pets WHERE age > 2;\n', student: 'select name from pets where age > 2;\n' },
  { kind: 'sql', name: 'one line vs several, indented', solution: 'SELECT name, age\nFROM pets\nWHERE age > 2\nORDER BY age;\n', student: 'SELECT name,age FROM pets\n  WHERE age>2 ORDER BY age;\n' },
  { kind: 'sql', name: 'final semicolon left off', solution: 'SELECT name FROM pets;\n', student: 'SELECT name FROM pets\n' },
  { kind: 'sql', name: 'final semicolon before a comment', solution: 'SELECT name FROM pets\n', student: 'SELECT name FROM pets; -- done\n' },
  { kind: 'sql', name: 'comment', solution: 'SELECT name FROM pets;\n', student: '-- list names\nSELECT name FROM pets;\n' },
  { kind: 'sql', name: 'spacing inside an expression', solution: 'SELECT age * 2 FROM pets;\n', student: 'SELECT age*2 FROM pets;\n' },
  // Web
  { kind: 'web', name: 'indentation removed', solution: PAGE, student: PAGE.replace(/^ +/gm, '') },
  { kind: 'web', name: 'attribute spacing and quote style', solution: '<p class="a">Hi</p>\n', student: "<p class = 'a'>Hi</p>\n" },
  { kind: 'web', name: 'unquoted attribute value', solution: '<p class="a">Hi</p>\n', student: '<p class=a>Hi</p>\n' },
  { kind: 'web', name: 'tag name case', solution: '<p>Hi</p>\n', student: '<P>Hi</P>\n' },
  { kind: 'web', name: 'doctype case, no newline at the end', solution: PAGE, student: PAGE.replace('<!doctype html>', '<!DOCTYPE  html>').trimEnd() },
  { kind: 'web', name: 'CSS spacing in <style>', solution: '<style>\n  h1 { color: red; }\n</style>\n<h1>Hi</h1>\n', student: '<style>\nh1{color:red;}\n</style>\n<h1>Hi</h1>\n' },
  { kind: 'web', name: 'JS spacing in <script>', solution: '<script>\n  console.log(1 + 2);\n</script>\n', student: '<script>\nconsole.log(1+2)\n</script>\n' },
  { kind: 'web', name: 'HTML comment left in', solution: '<p>Hi</p>\n', student: '<!-- my page -->\n<p>Hi</p>\n' },
  { kind: 'web', name: 'text wrapped onto two lines', solution: '<p>Hello there</p>\n', student: '<p>Hello\n   there</p>\n' },
  { kind: 'web', name: 'line breaks between block elements', solution: '<body>\n<h1>Hi</h1>\n</body>\n', student: '<body><h1>Hi</h1></body>\n' },
  { kind: 'web', name: 'the whole page on one line', solution: PAGE, student: '<!doctype html><html><body><h1>My Page</h1><p>Welcome!</p></body></html>' },
  { kind: 'web', name: 'a list on one line', solution: '<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n', student: '<ul><li>a</li><li>b</li></ul>' },
  { kind: 'web', name: 'spaces at the start and end of a paragraph', solution: '<p>Hello there</p>\n', student: '<p>\n  Hello there\n</p>\n' },
  { kind: 'web', name: 'a line break after <br>', solution: '<p>a<br>b</p>\n', student: '<p>a<br>\n  b</p>\n' },
  { kind: 'web', name: 'spaces next to a comment between blocks', solution: '<p>a</p><p>b</p>\n', student: '<p>a</p>\n<!-- next -->\n<p>b</p>\n' },
];

// Programs that look alike but aren't the same. `from` is the first compare mode in which they do count as the same
// (only the text inside quotes, or HTML text, differs, and that mode ignores the difference); without it, never.
const DIFFERENT: Array<Pair & { from?: CompareMode }> = [
  // JavaScript
  { kind: 'javascript', name: 'spaces inside a string', solution: 'console.log("a b");\n', student: 'console.log("a  b");\n', from: 'ignore-whitespace' },
  { kind: 'javascript', name: 'capitals inside a string', solution: 'console.log("Hello");\n', student: 'console.log("hello");\n', from: 'ignore-case' },
  { kind: 'javascript', name: 'spaces inside a template literal', solution: 'console.log(`a ${1} b`);\n', student: 'console.log(`a  ${1} b`);\n', from: 'ignore-whitespace' },
  { kind: 'javascript', name: 'blank line inside a template literal', solution: 'console.log(`a\nb`);\n', student: 'console.log(`a\n\nb`);\n', from: 'ignore-whitespace' },
  {
    kind: 'javascript',
    name: 'text of a template literal',
    solution: 'const name = "x";\nconsole.log(`Hello, ${name}!`);\n',
    student: 'const name = "x";\nconsole.log(`Bye, ${name}!`);\n',
  },
  { kind: 'javascript', name: 'a - -b vs a--b', solution: 'let a = 1, b = 2;\nconsole.log(a - -b);\n', student: 'let a = 1, b = 2;\nconsole.log(a--b);\n' },
  { kind: 'javascript', name: 'y + +z vs y++z', solution: 'let y = 1, z = 2;\nconsole.log(y + +z);\n', student: 'let y = 1, z = 2;\nconsole.log(y++z);\n' },
  { kind: 'javascript', name: 'let vs const', solution: 'const n = 5;\nconsole.log(n);\n', student: 'let n = 5;\nconsole.log(n);\n' },
  {
    kind: 'javascript',
    name: 'a missing ; changes the meaning (line starting with "(")',
    solution: 'const a = 1\nconst b = a;\n(function () { console.log(b) })()\n',
    student: 'const a = 1\nconst b = a\n(function () { console.log(b) })()\n',
  },
  {
    kind: 'javascript',
    name: 'return on its own line returns nothing',
    solution: 'function f(x) {\n  return x;\n}\nconsole.log(f(1));\n',
    student: 'function f(x) {\n  return\n  x;\n}\nconsole.log(f(1));\n',
  },
  { kind: 'javascript', name: 'an empty if body', solution: 'if (x) foo();\n', student: 'if (x); foo();\n' },
  { kind: 'javascript', name: 'spacing in a regular expression', solution: 'console.log(/a b/.test("a b"));\n', student: 'console.log(/a  b/.test("a b"));\n' },
  { kind: 'javascript', name: 'escaped quote vs other quotes (kept apart)', solution: 'console.log("a\\"b");\n', student: "console.log('a\"b');\n" },
  { kind: 'javascript', name: 'code commented out', solution: 'console.log(1);\nconsole.log(2);\n', student: 'console.log(1);\n// console.log(2);\n' },
  { kind: 'javascript', name: 'split(" ") vs split("")', solution: 'console.log("a b".split(" ").length);\n', student: 'console.log("a b".split("").length);\n' },
  // Text that isn't printed as it is counts as typed in every mode: it changes what the program does.
  { kind: 'javascript', name: 'capitals in a comparison', solution: 'if (input() === "Yes") console.log("ok");\n', student: 'if (input() === "yes") console.log("ok");\n' },
  { kind: 'javascript', name: 'spaces in a property name', solution: 'const o = { "first name": 1 };\nconsole.log(o["first name"]);\n', student: 'const o = { "first name": 1 };\nconsole.log(o["firstname"]);\n' },
  { kind: 'javascript', name: 'a string compared inside console.log', solution: 'const x = input();\nconsole.log(x === "a b");\n', student: 'const x = input();\nconsole.log(x === "a  b");\n' },
  { kind: 'javascript', name: 'the length of a string inside console.log', solution: 'console.log("a b".length);\n', student: 'console.log("ab".length);\n' },
  { kind: 'javascript', name: 'a %-directive in console.log', solution: 'console.log("%s items", 3);\n', student: 'console.log("% s items", 3);\n' },
  { kind: 'javascript', name: 'printed text joined with +', solution: 'const t = 8;\nconsole.log("Total: " + t);\n', student: 'const t = 8;\nconsole.log("Total:" + t);\n', from: 'ignore-whitespace' },
  { kind: 'javascript', name: 'prompt text', solution: 'const n = prompt("Name: ");\n', student: 'const n = prompt("Name:");\n', from: 'ignore-whitespace' },
  { kind: 'javascript', name: '=> on a line of its own (a syntax error)', solution: 'const f = () => 1;\nconsole.log(f());\n', student: 'const f = ()\n=> 1;\nconsole.log(f());\n' },
  { kind: 'typescript', name: 'another type', solution: 'const n: number = 1;\n', student: 'const n: string = 1;\n' },
  // Python
  { kind: 'python', name: 'last line moved into the loop (indentation is meaning)', solution: PY_SOL, student: PY_SOL.replace('print("done")', '    print("done")') },
  {
    kind: 'python',
    name: 'else attached to the for instead of the if',
    solution: 'for i in range(2):\n    if i:\n        print(i)\n    else:\n        print("no")\n',
    student: 'for i in range(2):\n    if i:\n        print(i)\nelse:\n    print("no")\n',
  },
  { kind: 'python', name: 'f-string text', solution: 'name = "x"\nprint(f"Hello, {name}!")\n', student: 'name = "x"\nprint(f"Bye, {name}!")\n' },
  { kind: 'python', name: 'f-string spacing', solution: 'name = "x"\nprint(f"Hello, {name}!")\n', student: 'name = "x"\nprint(f"Hello,  {name}!")\n', from: 'ignore-whitespace' },
  { kind: 'python', name: 'f-string format spec', solution: 'x = 1\nprint(f"{x:>4}")\n', student: 'x = 1\nprint(f"{x:>8}")\n' },
  { kind: 'python', name: 'blank line inside a triple-quoted string', solution: 'print("""a\nb""")\n', student: 'print("""a\n\nb""")\n', from: 'ignore-whitespace' },
  { kind: 'python', name: 'trailing spaces inside a triple-quoted string', solution: 'print("""a\nb""")\n', student: 'print("""a   \nb""")\n', from: 'ignore-whitespace' },
  { kind: 'python', name: 'capitals inside a string', solution: 'print("Done")\n', student: 'print("done")\n', from: 'ignore-case' },
  { kind: 'python', name: 'not x vs notx', solution: 'x = False\nprint(not x)\n', student: 'x = False\nnotx = 1\nprint(notx)\n' },
  { kind: 'python', name: 'r"" vs ""', solution: 'print(r"a\\nb")\n', student: 'print("a\\nb")\n' },
  { kind: 'python', name: '" ".join vs "".join', solution: 'print(" ".join(["a", "b"]))\n', student: 'print("".join(["a", "b"]))\n' },
  { kind: 'python', name: 'precedence', solution: 'print((1 + 2) * 3)\n', student: 'print(1 + 2 * 3)\n' },
  { kind: 'python', name: 'spaces in a comparison', solution: 'city = input()\nif city == "New York":\n    print("Big Apple")\n', student: 'city = input()\nif city == "NewYork":\n    print("Big Apple")\n' },
  { kind: 'python', name: 'len() of text inside print', solution: 'print(len("a b"))\n', student: 'print(len("ab"))\n' },
  { kind: 'python', name: 'a split() separator', solution: 'print("1,2".split(", "))\n', student: 'print("1,2".split(","))\n' },
  { kind: 'python', name: 'a dictionary key', solution: 'd = {"first name": 1}\nprint(d["first name"])\n', student: 'd = {"first name": 1}\nprint(d["firstname"])\n' },
  { kind: 'python', name: 'text stored before it is printed', solution: 's = "a b"\nprint(s)\n', student: 's = "a  b"\nprint(s)\n' },
  { kind: 'python', name: 'printed text joined with +', solution: 'n = 2\nprint("Total: " + str(n))\n', student: 'n = 2\nprint("Total:" + str(n))\n', from: 'ignore-whitespace' },
  { kind: 'python', name: "print()'s sep", solution: 'print(1, 2, sep=", ")\n', student: 'print(1, 2, sep=",")\n', from: 'ignore-whitespace' },
  { kind: 'python', name: 'an input() prompt', solution: 'n = input("Name: ")\n', student: 'n = input("Name:")\n', from: 'ignore-whitespace' },
  // Indentation Python refuses, though the parser takes it: the student's program crashes.
  { kind: 'python', name: 'unexpected indent', solution: 'name = input()\nprint("Hi", name)\n', student: 'name = input()\n    print("Hi", name)\n' },
  { kind: 'python', name: 'a space before the first line', solution: 'name = input()\nprint("Hi", name)\n', student: ' name = input()\nprint("Hi", name)\n' },
  {
    kind: 'python',
    name: 'a dedent to no enclosing level',
    solution: 'total = 0\nfor i in range(3):\n    total += i\nprint(total)\n',
    student: 'total = 0\nfor i in range(3):\n    total += i\n   print(total)\n',
  },
  {
    kind: 'python',
    name: 'a tab and then 8 spaces in one block (TabError)',
    solution: 'for i in range(3):\n    x = i\n    print(x)\n',
    student: 'for i in range(3):\n\tx = i\n        print(x)\n',
  },
  // Lua
  { kind: 'lua', name: 'a - -b vs a--b (-- starts a comment)', solution: 'local a, b = 1, 2\nprint(a - -b)\n', student: 'local a, b = 1, 2\nprint(a--b)\n' },
  { kind: 'lua', name: 'spaces in a string', solution: 'print("a b")\n', student: 'print("a  b")\n', from: 'ignore-whitespace' },
  { kind: 'lua', name: 'blank line inside a long string', solution: 'print([[a\nb]])\n', student: 'print([[a\n\nb]])\n', from: 'ignore-whitespace' },
  { kind: 'lua', name: 'spaces inside a long string with = signs', solution: 'print([==[a b]==])\n', student: 'print([==[a  b]==])\n', from: 'ignore-whitespace' },
  { kind: 'lua', name: 'statement moved out of the loop', solution: 'for i = 1, 3 do\n  print(i)\n  print("x")\nend\n', student: 'for i = 1, 3 do\n  print(i)\nend\nprint("x")\n' },
  { kind: 'lua', name: 'a ; before ( keeps two statements apart', solution: 'local f = print;\n(f)("x")\n', student: 'local f = print\n(f)("x")\n' },
  { kind: 'lua', name: 'text in a comparison', solution: 'local a = io.read()\nif a == "yes please" then print("ok") end\n', student: 'local a = io.read()\nif a == "yesplease" then print("ok") end\n' },
  { kind: 'lua', name: 'text compared inside print', solution: 'local x = io.read()\nprint("a b" == x)\n', student: 'local x = io.read()\nprint("a  b" == x)\n' },
  { kind: 'lua', name: 'the length of text inside print', solution: 'print(#"a b")\n', student: 'print(#"ab")\n' },
  { kind: 'lua', name: 'a table key', solution: 'local t = { ["a b"] = 1 }\nprint(t["a b"])\n', student: 'local t = { ["a b"] = 1 }\nprint(t["ab"])\n' },
  { kind: 'lua', name: 'printed text joined with ..', solution: 'local t = 8\nprint("Total: " .. t)\n', student: 'local t = 8\nprint("Total:" .. t)\n', from: 'ignore-whitespace' },
  { kind: 'lua', name: 'io.write text', solution: 'io.write("Name: ")\n', student: 'io.write("name:")\n', from: 'ignore-case' },
  { kind: 'lua', name: 'print "text" without brackets', solution: 'print "a b"\n', student: 'print "ab"\n', from: 'ignore-whitespace' },
  // SQL
  // SQL text is data and conditions, never just printed: it counts as typed.
  { kind: 'sql', name: 'string case', solution: "SELECT * FROM pets WHERE kind = 'dog';\n", student: "SELECT * FROM pets WHERE kind = 'Dog';\n" },
  { kind: 'sql', name: 'spaces in a LIKE pattern', solution: "SELECT * FROM pets WHERE name LIKE 'a b%';\n", student: "SELECT * FROM pets WHERE name LIKE 'ab%';\n" },
  { kind: 'sql', name: "'x' (text) vs \"x\" (a column)", solution: "SELECT 'name' FROM pets;\n", student: 'SELECT "name" FROM pets;\n' },
  { kind: 'sql', name: 'another column', solution: 'SELECT name FROM pets;\n', student: 'SELECT age FROM pets;\n' },
  { kind: 'sql', name: 'a ; between statements', solution: 'SELECT 1;\nSELECT 2;\n', student: 'SELECT 1\nSELECT 2;\n' },
  // Web: the page's text counts as a browser shows it, in every compare mode.
  { kind: 'web', name: 'text', solution: '<p>Hi</p>\n', student: '<p>Hello</p>\n' },
  { kind: 'web', name: 'text case', solution: '<p>Hi</p>\n', student: '<p>HI</p>\n' },
  { kind: 'web', name: 'spaces between words', solution: '<h1>Welcome to my page</h1>\n', student: '<h1>Welcometomypage</h1>\n' },
  { kind: 'web', name: 'space between inline elements (shows "a b" vs "ab")', solution: '<b>a</b> <i>b</i>\n', student: '<b>a</b><i>b</i>\n' },
  { kind: 'web', name: 'space inside a paragraph next to an inline element', solution: '<p>Total: <b>8</b></p>\n', student: '<p>Total:<b>8</b></p>\n' },
  { kind: 'web', name: '<pre> spacing', solution: '<pre>a  b</pre>\n', student: '<pre>a b</pre>\n' },
  { kind: 'web', name: 'spacing on a page that sets white-space', solution: '<p style="white-space: pre">a  b</p>\n', student: '<p style="white-space: pre">a b</p>\n' },
  { kind: 'web', name: 'CSS value', solution: '<style>h1 { color: red; }</style>\n', student: '<style>h1 { color: blue; }</style>\n' },
  { kind: 'web', name: 'a font name in CSS', solution: '<style>p { font-family: "Times New Roman"; }</style>\n', student: '<style>p { font-family: "TimesNewRoman"; }</style>\n' },
  { kind: 'web', name: 'JS string in <script>', solution: '<script>alert("a b")</script>\n', student: '<script>alert("a  b")</script>\n' },
  { kind: 'web', name: 'attribute value', solution: '<p class="a">Hi</p>\n', student: '<p class="A">Hi</p>\n' },
  { kind: 'web', name: 'element moved out of another', solution: '<div><p>Hi</p></div>\n', student: '<div></div><p>Hi</p>\n' },
];

describe('sameProgram: structure', () => {
  for (const p of SAME) {
    it(`same program [${p.kind}]: ${p.name}`, async () => {
      for (const mode of MODES) expect(await sameProgram({ kind: p.kind }, p.student, p.solution, mode), mode).toBe(true);
    });
  }

  for (const p of DIFFERENT) {
    it(`not the same [${p.kind}]: ${p.name}`, async () => {
      for (const mode of MODES) {
        const same = p.from !== undefined && rank(mode) >= rank(p.from);
        expect(await sameProgram({ kind: p.kind }, p.student, p.solution, mode), mode).toBe(same);
      }
    });
  }

  it('uses the pseudocode engine with the language config', async () => {
    const target = { kind: 'pseudocode' as const, pseudocode: createPseudocodeConfig('classroom') };
    const solution = 'INPUT n\nIF n > 0 THEN\n  OUTPUT "Total: ", n * 2\nEND IF\n';
    const student = '// Write your program below\ninput n\nif n>0\n\toutput "Total:",n*2 // done\nendif\n';
    expect(await sameProgram(target, student, solution, 'trim')).toBe(false);
    expect(await sameProgram(target, student.replace('endif', 'end if'), solution, 'trim')).toBe(false);
    expect(await sameProgram(target, student.replace('endif', 'end if'), solution, 'ignore-whitespace')).toBe(true);
    expect(await sameProgram(target, student.replace('endif', 'end if').replace('"Total:"', '"Total: "'), solution, 'trim')).toBe(true);
    expect(await sameProgram(target, 'INPUT n\nOUTPUT n * 2\n', solution, 'ignore-case')).toBe(false);
  });
});

describe('programFingerprint', () => {
  it.each<[LanguageKind, string]>([
    ['javascript', 'console.log("hi"'],
    ['javascript', 'let x = ;'],
    ['typescript', 'const x: = 1;'],
    ['python', 'if x\n  print(1)\n'],
    ['web', '<p class="a>x</p>'],
    ['web', '<script>let x = ;</script>'],
    ['sql', 'SELECT * FROM pets WHERE (age > 2'],
    ['lua', 'print("hi)\n'],
    ['lua', 'print([[hi)\n'],
    ['lua', 'x = 1 ! 2\n'],
  ])('is null on a syntax error [%s] %j', async (kind, code) => {
    expect(await programFingerprint({ kind }, code, 'trim')).toBeNull();
  });

  it('is null for pseudocode without its config, or that does not parse', async () => {
    expect(await programFingerprint({ kind: 'pseudocode' }, 'OUTPUT 1\n', 'trim')).toBeNull();
    expect(await programFingerprint({ kind: 'pseudocode', pseudocode: createPseudocodeConfig('classroom') }, 'OUTPUT (1\n', 'trim')).toBeNull();
  });
});

// Checked against CPython 3 (compile()): which indentation Python accepts.
describe('pythonIndentationValid', () => {
  it.each([
    'name = input()\nprint(name)\n',
    'if x:\n    y = 1\nelse:\n    y = 2\n',
    'if x:\n\ty = 1\n\tif y:\n\t\tz = 2\nw = 3\n',
    'def f(a,\n        b):\n    return a + b\n',
    'x = [1,\n2,\n     3]\n',
    's = """line\n  not indented\nend"""\nprint(s)\n',
    'total = 1 + \\\n        2\n',
    'if x:  # header\n    pass\n',
    'if x:\n    pass\n  # comment\n        # comment\n    pass\n',
    'if x: pass\nprint(1)\n',
    'class A:\n    def f(self):\n        return 1\n\n    def g(self):\n        return 2\n',
    'for i in range(2):\n\tprint(i)\nfor j in range(2):\n        print(j)\n',
    "d = {'a': 1,\n     'b': 2}\n",
    "x = 'it''s'\n",
    "s = 'a\\\nb'\n",
    'print(f"{x:>4}")\n',
  ])('accepts %j', (code) => {
    expect(pythonIndentationValid(code)).toBe(true);
  });

  it.each([
    'name = input()\n    print(name)\n',
    ' x = 1\n',
    'total = 0\nfor i in range(3):\n    total += i\n   print(total)\n',
    'for i in range(3):\n\tx = i\n        print(x)\n',
    'if x:\nprint(1)\n',
    'if x:\n',
    'if x: pass\n    print(1)\n',
    "x = 'abc\nprint(x)\n",
    'if x:\n        a = 1\n    b = 2\n',
  ])('refuses %j', (code) => {
    expect(pythonIndentationValid(code)).toBe(false);
  });
});

describe('sameProgram: syntax errors and text', () => {
  it('matches nothing to a blank solution', async () => {
    for (const solution of [null, undefined, '', '  \n\n']) expect(await sameProgram({ kind: 'javascript' }, '', solution, 'trim')).toBe(false);
    expect(await sameProgram({ kind: 'python' }, '', 'print(1)\n', 'ignore-case')).toBe(false);
  });

  it('is not the same program when only one of them has a syntax error', async () => {
    expect(await sameProgram({ kind: 'javascript' }, 'console.log("hi"\n', 'console.log("hi")\n', 'ignore-case')).toBe(false);
    expect(await sameProgram({ kind: 'python' }, 'if x\n    print(1)\n', 'if x:\n    print(1)\n', 'ignore-case')).toBe(false);
    const classroom = createPseudocodeConfig('classroom');
    expect(await sameProgram({ kind: 'pseudocode', pseudocode: classroom }, 'OUTPUT "a\n', 'OUTPUT "a"\n', 'ignore-case')).toBe(false);
  });

  // When neither parses (a solution with a mistake, or syntax the parser doesn't know), the text is compared with
  // whitespace removed only where it can't matter.
  const TEXT: Array<{ target: Parameters<typeof sameProgram>[0]; name: string; solution: string; student: string; want: boolean; mode?: CompareMode }> = [
    { target: { kind: 'javascript' }, name: 'spacing and indentation', solution: 'let x = ;\nif (a) {\n  f(x, "a b");\n}\n', student: 'let x=;\n\nif(a){\n\tf( x,"a b" );   \n}\n', want: true },
    { target: { kind: 'javascript' }, name: 'spaces inside a string', solution: 'let x = ;\nf("a b");\n', student: 'let x = ;\nf("a  b");\n', want: false },
    // Whether text is printed can't be told without parsing, so it counts as typed in every mode.
    { target: { kind: 'javascript' }, name: 'spaces inside a string, ignore-whitespace', solution: 'let x = ;\nf("a b");\n', student: 'let x = ;\nf("a  b");\n', want: false, mode: 'ignore-whitespace' },
    { target: { kind: 'javascript' }, name: 'capitals inside a string, ignore-case', solution: 'let x = ;\nf("Yes");\n', student: 'let x = ;\nf("yes");\n', want: false, mode: 'ignore-case' },
    { target: { kind: 'javascript' }, name: 'a - -b vs a--b', solution: 'let x = ;\nf(a - -b);\n', student: 'let x = ;\nf(a--b);\n', want: false },
    { target: { kind: 'javascript' }, name: 'statements joined onto one line', solution: 'let x = ;\nf()\ng()\n', student: 'let x = ;\nf() g()\n', want: false },
    { target: { kind: 'javascript' }, name: 'blank line inside a template literal', solution: 'let x = ;\nf(`a\nb`);\n', student: 'let x = ;\nf(`a\n\nb`);\n', want: false },
    { target: { kind: 'javascript' }, name: 'an apostrophe in a comment', solution: "let x = ;\n// don't\nf('a b');\n", student: "let x = ;\n// don't\nf('a  b');\n", want: false },
    { target: { kind: 'python' }, name: 'spacing inside lines', solution: 'if x\n    print(x, "a b")\n', student: 'if x\n    print( x,"a b" )  \n\n', want: true },
    { target: { kind: 'python' }, name: 'indentation counts', solution: 'if x\n    print(1)\nprint(2)\n', student: 'if x\n    print(1)\n    print(2)\n', want: false },
    { target: { kind: 'python' }, name: "blank line inside ''' text", solution: "if x\n    print('''it's\nb''')\n", student: "if x\n    print('''it's\n\nb''')\n", want: false },
    { target: { kind: 'lua' }, name: 'spaces inside a long string with = signs', solution: 'print([==[a b]==]) $\n', student: 'print([==[a  b]==]) $\n', want: false },
    { target: { kind: 'sql' }, name: 'line breaks count', solution: "SELECT name FROM pets WHERE (kind = 'a b'\n", student: "SELECT name  FROM pets\nWHERE (kind='a b'\n", want: false },
    { target: { kind: 'sql' }, name: 'spaces', solution: "SELECT name FROM pets WHERE (kind = 'a b'\n", student: "SELECT  name FROM pets WHERE ( kind='a b'  \n", want: true },
    { target: { kind: 'web' }, name: 'indentation', solution: '<p class="a>\n  <b>x</b> y\n</p>\n', student: '<p class="a>\n<b>x</b>   y\n</p>\n', want: true },
    { target: { kind: 'web' }, name: 'space next to a tag shows', solution: '<p class="a>\n<b>x</b> y\n', student: '<p class="a>\n<b>x</b>y\n', want: false },
    { target: { kind: 'web' }, name: '<pre> text is compared as typed', solution: '<p class="a>\n<pre>a\n  b</pre>\n', student: '<p class="a>\n<pre>a\nb</pre>\n', want: false },
    { target: { kind: 'pseudocode' }, name: 'pseudocode without its config: spacing', solution: 'OUTPUT n * 2\n', student: '  OUTPUT n*2  \n\n', want: true },
    { target: { kind: 'pseudocode' }, name: 'pseudocode without its config: text', solution: 'OUTPUT "a b"\n', student: 'OUTPUT "a  b"\n', want: false },
    { target: { kind: 'pseudocode', pseudocode: createPseudocodeConfig('classroom') }, name: 'pseudocode that does not parse: spacing', solution: 'OUTPUT (1 + 2\n', student: 'OUTPUT(1+2   \n', want: true },
    { target: { kind: 'pseudocode', pseudocode: createPseudocodeConfig('classroom') }, name: 'pseudocode that does not parse: comments count', solution: 'OUTPUT (1 + 2\n', student: 'OUTPUT (1 + 2 // sum\n', want: false },
  ];
  for (const t of TEXT) {
    it(`${t.want ? 'same' : 'not the same'} [${t.target.kind}]: ${t.name}`, async () => {
      expect(await sameProgram(t.target, t.student, t.solution, t.mode ?? 'trim')).toBe(t.want);
    });
  }
});
