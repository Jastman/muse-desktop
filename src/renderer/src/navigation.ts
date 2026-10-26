export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/** Scrolls an element into view (instantly when reduced motion is preferred) and moves focus to it. */
export function revealElement(element: HTMLElement | null, focusTarget?: HTMLElement | null) {
  if (!element) return false
  element.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  const target = focusTarget || element
  if (
    !target.hasAttribute('tabindex') &&
    !/^(A|BUTTON|INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
  )
    target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
  return true
}

export function findItemElement(root: ParentNode, itemId: string) {
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(itemId) : itemId
  return (
    root.querySelector<HTMLElement>(`[data-item-id="${escaped}"]`) ||
    root.querySelector<HTMLElement>(`[data-item-ids~="${escaped}"]`)
  )
}

/** Jumps to a pending approval/question card and focuses its first actionable control. */
export function revealRequest(requestId: string) {
  const card = document.getElementById(`request-${requestId}`)
  return revealElement(card, card?.querySelector<HTMLElement>('button, input') ?? card)
}
