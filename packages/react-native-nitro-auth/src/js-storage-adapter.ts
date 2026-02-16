export type JSStorageAdapter = {
  save(key: string, value: string): void | Promise<void>;
  load(key: string): string | undefined | Promise<string | undefined>;
  remove(key: string): void | Promise<void>;
};
