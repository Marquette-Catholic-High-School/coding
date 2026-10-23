// Lua 5.4 runner (wasmoon). A fresh Lua state per run; print, io.write, io.read, io.lines and the standard file
// handles are redefined in Lua (see HARNESS) so output and input go through the worker, with Lua's own formatting.

import glueWasmUrl from 'wasmoon/dist/glue.wasm?url';
import wasmoonSource from 'wasmoon/dist/index.js?raw';
import type { LuaFactory } from 'wasmoon';
import { evaluateCommonJs } from './commonjs';
import { describeError, failure, OK, type LangResult, type LanguageRunner } from './io';
import { luaRunError } from './luaErrors';

type Wasmoon = typeof import('wasmoon');

// Runs inside the fresh Lua state. The four __codeclass_* globals are set from JavaScript and removed first.
const HARNESS = String.raw`
local write, readline, report, source = __codeclass_write, __codeclass_readline, __codeclass_report, __codeclass_source
__codeclass_write, __codeclass_readline, __codeclass_report, __codeclass_source = nil, nil, nil, nil

local type, tostring, tonumber, select, error, ipairs = type, tostring, tonumber, select, error, ipairs
local setmetatable, getmetatable, load, xpcall = setmetatable, getmetatable, load, xpcall
local concat, unpack, pack, floor = table.concat, table.unpack, table.pack, math.floor
local mathtype, format, traceback = math.type, string.format, debug.traceback

local function writeall(stream, level, ...)
  for i = 1, select("#", ...) do
    local v = select(i, ...)
    local t = type(v)
    if t == "string" then
      write(stream, v)
    elseif t == "number" then
      write(stream, mathtype(v) == "integer" and format("%d", v) or format("%.14g", v))
    else
      error(format("bad argument #%d to 'write' (string expected, got %s)", i, t), level)
    end
  end
end

function print(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
  write(1, concat(parts, "\t") .. "\n")
end

local buffer = ""

local function fill(wait)
  local line = readline(wait)
  if line == nil then return false end
  buffer = buffer .. line .. "\n"
  return true
end

local function readline_fmt(keep_newline)
  while true do
    local i = buffer:find("\n", 1, true)
    if i then
      local s = buffer:sub(1, keep_newline and i or i - 1)
      buffer = buffer:sub(i + 1)
      return s
    end
    if not fill(true) then
      if buffer == "" then return nil end
      local s = buffer
      buffer = ""
      return s
    end
  end
end

local NUMBER_PATTERNS = {
  "^[+-]?0[xX]%x+",
  "^[+-]?%d+%.?%d*[eE][+-]?%d+",
  "^[+-]?%.%d+[eE][+-]?%d+",
  "^[+-]?%d+%.?%d*",
  "^[+-]?%.%d+",
}

local function readnumber()
  while true do
    local start = buffer:find("%S")
    if start then
      buffer = buffer:sub(start)
      break
    end
    buffer = ""
    if not fill(true) then return nil end
  end
  for _, pattern in ipairs(NUMBER_PATTERNS) do
    local text = buffer:match(pattern)
    if text then
      local value = tonumber(text)
      if value ~= nil then
        buffer = buffer:sub(#text + 1)
        return value
      end
    end
  end
  return nil
end

local function readchars(n)
  if n <= 0 then
    if buffer ~= "" or fill(true) then return "" end
    return nil
  end
  while #buffer < n do
    if not fill(true) then break end
  end
  if buffer == "" then return nil end
  local s = buffer:sub(1, n)
  buffer = buffer:sub(n + 1)
  return s
end

local function readall()
  while fill(false) do end
  local s = buffer
  buffer = ""
  return s
end

local function read(...)
  local n = select("#", ...)
  if n == 0 then return readline_fmt(false) end
  local results = {}
  for i = 1, n do
    local f = select(i, ...)
    local value
    if type(f) == "number" then
      value = readchars(floor(f))
    elseif type(f) == "string" then
      local c = f:gsub("^%*", ""):sub(1, 1)
      if c == "l" then value = readline_fmt(false)
      elseif c == "L" then value = readline_fmt(true)
      elseif c == "n" then value = readnumber()
      elseif c == "a" then value = readall()
      else error(format("bad argument #%d to 'read' (invalid format)", i), 2) end
    else
      error(format("bad argument #%d to 'read' (invalid format)", i), 2)
    end
    results[i] = value
    if value == nil then return unpack(results, 1, i) end
  end
  return unpack(results, 1, n)
end

local function lines(...)
  local formats = pack(...)
  return function()
    if formats.n == 0 then return readline_fmt(false) end
    return read(unpack(formats, 1, formats.n))
  end
end

local methods = {}
local file_mt = { __index = methods, __name = "FILE*" }
file_mt.__tostring = function(f) return format("file (%s)", f.name) end

local function newfile(name, stream)
  return setmetatable({ name = name, stream = stream }, file_mt)
end

function methods:write(...)
  if self.stream == nil then return nil, "Bad file descriptor", 9 end
  writeall(self.stream, 3, ...)
  return self
end
function methods:read(...)
  if self.stream ~= nil then return nil, "Bad file descriptor", 9 end
  return read(...)
end
function methods:lines(...) return lines(...) end
function methods:flush() return self end
function methods:setvbuf() return true end
function methods:seek() return nil, "Illegal seek", 29 end
function methods:close() return nil, "cannot close standard file" end

local stdin, stdout, stderr = newfile("stdin", nil), newfile("stdout", 1), newfile("stderr", 2)
local original_lines, original_type, original_input, original_output = io.lines, io.type, io.input, io.output

io.write = function(...)
  writeall(1, 3, ...)
  return stdout
end
io.read = read
io.lines = function(filename, ...)
  if filename == nil then return lines(...) end
  return original_lines(filename, ...)
end
io.stdin, io.stdout, io.stderr = stdin, stdout, stderr
io.input = function(file)
  if file == nil then return stdin end
  return original_input(file)
end
io.output = function(file)
  if file == nil then return stdout end
  return original_output(file)
end
io.type = function(obj)
  if getmetatable(obj) == file_mt then return "file" end
  return original_type(obj)
end

local exit_mt = {}
os.exit = function(code)
  local status = 0
  if code == false then status = 1 elseif type(code) == "number" then status = floor(code) end
  error(setmetatable({ status = status }, exit_mt))
end

local chunk, err = load(source, "=main", "t")
if not chunk then
  report("error", tostring(err), "")
  return
end

local ok, e = xpcall(chunk, function(m)
  if getmetatable(m) == exit_mt then return m end
  local message
  if type(m) == "string" then
    message = m
  elseif (type(m) == "table" or type(m) == "userdata") and not (getmetatable(m) and getmetatable(m).__tostring) then
    message = "(error object is a " .. type(m) .. " value)"
  else
    message = tostring(m)
  end
  return { message = message, trace = traceback(message, 2) }
end)

if ok then
  report("ok", "", "")
elseif type(e) == "table" and getmetatable(e) == exit_mt then
  report("exit", "", e.status)
elseif type(e) == "table" and e.message then
  report("error", e.message, e.trace)
else
  report("error", tostring(e), "")
end
`;

let factory: LuaFactory | null = null;
let loading: Promise<void> | null = null;

async function loadFactory(): Promise<void> {
  const wasmoon = evaluateCommonJs<Wasmoon>(wasmoonSource, 'wasmoon.js');
  const created = new wasmoon.LuaFactory(glueWasmUrl);
  try {
    await created.getLuaModule();
  } catch (err) {
    throw new Error("Couldn't load Lua. Check your internet connection and try again.", { cause: err });
  }
  factory = created;
}

export const luaRunner: LanguageRunner = {
  loaded: () => factory !== null,
  load: () => {
    loading ??= loadFactory().catch((err: unknown) => {
      loading = null;
      throw err;
    });
    return loading;
  },
  run: async (code, io): Promise<LangResult> => {
    if (!factory) await luaRunner.load();
    let report: { kind: string; message: string; extra: unknown } | null = null;
    const engine = await factory!.createEngine({ openStandardLibs: true, injectObjects: false, enableProxy: false });
    try {
      // Returning undefined (not null) for nil: wasmoon cannot convert null return values.
      engine.global.set('__codeclass_write', (stream: unknown, text: unknown) => {
        io.write(stream === 2 ? 'stderr' : 'stdout', String(text));
      });
      engine.global.set('__codeclass_readline', (wait: unknown) => io.readLine({ wait: wait !== false }) ?? undefined);
      engine.global.set('__codeclass_report', (kind: unknown, message: unknown, extra: unknown) => {
        report = { kind: String(kind), message: message == null ? '' : String(message), extra };
      });
      engine.global.set('__codeclass_source', code);
      engine.doStringSync(HARNESS);
    } catch (err) {
      return failure({ message: `Lua stopped unexpectedly: ${describeError(err)}` }, true);
    } finally {
      try {
        engine.global.close();
      } catch {
        // The state is discarded either way.
      }
    }
    const result = report as { kind: string; message: string; extra: unknown } | null;
    if (!result) return failure({ message: 'Lua stopped without finishing the program.' }, true);
    if (result.kind === 'ok') return OK;
    if (result.kind === 'exit') {
      const status = Number(result.extra) || 0;
      return status === 0 ? OK : failure({ message: `The program stopped with exit code ${status}.` });
    }
    return failure(luaRunError(result.message, typeof result.extra === 'string' ? result.extra : ''));
  },
};
