import { Link } from 'react-router-dom';
import styles from './Home.module.css';

export function Home() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>DDO Build DPS Calculator</h1>
        <p className={styles.subtitle}>
          Plan your Dungeons and Dragons Online character build — ability scores,
          class splits, feats, and enhancements — then share it with a link or
          import an existing build from DDO Builder.
        </p>
        <Link to="/builder" className={styles.cta}>
          Start Building →
        </Link>
      </section>

      <section className={styles.features}>
        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>⚔️</div>
          <h2>Multiclass Support</h2>
          <p>Model DDO's unique 3-class multiclass system with accurate BAB, saves, and hit points for every combination.</p>
        </div>
        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>🎲</div>
          <h2>Point-Buy Calculator</h2>
          <p>Allocate your 32 ability score points with real-time cost feedback and racial bonus preview.</p>
        </div>
        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>🔗</div>
          <h2>Shareable Builds</h2>
          <p>Your entire build is encoded in the URL. Copy and share it — no account required, no server needed.</p>
        </div>
      </section>
    </div>
  );
}
