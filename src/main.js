import "./style.css";
import { astro } from "iztro";
import { KB2026 } from "./kb_2026.js";

const SIHUA_2026 = KB2026?.annual_sihua_2026 || { "天同": "祿", "天機": "權", "文昌": "科", "廉貞": "忌" };
const CONSULT_FORM_URL = "https://forms.gle/Vvs6U12TeMYtab8A6";

let _lastChart = null;
let _lastLianZhenIdx = -1;
let _selectedPalaceIdx = -1;

let _ziCharts = null; // { lateChart, earlyChart }
let _sheet = null;

/** ---------- helpers ---------- */
function toSafeText(v) { return v === null || v === undefined ? "" : String(v); }

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

/** ---------- scroll (修掉你四個標籤不會動) ---------- */
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
window.scrollToSection = scrollToSection; // 給 HTML onclick

/** ---------- time index ---------- */
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

/** ---------- DOB selectors ---------- */
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function initDOBSelectors() {
  const yEl = document.getElementById("dob-year");
  const mEl = document.getElementById("dob-month");
  const dEl = document.getElementById("dob-day");
  if (!yEl || !mEl || !dEl) return;

  const saved = localStorage.getItem("sm_dob");
  let defY = 1995, defM = 1, defD = 1;
  if (saved) {
    const parts = saved.split("-").map((n) => parseInt(n, 10));
    if (parts.length === 3 && parts.every((x) => Number.isFinite(x))) [defY, defM, defD] = parts;
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

/** ---------- palace aliases ---------- */
const PALACE_ALIAS = {
  "命": ["命", "命宮", "命宫"],
  "兄弟": ["兄弟", "兄弟宮", "兄弟宫"],
  "夫妻": ["夫妻", "夫妻宮", "夫妻宫", "配偶", "配偶宮", "婚姻", "感情"],
  "子女": ["子女", "子女宮", "子女宫"],
  "財帛": ["財帛", "财帛", "財帛宮", "财帛宫", "金錢", "金钱", "現金流", "现金流"],
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
  for (const [key, arr] of Object.entries(PALACE_ALIAS)) arr.forEach((a) => m.set(a, key));
  return m;
})();
function normalizePalaceName(name) {
  let s = toSafeText(name).trim().replace(/[　\s]/g, "").replace(/宮|宫/g, "");
  if (ALIAS_TO_KEY.has(s)) return ALIAS_TO_KEY.get(s);
  s = s.replace(/\(.*?\)/g, "");
  if (ALIAS_TO_KEY.has(s)) return ALIAS_TO_KEY.get(s);
  return s;
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

/** ---------- bottom sheet ---------- */
function initBottomSheet() {
  const root = document.getElementById("sheet-root");
  const panel = document.getElementById("sheet-panel");
  const backdrop = document.getElementById("sheet-backdrop");
  const closeBtn = document.getElementById("sheet-close");
  const prevBtn = document.getElementById("sheet-prev");
  const nextBtn = document.getElementById("sheet-next");
  const title = document.getElementById("sheet-title");
  const body = document.getElementById("sheet-body");

  if (!root || !panel || !backdrop || !closeBtn || !title || !body) return;

  _sheet = { root, panel, backdrop, closeBtn, prevBtn, nextBtn, title, body, isOpen: false };

  const close = () => closeBottomSheet();
  backdrop.addEventListener("click", close);
  closeBtn.addEventListener("click", close);

  prevBtn?.addEventListener("click", () => {
    if (_selectedPalaceIdx < 0) return;
    selectPalace((_selectedPalaceIdx + 11) % 12, { keepSheet: true });
  });
  nextBtn?.addEventListener("click", () => {
    if (_selectedPalaceIdx < 0) return;
    selectPalace((_selectedPalaceIdx + 1) % 12, { keepSheet: true });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}
function openOrUpdateBottomSheet({ title, html }) {
  if (!_sheet) return;

  _sheet.title.textContent = title || "宮位解析";
  _sheet.body.innerHTML = html || "";

  if (_sheet.isOpen) return; // 已開啟只更新內容

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

/** ---------- UI init ---------- */
function initShichenUI() {
  const shichen = document.getElementById("shichen");
  const ziWrap = document.getElementById("zi-mode-wrap");
  if (!shichen || !ziWrap) return;

  const sync = () => ziWrap.classList.toggle("hidden", shichen.value !== "子");
  shichen.addEventListener("change", sync);
  sync();

  const bar = document.getElementById("zi-choice-bar");
  const btnLate = document.getElementById("btn-zi-late");
  const btnEarly = document.getElementById("btn-zi-early");

  btnLate?.addEventListener("click", () => {
    if (_ziCharts?.lateChart) renderFromChart(_ziCharts.lateChart);
    bar?.classList.add("hidden");
  });
  btnEarly?.addEventListener("click", () => {
    if (_ziCharts?.earlyChart) renderFromChart(_ziCharts.earlyChart);
    bar?.classList.add("hidden");
  });
}

/** ---------- reset ---------- */
function resetToInput() {
  document.getElementById("result-section")?.classList.add("hidden");
  document.getElementById("input-section")?.classList.remove("hidden");
  clearError();

  _lastChart = null;
  _lastLianZhenIdx = -1;
  _selectedPalaceIdx = -1;
  _ziCharts = null;

  document.getElementById("palace-detail") && (document.getElementById("palace-detail").innerHTML = `<div class="text-zinc-500 text-[12px]">尚未選擇宮位。</div>`);
  document.getElementById("profile-summary") && (document.getElementById("profile-summary").innerHTML = `<div class="text-zinc-500 text-[12px]">請先啟動演算。</div>`);
  document.getElementById("annual-hero-text") && (document.getElementById("annual-hero-text").textContent = "");
  document.getElementById("annual-traffic") && (document.getElementById("annual-traffic").innerHTML = "");
  document.getElementById("annual-keywords") && (document.getElementById("annual-keywords").innerHTML = "");
  document.getElementById("quest-list") && (document.getElementById("quest-list").innerHTML = "");
  document.getElementById("zi-choice-bar")?.classList.add("hidden");

  closeBottomSheet();
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

  localStorage.setItem("sm_dob", `${dobParts.y}-${dobParts.m}-${dobParts.d}`);
  localStorage.setItem("sm_tob", plan.tob || "12:00");

  document.getElementById("input-section")?.classList.add("hidden");
  document.getElementById("result-section")?.classList.remove("hidden");

  try {
    if (plan.kind === "dual-zi") {
      const lateChart = astro.bySolar(`${dobParts.y}-${dobParts.m}-${dobParts.d}`, plan.late, genderZh, true, "zh-TW");
      const earlyChart = astro.bySolar(`${dobParts.y}-${dobParts.m}-${dobParts.d}`, plan.early, genderZh, true, "zh-TW");

      _ziCharts = { lateChart, earlyChart };
      renderFromChart(lateChart); // 預設晚子
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

/** ---------- render ---------- */
function renderFromChart(chart) {
  _lastChart = chart;
  _selectedPalaceIdx = -1;

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

    const def = palaceDefByName(palace.name);
    if (def?.label) {
      const chip = document.createElement("div");
      chip.className = "scene-chip";
      chip.textContent = def.label;
      pDiv.appendChild(chip);
    }

    const flex = document.createElement("div");
    flex.className = "flex h-full";

    const majorWrap = document.createElement("div");
    majorWrap.className = "flex";

    const minorWrap = document.createElement("div");
    minorWrap.className = "flex";

    const huaSet = new Set();

    // 空宮借星（在格子裡半透明顯示借星）
    const majorsDirect = starsOfPalace(palace);
    if (majorsDirect.length === 0) {
      const badge = document.createElement("div");
      badge.className = "borrow-badge";
      badge.textContent = "🔗 借星";
      pDiv.appendChild(badge);

      const oppIdx = (idx + 6) % 12;
      const opp = chart.palaces[oppIdx];
      const oppMajors = starsOfPalace(opp);

      oppMajors.slice(0, 2).forEach((n, i) => {
        const star = document.createElement("div");
        star.className = "star-main borrowed";
        star.textContent = i === 0 ? `(${n}` : `${n})`;
        majorWrap.appendChild(star);
      });
    } else {
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
    }

    (palace.minorStars || []).forEach((s) => {
      const star = document.createElement("div");
      star.className = "star-minor";
      star.textContent = toSafeText(s.name);
      minorWrap.appendChild(star);
    });

    flex.appendChild(majorWrap);
    flex.appendChild(minorWrap);

    const label = document.createElement("div");
    label.className = "palace-label";
    label.textContent = toSafeText(palace.name);

    const meta = document.createElement("div");
    meta.className = "meta-label";
    meta.textContent = `${toSafeText(palace.heavenlyStem)}${toSafeText(palace.earthlyBranch)}`;

    const age = document.createElement("div");
    age.className = "age-label";
    age.textContent = toSafeText(palace.changsheng12);

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

  document.getElementById("bureau-text").innerText = toSafeText(chart.fiveElementsClass);
  document.getElementById("destiny-text").innerText = `${toSafeText(chart.chineseDate)} 生 / 命主 ${toSafeText(chart.soul)}`;

  updateAnnualHero(chart, lianZhenIdx);

  const profileEl = document.getElementById("profile-summary");
  if (profileEl) profileEl.innerHTML = buildProfileSummaryHTML();

  const nominalIdx = chart.palaces.findIndex((p) => normalizePalaceName(p.name) === "命");
  if (nominalIdx >= 0) selectPalace(nominalIdx);

  drawClashLine(lianZhenIdx);

  // 延遲顯示底部 CTA（讀完才看到）
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

/** ---------- select palace ---------- */
function selectPalace(idx, opts = {}) {
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

  const detailEl = document.getElementById("palace-detail");
  if (detailEl) detailEl.innerHTML = html;

  if (isMobileView()) {
    openOrUpdateBottomSheet({ title, html });
  } else {
    if (!opts.keepSheet) closeBottomSheet();
  }
}

function buildPalaceDetailHTML(palace, idx) {
  const majorsDirect = starsOfPalace(palace);
  const borrowPack = getMajorStarsOrBorrow(idx);
  const def = palaceDefByName(palace.name);

  const majorHTML = (palace.majorStars || []).map((s) => {
    const birth = s.lunarSihua ? ` <span class="px-1.5 py-0.5 rounded bg-red-800/70 text-white text-[10px]">本命${toSafeText(s.lunarSihua)}</span>` : "";
    const ann = SIHUA_2026[s.name] ? ` <span class="px-1.5 py-0.5 rounded bg-blue-800/70 text-white text-[10px]">2026${toSafeText(SIHUA_2026[s.name])}</span>` : "";
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
      <div class="text-base font-black text-zinc-100">${toSafeText(palace.name)} <span class="text-[12px] text-zinc-500">#${idx}</span></div>
      <div class="text-[12px] text-zinc-500 font-mono mt-1">
        ${toSafeText(palace.heavenlyStem)}${toSafeText(palace.earthlyBranch)} ｜ ${toSafeText(palace.changsheng12)}
      </div>
      ${def ? `<div class="mt-2 text-[12px] text-zinc-300">場景：<span class="text-[#D4AF37] font-bold">${def.label}</span>｜${def.desc}</div>` : ""}
      ${emptyHint}

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

  const persona = tag
    ? `<div class="mt-2 text-[13px] text-zinc-200">主星人設：<span class="text-[#D4AF37] font-bold">${tag.tag}</span>｜${tag.workplace}</div>`
    : `<div class="mt-2 text-[13px] text-zinc-400">主星人設：尚未建立（可後續擴充）</div>`;

  const ctas = (def?.cta || []).slice(0, 4);
  const ctaHTML = ctas.length
    ? `<div class="mt-3 text-[12px] text-zinc-300"><div class="text-zinc-400 mb-1">可執行小動作</div>- ${ctas.join("<br/>- ")}</div>`
    : "";

  // 三段式資訊揭露：短→再展開
  const shortTips = `
    <div class="mt-3 text-[12px] text-zinc-300">
      <div class="text-zinc-400 mb-1">3 秒白話</div>
      <div>• 場景：<span class="text-zinc-100 font-bold">${def?.label || key}</span></div>
      <div>• 你在乎：<span class="text-zinc-200">${def?.cares || "以此宮場景為主"}</span></div>
      <div>• 行動：<span class="text-zinc-200">${(def?.cta || [])[0] || "先用紅綠燈決定進攻/防守"}</span></div>
    </div>
  `;

  const huaText = huaLines.length ? `- ${huaLines.join("<br/>- ")}` : "（此宮今年沒有明顯四化標記：重點回到場景 + 你的行動策略。）";

  return `
    <div class="mt-4 border-t border-zinc-800 pt-4">
      <div class="text-[12px] text-zinc-400 mb-2">新手白話（人生/性格）</div>

      ${def ? `<div class="text-[13px] leading-relaxed text-zinc-200">
        這是【${toSafeText(palace.name)}】：<span class="text-[#D4AF37] font-bold">${def.label}</span>
      </div>` : ""}

      ${shortTips}
      ${persona}

      <details class="mt-3">
        <summary class="text-[12px] text-zinc-300 cursor-pointer select-none">展開完整解析</summary>
        <div class="mt-2 text-[12px] text-zinc-300">
          <div class="text-zinc-400 mb-1">四化提示（今年的紅綠燈）</div>
          ${huaText}
        </div>
        ${ctaHTML}

        <div class="mt-4">
          <a class="btn-consult inline-flex" target="_blank" rel="noreferrer" href="${CONSULT_FORM_URL}">
            需要更深度的個人策略？申請 1 對 1 諮詢 ↗
          </a>
        </div>
      </details>
    </div>
  `;
}

/** ---------- annual hero + quests ---------- */
function updateAnnualHero(chart, lzIdx) {
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

  const hero = document.getElementById("annual-hero-text");
  if (hero) {
    hero.innerText =
      `2026 丙午年戰略重點在於「轉化」與「重組」。` +
      `流年化忌（廉貞）落入你的【${jiName}】（${jiScene}），今年更像「補洞/修繕年」：先修系統、先補根基，再談衝刺。` +
      `而天同化祿進入【${luName}】（${luScene}），這裡是年度更容易出現「資源／合作／好運窗口」的突破口：多走出去、多曝光、多連結，順勢擴張。`;
  }

  // keywords cloud
  const kwEl = document.getElementById("annual-keywords");
  if (kwEl) {
    const kws = ["#轉化", "#重組", "#補洞", luKey === "遷移" ? "#走出去" : "#放大紅利"];
    kwEl.innerHTML = kws
      .map((k) => `<span class="px-3 py-1 rounded-full border border-zinc-800 bg-black/25 text-[12px] text-zinc-200 font-black">${k}</span>`)
      .join("");
  }

  // traffic
  const idxJi = _lastLianZhenIdx;
  const idxLu = findPalaceIndexByStarName("天同");
  const idxQuan = findPalaceIndexByStarName("天機");
  const idxKe = findPalaceIndexByStarName("文昌");

  const traffic = [
    idxLu >= 0 ? { hua: "祿", idx: idxLu } : null,
    idxKe >= 0 ? { hua: "科", idx: idxKe } : null,
    idxQuan >= 0 ? { hua: "權", idx: idxQuan } : null,
    idxJi >= 0 ? { hua: "忌", idx: idxJi } : null,
  ].filter(Boolean);

  const tEl = document.getElementById("annual-traffic");
  if (tEl) {
    tEl.innerHTML = traffic.map((t) => {
      const p = chart.palaces[t.idx];
      const k = normalizePalaceName(p.name);
      const def = KB2026?.palace_definitions?.[k];
      const h = KB2026?.hua_definitions?.[t.hua];
      const label = def?.label || k;
      const cls =
        h?.tone === "green" ? "text-green-300" :
        h?.tone === "yellow" ? "text-yellow-300" :
        h?.tone === "blue" ? "text-blue-300" :
        "text-red-300";
      return `<div class="text-[12px] text-zinc-400">
        <span class="${cls} font-black">${t.hua}（${h?.status || ""}）</span>｜${k}：${label}
      </div>`;
    }).join("");
  }

  // quests (grid cards)
  const months = buildMonthlyQuests(jiKey, luKey);
  const list = document.getElementById("quest-list");
  if (list) {
    const nowM = new Date().getMonth() + 1;
    list.innerHTML = months.map((q) => qToCardHTML(q, nowM)).join("");
  }
}

function qToCardHTML(q, nowM) {
  const tagMap = {
    green: { text: "加分", cls: "tag-green" },
    yellow: { text: "修煉", cls: "tag-yellow" },
    red: { text: "提醒", cls: "tag-red" },
    blue: { text: "穩定", cls: "tag-blue" },
  };
  const t = tagMap[q.color] || { text: "任務", cls: "tag-blue" };
  const isCurrent = q.month === nowM;

  return `
    <div class="quest-card ${isCurrent ? "is-current" : ""}">
      <div class="quest-head">
        <div class="quest-title">${q.month} 月｜${q.theme}</div>
        <div class="quest-tag ${t.cls}">${isCurrent ? "進行中" : t.text}</div>
      </div>
      <div class="quest-body">${q.desc}</div>
      <div class="quest-sub">行動：${q.action}${q.tail ? " " + q.tail : ""}</div>
    </div>
  `;
}

function buildMonthlyQuests(jiKey, luKey) {
  const jiLabel = jiKey ? (KB2026?.palace_definitions?.[jiKey]?.label || jiKey) : "壓力區";
  const luLabel = luKey ? (KB2026?.palace_definitions?.[luKey]?.label || luKey) : "機會區";

  const base = KB2026?.monthly_strategy || [];
  return base.map((it) => {
    let tail = "";
    if (it.color === "red") tail = `（提醒：今年要特別顧「${jiLabel}」）`;
    else if (it.color === "green") tail = `（加分：把成果丟到「${luLabel}」舞台）`;
    else if (it.color === "yellow") tail = `（修煉：用專業拿回節奏）`;
    else tail = `（穩定：用口碑與條理累積信用）`;

    return { ...it, tail };
  });
}

/** ---------- profile summary ---------- */
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

  const line = (label, pack, tag) => {
    if (tag) return `${label}：<span class="text-[#D4AF37] font-black">${tag.tag}</span>（${toSafeText(pack.majors?.join("、") || "")}）`;
    if (pack.mode === "borrow") return `${label}：<span class="text-[#D4AF37] font-black">環境映射型（空宮借星）</span>（借：${toSafeText(pack.opp?.name || "")}）`;
    return `${label}：<span class="text-[#D4AF37] font-black">（資料不足）</span>`;
  };

  const mingLine = line("你的性格核心（命宮）", mingPack, mingTag);
  const fudeLine = line("快樂與安全感（福德）", fudePack, fudeTag);

  const jieLine = jieTag
    ? `壓力反應（疾厄）：<span class="text-[#D4AF37] font-black">${jieTag.tag}</span>（${toSafeText(jiePack.majors?.join("、") || "")}）`
    : `壓力反應（疾厄）：以「場景」與「四化紅綠燈」判讀更準。`;

  const linkLine = `關係模式（夫妻 / 交友）：${toSafeText(fuqiPack.majors?.join("、") || (fuqiPack.mode === "borrow" ? "空宮借星" : "（無）"))} ／ ${toSafeText(frPack.majors?.join("、") || (frPack.mode === "borrow" ? "空宮借星" : "（無）"))}`;

  return `
    <div class="text-[13px] text-zinc-300 leading-relaxed space-y-1">
      <div>${mingLine}</div>
      <div>${fudeLine}</div>
      <div>${jieLine}</div>
      <div>${linkLine}</div>
      <div class="mt-3 text-[12px] text-zinc-500">#轉化 #重組 #補洞</div>
    </div>
  `;
}

/** ---------- clash line ---------- */
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

/** ---------- CSV export（保持你原本功能） ---------- */
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

  const rows = [];
  rows.push(["紫微戰略地圖｜匯出資料（2026）"]);
  rows.push([]);
  rows.push(["基本資料"]);
  rows.push(["項目", "內容"]);
  rows.push(["生日（西元）", dob ? `${dob.y}-${dob.m}-${dob.d}` : ""]);
  rows.push(["時間(24h)", tob]);
  rows.push(["時辰", shichen || "（未填）"]);
  rows.push(["子時早晚", shichen === "子" ? (ziMode || "auto") : "—"]);
  rows.push(["性別", gender]);
  rows.push(["五行局", _lastChart.fiveElementsClass]);
  rows.push(["命主", _lastChart.soul]);
  rows.push([]);

  rows.push(["十二宮"]);
  rows.push(["宮位", "主星", "輔星"]);
  _lastChart.palaces.forEach((p) => {
    rows.push([normalizePalaceName(p.name), (p.majorStars || []).map(s=>s.name).join("、"), (p.minorStars || []).map(s=>s.name).join("、")]);
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

/** ---------- expose ---------- */
window.deployTacticalMap = deployTacticalMap;
window.resetToInput = resetToInput;
window.exportCSV = exportCSV;

/** ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initDOBSelectors();
  initShichenUI();
  initBottomSheet();

  const savedT = localStorage.getItem("sm_tob");
  if (savedT) {
    const tob = document.getElementById("tob");
    if (tob) tob.value = savedT;
  }
});
