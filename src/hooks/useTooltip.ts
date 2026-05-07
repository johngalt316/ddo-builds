// Hover-on-PC / tap-on-mobile tooltip hook.
//
// Wires up the open/close state + event handlers for a popover-style
// tooltip that:
//   • shows on mouseenter (or focus) on hover-capable devices
//   • toggles on tap with outside-tap + Escape dismiss on touch
//   • flips behavior live when a mouse is plugged in / unplugged on a
//     hybrid device (matchMedia change listener)
//
// Spread `wrapperProps` on the positioning container (the element the
// popover anchors to) and `triggerProps` on the focusable trigger
// (the button the user interacts with). They can be the same element
// when the trigger is also the wrapper.
//
//   const { open, wrapperProps, triggerProps } = useTooltip();
//   return (
//     <div className={styles.chipWrapper} {...wrapperProps}>
//       <button {...triggerProps}>...</button>
//       {open && <div className={styles.popover}>...</div>}
//     </div>
//   );

import { useEffect, useRef, useState } from 'react';

/** True on devices with a real mouse / trackpad. Reactive to
 *  hardware changes on hybrids (e.g. plugging a USB mouse into a
 *  Surface). */
function useHoverCapable(): boolean {
  const [hover, setHover] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const onChange = (e: MediaQueryListEvent) => setHover(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return hover;
}

export interface UseTooltipResult<T extends HTMLElement = HTMLDivElement> {
  open: boolean;
  /** Spread on the wrapper element that contains both trigger + popover.
   *  Provides the ref used for outside-click detection + the hover
   *  enter/leave handlers on hover-capable devices. Pass `<HTMLLIElement>`
   *  etc. as a generic when the wrapper isn't a div. */
  wrapperProps: {
    ref: React.RefObject<T | null>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  /** Spread on the focusable trigger (typically a <button>). Wires
   *  click-to-toggle on touch and focus/blur for keyboard users. */
  triggerProps: {
    'aria-expanded': boolean;
    'aria-haspopup': 'dialog';
    onClick: () => void;
    onFocus: () => void;
    onBlur:  () => void;
  };
  setOpen: (next: boolean) => void;
}

export function useTooltip<T extends HTMLElement = HTMLDivElement>(): UseTooltipResult<T> {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<T | null>(null);
  const isHoverCapable = useHoverCapable();

  useEffect(() => {
    if (!open || isHoverCapable) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapperRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown',  onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown',    onKey);
    return () => {
      document.removeEventListener('mousedown',  onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown',    onKey);
    };
  }, [open, isHoverCapable]);

  return {
    open,
    setOpen,
    wrapperProps: {
      ref: wrapperRef,
      onMouseEnter: () => { if (isHoverCapable) setOpen(true);  },
      onMouseLeave: () => { if (isHoverCapable) setOpen(false); },
    },
    triggerProps: {
      'aria-expanded': open,
      'aria-haspopup': 'dialog',
      onClick: () => { if (!isHoverCapable) setOpen(o => !o); },
      onFocus: () => { if (isHoverCapable) setOpen(true);  },
      onBlur:  () => { if (isHoverCapable) setOpen(false); },
    },
  };
}
