/** Shared surface for floating panels (select lists, menus). */
export const floatingPanel =
  'z-50 overflow-hidden rounded-lg border bg-bg p-1 text-fg shadow-lg data-[state=open]:animate-fade-in-opacity'

/** Shared row style for items inside floating panels. */
export const floatingItem =
  'relative flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover'
