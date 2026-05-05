import { Outlet, NavLink } from 'react-router-dom';
import styles from './Layout.module.css';

export function Layout() {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>⚔️</span>
          <span className={styles.brandName}>DDO Builds</span>
        </div>
        <nav className={styles.nav}>
          <NavLink to="/" end className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            Home
          </NavLink>
          <NavLink to="/builder" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            Builder
          </NavLink>
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <p>DDO Builds — a fan-made hobby project. Not affiliated with Standing Stone Games.</p>
        <p className={styles.version} title="Auto-bumped on every push">
          v{__APP_VERSION__} · <code>{__APP_SHA__}</code>
        </p>
      </footer>
    </div>
  );
}
