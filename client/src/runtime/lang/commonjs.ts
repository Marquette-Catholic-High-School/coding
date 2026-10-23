// sql.js and wasmoon ship as UMD/CommonJS bundles. They are imported as raw text (`?raw`) and evaluated with a
// `module`/`exports` shim, which behaves the same in the Vite dev server (where these packages are excluded from
// dependency pre-bundling, so a normal import would have no exports) and in production builds.

export function evaluateCommonJs<T>(source: string, name: string): T {
  const module: { exports: unknown } = { exports: {} };
  const factory = new Function('module', 'exports', 'require', `${source}\n//# sourceURL=${name}`) as (
    module: { exports: unknown },
    exports: unknown,
    require: (id: string) => never,
  ) => void;
  factory(module, module.exports, (id) => {
    throw new Error(`"${id}" is not available in the browser`);
  });
  return module.exports as T;
}
