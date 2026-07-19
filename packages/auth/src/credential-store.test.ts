import { describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Cipher,
  EncryptedFileCredentialStore,
  InMemoryCredentialStore,
  oauthAccount,
} from "./credential-store";

/// A reversible fake cipher: real base64, so the file on disk is provably not
/// plaintext while tests can still decode it.
const base64Cipher: Cipher = {
  encrypt: async (plain) => Buffer.from(plain, "utf8").toString("base64"),
  decrypt: async (cipherText) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cipherText))
      throw new Error("bad ciphertext");
    return Buffer.from(cipherText, "base64").toString("utf8");
  },
};

async function tempStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nexus-auth-test-"));
  return join(dir, "credentials.enc");
}

test("oauthAccount matches the <providerId>.oauth convention", () => {
  expect(oauthAccount("openai")).toBe("openai.oauth");
});

describe("InMemoryCredentialStore", () => {
  test("get/set/delete", async () => {
    const store = new InMemoryCredentialStore();
    expect(await store.get("a")).toBeUndefined();
    await store.set("a", "1");
    expect(await store.get("a")).toBe("1");
    await store.delete("a");
    expect(await store.get("a")).toBeUndefined();
  });
});

describe("EncryptedFileCredentialStore", () => {
  test("persists values across instances, encrypted on disk", async () => {
    const path = await tempStorePath();
    const store = new EncryptedFileCredentialStore(path, base64Cipher);
    expect(await store.get("openai.oauth")).toBeUndefined();
    await store.set("openai.oauth", "secret-token");
    await store.set("kimi.device_id", "device-1");
    await store.delete("kimi.device_id");

    const onDisk = await readFile(path, "utf8");
    expect(onDisk).not.toContain("secret-token");
    expect(JSON.parse(await base64Cipher.decrypt(onDisk))).toEqual({
      "openai.oauth": "secret-token",
    });

    const reopened = new EncryptedFileCredentialStore(path, base64Cipher);
    expect(await reopened.get("openai.oauth")).toBe("secret-token");
    expect(await reopened.get("kimi.device_id")).toBeUndefined();
  });

  test("writes atomically and leaves no tmp file behind", async () => {
    const path = await tempStorePath();
    const store = new EncryptedFileCredentialStore(path, base64Cipher);
    await store.set("a", "1");
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  test("missing file is empty without logging", async () => {
    const errorSpy = spyOn(console, "error");
    try {
      const store = new EncryptedFileCredentialStore(
        await tempStorePath(),
        base64Cipher,
      );
      expect(await store.get("a")).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("undecryptable file is treated as empty but logged", async () => {
    const path = await tempStorePath();
    await writeFile(path, "!!! not ciphertext !!!", "utf8");
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = new EncryptedFileCredentialStore(path, base64Cipher);
      expect(await store.get("a")).toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      /// The store still works after starting empty.
      await store.set("a", "1");
      expect(await store.get("a")).toBe("1");
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("decrypted-but-not-an-object file is treated as empty but logged", async () => {
    const path = await tempStorePath();
    await writeFile(
      path,
      await base64Cipher.encrypt('"just a string"'),
      "utf8",
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = new EncryptedFileCredentialStore(path, base64Cipher);
      expect(await store.get("a")).toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("serializes concurrent writes", async () => {
    const path = await tempStorePath();
    const store = new EncryptedFileCredentialStore(path, base64Cipher);
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        store.set(`account-${index}`, `${index}`),
      ),
    );
    const reopened = new EncryptedFileCredentialStore(path, base64Cipher);
    for (let index = 0; index < 10; index += 1) {
      expect(await reopened.get(`account-${index}`)).toBe(`${index}`);
    }
  });
});
