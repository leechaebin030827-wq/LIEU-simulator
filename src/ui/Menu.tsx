import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Dropdown used by the top bar: closes on outside click, Esc, or after picking an item (anything inside `.keep` stays open). */
export function Menu({ label, title, className = 'ico', align = 'left', width, children }: { label: ReactNode; title?: string; className?: string; align?: 'left' | 'right'; width?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', off); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="exmenu" ref={ref}>
      <button className={className + (open ? ' open' : '')} title={title} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos(align === 'right' ? { right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 } : { left: r.left, top: r.bottom + 6 }); setOpen((o) => !o); }}>
        {label}<span className="caret">▾</span>
      </button>
      {open && <div className="exlist menu" role="menu" style={{ ...pos, ...(width ? { width } : {}) }} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

export const MenuItem = ({ onClick, hint, disabled, children }: { onClick: () => void; hint?: string; disabled?: boolean; children: ReactNode }) => (
  <button role="menuitem" className="exitem mi" disabled={disabled} onClick={onClick}><span className="extxt"><b>{children}</b></span>{hint && <kbd>{hint}</kbd>}</button>
);
export const MenuSep = () => <div className="msep" />;
/** Content that must not close the menu when clicked (inputs, labels). */
export const MenuKeep = ({ children }: { children: ReactNode }) => <div className="keep" onClick={(e) => e.stopPropagation()}>{children}</div>;
