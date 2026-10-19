import type { PointerEvent } from 'react';

export function trackCardSpotlight(event: PointerEvent<HTMLElement>) {
  if (event.pointerType === 'touch') return;
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--spotlight-x', `${event.clientX - bounds.left}px`);
  event.currentTarget.style.setProperty('--spotlight-y', `${event.clientY - bounds.top}px`);
}
