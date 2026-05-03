// @vitest-environment happy-dom
//
// UI test for the feat picker — verifies the modal opens, search filters
// the list, requirement-blocked feats can be hidden/shown, and clicking
// a feat row fires addFeat into the build store.
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import { FeatsTab } from '@/components/build/FeatsTab';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { DEFAULT_BUILD } from '@/types/build';
import type { DDOFeatData } from '@/types/ddoData';

// Minimal feats for the picker. Includes one whose requirements pass, one
// blocked by a Class requirement we don't satisfy, and one whose description
// matches a search query but the name doesn't.
const FAKE_FEATS: DDOFeatData[] = [
  {
    name: 'Power Attack',
    description: 'Take a -5 penalty to attack to gain bonus damage.',
    icon: 'PowerAttack',
    groups: ['Standard'],
    acquire: 'Train',
    maxTimesAcquire: 1,
    requirements: { allOf: [], oneOf: [], noneOf: [] },
    hasSubItems: false,
    effects: [],
  },
  {
    name: 'Cleave',
    description: 'Hit two adjacent enemies in a line.',
    icon: 'Cleave',
    groups: ['Standard'],
    acquire: 'Train',
    maxTimesAcquire: 1,
    requirements: { allOf: [], oneOf: [], noneOf: [] },
    hasSubItems: false,
    effects: [],
  },
  {
    name: 'Blocked Wizard Feat',
    description: 'Requires several wizard levels.',
    icon: 'WizardThing',
    groups: ['Class Bonus'],
    acquire: 'Train',
    maxTimesAcquire: 1,
    requirements: {
      allOf: [{ type: 'Class', item: 'Wizard', value: 5 }],
      oneOf: [],
      noneOf: [],
    },
    hasSubItems: false,
    effects: [],
  },
];

function renderTab() {
  return render(
    <MemoryRouter>
      <FeatsTab />
    </MemoryRouter>,
  );
}

describe('FeatPickerDialog', () => {
  beforeEach(() => {
    cleanup();
    useBuildStore.setState({ build: structuredClone(DEFAULT_BUILD) });
    // Seed the game data store with enough fake data for the picker to work.
    useGameDataStore.setState({
      status: 'ready',
      feats: FAKE_FEATS,
      classes: [],
      featIcons: {},
    });
  });

  it('starts hidden, opens on + Add Feat', () => {
    renderTab();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Add Feat/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('lists eligible feats but hides blocked ones by default', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add Feat/i }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByText('Power Attack')).toBeTruthy();
    expect(within(dialog).queryByText('Cleave')).toBeTruthy();
    // Default Fighter build has no Wizard levels, so the blocked feat is hidden
    expect(within(dialog).queryByText('Blocked Wizard Feat')).toBeNull();
  });

  it('reveals blocked feats when "Show ineligible" is checked', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add Feat/i }));
    fireEvent.click(screen.getByLabelText(/Show ineligible/i));
    expect(screen.getByText('Blocked Wizard Feat')).toBeTruthy();
  });

  it('filters by search query', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add Feat/i }));
    const dialog = screen.getByRole('dialog');
    const search = within(dialog).getByPlaceholderText(/Search/i);

    fireEvent.change(search, { target: { value: 'cleave' } });

    expect(within(dialog).queryByText('Cleave')).toBeTruthy();
    expect(within(dialog).queryByText('Power Attack')).toBeNull();
  });

  it('clicking a feat row adds it to the build and closes the dialog', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add Feat/i }));
    fireEvent.click(screen.getByText('Power Attack'));

    expect(screen.queryByRole('dialog')).toBeNull();
    const stored = useBuildStore.getState().build.feats;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.featId).toBe('Power Attack');
  });

  it('the X button removes a feat', () => {
    useBuildStore.setState(s => ({
      build: {
        ...s.build,
        feats: [{ slotIndex: 0, featId: 'Power Attack' }],
      },
    }));
    renderTab();
    fireEvent.click(screen.getByLabelText(/Remove Power Attack/i));
    expect(useBuildStore.getState().build.feats).toHaveLength(0);
  });
});
