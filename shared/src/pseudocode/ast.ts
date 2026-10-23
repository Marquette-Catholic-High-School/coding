// Syntax tree produced by the parser. Every node carries a 1-based source position (see `Pos`).
import type { Pos } from './errors';
import type { PseudoBuiltin } from './types';

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '^' | 'div' | 'mod' | '&'
  | '=' | '!=' | '<' | '>' | '<=' | '>='
  | 'and' | 'or';

export interface NumberLit extends Pos { k: 'num'; value: number }
export interface StringLit extends Pos { k: 'str'; value: string }
export interface BoolLit extends Pos { k: 'bool'; value: boolean }
export interface VarRef extends Pos { k: 'var'; name: string }
export interface ListLit extends Pos { k: 'list'; items: Expr[] }
export interface IndexExpr extends Pos { k: 'index'; target: Expr; index: Expr }
export interface InputExpr extends Pos { k: 'input'; prompt: Expr | null }
export interface UnaryExpr extends Pos { k: 'neg' | 'not'; operand: Expr; opText: string }
export interface BinaryExpr extends Pos {
  k: 'bin';
  op: BinaryOp;
  /** Operator as typed (for messages) and its position. */
  opText: string;
  opPos: Pos;
  left: Expr;
  right: Expr;
}
export interface CallExpr extends Pos {
  k: 'call';
  name: string;
  args: Expr[];
  /** Filled in by the resolver: the user function, or the built-in. */
  fn: FuncDef | null;
  builtin: PseudoBuiltin | null;
}

/** `ARRAY[1:5] OF INTEGER` in a DECLARE: a list per bound pair (nested for 2-D), filled with the type's default. */
export interface NewArrayExpr extends Pos {
  k: 'newArray';
  bounds: Array<{ low: Expr; high: Expr }>;
  fill: number | string | boolean;
}

export type Expr =
  | NumberLit | StringLit | BoolLit | VarRef | ListLit | IndexExpr | InputExpr | UnaryExpr | BinaryExpr | CallExpr | NewArrayExpr;

/** Something a value can be stored in. */
export type Target = VarRef | IndexExpr;

export interface OutputStmt extends Pos { k: 'output'; values: Expr[] }
/** `INPUT x` (targets) or a bare `INPUT()` whose answer is thrown away (no targets). */
export interface InputStmt extends Pos { k: 'inputStmt'; prompt: Expr | null; targets: Target[] }
export interface AssignStmt extends Pos { k: 'assign'; target: Target; value: Expr }
export interface IfStmt extends Pos {
  k: 'if';
  branches: Array<{ cond: Expr; body: Stmt[] }>;
  elseBody: Stmt[] | null;
}
export interface WhileStmt extends Pos { k: 'while'; cond: Expr; body: Stmt[] }
/** REPEAT … UNTIL cond (checks after each pass). */
export interface RepeatUntilStmt extends Pos { k: 'repeatUntil'; body: Stmt[]; cond: Expr }
/** REPEAT UNTIL cond … END REPEAT (checks before each pass, AP CSP). */
export interface RepeatUntilFirstStmt extends Pos { k: 'repeatUntilFirst'; cond: Expr; body: Stmt[] }
export interface RepeatTimesStmt extends Pos { k: 'repeatTimes'; count: Expr; body: Stmt[] }
export interface ForStmt extends Pos { k: 'for'; name: string; from: Expr; to: Expr; step: Expr | null; body: Stmt[] }
export interface ForEachStmt extends Pos { k: 'forEach'; name: string; list: Expr; body: Stmt[] }
export interface ReturnStmt extends Pos { k: 'return'; value: Expr | null }
export interface CallStmt extends Pos { k: 'call'; call: CallExpr }

export type Stmt =
  | OutputStmt | InputStmt | AssignStmt | IfStmt | WhileStmt | RepeatUntilStmt | RepeatUntilFirstStmt | RepeatTimesStmt
  | ForStmt | ForEachStmt | ReturnStmt | CallStmt;

export interface FuncDef extends Pos {
  name: string;
  params: string[];
  /** Per parameter: BYREF (the caller's variable gets the final value back when the call ends). */
  byRef: boolean[];
  body: Stmt[];
  isProcedure: boolean;
  /** True when the body contains `RETURN value` somewhere. */
  returnsValue: boolean;
}

export interface Program {
  body: Stmt[];
  /** Every FUNCTION / PROCEDURE, hoisted (callable before its definition). */
  functions: Map<string, FuncDef>;
}
