import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/// Async credential storage. The Rust runtime kept credentials in the OS
/// keychain; the TypeScript runtime stores them in an encrypted file under the
/// Electron userData directory instead. `get` resolves undefined for a missing
/// account (the Rust `get` returned an error for that case).
export interface CredentialStore {
  get(account: string): Promise<string | undefined>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/// The account name OAuth tokens live under — matches the Rust/Swift
/// convention (`<providerId>.oauth`).
export function oauthAccount(providerId: string): string {
  return `${providerId}.oauth`;
}

/// The standard test double.
export class InMemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  async get(account: string): Promise<string | undefined> {
    return this.values.get(account);
  }

  async set(account: string, value: string): Promise<void> {
    this.values.set(account, value);
  }

  async delete(account: string): Promise<void> {
    this.values.delete(account);
  }
}

/// The encryption boundary is injected: in production the Electron main
/// process services encrypt/decrypt (safeStorage) over IPC; tests inject a
/// trivial cipher.
export interface Cipher {
  encrypt(plain: string): Promise<string>;
  decrypt(cipherText: string): Promise<string>;
}

/// All credentials live in ONE encrypted JSON object (account → value) inside
/// `filePath`. Loaded lazily on first use; every write rewrites the whole file
/// atomically (tmp file + rename) so a crash never leaves a torn file. A
/// corrupted or undecryptable file is treated as empty — the user re-connects
/// providers — but is logged, never silently swallowed.
export class EncryptedFileCredentialStore implements CredentialStore {
  private cache: Record<string, string> | undefined;
  /// Tail of the operation chain; every get/set/delete is serialized behind it
  /// so concurrent read-modify-write cycles cannot clobber each other.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
  ) {}

  get(account: string): Promise<string | undefined> {
    return this.enqueue(async () => (await this.load())[account]);
  }

  set(account: string, value: string): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.load();
      data[account] = value;
      await this.save(data);
    });
  }

  delete(account: string): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.load();
      delete data[account];
      await this.save(data);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache !== undefined) return this.cache;
    let cipherText: string;
    try {
      cipherText = await readFile(this.filePath, "utf8");
    } catch (error) {
      /// A missing file is the normal first-run state; anything else (EACCES,
      /// EISDIR, …) still starts empty but is worth surfacing.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(
          "Nexus could not read the credential store; starting empty.",
          error,
        );
      }
      this.cache = {};
      return this.cache;
    }
    try {
      const parsed: unknown = JSON.parse(await this.cipher.decrypt(cipherText));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("credential store is not a JSON object");
      }
      const data: Record<string, string> = {};
      for (const [account, value] of Object.entries(parsed)) {
        if (typeof value === "string") data[account] = value;
      }
      this.cache = data;
    } catch (error) {
      console.error(
        "Nexus could not read the credential store; starting empty.",
        error,
      );
      this.cache = {};
    }
    return this.cache;
  }

  private async save(data: Record<string, string>): Promise<void> {
    this.cache = data;
    const cipherText = await this.cipher.encrypt(JSON.stringify(data));
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, cipherText, "utf8");
    await rename(tmpPath, this.filePath);
  }
}
