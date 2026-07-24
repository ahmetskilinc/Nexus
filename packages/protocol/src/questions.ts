/// A focused question emitted by the agent while its current run is paused.
/// `callId` is the provider tool-call id and correlates the user's answer.
export type UserQuestion = {
  callId: string;
  question: string;
  choices?: string[];
  allowFreeform: boolean;
};

/// A question held in ephemeral renderer state while the owning run waits.
export type PendingQuestion = UserQuestion & { runId: string };
