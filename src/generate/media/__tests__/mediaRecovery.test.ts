import { describe, expect, it } from "vitest";
import { pickDraftsToRequeue, type RetryCandidate } from "../retryPolicy.js";

const draft = (id: string, media: RetryCandidate["media"]): RetryCandidate => ({ id, media });
const failed = { status: "FAILED", url: null };
const ready = { status: "READY", url: "https://cdn.example.com/a.png" };

describe("pickDraftsToRequeue", () => {
  it("requeues a draft whose attempts all failed", () => {
    expect(pickDraftsToRequeue([draft("a", [failed])], 3, 10)).toEqual(["a"]);
  });

  it("leaves a draft that already has a usable image", () => {
    // Failed once, succeeded on the retry — there is nothing left to recover.
    expect(pickDraftsToRequeue([draft("a", [failed, ready])], 3, 10)).toEqual([]);
  });

  it("stops once the attempt budget is spent", () => {
    // The budget is what stops a provider outage costing unbounded credits.
    expect(pickDraftsToRequeue([draft("a", [failed, failed, failed])], 3, 10)).toEqual([]);
    expect(pickDraftsToRequeue([draft("a", [failed, failed])], 3, 10)).toEqual(["a"]);
  });

  it("counts every attempt, including ones abandoned mid-generation", () => {
    const interrupted = { status: "GENERATING", url: null };
    expect(pickDraftsToRequeue([draft("a", [failed, interrupted, failed])], 3, 10)).toEqual([]);
  });

  it("caps how many drafts one sweep requeues", () => {
    const backlog = ["a", "b", "c", "d", "e"].map((id) => draft(id, [failed]));
    expect(pickDraftsToRequeue(backlog, 3, 2)).toEqual(["a", "b"]);
  });

  it("treats a READY row with no url as unusable", () => {
    expect(pickDraftsToRequeue([draft("a", [{ status: "READY", url: null }])], 3, 10)).toEqual(["a"]);
  });

  it("returns nothing for an empty backlog", () => {
    expect(pickDraftsToRequeue([], 3, 10)).toEqual([]);
  });
});
