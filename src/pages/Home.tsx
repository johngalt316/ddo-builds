import { Link } from 'react-router-dom';
import styles from './Home.module.css';

export function Home() {
  return (
    <div className={styles.page}>
      <div className={styles.alphaBanner} role="alert">
        <span className={styles.alphaTag}>Alpha</span>
        <span>
          Active development. Numbers may be wrong, layouts may shift, and saved
          builds may need re-importing as the data model evolves. Report issues
          at{' '}
          <a
            href="https://github.com/johngalt316/ddo-builds/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/johngalt316/ddo-builds/issues
          </a>
          .
        </span>
      </div>

      <section className={styles.hero}>
        <h1 className={styles.title}>DDO DPS Calculator</h1>
        <p className={styles.subtitle}>
          A build planner with a real DPS engine for{' '}
          <em>Dungeons &amp; Dragons Online</em>. Plan a character, lay out a
          rotation, and see — second by second — where every point of damage
          comes from.
        </p>
        <Link to="/builder" className={styles.cta}>
          Open the builder <span className={styles.ctaArrow} aria-hidden="true">→</span>
        </Link>
      </section>

      <section className={styles.features}>
        <article className={styles.feature}>
          <header className={styles.featureHeader}>
            <h2>DPS Calculator</h2>
            <span className={styles.featureStatus}>Magic ✓ · Melee ✓ · Ranged ✗</span>
          </header>
          <p>
            Per-spell damage-per-cast, full rotation cycle simulation, on-hit
            procs, buff and debuff stacking, damage broken out by source, and
            difficulty scaling from Elite through R10. Compare two enhancement
            sets side-by-side at the same rotation and weapon.
          </p>
        </article>

        <article className={styles.feature}>
          <header className={styles.featureHeader}>
            <h2>Build Planner</h2>
            <span className={styles.featureStatus}>Heroic · Epic · Legendary</span>
          </header>
          <p>
            Three-class multiclass with accurate BAB, saves, hit dice, and spell
            slots. 32-point buy with live cost feedback. Feats, skills,
            enhancement trees, epic destinies, reaper trees, and gear. Multiple
            enhancement sets and gear sets per build for{' '}
            <em>&ldquo;what if I respec&rdquo;</em> comparisons.
          </p>
        </article>

        <article className={styles.feature}>
          <header className={styles.featureHeader}>
            <h2>Import &amp; Share</h2>
            <span className={styles.featureStatus}>No accounts · No telemetry</span>
          </header>
          <p>
            Import existing builds from Maetrim&apos;s DDOBuilderV2{' '}
            <code>.DDOBuild</code> XML, or build from scratch. The entire build
            is encoded in the URL — copy the link to share a complete character
            with party members or the forums. No server, no database, no cookies.
          </p>
        </article>
      </section>

      {/* Pending — short, factual list of what's not yet built. */}
      <section className={styles.pending}>
        <h2 className={styles.pendingTitle}>Not yet built</h2>
        <ul className={styles.pendingList}>
          <li>Ranged rotations</li>
          <li>Rotation optimizer (auto-fill is on you for now)</li>
          <li>Enemy AC and Fortification modeling</li>
          <li>Some on-hit melee procs (Magical Ambush analogs)</li>
        </ul>
      </section>

      <footer className={styles.attribution}>
        <p>
          Open source under the{' '}
          <a
            href="https://github.com/johngalt316/ddo-builds"
            target="_blank"
            rel="noopener noreferrer"
          >
            MIT license
          </a>
          . Game data and item images sourced from{' '}
          <a
            href="https://github.com/Maetrim/DDOBuilderV2"
            target="_blank"
            rel="noopener noreferrer"
          >
            Maetrim&apos;s DDOBuilderV2
          </a>
          .
        </p>
        <p className={styles.attributionDim}>
          Dungeons &amp; Dragons Online is © Standing Stone Games. This site is a
          fan-made tool, not affiliated with or endorsed by Standing Stone Games
          or Daybreak Game Company.
        </p>
      </footer>
    </div>
  );
}
