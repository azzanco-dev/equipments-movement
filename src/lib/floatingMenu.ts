export function prepareFloatingMenu(
  element: HTMLElement | null,
  updatePosition: () => void,
  desiredHeight = 240,
) {
  if (!element) return
  const rect = element.getBoundingClientRect()
  const viewportPadding = 8
  const gap = 4
  const availableBelow =
    window.innerHeight - rect.bottom - gap - viewportPadding
  const availableAbove = rect.top - gap - viewportPadding
  const openAbove = availableAbove > availableBelow
  const available = openAbove ? availableAbove : availableBelow

  updatePosition()
  if (available < desiredHeight) {
    element.scrollIntoView({
      behavior: 'smooth',
      block: openAbove ? 'end' : 'start',
      inline: 'nearest',
    })
  }
  window.requestAnimationFrame(updatePosition)
  window.setTimeout(updatePosition, 220)
}
