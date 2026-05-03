import { Link } from 'react-router-dom';
import styles from './NotFound.module.css';

export function NotFound() {
  return (
    <div className={styles.page}>
      <h1 className={styles.code}>404</h1>
      <p className={styles.message}>This dungeon does not exist.</p>
      <Link to="/" className={styles.link}>← Back to Home</Link>
    </div>
  );
}
