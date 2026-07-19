import { describe, expect, test } from "bun:test";
import { guardPublicUrl, isPublicAddress } from "./ssrf";

describe("isPublicAddress", () => {
  test("blocks internal ranges", () => {
    const bad = [
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.1",
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "255.255.255.255",
      "192.0.2.1", // documentation
      "224.0.0.1", // multicast
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1", // v4-mapped loopback
      "::ffff:10.0.0.1", // v4-mapped private
    ];
    for (const address of bad) {
      expect(isPublicAddress(address)).toBe(false);
    }
  });

  test("allows public ranges", () => {
    const good = [
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34",
      "2606:2800:220:1::",
      "::ffff:8.8.8.8", // v4-mapped public
    ];
    for (const address of good) {
      expect(isPublicAddress(address)).toBe(true);
    }
  });

  test("rejects non-addresses", () => {
    expect(isPublicAddress("not-an-ip")).toBe(false);
  });
});

describe("guardPublicUrl", () => {
  test("rejects loopback and metadata addresses", async () => {
    await expect(guardPublicUrl("http://127.0.0.1/")).rejects.toThrow(
      "non-public",
    );
    await expect(guardPublicUrl("http://localhost/")).rejects.toThrow();
    await expect(
      guardPublicUrl("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow("non-public");
    await expect(guardPublicUrl("http://[::1]/")).rejects.toThrow("non-public");
  });

  test("accepts hosts that resolve publicly via the injected lookup", async () => {
    const lookup = async () => [{ address: "93.184.216.34" }];
    await expect(
      guardPublicUrl("https://example.com/", lookup),
    ).resolves.toBeUndefined();
  });

  test("rejects hosts with any non-public record", async () => {
    const lookup = async () => [
      { address: "93.184.216.34" },
      { address: "10.0.0.5" },
    ];
    await expect(
      guardPublicUrl("https://rebind.example/", lookup),
    ).rejects.toThrow("non-public address (10.0.0.5)");
  });

  test("rejects unresolvable and empty results", async () => {
    await expect(
      guardPublicUrl("https://x.example/", async () => []),
    ).rejects.toThrow("did not resolve to any address");
    await expect(
      guardPublicUrl("https://x.example/", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow("could not be resolved");
  });
});
