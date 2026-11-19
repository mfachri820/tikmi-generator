import type { FileStore } from "./ingest";

/** In-memory FileStore for tests and local scripts. */
export class MemoryStore implements FileStore {
  readonly files = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer) {
    this.files.set(key, Buffer.from(bytes));
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
}
