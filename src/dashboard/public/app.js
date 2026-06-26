// ReportajGO control panel — talks to the /api JSON endpoints.
const PLATFORMS = ["TELEGRAM", "INSTAGRAM", "FACEBOOK", "WEBSITE", "YOUTUBE"];
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ru", label: "Russian" },
  { code: "uz", label: "Uzbek" },
];
const CRON_PRESETS = [
  "*/30 * * * *", "0 * * * *", "0 */2 * * *", "0 */4 * * *",
  "0 */6 * * *", "0 9,18 * * *", "0 9 * * *",
];
const $ = (sel) => document.querySelector(sel);
const el = (id) => document.getElementById(id);

let state = { status: null, tab: "PENDING_APPROVAL", topics: [] };

// ── i18n ─────────────────────────────────────────────────
const I18N = {
  en: {
    appTitle: "· Control Panel", systemStatus: "System status",
    pipelineControls: "Pipeline controls",
    runPipeline: "▶ Run pipeline now", scanNow: "⟳ Scan due posts",
    pauseCron: "⏸ Pause auto-research", resumeCron: "▶ Resume auto-research",
    retryPipeline: "↻ Retry failed (pipeline)", retryPublish: "↻ Retry failed (publish)",
    refresh: "⟲ Refresh",
    controlsHelp: "Auto-research runs on the schedule below. “Run pipeline now” triggers an immediate research→copy→media cycle without waiting for the cron.",
    settings: "Settings", appliedLive: "Applied live · no restart",
    topicsLabel: "Research topics",
    topicsHelp: "One topic per chip. The agent searches each worldwide — add or remove as many as you like.",
    topicAddPh: "Add a topic, then press Enter", add: "Add",
    contentLangs: "Content languages", contentLangsHelp: "First selected language is the primary post language.",
    geminiModel: "Gemini model", enabledPlatforms: "Enabled platforms",
    scheduleLabel: "Research schedule — how often to look for news",
    cronEvery30: "Every 30 minutes", cronHourly: "Every hour", cron2h: "Every 2 hours",
    cron4h: "Every 4 hours", cron6h: "Every 6 hours", cronTwice: "Twice a day (09:00 & 18:00)",
    cronDaily: "Once a day (09:00)", cronCustom: "Custom cron…",
    cronHelp: "Times use the schedule timezone shown in the header.",
    integrations: "Integrations (read-only · set via .env)",
    saveSettings: "💾 Save settings", resetForm: "Reset form",
    content: "Content", tabPending: "Pending", tabScheduled: "Scheduled",
    tabPublished: "Published", tabRejected: "Rejected", tabFailed: "Failed",
    loading: "Loading…", nothingHere: "Nothing here yet.", failedToLoad: "Failed to load:",
    noTopics: "No topics yet — add one below.",
    stat_pending: "Pending approval", stat_scheduled: "Scheduled", stat_published: "Published",
    stat_pipelineQueue: "Pipeline queue", stat_publishQueue: "Publish queue",
    sub_awaitingMedia: "awaiting media", sub_queuedToPublish: "queued to publish",
    sub_newsSeen: "news items seen", q_active: "active", q_wait: "wait", q_failed: "failed",
    cron_on: "auto", cron_paused: "auto-research paused", conf_yes: "configured", conf_no: "not set",
    postCopy: "Post copy", hashtags: "Hashtags (comma-separated)", scheduleLocal: "Schedule (local time)",
    approve: "✓ Approve & schedule", reject: "Reject", linkWord: "link", sourceWord: "source",
    scheduledAt: "Scheduled:", publishedAt: "Published:", postId: "Post id:", reason: "Reason:", errorWord: "Error:",
    t_settingsSaved: "Settings saved & applied", t_pipelineQueued: "Pipeline run queued",
    t_scanQueued: "Scan queued", t_autoPaused: "Auto-research paused", t_autoResumed: "Auto-research resumed",
    t_retriedPipe: "pipeline job(s) retried", t_retriedPub: "publish job(s) retried",
    t_formReset: "Form reset", t_addOneTopic: "Add at least one topic",
    t_selectLang: "Select at least one language", t_enablePlatform: "Enable at least one platform",
    t_pickSchedule: "Pick a schedule (or enter a custom cron)", t_pickTime: "Pick a schedule time",
    t_approved: "Approved & scheduled", t_rejected: "Rejected", t_rejectReason: "Reason for rejecting? (optional)",
  },
  uz: {
    appTitle: "· Boshqaruv paneli", systemStatus: "Tizim holati",
    pipelineControls: "Konveyer boshqaruvi",
    runPipeline: "▶ Hozir ishga tushirish", scanNow: "⟳ Navbatdagilarni tekshirish",
    pauseCron: "⏸ Avto-izlanishni to‘xtatish", resumeCron: "▶ Avto-izlanishni davom ettirish",
    retryPipeline: "↻ Qayta urinish (konveyer)", retryPublish: "↻ Qayta urinish (e’lon)",
    refresh: "⟲ Yangilash",
    controlsHelp: "Avto-izlanish quyidagi jadval bo‘yicha ishlaydi. “Hozir ishga tushirish” kron’ni kutmasdan darhol izlanish→matn→media tsiklini boshlaydi.",
    settings: "Sozlamalar", appliedLive: "Jonli qo‘llanadi · qayta ishga tushirishsiz",
    topicsLabel: "Izlanish mavzulari",
    topicsHelp: "Har bir chipda bitta mavzu. Agent har birini butun dunyo bo‘ylab izlaydi — xohlagancha qo‘shing yoki o‘chiring.",
    topicAddPh: "Mavzu qo‘shing va Enter bosing", add: "Qo‘shish",
    contentLangs: "Kontent tillari", contentLangsHelp: "Birinchi tanlangan til — asosiy post tili.",
    geminiModel: "Gemini modeli", enabledPlatforms: "Yoqilgan platformalar",
    scheduleLabel: "Izlanish jadvali — yangiliklarni qanchalik tez-tez izlash",
    cronEvery30: "Har 30 daqiqada", cronHourly: "Har soatda", cron2h: "Har 2 soatda",
    cron4h: "Har 4 soatda", cron6h: "Har 6 soatda", cronTwice: "Kuniga ikki marta (09:00 va 18:00)",
    cronDaily: "Kuniga bir marta (09:00)", cronCustom: "Maxsus cron…",
    cronHelp: "Vaqtlar sarlavhadagi vaqt mintaqasida ko‘rsatiladi.",
    integrations: "Integratsiyalar (faqat o‘qish · .env orqali)",
    saveSettings: "💾 Saqlash", resetForm: "Tozalash",
    content: "Kontent", tabPending: "Kutilmoqda", tabScheduled: "Rejada",
    tabPublished: "E’lon qilingan", tabRejected: "Rad etilgan", tabFailed: "Xatolik",
    loading: "Yuklanmoqda…", nothingHere: "Hozircha bo‘sh.", failedToLoad: "Yuklab bo‘lmadi:",
    noTopics: "Hali mavzu yo‘q — quyidan qo‘shing.",
    stat_pending: "Tasdiqlash kutilmoqda", stat_scheduled: "Rejada", stat_published: "E’lon qilingan",
    stat_pipelineQueue: "Konveyer navbati", stat_publishQueue: "E’lon navbati",
    sub_awaitingMedia: "media kutilmoqda", sub_queuedToPublish: "e’longa navbatda",
    sub_newsSeen: "ko‘rilgan yangiliklar", q_active: "faol", q_wait: "kutilmoqda", q_failed: "xato",
    cron_on: "avto", cron_paused: "avto-izlanish to‘xtatilgan", conf_yes: "sozlangan", conf_no: "yo‘q",
    postCopy: "Post matni", hashtags: "Heshteglar (vergul bilan)", scheduleLocal: "Reja (mahalliy vaqt)",
    approve: "✓ Tasdiqlash va rejaga olish", reject: "Rad etish", linkWord: "havola", sourceWord: "manba",
    scheduledAt: "Rejada:", publishedAt: "E’lon qilingan:", postId: "Post id:", reason: "Sabab:", errorWord: "Xato:",
    t_settingsSaved: "Sozlamalar saqlandi", t_pipelineQueued: "Konveyer navbatga qo‘yildi",
    t_scanQueued: "Tekshiruv navbatga qo‘yildi", t_autoPaused: "Avto-izlanish to‘xtatildi", t_autoResumed: "Avto-izlanish davom etdi",
    t_retriedPipe: "konveyer ishi qayta urinildi", t_retriedPub: "e’lon ishi qayta urinildi",
    t_formReset: "Forma tozalandi", t_addOneTopic: "Kamida bitta mavzu qo‘shing",
    t_selectLang: "Kamida bitta tilni tanlang", t_enablePlatform: "Kamida bitta platformani yoqing",
    t_pickSchedule: "Jadvalni tanlang (yoki maxsus cron kiriting)", t_pickTime: "Reja vaqtini tanlang",
    t_approved: "Tasdiqlandi va rejaga olindi", t_rejected: "Rad etildi", t_rejectReason: "Rad etish sababi? (ixtiyoriy)",
  },
  ru: {
    appTitle: "· Панель управления", systemStatus: "Состояние системы",
    pipelineControls: "Управление конвейером",
    runPipeline: "▶ Запустить сейчас", scanNow: "⟳ Проверить очередь",
    pauseCron: "⏸ Остановить авто-поиск", resumeCron: "▶ Возобновить авто-поиск",
    retryPipeline: "↻ Повторить (конвейер)", retryPublish: "↻ Повторить (публикация)",
    refresh: "⟲ Обновить",
    controlsHelp: "Авто-поиск работает по расписанию ниже. «Запустить сейчас» немедленно запускает цикл поиск→текст→медиа, не дожидаясь крона.",
    settings: "Настройки", appliedLive: "Применяется сразу · без перезапуска",
    topicsLabel: "Темы для поиска",
    topicsHelp: "Одна тема на чип. Агент ищет каждую по всему миру — добавляйте или удаляйте сколько нужно.",
    topicAddPh: "Добавьте тему и нажмите Enter", add: "Добавить",
    contentLangs: "Языки контента", contentLangsHelp: "Первый выбранный язык — основной язык поста.",
    geminiModel: "Модель Gemini", enabledPlatforms: "Включённые платформы",
    scheduleLabel: "Расписание поиска — как часто искать новости",
    cronEvery30: "Каждые 30 минут", cronHourly: "Каждый час", cron2h: "Каждые 2 часа",
    cron4h: "Каждые 4 часа", cron6h: "Каждые 6 часов", cronTwice: "Дважды в день (09:00 и 18:00)",
    cronDaily: "Раз в день (09:00)", cronCustom: "Свой cron…",
    cronHelp: "Время — в часовом поясе, указанном в шапке.",
    integrations: "Интеграции (только чтение · через .env)",
    saveSettings: "💾 Сохранить", resetForm: "Сбросить",
    content: "Контент", tabPending: "Ожидают", tabScheduled: "Запланированы",
    tabPublished: "Опубликованы", tabRejected: "Отклонены", tabFailed: "Ошибки",
    loading: "Загрузка…", nothingHere: "Пока пусто.", failedToLoad: "Не удалось загрузить:",
    noTopics: "Тем пока нет — добавьте ниже.",
    stat_pending: "Ожидают одобрения", stat_scheduled: "Запланированы", stat_published: "Опубликованы",
    stat_pipelineQueue: "Очередь конвейера", stat_publishQueue: "Очередь публикаций",
    sub_awaitingMedia: "ждут медиа", sub_queuedToPublish: "в очереди на публикацию",
    sub_newsSeen: "просмотрено новостей", q_active: "активно", q_wait: "ожидание", q_failed: "ошибки",
    cron_on: "авто", cron_paused: "авто-поиск остановлен", conf_yes: "настроено", conf_no: "не задано",
    postCopy: "Текст поста", hashtags: "Хэштеги (через запятую)", scheduleLocal: "Время (локальное)",
    approve: "✓ Одобрить и запланировать", reject: "Отклонить", linkWord: "ссылка", sourceWord: "источник",
    scheduledAt: "Запланировано:", publishedAt: "Опубликовано:", postId: "ID поста:", reason: "Причина:", errorWord: "Ошибка:",
    t_settingsSaved: "Настройки сохранены", t_pipelineQueued: "Конвейер поставлен в очередь",
    t_scanQueued: "Проверка поставлена в очередь", t_autoPaused: "Авто-поиск остановлен", t_autoResumed: "Авто-поиск возобновлён",
    t_retriedPipe: "задач конвейера повторено", t_retriedPub: "задач публикации повторено",
    t_formReset: "Форма сброшена", t_addOneTopic: "Добавьте хотя бы одну тему",
    t_selectLang: "Выберите хотя бы один язык", t_enablePlatform: "Включите хотя бы одну платформу",
    t_pickSchedule: "Выберите расписание (или введите свой cron)", t_pickTime: "Выберите время",
    t_approved: "Одобрено и запланировано", t_rejected: "Отклонено", t_rejectReason: "Причина отклонения? (необязательно)",
  },
};

let lang = localStorage.getItem("rg_lang") || "en";
const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;

function applyStaticI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPh);
  });
  el("lang-switch").querySelectorAll("button").forEach((b) =>
    b.classList.toggle("on", b.dataset.lang === lang),
  );
}

function setLang(next) {
  lang = next;
  localStorage.setItem("rg_lang", next);
  applyStaticI18n();
  renderTopics();
  if (state.status) {
    renderCronState(state.status.config);
    renderStats(state.status);
    renderIntegrations(state.status.integrations);
  }
  loadTab(state.tab);
}

// ── theme ────────────────────────────────────────────────
let theme = localStorage.getItem("rg_theme") || "dark";
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  el("theme-toggle").textContent = theme === "dark" ? "☀️" : "🌙";
}
function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem("rg_theme", theme);
  applyTheme();
}

// ── helpers ──────────────────────────────────────────────
function toast(msg, isErr = false) {
  const el2 = el("toast");
  el2.textContent = msg;
  el2.className = "toast show" + (isErr ? " err" : "");
  setTimeout(() => (el2.className = "toast"), 2600);
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
  btn.innerHTML = '<span class="spin">⟳</span> …';
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
    return `<b>${x.active ?? 0}</b> ${t("q_active")} · <b>${x.waiting ?? 0}</b> ${t("q_wait")} · <b>${x.failed ?? 0}</b> ${t("q_failed")}`;
  };
  el("stats").innerHTML = [
    statCard(t("stat_pending"), drafts.PENDING_APPROVAL ?? 0, `${drafts.PENDING_MEDIA ?? 0} ${t("sub_awaitingMedia")}`),
    statCard(t("stat_scheduled"), drafts.SCHEDULED ?? 0, `${sched.PENDING ?? 0} ${t("sub_queuedToPublish")}`),
    statCard(t("stat_published"), drafts.PUBLISHED ?? 0, `${c.newsItems ?? 0} ${t("sub_newsSeen")}`),
    statCard(t("stat_pipelineQueue"), "", qrow("pipeline")),
    statCard(t("stat_publishQueue"), "", qrow("publish")),
  ].join("");
}

function renderIntegrations(integ) {
  const map = { gemini: "Gemini", telegram: "Telegram", meta: "Meta (IG/FB)", higgsfield: "Higgsfield" };
  el("integrations").innerHTML = Object.entries(map)
    .map(([k, label]) => {
      const ok = integ?.[k]?.configured;
      return `<span class="pill"><b>${label}</b> <span class="${ok ? "s-ok" : "s-no"}">${ok ? "✓ " + t("conf_yes") : "✗ " + t("conf_no")}</span></span>`;
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

// ── topics editor (chips) ────────────────────────────────
function renderTopics() {
  const box = el("s-topics");
  if (!state.topics.length) {
    box.innerHTML = `<span class="topic-empty">${t("noTopics")}</span>`;
    return;
  }
  box.innerHTML = state.topics
    .map((tp, i) => `<span class="topic">${esc(tp)}<button type="button" class="rm" data-i="${i}" aria-label="remove">×</button></span>`)
    .join("");
  box.querySelectorAll(".rm").forEach((b) =>
    b.addEventListener("click", () => {
      state.topics.splice(Number(b.dataset.i), 1);
      renderTopics();
    }),
  );
}
function addTopic() {
  const inp = el("s-topic-input");
  const v = inp.value.trim();
  if (!v) return;
  if (!state.topics.some((x) => x.toLowerCase() === v.toLowerCase())) state.topics.push(v);
  inp.value = "";
  renderTopics();
}

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
  state.topics = [...(cfg.researchTopics || [])];
  renderTopics();
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
  el("cron-state").textContent = active ? `${t("cron_on")}: ${cfg.researchCron} (${cfg.tz})` : t("cron_paused");
  el("toggle-cron").textContent = active ? t("pauseCron") : t("resumeCron");
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
    researchTopics: state.topics,
    contentLanguages: languages,
    enabledPlatforms: platforms,
    geminiModel: el("s-model").value,
    researchCron: selectedCron(),
  };
  if (!payload.researchTopics.length) return toast(t("t_addOneTopic"), true);
  if (!languages.length) return toast(t("t_selectLang"), true);
  if (!platforms.length) return toast(t("t_enablePlatform"), true);
  if (!payload.researchCron) return toast(t("t_pickSchedule"), true);
  await withBusy(btn, async () => {
    await api("/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    toast(t("t_settingsSaved"));
    await loadStatus();
  });
}

// ── content lifecycle ────────────────────────────────────
function mediaEl(media) {
  const m = (media || [])[0];
  if (!m) return '<div class="nomedia">—</div>';
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
        <span class="src">${esc(d.newsItem?.sourceName ?? t("sourceWord"))} ·
          <a href="${esc(d.newsItem?.sourceUrl)}" target="_blank" rel="noopener">${t("linkWord")}</a></span>
      </div>
      <h3>${esc(d.newsItem?.title ?? "")}</h3>
      <div>
        <label>${t("postCopy")} (${esc(d.language)})</label>
        <textarea rows="6" class="f-body">${esc(d.body ?? "")}</textarea>
      </div>
      <div class="form-grid">
        <div><label>${t("hashtags")}</label>
          <input class="f-tags" value="${esc((d.hashtags ?? []).join(", "))}" /></div>
        <div><label>${t("scheduleLocal")}</label>
          <input type="datetime-local" class="f-when" value="${defaultWhen()}" /></div>
      </div>
      <div class="actions">
        <button class="ok f-approve">${t("approve")}</button>
        <button class="danger f-reject">${t("reject")}</button>
      </div>
    </div>`;
  node.querySelector(".f-approve").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      const whenLocal = node.querySelector(".f-when").value;
      if (!whenLocal) throw new Error(t("t_pickTime"));
      await api(`/drafts/${d.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: node.querySelector(".f-body").value,
          hashtags: csv(node.querySelector(".f-tags").value),
          scheduledAt: new Date(whenLocal).toISOString(),
        }),
      });
      toast(t("t_approved"));
      node.remove();
      loadStatus();
    }),
  );
  node.querySelector(".f-reject").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      const reason = prompt(t("t_rejectReason")) ?? "";
      await api(`/drafts/${d.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      toast(t("t_rejected"));
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
  if (sp?.scheduledAt) lines.push(`<div class="kv">${t("scheduledAt")} <b>${fmtTime(sp.scheduledAt)}</b></div>`);
  if (sp?.publishedAt) lines.push(`<div class="kv">${t("publishedAt")} <b>${fmtTime(sp.publishedAt)}</b></div>`);
  if (sp?.externalPostId) lines.push(`<div class="kv">${t("postId")} <b>${esc(sp.externalPostId)}</b></div>`);
  if (d.rejectedReason) lines.push(`<div class="kv">${t("reason")} <b>${esc(d.rejectedReason)}</b></div>`);
  if (sp?.error) lines.push(`<div class="kv">${t("errorWord")} <b>${esc(sp.error)}</b></div>`);
  node.innerHTML = `
    <div class="media">${mediaEl(d.media)}</div>
    <div class="body">
      <div class="meta">
        <span class="badge-plat">${esc(d.platform)}</span>
        <span class="badge-status s-${esc(d.status)}">${esc(d.status)}</span>
        <span class="src">${esc(d.newsItem?.sourceName ?? t("sourceWord"))}</span>
      </div>
      <h3>${esc(d.newsItem?.title ?? "")}</h3>
      <div class="copy">${esc(d.body ?? "")}</div>
      ${lines.join("")}
    </div>`;
  return node;
}

async function loadTab(status) {
  state.tab = status;
  el("tabs").querySelectorAll(".tab").forEach((tabBtn) => tabBtn.classList.toggle("on", tabBtn.dataset.tab === status));
  const list = el("list");
  list.innerHTML = `<div class="empty">${t("loading")}</div>`;
  try {
    const posts = await api("/posts/" + status);
    list.innerHTML = "";
    if (!posts.length) {
      list.innerHTML = `<div class="empty">${t("nothingHere")}</div>`;
      return;
    }
    const build = status === "PENDING_APPROVAL" ? pendingCard : readonlyCard;
    posts.forEach((p) => list.appendChild(build(p)));
  } catch (err) {
    list.innerHTML = `<div class="empty">${t("failedToLoad")} ${esc(err.message)}</div>`;
  }
}

// ── wire up ──────────────────────────────────────────────
function bind() {
  el("lang-switch").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => setLang(b.dataset.lang)),
  );
  el("theme-toggle").addEventListener("click", toggleTheme);

  el("s-topic-add").addEventListener("click", addTopic);
  el("s-topic-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTopic();
    }
  });

  el("run-pipeline").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      await api("/pipeline/run", { method: "POST" });
      toast(t("t_pipelineQueued"));
      setTimeout(loadStatus, 1200);
    }),
  );
  el("scan-now").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      await api("/scheduler/scan", { method: "POST" });
      toast(t("t_scanQueued"));
    }),
  );
  el("toggle-cron").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      const active = state.status?.config?.cronActive;
      await api(active ? "/cron/pause" : "/cron/resume", { method: "POST" });
      toast(active ? t("t_autoPaused") : t("t_autoResumed"));
      await loadStatus();
    }),
  );
  el("retry-pipeline").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      const r = await api("/queues/pipeline/retry-failed", { method: "POST" });
      toast(`${r.retried} ${t("t_retriedPipe")}`);
      await loadStatus();
    }),
  );
  el("retry-publish").addEventListener("click", (e) =>
    withBusy(e.target, async () => {
      const r = await api("/queues/publish/retry-failed", { method: "POST" });
      toast(`${r.retried} ${t("t_retriedPub")}`);
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
    toast(t("t_formReset"));
  });
  el("tabs").querySelectorAll(".tab").forEach((tabBtn) =>
    tabBtn.addEventListener("click", () => loadTab(tabBtn.dataset.tab)),
  );
}

async function init() {
  applyTheme();
  applyStaticI18n();
  bind();
  await loadStatus();
  await loadTab("PENDING_APPROVAL");
  setInterval(() => loadStatus().catch(() => {}), 20000);
}
init();
