// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { TomesAndLevelUpsPanel } from '@/components/build/TomesAndLevelUpsPanel';
import { useBuildStore } from '@/store/buildStore';
import { DEFAULT_BUILD } from '@/types/build';

function renderPanel() {
  return render(<MemoryRouter><TomesAndLevelUpsPanel /></MemoryRouter>);
}

describe('TomesAndLevelUpsPanel', () => {
  beforeEach(() => {
    cleanup();
    useBuildStore.setState({
      build: {
        ...structuredClone(DEFAULT_BUILD),
        classes: [{ classId: 'fighter', levels: 20 }],
      },
    });
  });

  it('starts with all tomes at 0', () => {
    renderPanel();
    expect(screen.getAllByText('+0').length).toBe(6);
  });

  it('+ button on STR tome bumps to +1, capped at +8', () => {
    renderPanel();
    const incBtn = screen.getByLabelText(/Increase Strength tome/i);
    fireEvent.click(incBtn);
    expect(useBuildStore.getState().build.abilityTomes?.STR).toBe(1);
    // Click 7 more times → reaches +8
    for (let i = 0; i < 7; i++) fireEvent.click(incBtn);
    expect(useBuildStore.getState().build.abilityTomes?.STR).toBe(8);
    // Disabled at +8
    expect((incBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('− button at 0 is disabled', () => {
    renderPanel();
    const decBtn = screen.getByLabelText(/Decrease Strength tome/i);
    expect((decBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('selecting a level-up assignment writes to store', () => {
    renderPanel();
    const select = screen.getByLabelText(/Level 4 ability assignment/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'STR' } });
    expect(useBuildStore.getState().build.levelUps?.[4]).toBe('STR');
  });

  it('level-up dropdown is disabled when char level is below the tier', () => {
    useBuildStore.setState(s => ({
      build: { ...s.build, classes: [{ classId: 'fighter', levels: 3 }] },
    }));
    renderPanel();
    const sel = screen.getByLabelText(/Level 4 ability assignment/i) as HTMLSelectElement;
    expect(sel.disabled).toBe(true);
  });

  it('clearing a selection ("—") removes the tier from levelUps', () => {
    useBuildStore.setState(s => ({
      build: { ...s.build, levelUps: { 4: 'CON' } },
    }));
    renderPanel();
    const select = screen.getByLabelText(/Level 4 ability assignment/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });
    expect(useBuildStore.getState().build.levelUps?.[4]).toBeUndefined();
  });
});
