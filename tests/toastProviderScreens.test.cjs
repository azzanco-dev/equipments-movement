const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// `useToast()` throws outside a `ToastProvider`, and no shell mounts one, so
// every SCREEN that calls it must mount its own (the PO page crashed on
// 2026-11-09 after the remove-line Toast was added without one).
const SCREENS = path.join(__dirname, '..', 'src', 'screens')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

test('every screen that calls useToast mounts a ToastProvider', () => {
  const offenders = walk(SCREENS).filter((file) => {
    const source = fs.readFileSync(file, 'utf8')
    return source.includes('useToast(') && !source.includes('<ToastProvider>')
  })
  assert.deepEqual(
    offenders.map((file) => path.relative(SCREENS, file)),
    [],
  )
})
