import { Router } from "express";
import { logger } from "../config/logger.js";
import { updateRuntimeConfig } from "../config/settingsStore.js";
import {
  pauseResearchCron,
  reRegisterResearchCron,
  resumeResearchCron,
} from "../queue/schedule.js";
import {
  approveDraft,
  listPendingDrafts,
  rejectDraft,
  reschedulePost,
  restoreDraft,
} from "./approvalService.js";
import {
  getStatus,
  listPostsByStatus,
  publishAllPending,
  removeRejectedDrafts,
  retryFailed,
  runPipelineNow,
  scanNow,
} from "./controlService.js";

const log = logger.child({ module: "dashboard:api" });

export const api = Router();

// Small wrapper so each handler's errors become a clean 400 JSON envelope.
function handle(fn: (req: import("express").Request, res: import("express").Response) => Promise<unknown>) {
  return async (req: import("express").Request, res: import("express").Response) => {
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.json({ ok: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ route: req.path, err: message }, "request failed");
      if (!res.headersSent) res.status(400).json({ ok: false, error: message });
    }
  };
}

// ─── Approval queue (existing) ────────────────────────────────────────────────
api.get("/drafts", async (_req, res) => {
  const drafts = await listPendingDrafts();
  res.json({ ok: true, data: drafts });
});

api.post("/drafts/:id/approve", async (req, res) => {
  try {
    const { body, hashtags, scheduledAt, approver, spaced } = req.body ?? {};
    // `spaced` lets the server pick the next free 15-min slot, so a time isn't required.
    if (!spaced && !scheduledAt) {
      return res.status(400).json({ ok: false, error: "scheduledAt is required" });
    }
    const result = await approveDraft(req.params.id, { body, hashtags, scheduledAt, spaced, approver });
    res.json({ ok: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err: message }, "approve failed");
    res.status(400).json({ ok: false, error: message });
  }
});

api.post("/drafts/:id/reject", async (req, res) => {
  try {
    const result = await rejectDraft(req.params.id, req.body?.reason);
    res.json({ ok: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, error: message });
  }
});

// Instant publish: approve at "now" and immediately trigger a scan so the
// scheduler picks it up and publishes right away (no waiting for the cron).
api.post("/drafts/:id/publish-now", handle(async (req) => {
  const { body, hashtags } = req.body ?? {};
  await approveDraft(req.params.id ?? "", {
    body,
    hashtags,
    scheduledAt: new Date().toISOString(),
    approver: "dashboard:instant",
  });
  return scanNow();
}));

api.post("/drafts/:id/restore", handle((req) => restoreDraft(req.params.id ?? "")));

api.post("/drafts/:id/reschedule", handle(async (req) => {
  const { scheduledAt } = req.body ?? {};
  if (!scheduledAt) throw new Error("scheduledAt is required");
  return reschedulePost(req.params.id ?? "", scheduledAt);
}));

// ─── Control panel: status + actions ──────────────────────────────────────────
api.get("/status", handle(() => getStatus()));

api.post("/pipeline/run", handle(() => runPipelineNow()));
api.post("/scheduler/scan", handle(() => scanNow()));
// Publish every pending-approval draft at once (no per-item review).
api.post("/publish/all", handle(() => publishAllPending("dashboard:all")));
// Delete all REJECTED drafts (clears the Rejected list).
api.post("/drafts/remove-rejected", handle(() => removeRejectedDrafts()));
api.post("/queues/:name/retry-failed", handle((req) => retryFailed(req.params.name ?? "")));

api.post("/cron/pause", handle(async () => {
  await pauseResearchCron();
  return { paused: true };
}));
api.post("/cron/resume", handle(async () => {
  await resumeResearchCron();
  return { paused: false };
}));

// ─── Control panel: live settings ─────────────────────────────────────────────
api.put("/settings", handle(async (req) => {
  const { config, changedCron } = await updateRuntimeConfig(req.body);
  // A changed cron only matters while auto-research is active. Never re-arm the
  // repeatable while paused — that would silently resume research the operator
  // stopped. Resume re-registers with the current pattern when they unpause.
  if (changedCron && !config.researchPaused) await reRegisterResearchCron(config.researchCron);
  // The website's sections are the seven fixed content verticals, so they no
  // longer change when a filter is edited — nothing to re-sync here. The set is
  // pushed at startup (see app.ts / main.ts) and only changes with a code-level
  // editorial revision of domain/verticals.ts.
  return config;
}));

// ─── Control panel: content lifecycle lists ───────────────────────────────────
const LIFECYCLE = ["PENDING_APPROVAL", "SCHEDULED", "PUBLISHED", "REJECTED", "FAILED"] as const;
api.get("/posts/:status", handle((req) => {
  const status = (req.params.status ?? "").toUpperCase();
  if (!(LIFECYCLE as readonly string[]).includes(status)) {
    throw new Error(`unknown status: ${status}`);
  }
  return listPostsByStatus(status as (typeof LIFECYCLE)[number]);
}));
