import { AsyncLocalStorage } from "node:async_hooks";

type StoreContext = {
  userId: string;
};

const storeContextStorage = new AsyncLocalStorage<StoreContext>();

/**
 * Run a function with a specific user's store context.
 * All store operations within this context will use the user's store key.
 */
export function withUserStore<T>(userId: string, fn: () => T): T {
  return storeContextStorage.run({ userId }, fn);
}

/**
 * Get the current user ID from the store context.
 * Returns undefined if not in a user context (falls back to default store).
 */
export function getCurrentUserId(): string | undefined {
  return storeContextStorage.getStore()?.userId;
}
