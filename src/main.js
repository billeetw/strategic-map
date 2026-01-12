import "./style.css";
import { astro } from "iztro";
import { KB2026 } from "./kb_2026.js";

/** =======================
 *  Config
 *  ======================= */
const SIHUA_2026 = KB2026?.annual_sihua_2026 || { "天同": "祿", "天機": "權", "文昌": "科", "廉貞": "忌" };
const CONSULT_FORM_URL = "https://forms.gle/Vvs6U12TeMYtab8A6"; // 你要改連結就改這裡

let _lastChart = null;
let _lastLianZhenIdx = -1;
let _selectedPalaceIdx = -1;

let _ziCharts = null; // { lateChart, earlyChart }
let _sheet = null;

/** =======================
 *  Helpers
 *  ======================= */
function toSafeText(v) {
  return v === null || v === undefined ? "" : String(v);
}

function showError(msg) {
  const box = document.getElementById("error-box");
  if (!box) return;
  box.textContent = msg;
  box.classList.remove("hidden");
}

function clearError() {
  const box = document.getElementById("error-box");
  if (!box) return;
  box.textContent = "";
  box.classList.add("hidden");
}

function isMobileView() {
  return window.matchMedia("(max-width: 640px)").matches;
}

/** iztro timeIndex：
 *  0 = 早子(00:xx)
 *  12 = 晚子(23:xx)
 *  1..11 = 丑..亥
 */
function timeIndexFromInput(tob) {
  const hour = parseInt((tob || "12:00").split(":")[0], 10);
  if (hour === 0) return 0;
  if (hour === 23) return 12;
  return Math.floor((hour + 1) / 2);
}

function timeIndexFromShichen(shichen, ziMode = "auto") {
  const map = { "丑": 1, "寅": 2, "卯": 3, "辰": 4, "巳": 5, "午": 6, "未": 7, "申": 8, "酉": 9, "戌": 10, "亥": 11 };
  if (shichen === "子") {
    if (ziMode === "late") return 12;
    if (ziMode === "early") return 0;
    return null; // auto → 雙盤
  }
  return map[shichen] ?? null;
}

function getTimePlan() {
  const shichen = document.getElementById("shichen")?.value || "";
  const ziMode = document.getElementById("zi-mode")?.value || "auto";
  const tob = document.getElementById("tob")?.value || "12:00";

  if (shichen) {
    const idx = timeIndexFromShichen(shichen, ziMode);
    if (shichen === "子" && idx === null) {
      return { kind: "dual-zi", late: 12, early: 0, shichen, ziMode, tob };
    }
    return { kind: "single", timeIdx: idx ?? timeIndexFromInput(tob), source: "shichen", shichen, ziMode, tob };
  }

  return { kind: "single", timeIdx: timeIndexFromInput(tob), source: "time", shichen: "", ziMode: "auto", tob };
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate(); // m: 1..12
}

function initDOBSelectors() {
  const yEl = document.getElementById("dob-year");
  const mEl = document.getElementById("dob-month");
  const dEl = document.getElementById("dob-day");
  if (!yEl || !mEl || !dEl) return;

  const saved = localStorage.getItem("sm_dob");
  let defY = 1995, defM = 1, defD = 1;
  if (saved) {
    const parts = saved.split("-").map((n) => parseInt(n, 10));
    if (parts.length === 3 && parts.every((x) => Number.isFinite(x))) {
      [defY, defM, defD] = parts;
    }
  }

  const currentYear = new Date().getFullYear();
  yEl.innerHTML = "";
  for (let y = currentYear; y >= 1900; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = `${y} 年`;
    yEl.appendChild(opt);
  }

  mEl.innerHTML = "";
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = `${m} 月`;
    mEl.appendChild(opt);
  }

  function syncDays() {
    const y = parseInt(yEl.value, 10);
    const m = parseInt(mEl.value, 10);
    const maxD = daysInMonth(y, m);
    const currentD = parseInt(dEl.value || "1", 10);

    dEl.innerHTML = "";
    for (let d = 1; d <= maxD; d++) {
      const opt = document.createElement("option");
      opt.value = String(d);
      opt.textContent = `${d} 日`;
      dEl.appendChild(opt);
    }
    dEl.value = String(Math.min(currentD, maxD));
  }

  yEl.value = String(defY);
  mEl.value = String(defM);
  syncDays();
  dEl.value = String(defD);

  yEl.addEventListener("change", syncDays);
  mEl.addEventListener("change", syncDays);
}

function getDOBParts() {
  const yEl = document.getElementById("dob-year");
  const mEl = document.getElementById("dob-month");
  const dEl = document.getElementById("dob-day");
  if (!yEl || !mEl || !dEl) return null;

  const y = parseInt(yEl.value, 10);
  const m = parseInt(mEl.value, 10);
  const d = parseInt(dEl.value, 10);
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) return { y, m, d };
  return null;
}

/** =======================
 *  Palace name canonicalization (aliases)
 *  ======================= */
const PALACE_ALIAS = {
  "命": ["命", "命宮", "命宫"],
  "兄弟": ["兄弟", "兄弟宮", "兄弟宫"],
  "夫妻": ["夫妻", "夫妻宮", "夫妻宫", "配偶", "配偶宮", "婚姻", "感情"],
  "子女": ["子女", "子女宮", "子女宫"],
  "財帛": ["財帛", "财帛", "財帛宮", "财帛宫", "財", "钱财", "金錢", "金钱"],
  "疾厄": ["疾厄", "疾厄宮", "疾厄宫", "健康", "病厄", "身體", "身体"],
  "遷移": ["遷移", "迁移", "遷移宮", "迁移宫", "外出", "出外", "旅行", "遠行", "远行"],
  "交友": ["交友", "交友宮", "交友宫", "朋友", "奴僕", "奴仆", "僕役", "仆役", "部屬", "部属"],
  "官祿": ["官祿", "官禄", "官祿宮", "官禄宫", "事業", "事业", "工作", "職場", "职场"],
  "田宅": ["田宅", "田宅宮", "田宅宫", "房產", "房产", "家宅", "不動產", "不动产", "根基", "後勤", "后勤"],
  "福德": ["福德", "福德宮", "福德宫", "精神", "享受", "內在", "内在"],
  "父母": ["父母", "父母宮", "父母宫", "長輩", "长辈", "權威", "权威", "合約", "合约", "文書", "文书"],
};

const ALIAS_TO_KEY = (() => {
  const m = new Map();
  for (const [key, arr] of Object.entries(PALACE_ALIAS)) {
    arr.forEach((a) => m.set(a, key));
  }
  return m;
})();

function normalizePalaceName(name) {
  let s = toSafeText(name).trim();
  s = s.replace(/[　\s]/g, "");
  s = s.replace(/宮|宫/g, ""); // 去掉「宮」
  // 常見別名直接映射
  if (ALIAS_TO_KEY.has(s)) return ALIAS_TO_KEY.get(s);
  // 有些軟體會顯示「事業(身宮)」等
  s = s.replace(/\(.*?\)/g, "");
  if (ALIAS_TO_KEY.has(s)) return ALIAS_TO_KEY.get(s);
  return s; // fallback
}

function palaceDefByName(palaceName) {
  const key = normalizePalaceName(palaceName);
  return KB2026?.palace_definitions?.[key] || null;
}

function starsOfPalace(palace) {
  return (palace?.majorStars || []).map((s) => s.name).filter(Boolean);
}

function starTagForMajors(majors) {
  if (!KB2026?.star_profiles) return null;
  if (!majors || majors.length === 0) return null;

  if (majors.length >= 2) {
    const combo1 = `${majors[0]}${majors[1]}`;
    const combo2 = `${majors[1]}${majors[0]}`;
    const hit = KB2026.star_profiles[combo1] || KB2026.star_profiles[combo2];
    if (hit) return hit;
  }
  return KB2026.star_profiles[majors[0]] || null;
}

function getMajorStarsOrBorrow(idx) {
  const palace = _lastChart?.palaces?.[idx];
  if (!palace) return { mode: "none", palace: null, majors: [] };

  const majors = starsOfPalace(palace);
  if (majors.length) return { mode: "direct", palace, majors };

  const oppIdx = (idx + 6) % 12;
  const opp = _lastChart?.palaces?.[oppIdx];
  const oppMajors = starsOfPalace(opp);

  return { mode: "borrow", palace, opp, oppIdx, majors: oppMajors };
}

function huaMeaning(hua) {
  const d = KB2026?.hua_definitions?.[hua];
  if (!d) return null;
  return `${d.status}：${d.guidance}`;
}

function findPalaceIndexByStarName(starName) {
  if (!_lastChart) return -1;
  return _lastChart.palaces.findIndex((p) => (p.majorStars || []).some((s) => s.name === starName));
}

/** =======================
 *  Bottom sheet
 *  ======================= */
function initBottomSheet() {
  const root = document.getElementById("sheet-root");
  const panel = document.getElementById("sheet-panel");
  const backdrop = document.getElementById("sheet-backdrop");
  const closeBtn = document.getElementById("sheet-close");
  const title = document.getElementById("sheet-title");
  const body = document.getElementById("sheet-body");

  if (!root || !panel || !backdrop || !closeBtn || !title || !body) return;

  _sheet = { root, panel, backdrop, closeBtn, title, body, isOpen: false };

  const close = () => closeBottomSheet();
  backdrop.addEventListener("click", close);
  closeBtn.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function openBottomSheet({ title, html }) {
  if (!_sheet) return;

  _sheet.title.textContent = title || "宮位解析";
  _sheet.body.innerHTML = html || "";

  _sheet.root.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  _sheet.isOpen = true;

  requestAnimationFrame(() => {
    _sheet.panel.classList.remove("translate-y-full");
  });
}

function closeBottomSheet() {
  if (!_sheet || !_sheet.isOpen) return;

  _sheet.panel.classList.add("translate-y-full");
  _sheet.isOpen = false;

  setTimeout(() => {
    _sheet.root.classList.add("hidden");
    document.body.style.overflow = "";
    _sheet.body.innerHTML = "";
  }, 220);
}

/** =======================
 *  UI init
 *  ======================= */
function initShichenUI() {
  const shichen = document.getElementById("shichen");
  const ziWrap = document.getElementById("zi-mode-wrap");
  if (!shichen || !ziWrap) return;

  const sync = () => {
    ziWrap.classList.toggle("hidden", shichen.value !== "子");
  };
  shichen.addEventListener("change", sync);
  sync();

  const bar = document.getElementById("zi-choice-bar");
  const btnLate = document.getElementById("btn-zi-late");
  const btnEarly = document.getElementById("btn-zi-early");

  if (btnLate) btnLate.addEventListener("click", () => {
    if (_ziCharts?.lateChart) renderFromChart(_ziCharts.lateChart);
    if (bar) bar.classList.add("hidden");
  });
  if (btnEarly) btnEarly.addEventListener("click", () => {
    if (_ziCharts?.earlyChart) renderFromChart(_ziCharts.earlyChart);
    if (bar) bar.classList.add("hidden");
  });
}

function initNavScroll() {
  document.querySelectorAll("[data-scrollto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-scrollto");
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/** =======================
 *  Core flow
 *  ======================= */
function resetToInput() {
  document.getElementById("result-section")?.classList.add("hidden");
  document.getElementById("input-section")?.classList.remove("hidden");
  clearError();

  _lastChart = null;
  _lastLianZhenIdx = -1;
  _selectedPalaceIdx = -1;
  _ziCharts = null;

  const detail = document.getElementById("palace-detail");
  if (detail) detail.innerHTML = `<div class="text-zinc-500 text-[12px]">尚未選擇宮位。</div>`;

  const profile = document.getElementById("profile-summary");
  if (profile) profile.innerHTML = `<div class="text-zinc-500 text-[12px]">請先啟動演算。</div>`;

  const aph = document.getElementById("aphorism-text");
  if (aph) aph.textContent = "";

  const quest = document.getElementById("quest-list");
  if (quest) quest.innerHTML = "";

  document.getElementById("zi-choice-bar")?.classList.add("hidden");
}

function scrollToTopQuests() {
  const el = document.getElementById("quest-list");
  if (el) el.scrollTop = 0;
}

function deployTacticalMap() {
  clearError();

  const dobParts = getDOBParts();
  const gender = document.getElementById("gender")?.value || "male";

  if (!dobParts) {
    showError("請先選擇出生年月日。");
    return;
  }

  const plan = getTimePlan();
  const genderZh = gender === "female" ? "女" : "男";

  // 記住輸入（手機不用一直選）
  localStorage.setItem("sm_dob", `${dobParts.y}-${dobParts.m}-${dobParts.d}`);
  localStorage.setItem("sm_tob", plan.tob || "12:00");

  document.getElementById("input-section")?.classList.add("hidden");
  document.getElementById("result-section")?.classList.remove("hidden");

  // 只支援西元：bySolar
  try {
    if (plan.kind === "dual-zi") {
      const lateChart = astro.bySolar(`${dobParts.y}-${dobParts.m}-${dobParts.d}`, plan.late, genderZh, true, "zh-TW");
      const earlyChart = astro.bySolar(`${dobParts.y}-${dobParts.m}-${dobParts.d}`, plan.early, genderZh, true, "zh-TW");

      _ziCharts = { lateChart, earlyChart };

      // 預設晚子
      renderFromChart(lateChart);

      // 顯示切換 bar
      document.getElementById("zi-choice-bar")?.classList.remove("hidden");
      return;
    }

    const chart = astro.bySolar(`${dobParts.y}-${dobParts.m}-${dobParts.d}`, plan.timeIdx, genderZh, true, "zh-TW");
    renderFromChart(chart);
  } catch (e) {
    console.error(e);
    showError("演算失敗：請確認輸入資料是否正確（目前僅支援西元生日）。");
    resetToInput();
  }
}

/** =======================
 *  Render from chart
 *  ======================= */
function renderFromChart(chart) {
  _lastChart = chart;
  _selectedPalaceIdx = -1;

  // rebuild map (preserve center hole + svg)
  const root = document.getElementById("map-root");
  const centerHole = root?.querySelector(".center-hole");
  const svgOverlay = root?.querySelector("#svg-overlay");

  if (!root || !centerHole || !svgOverlay) {
    showError("頁面結構缺失：找不到盤面容器（map-root）。");
    return;
  }

  root.innerHTML = "";
  root.appendChild(centerHole);
  root.appendChild(svgOverlay);

  const nominalBranch = chart.earthlyBranchOfSoulPalace;
  let lianZhenIdx = -1;

  chart.palaces.forEach((palace, idx) => {
    const pDiv = document.createElement("div");
    pDiv.id = `palace-${idx}`;

    const isNominal = palace.earthlyBranch === nominalBranch;
    pDiv.className = `palace p-${palace.earthlyBranch} ${isNominal ? "is-nominal" : ""}`;

    pDiv.tabIndex = 0;
    pDiv.setAttribute("role", "button");
    pDiv.setAttribute("aria-label", `${toSafeText(palace.name)} 宮`);

    const flex = document.createElement("div");
    flex.className = "flex h-full";

    const majorWrap = document.createElement("div");
    majorWrap.className = "flex";

    const minorWrap = document.createElement("div");
    minorWrap.className = "flex";

    // Annual hua markers
    const huaSet = new Set();

    // 主星
    (palace.majorStars || []).forEach((s) => {
      if (s.name === "廉貞") lianZhenIdx = idx;

      const star = document.createElement("div");
      star.className = "star-main";
      star.textContent = toSafeText(s.name);

      if (s.lunarSihua) {
        const tag = document.createElement("div");
        tag.className = "hua-tag hua-birth";
        tag.textContent = toSafeText(s.lunarSihua);
        star.appendChild(tag);
      }

      if (SIHUA_2026[s.name]) {
        const hua = SIHUA_2026[s.name];
        huaSet.add(hua);

        const tag2 = document.createElement("div");
        tag2.className = "hua-tag hua-2026";
        tag2.textContent = toSafeText(hua);
        star.appendChild(tag2);
      }

      majorWrap.appendChild(star);
    });

    // 輔星
    (palace.minorStars || []).forEach((s) => {
      const star = document.createElement("div");
      star.className = "star-minor";
      star.textContent = toSafeText(s.name);
      minorWrap.appendChild(star);
    });

    flex.appendChild(majorWrap);
    flex.appendChild(minorWrap);

    // labels
    const label = document.createElement("div");
    label.className = "palace-label";
    label.textContent = toSafeText(palace.name);

    const meta = document.createElement("div");
    meta.className = "meta-label";
    meta.textContent = `${toSafeText(palace.heavenlyStem)}${toSafeText(palace.earthlyBranch)}`;

    const age = document.createElement("div");
    age.className = "age-label";
    age.textContent = toSafeText(palace.changsheng12);

    // empty palace badge
    if ((palace.majorStars || []).length === 0) {
      const badge = document.createElement("div");
      badge.className = "borrow-badge";
      badge.textContent = "🔗 空宮借星";
      pDiv.appendChild(badge);
    }

    // energy highlight classes
    if (huaSet.has("祿")) pDiv.classList.add("has-lu");
    if (huaSet.has("權")) pDiv.classList.add("has-quan");
    if (huaSet.has("科")) pDiv.classList.add("has-ke");
    if (huaSet.has("忌")) pDiv.classList.add("has-ji");

    pDiv.appendChild(flex);
    pDiv.appendChild(label);
    pDiv.appendChild(meta);
    pDiv.appendChild(age);

    pDiv.addEventListener("click", () => selectPalace(idx));
    pDiv.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        selectPalace(idx);
      }
    });

    root.appendChild(pDiv);
  });

  _lastLianZhenIdx = lianZhenIdx;

  // center text
  document.getElementById("bureau-text").innerText = toSafeText(chart.fiveElementsClass);
  document.getElementById("destiny-text").innerText =
    `${toSafeText(chart.chineseDate)} 生 / 命主 ${toSafeText(chart.soul)}`;

  updateAnalysis(chart, lianZhenIdx);

  // profile
  const profileEl = document.getElementById("profile-summary");
  if (profileEl) profileEl.innerHTML = buildProfileSummaryHTML();

  // default select: 命宮（用別名對應）
  const nominalIdx = chart.palaces.findIndex((p) => normalizePalaceName(p.name) === "命");
  if (nominalIdx >= 0) selectPalace(nominalIdx);

  drawClashLine(lianZhenIdx);

  // delayed fade-in consult after months
  const consultAfter = document.getElementById("consult-after-months");
  if (consultAfter) {
    consultAfter.style.opacity = "0";
    consultAfter.style.transform = "translateY(8px)";
    setTimeout(() => {
      consultAfter.style.opacity = "1";
      consultAfter.style.transform = "translateY(0)";
    }, 800);
  }

  window.removeEventListener("resize", _onResizeRedraw);
  window.addEventListener("resize", _onResizeRedraw);
}

function _onResizeRedraw() {
  if (_lastChart) drawClashLine(_lastLianZhenIdx);
}

/** =======================
 *  Palace selection + detail
 *  ======================= */
function selectPalace(idx) {
  _selectedPalaceIdx = idx;

  for (let i = 0; i < 12; i++) {
    const el = document.getElementById(`palace-${i}`);
    if (el) el.classList.remove("is-selected");
  }
  const current = document.getElementById(`palace-${idx}`);
  if (current) current.classList.add("is-selected");

  const palace = _lastChart?.palaces?.[idx];
  if (!palace) return;

  const html = buildPalaceDetailHTML(palace, idx);
  const title = `${toSafeText(palace.name)}（${normalizePalaceName(palace.name)}）`;

  // desktop: right panel
  const detailEl = document.getElementById("palace-detail");
  if (detailEl) detailEl.innerHTML = html;

  // mobile: bottom sheet
  if (isMobileView()) {
    openBottomSheet({ title, html });
  }
}

function buildPalaceDetailHTML(palace, idx) {
  const majorsDirect = starsOfPalace(palace);
  const borrowPack = getMajorStarsOrBorrow(idx);
  const def = palaceDefByName(palace.name);

  const majorHTML = (palace.majorStars || []).map((s) => {
    const birth = s.lunarSihua
      ? ` <span class="px-1.5 py-0.5 rounded bg-red-800/70 text-white text-[10px]">本命${toSafeText(s.lunarSihua)}</span>`
      : "";
    const ann = SIHUA_2026[s.name]
      ? ` <span class="px-1.5 py-0.5 rounded bg-blue-800/70 text-white text-[10px]">2026${toSafeText(SIHUA_2026[s.name])}</span>`
      : "";
    return `<div class="flex items-center gap-2">
      <div class="text-[#D4AF37] font-black">${toSafeText(s.name)}</div>
      <div class="flex gap-1 flex-wrap">${birth}${ann}</div>
    </div>`;
  }).join("");

  const minorHTML = (palace.minorStars || []).map((s) =>
    `<span class="inline-block mr-2 mb-2 px-2 py-1 border border-zinc-800 text-zinc-300 text-[11px] rounded-lg bg-black/20">${toSafeText(s.name)}</span>`
  ).join("");

  let emptyHint = "";
  if (majorsDirect.length === 0 && borrowPack.mode === "borrow") {
    const oppName = toSafeText(borrowPack.opp?.name);
    const oppStars = borrowPack.majors.length ? borrowPack.majors.join("、") : "（仍無主星）";
    emptyHint = `
      <div class="mt-2 text-[12px] text-zinc-400">
        <span class="text-zinc-200 font-bold">空宮</span>：不是「沒有」，而是「更看對手/環境」。借對宮
        <span class="text-zinc-200 font-bold">${oppName}</span>（主星：${oppStars}）
      </div>
    `;
  }

  return `
    <div>
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-base font-black text-zinc-100">${toSafeText(palace.name)} <span class="text-[12px] text-zinc-500">#${idx}</span></div>
          <div class="text-[12px] text-zinc-500 font-mono mt-1">
            ${toSafeText(palace.heavenlyStem)}${toSafeText(palace.earthlyBranch)} ｜ ${toSafeText(palace.changsheng12)}
          </div>
          ${def ? `<div class="mt-2 text-[12px] text-zinc-300">場景：<span class="text-[#D4AF37] font-bold">${def.label}</span>｜${def.desc}</div>` : ""}
          ${emptyHint}
        </div>
      </div>

      <div class="mt-4">
        <div class="text-[12px] text-zinc-400 mb-2">主星</div>
        <div class="space-y-2">${majorHTML || `<div class="text-zinc-500 text-[12px]">（空宮／請看借對宮主星提示）</div>`}</div>
      </div>

      <div class="mt-4">
        <div class="text-[12px] text-zinc-400 mb-2">輔星</div>
        <div>${minorHTML || `<div class="text-zinc-500 text-[12px]">（無資料）</div>`}</div>
      </div>

      ${buildLifeExplainHTML(idx)}
    </div>
  `;
}

function buildLifeExplainHTML(idx) {
  const pack = getMajorStarsOrBorrow(idx);
  const palace = pack.palace;
  if (!palace) return "";

  const def = palaceDefByName(palace.name);
  const majors = pack.majors || [];
  const tag = starTagForMajors(majors);

  const key = normalizePalaceName(palace.name);
  const huaLines = [];

  for (const s of (palace.majorStars || [])) {
    const hua = SIHUA_2026[s.name];
    if (hua) huaLines.push(`2026 ${s.name} 化${hua}：${huaMeaning(hua) || ""}`);
  }

  let stressBlock = "";
  if (key === "疾厄" && KB2026?.stress_reactions && majors.length) {
    const notes = majors
      .map((name) => KB2026.stress_reactions[name])
      .filter(Boolean)
      .slice(0, 2);
    if (notes.length) {
      stressBlock = `
        <div class="mt-3 text-[12px] text-zinc-300">
          <div class="text-zinc-400 mb-1">壓力反應提醒（非醫療診斷）</div>
          - ${notes.join("<br/>- ")}
        </div>
      `;
    }
  }

  const ctas = (def?.cta || []).slice(0, 4);
  const ctaHTML = ctas.length
    ? `<div class="mt-3 text-[12px] text-zinc-300"><div class="text-zinc-400 mb-1">可執行小動作</div>- ${ctas.join("<br/>- ")}</div>`
    : "";

  const emptyExplain =
    pack.mode === "borrow"
      ? `<div class="mt-2 text-[12px] text-zinc-400">空宮說明：${KB2026?.empty_palace_copy?.desc || "你更像「環境映射型」：會根據對手/場景調整做法。"}<br/>建議：${KB2026?.empty_palace_copy?.action || "先看借對宮的主星特質，再落地到行動。"} </div>`
      : "";

  const persona = tag
    ? `<div class="mt-2 text-[13px] text-zinc-200">主星人設：<span class="text-[#D4AF37] font-bold">${tag.tag}</span>｜${tag.workplace}</div>`
    : `<div class="mt-2 text-[13px] text-zinc-400">主星人設：尚未建立（可後續擴充）</div>`;

  const huaText = huaLines.length
    ? `- ${huaLines.join("<br/>- ")}`
    : "（此宮今年沒有明顯四化標記：重點回到場景 + 你的行動策略。）";

  return `
    <div class="mt-4 border-t border-zinc-800 pt-4">
      <div class="text-[12px] text-zinc-400 mb-2">新手白話（人生/性格）</div>

      ${def ? `<div class="text-[13px] leading-relaxed text-zinc-200">
        這是【${toSafeText(palace.name)}】：<span class="text-[#D4AF37] font-bold">${def.label}</span><br/>
        你在乎的是：<span class="text-zinc-300">${def.cares}</span>
      </div>` : ""}

      ${emptyExplain}
      ${persona}

      <div class="mt-3 text-[12px] text-zinc-300">
        <div class="text-zinc-400 mb-1">四化提示（今年的紅綠燈）</div>
        ${huaText}
      </div>

      ${stressBlock}
      ${ctaHTML}

      <div class="mt-4">
        <a class="btn-consult inline-flex" target="_blank" rel="noreferrer" href="${CONSULT_FORM_URL}">
          需要更深度的個人策略？申請 1 對 1 諮詢 ↗
        </a>
      </div>
    </div>
  `;
}

/** =======================
 *  Summary + Annual + Monthly
 *  ======================= */
function buildProfileSummaryHTML() {
  if (!_lastChart) return `<div class="text-zinc-500 text-[12px]">請先啟動演算。</div>`;

  const getIdxByKey = (k) =>
    _lastChart.palaces.findIndex((p) => normalizePalaceName(p.name) === k);

  const idxMing = getIdxByKey("命");
  const idxFude = getIdxByKey("福德");
  const idxJie = getIdxByKey("疾厄");
  const idxFuqi = getIdxByKey("夫妻");
  const idxFriends = getIdxByKey("交友");

  const mingPack = getMajorStarsOrBorrow(idxMing);
  const fudePack = getMajorStarsOrBorrow(idxFude);
  const jiePack = getMajorStarsOrBorrow(idxJie);
  const fuqiPack = getMajorStarsOrBorrow(idxFuqi);
  const frPack = getMajorStarsOrBorrow(idxFriends);

  const mingTag = starTagForMajors(mingPack.majors);
  const fudeTag = starTagForMajors(fudePack.majors);
  const jieTag = starTagForMajors(jiePack.majors);

  const idxJi = _lastLianZhenIdx; // 廉貞化忌
  const idxLu = findPalaceIndexByStarName("天同"); // 天同化祿
  const idxQuan = findPalaceIndexByStarName("天機"); // 天機化權
  const idxKe = findPalaceIndexByStarName("文昌"); // 文昌化科

  const jiKey = idxJi >= 0 ? normalizePalaceName(_lastChart.palaces[idxJi].name) : "";
  const luKey = idxLu >= 0 ? normalizePalaceName(_lastChart.palaces[idxLu].name) : "";

  const jiDef = KB2026?.palace_definitions?.[jiKey] || null;
  const luDef = KB2026?.palace_definitions?.[luKey] || null;

  const title =
    jiKey === "田宅" && luKey === "遷移"
      ? "🌟 2026 年度導航：先蹲後跳的「系統重組年」"
      : `🌟 2026 年度導航：先修「${jiDef?.label || "壓力區"}」再放大「${luDef?.label || "機會區"}」`;

  const line = (label, pack, tag) => {
    if (tag) {
      return `${label}：<span class="text-[#D4AF37] font-bold">${tag.tag}</span>（${toSafeText(pack.majors?.join("、") || "")}）`;
    }
    if (pack.mode === "borrow") {
      return `${label}：<span class="text-[#D4AF37] font-bold">環境映射型（空宮借星）</span>（借：${toSafeText(pack.opp?.name || "")}）`;
    }
    return `${label}：<span class="text-[#D4AF37] font-bold">（資料不足）</span>`;
  };

  const mingLine = line("你的性格核心（命宮）", mingPack, mingTag);
  const fudeLine = line("快樂與安全感（福德）", fudePack, fudeTag);

  const jieLine = jieTag
    ? `壓力反應（疾厄）：<span class="text-[#D4AF37] font-bold">${jieTag.tag}</span>（${toSafeText(jiePack.majors?.join("、") || "")}）`
    : `壓力反應（疾厄）：以「場景」與「四化紅綠燈」判讀更準。`;

  const linkLine = `關係模式（夫妻 / 交友）：${toSafeText(fuqiPack.majors?.join("、") || (fuqiPack.mode === "borrow" ? "空宮借星" : "（無）"))} ／ ${toSafeText(frPack.majors?.join("、") || (frPack.mode === "borrow" ? "空宮借星" : "（無）"))}`;

  const jiScene = jiDef ? `今年的坎：<span class="text-red-300 font-bold">${jiDef.label}</span>（${jiKey}）` : `今年的坎：壓力點（忌）`;
  const luScene = luDef ? `今年的光：<span class="text-green-300 font-bold">${luDef.label}</span>（${luKey}）` : `今年的光：機會點（祿）`;

  const jiAction = jiDef?.cta?.slice(0, 2).join("、") || "先補洞再衝刺";
  const luAction = luDef?.cta?.slice(0, 2).join("、") || "增加曝光與合作";

  const traffic = [
    idxLu >= 0 ? { hua: "祿", idx: idxLu } : null,
    idxKe >= 0 ? { hua: "科", idx: idxKe } : null,
    idxQuan >= 0 ? { hua: "權", idx: idxQuan } : null,
    idxJi >= 0 ? { hua: "忌", idx: idxJi } : null,
  ].filter(Boolean);

  const trafficHTML = traffic.map((t) => {
    const p = _lastChart.palaces[t.idx];
    const k = normalizePalaceName(p.name);
    const def = KB2026?.palace_definitions?.[k];
    const h = KB2026?.hua_definitions?.[t.hua];
    const label = def?.label || k;
    const tone =
      h?.tone === "green" ? "text-green-300" :
      h?.tone === "yellow" ? "text-yellow-300" :
      h?.tone === "blue" ? "text-blue-300" :
      "text-red-300";
    return `<div class="text-[12px] text-zinc-400">
      <span class="${tone} font-bold">${t.hua}（${h?.status || ""}）</span>｜${k}：${label}
    </div>`;
  }).join("");

  return `
    <div class="text-zinc-100 font-black mb-2">${title}</div>

    <div class="text-[13px] text-zinc-300 leading-relaxed space-y-1">
      <div>${mingLine}</div>
      <div>${fudeLine}</div>
      <div>${jieLine}</div>
      <div>${linkLine}</div>
    </div>

    <div class="mt-4 text-[13px] text-zinc-300 leading-relaxed">
      <div>${jiScene} → 建議：<span class="text-zinc-100 font-bold">${jiAction}</span></div>
      <div class="mt-1">${luScene} → 建議：<span class="text-zinc-100 font-bold">${luAction}</span></div>
    </div>

    <div class="mt-4 text-[12px] text-zinc-400">
      <div class="text-zinc-500 mb-1">今年紅綠燈（先看順的，再看修煉，再看補洞）</div>
      ${trafficHTML}
    </div>

    <div class="mt-4 text-[12px] text-zinc-500 leading-relaxed">
      讀盤順序（小白版）：命宮看「你怎麼做事」→ 福德看「你怎麼快樂」→ 疾厄看「你怎麼耗損」→ 夫妻/交友看「你怎麼連結」。
    </div>
  `;
}

function updateAnalysis(chart, lzIdx) {
  const jiPalace = lzIdx >= 0 ? chart.palaces[lzIdx] : null;
  const luPalace = chart.palaces.find((p) => (p.majorStars || []).some((s) => s.name === "天同")) || null;

  const jiKey = jiPalace ? normalizePalaceName(jiPalace.name) : "";
  const luKey = luPalace ? normalizePalaceName(luPalace.name) : "";

  const jiDef = KB2026?.palace_definitions?.[jiKey] || null;
  const luDef = KB2026?.palace_definitions?.[luKey] || null;

  const jiName = jiPalace ? jiPalace.name : "（未定位）";
  const luName = luPalace ? luPalace.name : "（未定位）";

  const jiScene = jiDef ? `「${jiDef.label}」` : "壓力區";
  const luScene = luDef ? `「${luDef.label}」` : "機會區";

  const aph = document.getElementById("aphorism-text");
  if (aph) {
    aph.innerText =
      `2026 丙午年戰略重點在於「轉化」與「重組」。` +
      `流年化忌（廉貞）落入你的【${jiName}】（${jiScene}），今年更像「補洞/修繕年」：先修系統、先補根基，再談衝刺。` +
      `而天同化祿進入【${luName}】（${luScene}），這裡是年度更容易出現「資源／合作／好運窗口」的突破口：多走出去、多曝光、多連結，順勢擴張。`;
  }

  const months = buildMonthlyQuests(jiKey, luKey);
  const list = document.getElementById("quest-list");
  if (list) {
    list.innerHTML = months.map((q) => `
      <div class="quest-item">
        <div class="text-[#D4AF37] font-black mb-1">${q.m}｜${q.theme}</div>
        <div class="text-zinc-300 leading-relaxed">${q.task}</div>
      </div>
    `).join("");
  }
}

function buildMonthlyQuests(jiKey, luKey) {
  const jiLabel = jiKey ? (KB2026?.palace_definitions?.[jiKey]?.label || jiKey) : "壓力區";
  const luLabel = luKey ? (KB2026?.palace_definitions?.[luKey]?.label || luKey) : "機會區";

  const base = KB2026?.monthly_strategy || [
    { month: 1, theme: "資源清點", desc: "年度過渡期，先清盤再出手。", action: "刪減支線、盤點資源", color: "yellow" },
    { month: 2, theme: "啟動測試", desc: "先做一個 MVP 去試水溫。", action: "快速上線、蒐集回饋", color: "green" },
  ];

  return base.map((it) => {
    const m = `${it.month} 月`;
    let tail = "";
    if (it.color === "red") tail = `（提醒：今年要特別顧「${jiLabel}」）`;
    else if (it.color === "green") tail = `（加分：把成果丟到「${luLabel}」舞台）`;
    else if (it.color === "yellow") tail = `（修煉：用專業拿回節奏）`;
    else tail = `（穩定：用口碑與條理累積信用）`;

    return { m, theme: it.theme, task: `${it.desc} 行動：${it.action} ${tail}` };
  });
}

/** =======================
 *  Clash line (廉貞對沖)
 *  ======================= */
function drawClashLine(idx) {
  const svg = document.getElementById("svg-overlay");
  const root = document.getElementById("map-root");
  if (!svg || !root) return;

  svg.innerHTML = "";
  if (idx === -1) return;

  const container = root.getBoundingClientRect();
  const el1 = document.getElementById(`palace-${idx}`);
  const el2 = document.getElementById(`palace-${(idx + 6) % 12}`);
  if (!el1 || !el2) return;

  const r1 = el1.getBoundingClientRect();
  const r2 = el2.getBoundingClientRect();

  const x1 = r1.left - container.left + r1.width / 2;
  const y1 = r1.top - container.top + r1.height / 2;
  const x2 = r2.left - container.left + r2.width / 2;
  const y2 = r2.top - container.top + r2.height / 2;

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  line.setAttribute("stroke", "#C41E3A");
  line.setAttribute("stroke-width", "1.6");
  line.setAttribute("stroke-dasharray", "6,4");
  line.setAttribute("opacity", "0.65");
  svg.appendChild(line);
}

/** =======================
 *  CSV export (年度導航 + 12宮場景 + 流月任務)
 *  ======================= */
function csvEscape(v) {
  const s = toSafeText(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCSV() {
  if (!_lastChart) {
    showError("請先啟動演算，才能匯出 CSV。");
    return;
  }

  const dob = getDOBParts();
  const tob = document.getElementById("tob")?.value || "";
  const shichen = document.getElementById("shichen")?.value || "";
  const ziMode = document.getElementById("zi-mode")?.value || "";
  const gender = document.getElementById("gender")?.value || "";

  const idxJi = _lastLianZhenIdx;
  const idxLu = findPalaceIndexByStarName("天同");
  const jiKey = idxJi >= 0 ? normalizePalaceName(_lastChart.palaces[idxJi].name) : "";
  const luKey = idxLu >= 0 ? normalizePalaceName(_lastChart.palaces[idxLu].name) : "";
  const jiDef = jiKey ? KB2026?.palace_definitions?.[jiKey] : null;
  const luDef = luKey ? KB2026?.palace_definitions?.[luKey] : null;

  const rows = [];

  rows.push(["紫微戰略地圖｜匯出資料（2026）"]);
  rows.push([]);
  rows.push(["年度導航"]);
  rows.push(["項目", "內容"]);
  rows.push(["生日（西元）", dob ? `${dob.y}-${dob.m}-${dob.d}` : ""]);
  rows.push(["時間(24h)", tob]);
  rows.push(["時辰", shichen || "（未填）"]);
  rows.push(["子時早晚", shichen === "子" ? (ziMode || "auto") : "—"]);
  rows.push(["性別", gender]);
  rows.push(["五行局", _lastChart.fiveElementsClass]);
  rows.push(["命主", _lastChart.soul]);
  rows.push(["壓力點（忌）", jiKey ? `${jiKey}｜${jiDef?.label || ""}` : ""]);
  rows.push(["機會點（祿）", luKey ? `${luKey}｜${luDef?.label || ""}` : ""]);
  rows.push([]);

  rows.push(["十二宮場景"]);
  rows.push(["宮位", "場景標籤", "核心描述", "主星(或借星)", "是否空宮", "借對宮", "2026 四化", "行動建議"]);

  _lastChart.palaces.forEach((p, idx) => {
    const key = normalizePalaceName(p.name);
    const def = KB2026?.palace_definitions?.[key] || null;
    const majors = starsOfPalace(p);
    let isEmpty = majors.length === 0;
    let borrowFrom = "";
    let majorsText = majors.join("、");

    if (isEmpty) {
      const oppIdx = (idx + 6) % 12;
      const opp = _lastChart.palaces[oppIdx];
      const oppMajors = starsOfPalace(opp);
      borrowFrom = normalizePalaceName(opp.name);
      majorsText = oppMajors.join("、") || "（無）";
    }

    const huaList = (p.majorStars || [])
      .map((s) => SIHUA_2026[s.name] ? `${s.name}化${SIHUA_2026[s.name]}` : "")
      .filter(Boolean)
      .join("；");

    const cta = (def?.cta || []).slice(0, 3).join(" / ");

    rows.push([
      key,
      def?.label || "",
      def?.desc || "",
      majorsText,
      isEmpty ? "是" : "否",
      borrowFrom,
      huaList,
      cta,
    ]);
  });

  rows.push([]);

  rows.push(["流月戰略任務"]);
  rows.push(["月份", "主題", "個人化任務"]);
  const months = buildMonthlyQuests(jiKey, luKey);
  months.forEach((mObj) => {
    rows.push([mObj.m, mObj.theme, mObj.task]);
  });

  const csv = "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `紫微戰略地圖-2026.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** =======================
 *  Expose to window
 *  ======================= */
window.deployTacticalMap = deployTacticalMap;
window.resetToInput = resetToInput;
window.scrollToTopQuests = scrollToTopQuests;
window.exportCSV = exportCSV;

/** =======================
 *  Boot
 *  ======================= */
initDOBSelectors();
initShichenUI();
initBottomSheet();
initNavScroll();

// restore time default
const savedT = localStorage.getItem("sm_tob");
if (savedT) {
  const tob = document.getElementById("tob");
  if (tob) tob.value = savedT;
}
