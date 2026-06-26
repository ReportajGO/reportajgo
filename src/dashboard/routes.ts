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
    const { body, hashtags, scheduledAt, approver } = req.body ?? {};
    if (!scheduledAt) {
      return res.status(400).json({ ok: false, error: "scheduledAt is required" });
    }
    const result = await approveDraft(req.params.id, { body, hashtags, scheduledAt, approver });
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
  // A changed cron only matters while auto-research is active; resume/re-register
  // keeps the repeatable job pointed at the new pattern.
  if (changedCron) await reRegisterResearchCron(config.researchCron);
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
