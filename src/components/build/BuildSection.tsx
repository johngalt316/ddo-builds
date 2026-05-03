import { type ReactNode, useState } from 'react';
import styles from './BuildSection.module.css';

interface Props {
  children: ReactNode;
  defaultOpen?: boolean;
}

export function BuildSection({ children, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.section}>
      <button
        className={styles.header}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={open ? styles.chevronOpen : styles.chevron}>▸</span>
        <span className={styles.title}>Build</span>
      </button>
      {open && <div className={styles.body}>{children}</div>}
    </section>
  );
}
