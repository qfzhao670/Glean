import { useEffect } from 'react';

const particles = [
  { x: '-72px', y: '-38px', r: '-34deg', delay: '0ms' },
  { x: '-54px', y: '-78px', r: '24deg', delay: '35ms' },
  { x: '-18px', y: '-92px', r: '-18deg', delay: '80ms' },
  { x: '28px', y: '-88px', r: '38deg', delay: '20ms' },
  { x: '64px', y: '-62px', r: '-28deg', delay: '95ms' },
  { x: '82px', y: '-24px', r: '42deg', delay: '45ms' },
  { x: '70px', y: '34px', r: '-22deg', delay: '110ms' },
  { x: '30px', y: '54px', r: '30deg', delay: '65ms' },
  { x: '-38px', y: '50px', r: '-40deg', delay: '125ms' },
  { x: '-80px', y: '18px', r: '20deg', delay: '55ms' },
];

export default function GlobalClickEffect() {
  useEffect(() => {
    const activeBursts = new Set<HTMLElement>();
    const removalTimers = new Set<number>();

    const removeBurst = (burst: HTMLElement, timer: number) => {
      burst.remove();
      activeBursts.delete(burst);
      removalTimers.delete(timer);
    };

    const showBurst = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest('.book-opening-overlay')) return;

      const burst = document.createElement('span');
      burst.className = 'global-click-burst';
      burst.setAttribute('aria-hidden', 'true');
      burst.style.left = `${event.clientX}px`;
      burst.style.top = `${event.clientY}px`;

      const firstRing = document.createElement('b');
      firstRing.className = 'spirit-ring ring-one';
      const secondRing = document.createElement('b');
      secondRing.className = 'spirit-ring ring-two';
      burst.append(firstRing, secondRing);

      particles.forEach((particle, index) => {
        const mote = document.createElement('i');
        mote.className = index % 3 === 0 ? 'spirit-leaf' : 'spirit-spark';
        mote.style.setProperty('--x', particle.x);
        mote.style.setProperty('--y', particle.y);
        mote.style.setProperty('--r', particle.r);
        mote.style.setProperty('--delay', particle.delay);
        burst.append(mote);
      });

      document.body.append(burst);
      activeBursts.add(burst);
      const timer = window.setTimeout(() => removeBurst(burst, timer), 1000);
      removalTimers.add(timer);
    };

    window.addEventListener('pointerdown', showBurst, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', showBurst, true);
      removalTimers.forEach(timer => window.clearTimeout(timer));
      activeBursts.forEach(burst => burst.remove());
    };
  }, []);

  return null;
}
