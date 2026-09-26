// Loads a TypeScript module from src/lib/extracting in an isolated VM,
// resolving its relative imports (e.g. './form') the same way.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..', '..', 'src', 'lib', 'extracting')

function loadExtractingModule(name, cache = new Map()) {
  const file = path.join(ROOT, `${name}.ts`)
  if (cache.has(file)) return cache.get(file)
  const exports = {}
  cache.set(file, exports)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const localRequire = (specifier) => {
    if (!specifier.startsWith('./'))
      throw new Error(`Unexpected import ${specifier} in ${name}.ts`)
    return loadExtractingModule(specifier.slice(2), cache)
  }
  vm.runInNewContext(
    code,
    { exports, require: localRequire, process },
    { filename: file },
  )
  return exports
}

module.exports = { loadExtractingModule }
