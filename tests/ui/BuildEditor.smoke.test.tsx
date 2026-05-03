// @vitest-environment happy-dom
//
// Phase 0 UI regression net.
//
// Mounts BuildEditor with a freshly-reset Zustand store and the *idle*
// (XML not yet loaded) game-data store, so the static JSON stubs fall through.
// Snapshots the rendered HTML.
//
// Goals:
//   - Catch "the page crashes on render" outright
//   - Catch silent structural drift (missing tab, missing toolbar button,
//     section header text changed) via committed HTML snapshot
//
// Non-goals:
//   - Pixel-perfect screenshot regression — deferred until CI exists, at
//     which point Playwright + a single committed PNG is the right tool.
//
// The snapshot is intentionally a full HTML dump so a diff is human-readable
// in PRs ("a button disappeared", "a tab was renamed").
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, cleanup } from '@testing-library/react';
import { resolve } from 'node:path';
import { BuildEditor } from '@/pages/BuildEditor';
import { useBuildStore } from '@/store/buildStore';
import { DEFAULT_BUILD } from '@/types/build';

const SNAPSHOTS = resolve(__dirname, '../snapshots');

describe('BuildEditor smoke test', () => {
  beforeEach(() => {
    // Reset to a known build so the snapshot is deterministic across test runs
    useBuildStore.setState({ build: structuredClone(DEFAULT_BUILD) });
    cleanup();
  });

  it('renders the editor shell without throwing', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/builder']}>
        <BuildEditor />
      </MemoryRouter>,
    );

    // Sanity checks — if any of these fail, the layout-level regression
    // is real, not a snapshot whitespace diff.
    expect(container.querySelector('input[aria-label="Build name"]')).toBeTruthy();
    expect(container.textContent).toContain('Share Build');
    expect(container.textContent).toContain('Reset');

    // Tabs in the Build section
    for (const label of ['Main Sheet', 'Feats', 'Enhancements', 'Epic Destinies', 'Skills']) {
      expect(container.textContent).toContain(label);
    }
  });

  it('rendered HTML matches snapshot', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/builder']}>
        <BuildEditor />
      </MemoryRouter>,
    );

    // Strip volatile attributes (random react-generated IDs etc.) before
    // snapshotting. Today's React 19 doesn't emit non-deterministic ids
    // in our tree, but normalize defensively so future updates don't
    // create flakes.
    const html = container.innerHTML
      .replace(/ id="[^"]*"/g, '')
      .replace(/aria-controls="[^"]*"/g, '')
      .replace(/aria-labelledby="[^"]*"/g, '');

    // One-line HTML is unreadable in PR diffs. Cheap pretty-print: line break
    // before each opening tag. Not a real formatter — just enough to make
    // a diff scannable.
    const pretty = html.replace(/></g, '>\n<');

    await expect(pretty).toMatchFileSnapshot(
      resolve(SNAPSHOTS, 'BuildEditor.html.snap.html'),
    );
  });
});
