import { describe, expect, test } from "bun:test";
import { ApprovalMailbox, QuestionMailbox } from "./approvals";

describe("ApprovalMailbox", () => {
  test("a reply delivered before wait() is buffered, not lost", async () => {
    const mailbox = new ApprovalMailbox();
    mailbox.deliver({ callId: "c1", approved: false });
    expect(await mailbox.wait("c1")).toBe(false);
  });

  test("stale replies for other calls are skipped", async () => {
    const mailbox = new ApprovalMailbox();
    mailbox.deliver({ callId: "old-call", approved: true });
    mailbox.deliver({ callId: "c2", approved: true });
    // The buffered old-call reply is skipped; c2's answer arrives.
    expect(await mailbox.wait("c2")).toBe(true);
  });

  test("a live waiter ignores stale ids and resolves on its own", async () => {
    const mailbox = new ApprovalMailbox();
    const pending = mailbox.wait("c3");
    mailbox.deliver({ callId: "other", approved: true });
    mailbox.deliver({ callId: "c3", approved: true });
    expect(await pending).toBe(true);
  });

  test("close resolves a live wait as a decline", async () => {
    const mailbox = new ApprovalMailbox();
    const pending = mailbox.wait("c4");
    mailbox.close();
    expect(await pending).toBe(false);
    // And later waits decline immediately.
    expect(await mailbox.wait("c5")).toBe(false);
  });

  test("an aborted run resolves the wait as a decline", async () => {
    const mailbox = new ApprovalMailbox();
    const controller = new AbortController();
    const pending = mailbox.wait("c6", controller.signal);
    controller.abort();
    expect(await pending).toBe(false);
    // An already-aborted signal declines immediately.
    expect(await mailbox.wait("c7", controller.signal)).toBe(false);
  });
});

describe("QuestionMailbox", () => {
  test("buffers early answers, skips stale replies, and closes safely", async () => {
    const mailbox = new QuestionMailbox();
    mailbox.deliver({ callId: "old", answer: "old answer" });
    mailbox.deliver({ callId: "c1", answer: "PostgreSQL" });
    expect(await mailbox.wait("c1")).toBe("PostgreSQL");

    const pending = mailbox.wait("c2");
    mailbox.deliver({ callId: "other", answer: "ignored" });
    mailbox.deliver({ callId: "c2", answer: "SQLite" });
    expect(await pending).toBe("SQLite");

    const closed = mailbox.wait("c3");
    mailbox.close();
    expect(await closed).toBeUndefined();
  });

  test("an aborted wait resolves without an answer", async () => {
    const mailbox = new QuestionMailbox();
    const controller = new AbortController();
    const pending = mailbox.wait("c1", controller.signal);
    controller.abort();
    expect(await pending).toBeUndefined();
  });
});
