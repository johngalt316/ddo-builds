import { useEffect, useState } from 'react';
import { RaceSelector } from '@/components/build/RaceSelector';
import { ClassSelector } from '@/components/build/ClassSelector';
import { LevelGrid } from '@/components/build/LevelGrid';
import { TomesAndLevelUpsPanel } from '@/components/build/TomesAndLevelUpsPanel';
import { AbilityScorePanel } from '@/components/build/AbilityScorePanel';
import { ImportBuildButton } from '@/components/build/ImportBuildButton';
import { FeatsTab } from '@/components/build/FeatsTab';
import { EnhancementsTab } from '@/components/build/EnhancementsTab';
import { DestiniesTab } from '@/components/build/DestiniesTab';
import { SkillsTab } from '@/components/build/SkillsTab';
import { SpecialFeatsTab } from '@/components/build/SpecialFeatsTab';
import { BreakdownsTab } from '@/components/build/BreakdownsTab';
import { BuildSection } from '@/components/build/BuildSection';
import { StatsSection } from '@/components/stats/StatsSection';
import { GearSection } from '@/components/gear/GearSection';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { useBuild } from '@/hooks/useBuild';
import { useShareUrl } from '@/hooks/useShareUrl';
import styles from './BuildEditor.module.css';

const TABS = [
  { id: 'main',         label: 'Main Sheet' },
  { id: 'feats',        label: 'Feats' },
  { id: 'specialFeats', label: 'Past Lives' },
  { id: 'enhancements', label: 'Enhancements' },
  { id: 'destinies',    label: 'Epic Destinies' },
  { id: 'skills',       label: 'Skills' },
  { id: 'breakdowns',   label: 'Breakdowns' },
];

export function BuildEditor() {
  const { build, updateName, resetBuild, setBuild } = useBuild();
  const { copyShareUrl, loadBuildFromHash } = useShareUrl();
  const [copied, setCopied]       = useState(false);
  const [activeTab, setActiveTab] = useState('main');

  useEffect(() => {
    const loaded = loadBuildFromHash();
    if (loaded) setBuild(loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleShare() {
    const ok = await copyShareUrl(build);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className={styles.page}>
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <input
          className={styles.buildName}
          value={build.name}
          onChange={e => updateName(e.target.value)}
          placeholder="Build name"
          aria-label="Build name"
        />
        <div className={styles.toolbarActions}>
          <ImportBuildButton />
          <Button variant="ghost"   size="sm" onClick={resetBuild}>Reset</Button>
          <Button variant="primary" size="sm" onClick={handleShare}>
            {copied ? '✓ Copied!' : 'Share Build'}
          </Button>
        </div>
      </div>

      {/* ── Stats (always visible at top) ── */}
      <StatsSection />

      {/* ── Build (collapsible) ── */}
      <BuildSection>
        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
        <div className={styles.content}>
          {activeTab === 'main' && (
            <div className={styles.mainLayout}>
              <RaceSelector />
              <ClassSelector />
              <div className={styles.fullWidth}>
                <LevelGrid />
              </div>
              <div className={styles.fullWidth}>
                <AbilityScorePanel />
              </div>
              <div className={styles.fullWidth}>
                <TomesAndLevelUpsPanel />
              </div>
            </div>
          )}
          {activeTab === 'feats'        && <FeatsTab />}
          {activeTab === 'specialFeats' && <SpecialFeatsTab />}
          {activeTab === 'enhancements' && <EnhancementsTab />}
          {activeTab === 'destinies'    && <DestiniesTab />}
          {activeTab === 'skills'       && <SkillsTab />}
          {activeTab === 'breakdowns'   && <BreakdownsTab />}
        </div>
      </BuildSection>

      {/* ── Gear (collapsible, at bottom) ── */}
      <GearSection />
    </div>
  );
}
