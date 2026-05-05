import { useRef, useState, useMemo } from 'react';
import { parseDDOBuildFile } from '@/utils/ddoBuildParser';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { nameToId, skillNameToId } from '@/utils/classAdapter';
import { Button } from '@/components/ui/Button';
import styles from './ImportBuildButton.module.css';

type Status = 'idle' | 'success' | 'error';

export function ImportBuildButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const setBuild = useBuildStore(s => s.setBuild);
  const classes  = useGameDataStore(s => s.classes);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  // Class-skills lookup — parser uses this to halve cross-class SP into ranks.
  const classSkillsByClassId = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of classes) {
      out[nameToId(c.name)] = c.classSkills.map(skillNameToId);
    }
    return out;
  }, [classes]);

  function handleClick() {
    inputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset so the same file can be re-imported
    e.target.value = '';

    const text = await file.text();
    const result = parseDDOBuildFile(text, { classSkillsByClassId });

    if (!result) {
      setStatus('error');
      setMessage('Could not parse file — make sure it is a valid .DDOBuild file.');
      setTimeout(() => setStatus('idle'), 4000);
      return;
    }

    // Ensure selectedEnhancementTrees is populated from the import's tree data
    const buildToSet = {
      ...result.build,
      selectedEnhancementTrees: result.build.selectedEnhancementTrees.length > 0
        ? result.build.selectedEnhancementTrees
        : result.build.enhancements.map(e => e.treeId),
    };
    setBuild(buildToSet);
    setStatus('success');

    if (result.warnings.length > 0) {
      setMessage(`Imported with ${result.warnings.length} warning(s): ${result.warnings[0]}`);
    } else {
      setMessage(`"${result.build.name}" imported successfully.`);
    }
    setTimeout(() => setStatus('idle'), 4000);
  }

  return (
    <div className={styles.wrapper}>
      <input
        ref={inputRef}
        type="file"
        accept=".DDOBuild"
        className={styles.hiddenInput}
        onChange={handleFile}
        aria-label="Import .DDOBuild file"
      />
      <Button variant="secondary" size="sm" onClick={handleClick}>
        Import .DDOBuild
      </Button>
      {status !== 'idle' && (
        <span className={status === 'error' ? styles.error : styles.success}>
          {message}
        </span>
      )}
    </div>
  );
}
