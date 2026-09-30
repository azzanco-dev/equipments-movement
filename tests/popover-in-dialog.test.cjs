const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8')

const popover = read('src/components/ui/FloatingPopover.tsx')
const dialog = read('src/components/ui/Dialog.tsx')

// A Radix Dialog locks scrolling outside its content. A popover portaled to
// <body> from inside a dialog therefore could not be scrolled with the wheel
// or by touch (the filter dialog's company and project lists).

test('a popover portals into the container its surrounding dialog provides', () => {
  assert.match(popover, /export const PopoverContainerContext = createContext/)
  assert.match(
    popover,
    /const container = useContext\(PopoverContainerContext\)/,
  )
  assert.match(
    popover,
    /<RadixPopover\.Portal container=\{container \?\? undefined\}>/,
  )
})

test('the dialog provides its own content element to the popovers inside it', () => {
  assert.match(dialog, /<RadixDialog\.Content\s+ref=\{setContent\}/)
  assert.match(
    dialog,
    /<PopoverContainerContext\.Provider value=\{content\}>\s+\{children\}/,
  )
})
