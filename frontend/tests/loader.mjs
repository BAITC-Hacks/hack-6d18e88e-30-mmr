// Node test adapter for the same TypeScript / JSX modules used by Vite.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('.') || specifier.startsWith('/')) && context.parentURL?.startsWith('file:')) {
      const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
      if (!extname(base)) {
        const candidate = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`]
          .find(path => existsSync(path) && statSync(path).isFile());
        if (candidate) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('/shared/aiScopePolicy.json')) return { format: 'module', source: `export default ${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')))};`, shortCircuit: true };
    if (url.startsWith('file:') && /\.css(?:\?|$)/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
    if (url.startsWith('file:') && /\.tsx?$/.test(url)) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        fileName: fileURLToPath(url),
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, verbatimModuleSyntax: true },
      }).outputText;
      return { format: 'module', source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
