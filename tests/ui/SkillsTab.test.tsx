// @vitest-environment happy-dom
//
// UI smoke test for the rank +/- buttons in SkillsTab. Verifies buttons
// dispatch updateSkillRank into the store, respect the maxRanks cap, and
// stop at zero on the way down.
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import { SkillsTab } from '@/components/build/SkillsTab';
import { useBuildStore } from '@/store/buildStore';
import { DEFAULT_BUILD } from '@/types/build';

function renderTab() {
  return render(
    <MemoryRouter>
      <SkillsTab />
    </MemoryRouter>,
  );
}

describe('SkillsTab editor', () => {
  beforeEach(() => {
    cleanup();
    useBuildStore.setState({
      build: {
        ...structuredClone(DEFAULT_BUILD),
        // Bump to level 20 so maxRanks = 23 for class skills (room to test cap).
        classes: [{ classId: 'rogue', levels: 20 }],
      },
    });
  });

  it('+ button increments ranks via the store', () => {
    renderTab();
    const incBtn = screen.getByLabelText(/Increase Balance ranks/i);
    fireEvent.click(incBtn);
    expect(useBuildStore.getState().build.skillRanks.balance).toBe(1);
  });

  it('− button decrements ranks; disabled at 0', () => {
    useBuildStore.setState(s => ({
      build: { ...s.build, skillRanks: { balance: 2 } },
    }));
    renderTab();
    const decBtn = screen.getByLabelText(/Decrease Balance ranks/i);
    fireEvent.click(decBtn);
    expect(useBuildStore.getState().build.skillRanks.balance).toBe(1);
    fireEvent.click(decBtn);
    expect(useBuildStore.getState().build.skillRanks.balance).toBe(0);
    expect((decBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('+ button is disabled at maxRanks', () => {
    // Rogue is a thief class — Balance is a class skill. At level 20, max = 23.
    useBuildStore.setState(s => ({
      build: { ...s.build, skillRanks: { balance: 23 } },
    }));
    renderTab();
    const incBtn = screen.getByLabelText(/Increase Balance ranks/i);
    expect((incBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('budget header shows spent / total and remaining', () => {
    useBuildStore.setState(s => ({
      build: { ...s.build, skillRanks: { balance: 5, hide: 5 } },
    }));
    renderTab();
    // Ranks total = 10
    expect(screen.getByText(/10 \/ \d+ skill points spent/)).toBeTruthy();
  });

  it('shows over-budget styling when spent > budget', () => {
    // 1-level fighter has only 8 SP at INT 10, so 100 ranks far exceeds it.
    useBuildStore.setState(s => ({
      build: {
        ...s.build,
        classes: [{ classId: 'fighter', levels: 1 }],
        skillRanks: { balance: 100 },
      },
    }));
    renderTab();
    // The budget line should contain "over"
    const root = screen.getByText(/skill points spent/).closest('div')!;
    expect(within(root).getByText(/over/i)).toBeTruthy();
  });
});
