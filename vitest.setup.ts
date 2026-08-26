/**
 * vitest.setup.ts
 * Configure React's act() for the jsdom test environment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
