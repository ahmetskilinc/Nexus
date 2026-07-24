import type { PendingQuestion } from "@nexus/protocol";
import { m } from "motion/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { rise } from "../lib/motion";
import { ToolCard } from "./ToolCard";

const SHELL =
  "rounded-xl border-primary-dim bg-card/70 shadow-[var(--shadow-float)]";

export function QuestionCard({
  question,
  onRespond,
}: {
  question: PendingQuestion;
  onRespond: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function respond(value: string) {
    const trimmed = value.trim();
    if (!trimmed || submitted) return;
    setSubmitted(true);
    onRespond(trimmed);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    respond(answer);
  }

  return (
    <m.div variants={rise} initial="initial" animate="animate" className="mb-6">
      <ToolCard className={SHELL}>
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <span className="text-[11px] font-semibold tracking-wide text-primary-soft uppercase">
            Nexus needs your input
          </span>
          <span className="ml-auto text-[11px] text-faint">Run paused</span>
        </div>
        <div className="border-y border-border-soft px-3.5 py-3 text-[14px] leading-relaxed whitespace-pre-wrap text-foreground">
          {question.question}
        </div>
        <div className="space-y-2 px-3.5 py-3">
          {question.choices?.map((choice) => (
            <Button
              key={choice}
              type="button"
              variant="outline"
              className="w-full justify-start text-left"
              disabled={submitted}
              onClick={() => respond(choice)}
            >
              {choice}
            </Button>
          ))}
          {question.allowFreeform ? (
            <form onSubmit={submit} className="flex gap-2 pt-1">
              <Textarea
                aria-label="Answer the agent's question"
                value={answer}
                disabled={submitted}
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    respond(answer);
                  }
                }}
                placeholder="Type your answer…"
                className="min-h-10 resize-none text-[13px]"
              />
              <Button
                type="submit"
                size="sm"
                disabled={submitted || !answer.trim()}
              >
                Send
              </Button>
            </form>
          ) : null}
        </div>
      </ToolCard>
    </m.div>
  );
}
