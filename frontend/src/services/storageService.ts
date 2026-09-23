// Compatibility facade: the UI and platform share one validated persistence engine.
export {
  STORAGE_KEY, STORAGE_VERSION, clearStorageError, getStorageError,
  isSafePrototypeUrl, safeLocalStorage, validateStoredState,
} from '../app/persistence';
export type { ActivityEvent, AppPage, PersistedAppState } from '../app/persistence';
