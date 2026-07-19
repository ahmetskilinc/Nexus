import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { collectingEmitter } from "@nexus/protocol";
import { COMMAND_TIMEOUT_MS, runCommand } from "./command";
import {
  commandEnvironmentFromString,
  isDeniedCommand,
  restrictedEnvironment,
} from "./command-policy";
import { cleanup, fixture } from "./testutil";

const unix = process.platform !== "win32";

function run(
  workspace: string,
  command: string,
  options: {
    environment?: "compatible" | "restricted";
    timeoutMs?: number;
    signal?: AbortSignal;
    emitter?: ReturnType<typeof collectingEmitter>;
  } = {},
) {
  return runCommand({
    workspace,
    command,
    environment: options.environment ?? "restricted",
    callId: "c1",
    emitter: options.emitter ?? collectingEmitter(),
    signal: options.signal ?? new AbortController().signal,
    timeoutMs: options.timeoutMs,
  });
}

describe("command policy", () => {
  test("denylist blocks destructive commands but not normal ones", () => {
    expect(isDeniedCommand("rm -rf /")).toBe(true);
    expect(isDeniedCommand("sudo rm -rf ~")).toBe(true);
    expect(isDeniedCommand("dd if=/dev/zero of=/dev/sda")).toBe(true);
    expect(isDeniedCommand("cargo test")).toBe(false);
    expect(isDeniedCommand("rm -rf target/debug")).toBe(false);
    expect(isDeniedCommand("npm run build")).toBe(false);
  });

  test("environment parses restricted and defaults to compatible", () => {
    expect(commandEnvironmentFromString("restricted")).toBe("restricted");
    expect(commandEnvironmentFromString("anything-else")).toBe("compatible");
  });

  test("restricted environment keeps only the allowlist", () => {
    const env = restrictedEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/x",
      LC_ALL: "en_US.UTF-8",
      AWS_SECRET_ACCESS_KEY: "hunter2",
      GITHUB_TOKEN: "ghp_x",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
    expect(env.LC_ALL).toBe("en_US.UTF-8");
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });
});

describe.skipIf(!unix)("runCommand", () => {
  test("reports stdout and exit zero", async () => {
    const { dir } = fixture();
    const outcome = await run(dir, "echo hello");
    expect(outcome.output).toContain("hello");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.timedOut).toBe(false);
    cleanup(dir);
  });

  test("captures a nonzero exit", async () => {
    const { dir } = fixture();
    const outcome = await run(dir, "exit 3");
    expect(outcome.exitCode).toBe(3);
    expect(outcome.timedOut).toBe(false);
    cleanup(dir);
  });

  test("times out and kills promptly", async () => {
    const { dir } = fixture();
    const started = Date.now();
    const outcome = await run(dir, "sleep 5", { timeoutMs: 200 });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
    cleanup(dir);
  });

  test("caps output but keeps draining so the child can exit", async () => {
    const { dir } = fixture();
    const emitter = collectingEmitter();
    const outcome = await run(
      dir,
      "for i in $(seq 1 6000); do echo aaaaa; done",
      { emitter },
    );
    expect(outcome.output).toContain("Output truncated");
    expect(
      outcome.output.endsWith("[Output truncated at 20000 characters]"),
    ).toBe(true);
    // The child was drained to completion, not deadlocked on a full pipe.
    expect(outcome.exitCode).toBe(0);
    expect(outcome.timedOut).toBe(false);
    // Exactly one streamed truncation marker, then silence.
    const markers = emitter.events.filter(
      (event) =>
        event.type === "command_output" &&
        event.chunk === "[output truncated at 20000 characters]",
    );
    expect(markers.length).toBe(1);
    cleanup(dir);
  });

  test("runs in the workspace", async () => {
    const { dir } = fixture();
    const outcome = await run(dir, "pwd -P");
    expect(fs.realpathSync(outcome.output.trim())).toBe(fs.realpathSync(dir));
    cleanup(dir);
  });

  test("streams output deltas", async () => {
    const { dir } = fixture();
    const emitter = collectingEmitter();
    await run(dir, "printf 'a\\nb\\n'", { emitter });
    const deltas = emitter.events.filter(
      (event) => event.type === "command_output",
    );
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    expect(deltas[0]).toEqual({
      type: "command_output",
      callId: "c1",
      stream: "stdout",
      chunk: "a",
    });
    cleanup(dir);
  });

  test("restricted mode drops non-allowlisted variables", async () => {
    const { dir } = fixture();
    process.env.NEXUS_TEST_SECRET = "leak";
    try {
      const probe = "printenv NEXUS_TEST_SECRET || echo absent";
      const restricted = await run(dir, probe, {
        environment: "restricted",
      });
      expect(restricted.output.trim()).toBe("absent");
      const compatible = await run(dir, probe, {
        environment: "compatible",
      });
      expect(compatible.output.trim()).toBe("leak");
      const path = await run(dir, 'echo "$PATH"', {
        environment: "restricted",
      });
      expect(path.output.trim()).not.toBe("");
    } finally {
      delete process.env.NEXUS_TEST_SECRET;
    }
    cleanup(dir);
  });

  test("is killed when the signal aborts", async () => {
    const { dir } = fixture();
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 100);
    const outcome = await run(dir, "sleep 5", { signal: controller.signal });
    expect(outcome.exitCode).toBeNull();
    expect(outcome.timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
    cleanup(dir);
  });

  test("default timeout is 120 seconds", () => {
    expect(COMMAND_TIMEOUT_MS).toBe(120_000);
  });
});
