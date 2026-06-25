// ReportajGO control panel — talks to the /api JSON endpoints.
const PLATFORMS = ["TELEGRAM", "INSTAGRAM", "FACEBOOK", "WEBSITE", "YOUTUBE"];
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ru", label: "Russian" },
  { code: "uz", label: "Uzbek" },
];
// Cron presets surfaced by the schedule dropdown (keep in sync with index.html).
const CRON_PRESETS = [
  "*/30 * * * *",
  "0 * * * *",
  "0 */2 * * *",
  "0 */4 * * *",
  "0 */6 * * *",
  "0 9,18 * * *",
  "0 9 * * *",
];
const $ = (sel) => document.querySelector(sel);
const el = (id) => document.getElementById(id);

let state = { status: null, tab: "PENDING_APPROVAL" };

// ── helpers ──────────────────────────────────────────────
function toast(msg, isErr = false) {
  const t = el("toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  setTimeout(() => (t.className = "toast"), 2600);
}

async function api(path, opts) {
  const res = await fetch("/api" + path, opts);
  const json = await res.json().catch(() => ({ ok: false, error: "bad response" }));
  if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data;
}

async function withBusy(btn, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin">⟳</span> working…';
  try {
    await fn();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── status + settings render ─────────────────────────────
function renderHealth(h) {
  for (const key of ["postgres", "redis", "gemini"]) {
    const dot = document.querySelector(`.dot[data-h="${key}"]`);
    const flag = h[key];
    dot.classList.toggle("ok", !!flag?.ok);
    dot.classList.toggle("bad", !flag?.ok);
    if (flag?.detail) dot.title = flag.detail;
  }
}

function statCard(k, v, sub) {
  return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${
    sub ? `<div class="row">${sub}</div>` : ""
  }</div>`;
}

function renderStats(s) {
  const q = s.queues || {};
  const c = s.content || {};
  const drafts = c.drafts || {};
  const sched = c.scheduled || {};
  const qrow = (name) => {
    const x = q[name] || {};
    return `<b>${x.active ?? 0}</b> active · <b>${x.waiting ?? 0}</b> wait · <b>${x.failed ?? 0}</b> failed`;
  };
  el("stats").innerHTML = [
    statCard("Pending approval", drafts.PENDING_APPROVAL ?? 0, `${drafts.PENDING_MEDIA ?? 0} awaiting media`),
    statCard("Scheduled", drafts.SCHEDULED ?? 0, `${sched.PENDING ?? 0} queued to publish`),
    statCard("Published", drafts.PUBLISHED ?? 0, `${c.newsItems ?? 0} news items seen`),
    statCard("Pipeline queue", "", qrow("pipeline")),
    statCard("Publish queue", "", qrow("publish")),
  ].join("");
}

function renderIntegrations(integ) {
  const map = { gemini: "Gemini", telegram: "Telegram", meta: "Meta (IG/FB)", higgsfield: "Higgsfield" };
  el("integrations").innerHTML = Object.entries(map)
    .map(([k, label]) => {
      const ok = integ?.[k]?.configured;
      return `<span class="pill"><b>${label}</b> <span class="${ok ? "s-ok" : "s-no"}">${ok ? "✓ configured" : "✗ not set"}</span></span>`;
    })
    .join("");
}

function renderChips(container, items, selected) {
  container.innerHTML = items
    .map(({ value, label }) => {
      const on = selected.includes(value);
      return `<label class="chip ${on ? "on" : ""}">
        <input type="checkbox" value="${value}" ${on ? "checked" : ""}/> ${label}
      </label>`;
    })
    .join("");
  container.querySelectorAll(".chip input").forEach((inp) => {
    inp.addEventListener("change", () => inp.closest(".chip").classList.toggle("on", inp.checked));
  });
}

function renderPlatformChips(enabled) {
  renderChips(el("s-platforms"), PLATFORMS.map((p) => ({ value: p, label: p })), enabled);
}

function renderLanguageChips(langs) {
  renderChips(el("s-langs"), LANGUAGES.map((l) => ({ value: l.code, label: l.label })), langs);
}

// Point the schedule dropdown at the stored cron: a known preset selects it,
// anything else falls back to the custom text input.
function fillSchedule(cron) {
  const preset = el("s-cron-preset");
  if (CRON_PRESETS.includes(cron)) {
    preset.value = cron;
    el("s-cron").style.display = "none";
    el("s-cron").value = cron;
  } else {
    preset.value = "custom";
    el("s-cron").style.display = "";
    el("s-cron").value = cron || "";
  }
}

function fillSettings(cfg) {
  el("s-topics").value = (cfg.researchTopics || []).join(", ");
  fillSchedule(cfg.researchCron || "");
  const model = el("s-model");
  if (![...model.options].some((o) => o.value === cfg.geminiModel)) {
    model.add(new Option(cfg.geminiModel, cfg.geminiModel));
  }
  model.value = cfg.geminiModel;
  renderPlatformChips(cfg.enabledPlatforms || []);
  renderLanguageChips(cfg.contentLanguages || []);
}

function renderCronState(cfg) {
  const active = cfg.cronActive;
  el("cron-state").textContent = active ? `auto: ${cfg.researchCron} (${cfg.tz})` : "auto-research paused";
  el("toggle-cron").textContent = active ? "⏸ Pause auto-research" : "▶ Resume auto-research";
}

async function loadStatus() {
  const s = await api("/status");
  state.status = s;
  el("tz").textContent = s.config.tz;
  renderHealth(s.health);
  renderStats(s);
  renderIntegrations(s.integrations);
  renderCronState(s.config);
  fillSettings(s.config);
  // tab badges
  const d = s.content.drafts || {};
  for (const st of ["PENDING_APPROVAL", "SCHEDULED", "PUBLISHED", "REJECTED", "FAILED"]) {
    el("b-" + st).textContent = d[st] ?? 0;
  }
}

// ── settings save ────────────────────────────────────────
function csv(v) {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}
function selectedCron() {
  const preset = el("s-cron-preset").value;
  return preset === "custom" ? el("s-cron").value.trim() : preset;
}

async function saveSettings(btn) {
  const platforms = [...el("s-platforms").querySelectorAll("input:checked")].map((i) => i.value);
  const languages = [...el("s-langs").querySelectorAll("input:checked")].map((i) => i.value);
  const payload = {
    researchTopics: csv(el("s-topics").value),
    contentLanguages: languages,
    enabledPlatforms: platforms,
    geminiModel: el("s-model").value,
    researchCron: selectedCron(),
  };
  if (!payload.researchTopics.length) return toast("Add at least one topic", true);
  if (!languages.length) return toast("Select at least one language", true);
  if (!platforms.length) return toast("Enable at least one platform", true);
  if (!payload.researchCron) return toast("Pick a schedule (or enter a custom cron)", true);
  await withBusy(btn, async () => {
    await api("/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    toast("Settings saved & applied");
    await loadStatus();
  });
}

// ── content lifecycle ────────────────────────────────────
function mediaEl(media) {
  const m = (media || [])[0];
  if (!m) return '<div class="nomedia">No media<br/>(text-only)</div>';
  if (m.type === "VIDEO") return `<video src="${esc(m.url)}" controls muted loop></video>`;
  return `<img src="${esc(m.url)}" alt="generated visual" />`;
}

function pendingCard(d) {
  const node = document.createElement("article");
  node.className = "card";
  node.innerHTML = `
    <div class="media">${mediaEl(d.media)}</div>
    <div class="body">
      <div class="meta">
        <span class="badge-plat">${esc(d.platform)}</span>
        <span class="src">${esc(d.newsItem?.sourceName ?? "source")} ·
          <a href="${esc(d.newsItem?.sourceUrl)}" target="_blank" rel="noopener">link</a></span>
      </div>
      <h3>${esc(d.newsItem?.title ?? "")}</h3>
      <div>
        <label>Post copy (${esc(d.language)})</label>
        <textarea rows="6" class="f-body">${esc(d.body ?? "")}</textarea>
      </div>
      <div class="form-grid">
        <div><label>Hashtags (comma-separated)</label>
          <input class="f-tags" value="${esc((d.hashtags ?? []).join(", "))}" /></div>
        <div><label>Schedule (local time)</label>
          <input type="datetime-local" class="f-when" value="${defaultWhen()}" /></div>
      </div>
      <div class="actions">
        <button class="ok f-approve">✓ Approve &amp; schedule</button>
        <button class="danger f-reject">Reject</button>
      </div>
    </div>`;
  node.querySelector(".f-approve").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      const whenLocal = node.querySelector(".f-when").value;
      if (!whenLocal) throw new Error("Pick a schedule time");
      await api(`/drafts/${d.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: node.querySelector(".f-body").value,
          hashtags: csv(node.querySelector(".f-tags").value),
          scheduledAt: new Date(whenLocal).toISOString(),
        }),
      });
      toast("Approved & scheduled");
      node.remove();
      loadStatus();
    }),
  );
  node.querySelector(".f-reject").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      const reason = prompt("Reason for rejecting? (optional)") ?? "";
      await api(`/drafts/${d.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      toast("Rejected");
      node.remove();
      loadStatus();
    }),
  );
  return node;
}

function readonlyCard(d) {
  const node = document.createElement("article");
  node.className = "card";
  const sp = d.scheduledPost;
  const lines = [];
  if (sp?.scheduledAt) lines.push(`<div class="kv">Scheduled: <b>${fmtTime(sp.scheduledAt)}</b></div>`);
  if (sp?.publishedAt) lines.push(`<div class="kv">Published: <b>${fmtTime(sp.publishedAt)}</b></div>`);
  if (sp?.externalPostId) lines.push(`<div class="kv">Post id: <b>${esc(sp.externalPostId)}</b></div>`);
  if (d.rejectedReason) lines.push(`<div class="kv">Reason: <b>${esc(d.rejectedReason)}</b></div>`);
  if (sp?.error) lines.push(`<div class="kv">Error: <b>${esc(sp.error)}</b></div>`);
  node.innerHTML = `
    <div class="media">${mediaEl(d.media)}</div>
    <div class="body">
      <div class="meta">
        <span class="badge-plat">${esc(d.platform)}</span>
        <span class="badge-status s-${esc(d.status)}">${esc(d.status)}</span>
        <span class="src">${esc(d.newsItem?.sourceName ?? "source")}</span>
      </div>
      <h3>${esc(d.newsItem?.title ?? "")}</h3>
      <div class="copy">${esc(d.body ?? "")}</div>
      ${lines.join("")}
    </div>`;
  return node;
}

async function loadTab(status) {
  state.tab = status;
  el("tabs").querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === status));
  const list = el("list");
  list.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const posts = await api("/posts/" + status);
    list.innerHTML = "";
    if (!posts.length) {
      list.innerHTML = '<div class="empty">Nothing here yet.</div>';
      return;
    }
    const build = status === "PENDING_APPROVAL" ? pendingCard : readonlyCard;
    posts.forEach((p) => list.appendChild(build(p)));
  } catch (err) {
    list.innerHTML = `<div class="empty">Failed to load: ${esc(err.message)}</div>`;
  }
}

// ── wire up ──────────────────────────────────────────────
function bind() {
  el("run-pipeline").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      await api("/pipeline/run", { method: "POST" });
      toast("Pipeline run queued");
      setTimeout(loadStatus, 1200);
    }),
  );
  el("scan-now").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      await api("/scheduler/scan", { method: "POST" });
      toast("Scan queued");
    }),
  );
  el("toggle-cron").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      const active = state.status?.config?.cronActive;
      await api(active ? "/cron/pause" : "/cron/resume", { method: "POST" });
      toast(active ? "Auto-research paused" : "Auto-research resumed");
      await loadStatus();
    }),
  );
  el("retry-pipeline").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      const r = await api("/queues/pipeline/retry-failed", { method: "POST" });
      toast(`Retried ${r.retried} pipeline job(s)`);
      await loadStatus();
    }),
  );
  el("retry-publish").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      const r = await api("/queues/publish/retry-failed", { method: "POST" });
      toast(`Retried ${r.retried} publish job(s)`);
      await loadStatus();
    }),
  );
  el("refresh").addEventListener("click", (e) => withBusy(e.target, loadStatus));
  el("s-cron-preset").addEventListener("change", (e) => {
    el("s-cron").style.display = e.target.value === "custom" ? "" : "none";
  });
  el("save-settings").addEventListener("click", (e) => saveSettings(e.target));
  el("reset-settings").addEventListener("click", () => {
    if (state.status) fillSettings(state.status.config);
    toast("Form reset");
  });
  el("tabs").querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => loadTab(t.dataset.tab)),
  );
}

async function init() {
  bind();
  await loadStatus();
  await loadTab("PENDING_APPROVAL");
  // gentle auto-refresh of status every 20s
  setInterval(() => loadStatus().catch(() => {}), 20000);
}
init();
