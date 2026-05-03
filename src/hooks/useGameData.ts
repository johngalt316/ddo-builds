import { useEffect } from 'react';
import { useGameDataStore } from '@/store/gameDataStore';

export function useGameData() {
  const store = useGameDataStore();
  const { status, loadGameData } = store;

  useEffect(() => {
    if (status === 'idle') {
      void loadGameData();
    }
  }, [status, loadGameData]);

  return {
    status: store.status,
    error: store.error,
    isLoading: store.status === 'loading',
    isReady: store.status === 'ready',
    classes: store.classes,
    races: store.races,
    feats: store.feats,
    enhancementTrees: store.enhancementTrees,
    getClass: store.getClass,
    getRace: store.getRace,
  };
}
