// Radix moves focus onto panels and items (tabindex=-1). The highlight
// background marks the active item, so suppress the global
// [tabindex]:focus-visible outline from index.css here.

/** Shared surface for floating panels (select lists, menus). */
export const floatingPanel =
  'z-50 overflow-hidden rounded-lg border bg-bg p-1 text-fg shadow-lg outline-none focus-visible:!outline-none data-[state=open]:animate-fade-in-opacity'

/** Shared row style for items inside floating panels. */
export const floatingItem =
  'relative flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none focus-visible:!outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover'
