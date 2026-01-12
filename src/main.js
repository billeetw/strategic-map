import "./style.css";
import { astro } from "iztro";
import { KB2026 } from "./kb_2026.js";

const FORM_URL = "https://forms.gle/Vvs6U12TeMYtab8A6";
const SIHUA_2026 = (KB2026 && KB2026.annual_sihua_2026) || {
  天同: "祿",
  天機: "權",
  文昌: "科",
  廉貞: "忌",
};

let _lastChart = null;
let _lastLianZhenIdx = -1;
let _selectedPalaceIdx = -1;
let _questBound = false;

// ---------- utils ----------
function toSafeText(v) {
  return v === null || v === undefined ? "" : String(v);
}
function normalizePalaceName(name) {
  return (name || "").replace("宮", "");
}
function $(id) {
  return document.getElementById(id);
}
function showError(msg) {
  const box = $("error-box");
  if (!box) return;
  box.textContent = msg;
  box.classList.remove("hidden");
}
function clearError() {
  const box = $("error-box");
  if (!box) return;
  box.textContent = "";
  box.classList.add("hidden");
}

// iztro timeIndex：0..12（含早/晚子）
function timeIndexFromInput(tob) {
  const hour = parseInt((tob || "12:00").split(":")[0], 10);
  if (hour === 0) return 0;
  if (hour === 23) return 12;
  return Math.floor((hour + 1) / 2);
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

// 農曆月 → 地支（示意用：正月=寅 ... 12月=丑）
function branchFromMonth(month) {
  const arr = ["寅","卯","辰","巳","午","未","申","酉","戌","亥","子","丑"];
  const i = Math.max(1, Math.min(12, Number(month))) - 1;
  return arr[i];
}

function isInViewport(el, pad = 24) {
  const r = el.getBoundingClientRect();
  return r.top >= -pad && r.bottom <= (window.innerHeight + pad);
}

// ---------- DOB selectors ----------
function initDOBSelectors() {
  const yEl = $("dob-year");
  const mEl = $("dob-month");
  const dEl = $("dob-day");
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
  const yEl = $("dob-year");
  const mEl = $("dob-month");
  const dEl = $("dob-day");
  if (yEl && mEl && dEl) {
    const y = parseInt(yEl.value, 10);
    const m = parseInt(mEl.value, 10);
    const d = parseInt(dEl.value, 10);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) return { y, m, d };
  }
  return null;
}

// ---------- KB helpers (defensive) ----------
function palaceDefByName(palaceNameOrKey) {
  const key = normalizePalaceName(palaceNameOrKey);
  return (KB2026?.palace_definitions && KB2026.palace_definitions[key]) || null;
}
function huaDef(hua) {
  return (KB2026?.hua_definitions && KB2026.hua_definitions[hua]) || null;
}
function emptyCopy() {
  return KB2026?.empty_palace_copy || {
    title: "鏡面模式（空宮）",
    desc: "這不是沒有特質，而是你在這個領域特別容易因環境而調整策略。",
    action: "建議看借對宮的主星，並用『場景＋今年紅綠燈』來做決策。",
  };
}
function stressNote(starName) {
  return (KB2026?.stress_reactions && KB2026.stress_reactions[starName]) || null;
}
function starProfile(key) {
  return (KB2026?.star_profiles && KB2026.star_profiles[key]) || null;
}

// ---------- palace data helpers ----------
function starsOfPalace(palace) {
  return (palace?.majorStars || []).map((s) => s.name).filter(Boolean);
}

function starTagForMajors(majors) {
  if (!majors || majors.length === 0) return null;
  if (majors.length >= 2) {
    const combo1 = `${majors[0]}${majors[1]}`;
    const combo2 = `${majors[1]}${majors[0]}`;
    const hit = starProfile(combo1) || starProfile(combo2);
    if (hit) return hit;
  }
  return starProfile(majors[0]) || null;
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

function findPalaceIndexByStarName(starName) {
  if (!_lastChart) return -1;
  return _lastChart.palaces.findIndex((p) => (p.majorStars || []).some((s) => s.name === starName));
}

function findPalaceIndexByBranch(branch) {
  if (!_lastChart) return -1;
  return _lastChart.palaces.findIndex((p) => p.earthlyBranch === branch);
}

// ---------- bottom sheet ----------
let _sheet = null;

function initBottomSheet() {
  const root = $("sheet-root");
  const panel = $("sheet-panel");
  const backdrop = $("sheet-backdrop");
  const closeBtn = $("sheet-close");
  const title = $("sheet-title");
  const body = $("sheet-body");
  if (!root || !panel || !backdrop || !closeBtn || !title || !body) return;

  _sheet = { root, panel, backdrop, closeBtn, title, body, isOpen: false };

  const close = () => closeBottomSheet();
  backdrop.addEventListener("click", close);
  closeBtn.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function isMobileView() {
  return window.matchMedia("(max-width: 640px)").matches;
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

// ---------- navigation ----------
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
window.scrollToSection = scrollToSection;

// ---------- core actions ----------
function resetToInput() {
  $("result-section")?.classList.add("hidden");
  $("input-section")?.classList.remove("hidden");
  $("btn-reset")?.classList.add("hidden");
  $("btn-recalc")?.classList.add("hidden");
  clearError();

  _lastChart = null;
  _lastLianZhenIdx = -1;
  _selectedPalaceIdx = -1;

  const detail = $("palace-detail");
  if (detail) detail.innerHTML = `<div class="muted">尚未選擇宮位。</div>`;

  const profile = $("profile-summary");
  if (profile) profile.innerHTML = `<div class="muted">請先啟動演算。</div>`;

  const aph = $("aphorism-text");
  if (aph) aph.textContent = "";

  const quest = $("quest-list");
  if (quest) quest.innerHTML = "";
}
window.resetToInput = resetToInput;

function scrollToTopQuests() {
  const el = $("quest-list");
  if (el) el.scrollTop = 0;
}
window.scrollToTopQuests = scrollToTopQuests;

function flashPalace(idx) {
  const el = document.getElementById(`palace-${idx}`);
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth; // reflow
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 900);
}

function deployTacticalMap() {
  clearError();

  const dob = getDOBParts();
  const tob = $("tob")?.value || "12:00";
  const gender = $("gender")?.value || "male";
  const calendar = $("calendar")?.value || "gregorian";

  if (!dob) {
    showError("請先選擇出生年月日。");
    return;
  }

  localStorage.setItem("sm_dob", `${dob.y}-${dob.m}-${dob.d}`);
  localStorage.setItem("sm_tob", tob);

  $("input-section")?.classList.add("hidden");
  $("result-section")?.classList.remove("hidden");
  $("btn-reset")?.classList.remove("hidden");
  $("btn-recalc")?.classList.remove("hidden");

  const timeIdx = timeIndexFromInput(tob);
  const genderZh = gender === "female" ? "女" : "男";

  let chart;
  try {
    if (calendar === "lunar") {
      chart = astro.byLunar(dob.y, dob.m, dob.d, false, timeIdx, genderZh, true, "zh-TW");
    } else {
      chart = astro.bySolar(`${dob.y}-${dob.m}-${dob.d}`, timeIdx, genderZh, true, "zh-TW");
    }
  } catch (e) {
    console.error(e);
    showError("演算失敗：請確認輸入資料是否正確，或切換『曆法』重算。");
    resetToInput();
    return;
  }

  _lastChart = chart;
  _selectedPalaceIdx = -1;

  const root = $("map-root");
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
    const majors = starsOfPalace(palace);
    const isEmpty = majors.length === 0;

    const huaSet = new Set();
    (palace.majorStars || []).forEach((s) => {
      const hua = SIHUA_2026[s.name];
      if (hua) huaSet.add(hua);
      if (s.name === "廉貞") lianZhenIdx = idx;
    });

    pDiv.className = [
      "palace",
      `p-${palace.earthlyBranch}`,
      isNominal ? "is-nominal" : "",
      isEmpty ? "is-empty" : "",
      huaSet.has("祿") ? "has-hua-lu" : "",
      huaSet.has("權") ? "has-hua-quan" : "",
      huaSet.has("科") ? "has-hua-ke" : "",
      huaSet.has("忌") ? "has-hua-ji" : "",
    ].filter(Boolean).join(" ");

    pDiv.tabIndex = 0;
    pDiv.setAttribute("role", "button");
    pDiv.setAttribute("aria-label", `${toSafeText(palace.name)} 宮`);

    if (isEmpty) {
      const b = document.createElement("div");
      b.className = "borrow-badge";
      b.textContent = "🔗";
      pDiv.appendChild(b);
    }

    const flex = document.createElement("div");
    flex.className = "flex h-full";

    const majorWrap = document.createElement("div");
    majorWrap.className = "flex";

    const minorWrap = document.createElement("div");
    minorWrap.className = "flex";

    (palace.majorStars || []).forEach((s) => {
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
        const tag2 = document.createElement("div");
        tag2.className = "hua-tag hua-2026";
        tag2.textContent = toSafeText(SIHUA_2026[s.name]);
        star.appendChild(tag2);
      }
      majorWrap.appendChild(star);
    });

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

    pDiv.appendChild(flex);
    pDiv.appendChild(label);
    pDiv.appendChild(meta);
    pDiv.appendChild(age);

    pDiv.addEventListener("click", () => selectPalace(idx, { flash: true }));
    pDiv.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        selectPalace(idx, { flash: true });
      }
    });

    root.appendChild(pDiv);
  });

  _lastLianZhenIdx = lianZhenIdx;

  $("bureau-text").innerText = toSafeText(chart.fiveElementsClass);
  $("destiny-text").innerText = `${toSafeText(chart.chineseDate)} 生 / 命主 ${toSafeText(chart.soul)}`;

  updateAnnualAndMonthly(chart, lianZhenIdx);

  const profileEl = $("profile-summary");
  if (profileEl) profileEl.innerHTML = buildProfileSummaryHTML();

  const nominalIdx = chart.palaces.findIndex((p) => normalizePalaceName(p.name) === "命");
  if (nominalIdx >= 0) selectPalace(nominalIdx);

  drawOverlay();

  window.removeEventListener("resize", _onResizeRedraw);
  window.addEventListener("resize", _onResizeRedraw);

  // monthly CTA fade in after 2s
  const cta = $("cta-monthly");
  if (cta) {
    cta.classList.remove("cta-show");
    cta.classList.add("cta-hidden");
    setTimeout(() => {
      cta.classList.remove("cta-hidden");
      cta.classList.add("cta-show");
    }, 2000);
  }
}
window.deployTacticalMap = deployTacticalMap;

function _onResizeRedraw() {
  if (_lastChart) drawOverlay();
}

// ---------- selection + render ----------
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

  if (isMobileView()) {
    openBottomSheet({ title: `${toSafeText(palace.name)}｜宮位解析`, html });
  } else {
    const detailEl = $("palace-detail");
    if (detailEl) detailEl.innerHTML = html;
  }

  drawOverlay();
  if (opts.flash) flashPalace(idx);
}

function buildPalaceDetailHTML(palace, idx) {
  const majorsDirect = starsOfPalace(palace);
  const pack = getMajorStarsOrBorrow(idx);
  const def = palaceDefByName(palace.name);

  const majorHTML = (palace.majorStars || []).map((s) => {
    const birth = s.lunarSihua
      ? ` <span style="margin-left:6px;padding:2px 6px;border-radius:8px;background:rgba(196,30,58,0.6);font-size:11px;">${toSafeText(s.lunarSihua)}</span>`
      : "";
    const ann = SIHUA_2026[s.name]
      ? ` <span style="margin-left:6px;padding:2px 6px;border-radius:8px;background:rgba(30,64,175,0.6);font-size:11px;">${toSafeText(SIHUA_2026[s.name])}</span>`
      : "";
    return `<div style="display:flex;align-items:center;gap:8px;">
      <div style="color:var(--gold);font-weight:900;">${toSafeText(s.name)}</div>
      <div>${birth}${ann}</div>
    </div>`;
  }).join("");

  const minorHTML = (palace.minorStars || []).map((s) =>
    `<span style="display:inline-block;margin:0 8px 8px 0;padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);font-size:12px;color:rgba(255,255,255,0.75);">${toSafeText(s.name)}</span>`
  ).join("");

  let emptyHint = "";
  if (majorsDirect.length === 0 && pack.mode === "borrow") {
    const oppName = toSafeText(pack.opp?.name);
    const oppStars = pack.majors.length ? pack.majors.join("、") : "（仍無主星）";
    const ec = emptyCopy();
    emptyHint = `
      <div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.72);">
        <b style="color:rgba(255,255,255,0.9);">空宮</b>：${ec.title}｜
        借對宮：<b style="color:rgba(255,255,255,0.9);">${oppName}</b>（主星：${oppStars}）
      </div>
    `;
  }

  return `
    <div>
      <div style="display:flex;justify-content:space-between;gap:10px;">
        <div>
          <div style="font-weight:900;font-size:16px;">${toSafeText(palace.name)} <span style="color:rgba(255,255,255,0.5);font-size:12px;">#${idx}</span></div>
          <div style="margin-top:4px;color:rgba(255,255,255,0.55);font-size:12px;">
            ${toSafeText(palace.heavenlyStem)}${toSafeText(palace.earthlyBranch)} ｜ ${toSafeText(palace.changsheng12)}
          </div>
          ${def ? `<div style="margin-top:8px;font-size:13px;color:rgba(255,255,255,0.86);">
            場景：<b style="color:var(--gold);">${def.label}</b>｜${def.desc}
          </div>` : ""}
          ${emptyHint}
        </div>
      </div>

      <div style="margin-top:12px;">
        <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-bottom:6px;">主星</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${majorHTML || `<div style="font-size:12px;color:rgba(255,255,255,0.55);">（空宮／請看借對宮主星提示）</div>`}
        </div>
      </div>

      <div style="margin-top:12px;">
        <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-bottom:6px;">輔星</div>
        <div>${minorHTML || `<div style="font-size:12px;color:rgba(255,255,255,0.55);">（無資料）</div>`}</div>
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
    if (hua) {
      const hd = huaDef(hua);
      huaLines.push(`2026 ${s.name} 化${hua}：${hd ? `${hd.status}｜${hd.guidance}` : "（提示）"}`);
    }
  }

  let stressBlock = "";
  if (key === "疾厄" && majors.length) {
    const notes = majors.map(stressNote).filter(Boolean).slice(0, 2);
    if (notes.length) {
      stressBlock = `
        <div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.82);">
          <div style="color:rgba(255,255,255,0.55);margin-bottom:4px;">壓力反應提醒（非醫療診斷）</div>
          - ${notes.join("<br/>- ")}
        </div>
      `;
    }
  }

  const ctas = (def?.cta || []).slice(0, 4);
  const ctaHTML = ctas.length
    ? `<div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.82);">
        <div style="color:rgba(255,255,255,0.55);margin-bottom:4px;">可執行小動作</div>
        - ${ctas.join("<br/>- ")}
      </div>`
    : "";

  const ec = emptyCopy();
  const emptyExplain =
    pack.mode === "borrow"
      ? `<div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.6);">
          空宮說明：${ec.desc}<br/>建議：${ec.action}
        </div>`
      : "";

  const persona = tag
    ? `<div style="margin-top:8px;font-size:13px;color:rgba(255,255,255,0.9);">
        主星人設：<b style="color:var(--gold);">${tag.tag}</b>｜${tag.workplace}
      </div>`
    : `<div style="margin-top:8px;font-size:13px;color:rgba(255,255,255,0.6);">
        主星人設：尚未建立（可後續擴充）
      </div>`;

  const huaText = huaLines.length
    ? `- ${huaLines.join("<br/>- ")}`
    : "（此宮今年沒有明顯四化標記時，重點回到：場景＋你的行動策略。）";

  return `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);">
      <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-bottom:8px;">新手白話（人生/性格）</div>

      ${def ? `<div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.9);">
        這是【${toSafeText(palace.name)}】：<b style="color:var(--gold);">${def.label}</b><br/>
        你在乎的是：<span style="color:rgba(255,255,255,0.75);">${def.cares}</span>
      </div>` : ""}

      ${emptyExplain}
      ${persona}

      <div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.82);">
        <div style="color:rgba(255,255,255,0.55);margin-bottom:4px;">四化提示（今年的紅綠燈）</div>
        ${huaText}
      </div>

      ${stressBlock}
      ${ctaHTML}

      <div style="margin-top:12px;">
        <a href="${FORM_URL}" target="_blank" rel="noreferrer"
           style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:10px 12px;border-radius:12px;border:1px solid rgba(212,175,55,0.35);background:rgba(212,175,55,0.08);color:rgba(255,255,255,0.92);font-weight:900;">
          需要更深一層策略？申請 1 對 1諮詢服務↗
        </a>
      </div>
    </div>
  `;
}

// ---------- profile summary ----------
function buildProfileSummaryHTML() {
  if (!_lastChart) return `<div class="muted">請先啟動演算。</div>`;

  const getIdxByPalaceKey = (k) =>
    _lastChart.palaces.findIndex((p) => normalizePalaceName(p.name) === k);

  const idxMing = getIdxByPalaceKey("命");
  const idxJie = getIdxByPalaceKey("疾厄");
  const idxFuqi = getIdxByPalaceKey("夫妻");
  const idxFriends = getIdxByPalaceKey("交友");

  const mingPack = getMajorStarsOrBorrow(idxMing);
  const jiePack = getMajorStarsOrBorrow(idxJie);
  const fuqiPack = getMajorStarsOrBorrow(idxFuqi);
  const frPack = getMajorStarsOrBorrow(idxFriends);

  const mingTag = starTagForMajors(mingPack.majors);
  const jieTag = starTagForMajors(jiePack.majors);

  const idxJi = _lastLianZhenIdx;
  const idxLu = findPalaceIndexByStarName("天同");
  const idxQuan = findPalaceIndexByStarName("天機");
  const idxKe = findPalaceIndexByStarName("文昌");

  const jiKey = idxJi >= 0 ? normalizePalaceName(_lastChart.palaces[idxJi].name) : null;
  const luKey = idxLu >= 0 ? normalizePalaceName(_lastChart.palaces[idxLu].name) : null;

  const jiDef = jiKey ? palaceDefByName(jiKey) : null;
  const luDef = luKey ? palaceDefByName(luKey) : null;

  const title =
    jiKey === "田宅" && luKey === "遷移"
      ? "🌟 2026 年度導航：先蹲後跳的「系統重組年」"
      : `🌟 2026 年度導航：先修「${jiDef?.label || jiKey || "壓力區"}」再放大「${luDef?.label || luKey || "機會區"}」`;

  const mingLine = mingTag
    ? `你的底色：<b style="color:var(--gold);">${mingTag.tag}</b>（${toSafeText(mingPack.majors?.join("、") || "")}）`
    : `你的底色：<b style="color:var(--gold);">${emptyCopy().title}</b>（空宮可借對宮：${toSafeText(mingPack.opp?.name || "")}）`;

  const jieLine = jieTag
    ? `你的壓力反應：<b style="color:var(--gold);">${jieTag.tag}</b>（${toSafeText(jiePack.majors?.join("、") || "")}）`
    : `你的壓力反應：以「場景」與「今年紅綠燈」判讀更準。`;

  const linkLine = `你的連結（關係/社交）：夫妻 ${toSafeText(fuqiPack.majors?.join("、") || "空宮")} ／ 交友 ${toSafeText(frPack.majors?.join("、") || "空宮")}`;

  const jiScene = jiDef ? `今年的坎：<b style="color:rgba(248,113,113,0.95);">${jiDef.label}</b>（${jiKey}）` : `今年的坎：壓力點（忌）`;
  const luScene = luDef ? `今年的光：<b style="color:rgba(74,222,128,0.95);">${luDef.label}</b>（${luKey}）` : `今年的光：機會點（祿）`;

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
    const def = palaceDefByName(k);
    const hd = huaDef(t.hua);
    const label = def?.label || k;
    const tone = hd?.tone || (t.hua === "忌" ? "red" : "green");
    const color =
      tone === "green" ? "rgba(74,222,128,0.95)" :
      tone === "yellow" ? "rgba(250,204,21,0.95)" :
      tone === "blue" ? "rgba(96,165,250,0.95)" :
      "rgba(248,113,113,0.95)";
    return `<div style="font-size:12px;color:rgba(255,255,255,0.65);">
      <b style="color:${color};">${t.hua}（${hd?.status || "提示"}）</b>｜${k}：${label}
    </div>`;
  }).join("");

  return `
    <div style="font-weight:900;margin-bottom:8px;">${title}</div>

    <div style="font-size:14px;color:rgba(255,255,255,0.86);line-height:1.7;">
      <div>${mingLine}</div>
      <div style="margin-top:4px;">${linkLine}</div>
      <div style="margin-top:4px;">${jieLine}</div>
    </div>

    <div style="margin-top:10px;font-size:14px;color:rgba(255,255,255,0.86);line-height:1.7;">
      <div>${jiScene} → 建議：<span style="color:rgba(255,255,255,0.92);">${jiAction}</span></div>
      <div style="margin-top:4px;">${luScene} → 建議：<span style="color:rgba(255,255,255,0.92);">${luAction}</span></div>
    </div>

    <div style="margin-top:10px;">
      <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:6px;">今年紅綠燈（先看順的，再看修煉，再看補洞）</div>
      ${trafficHTML}
    </div>

    <div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.55);line-height:1.6;">
      讀盤順序（小白版）：命宮看「你怎麼做事」→ 福德看「你怎麼快樂」→ 疾厄看「你怎麼耗損」→ 夫妻/交友看「你怎麼連結」。
    </div>
  `;
}

// ---------- annual + monthly ----------
function updateAnnualAndMonthly(chart, lzIdx) {
  const jiPalace = lzIdx >= 0 ? chart.palaces[lzIdx] : null;
  const luPalace = chart.palaces.find((p) => (p.majorStars || []).some((s) => s.name === "天同")) || null;

  const jiKey = jiPalace ? normalizePalaceName(jiPalace.name) : null;
  const luKey = luPalace ? normalizePalaceName(luPalace.name) : null;

  const jiDef = jiKey ? palaceDefByName(jiKey) : null;
  const luDef = luKey ? palaceDefByName(luKey) : null;

  const jiName = jiPalace ? jiPalace.name : "（未定位）";
  const luName = luPalace ? luPalace.name : "（未定位）";

  const jiScene = jiDef ? `「${jiDef.label}」` : "壓力區";
  const luScene = luDef ? `「${luDef.label}」` : "機會區";

  $("aphorism-text").textContent =
    `2026 丙午年戰略重點在於「轉化」與「重組」。` +
    `流年化忌（廉貞）落入你的【${jiName}】（${jiScene}），今年更像「補洞/修繕年」：先修系統、先補根基，再談衝刺。` +
    `而天同化祿進入【${luName}】（${luScene}），這裡是年度更容易出現「資源／合作／好運窗口」的突破口：多走出去、多曝光、多連結，順勢擴張。`;

  const months = buildMonthlyQuests(jiKey, luKey);
  const list = $("quest-list");
  list.innerHTML = months.map((q) => `
    <div class="quest-item" data-month="${q.month}" data-branch="${q.branch}">
      <div style="color:var(--gold);font-weight:900;margin-bottom:6px;">${q.m}｜${q.theme}</div>
      <div style="color:rgba(255,255,255,0.70);line-height:1.6;">${q.task}</div>
      <div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,0.45);">定位地支：${q.branch}</div>
    </div>
  `).join("");

  bindQuestNavigationOnce();
}

function buildMonthlyQuests(jiKey, luKey) {
  const jiLabel = jiKey ? (palaceDefByName(jiKey)?.label || jiKey) : "壓力區";
  const luLabel = luKey ? (palaceDefByName(luKey)?.label || luKey) : "機會區";

  const list = KB2026?.monthly_strategy || [];

  return list.map((it) => {
    const m = `${it.month} 月`;
    let tail = "";
    if (it.color === "red") tail = `（提醒：今年要特別顧「${jiLabel}」）`;
    else if (it.color === "green") tail = `（加分：把成果丟到「${luLabel}」舞台）`;
    else if (it.color === "yellow") tail = `（修煉：用專業拿回節奏）`;
    else tail = `（穩定：用口碑與條理累積信用）`;

    const branch = branchFromMonth(it.month);
    return {
      month: it.month,
      branch,
      m,
      theme: it.theme,
      task: `${it.desc} 行動：${it.action} ${tail}`,
    };
  });
}

// ---------- flow-month click -> palace highlight ----------
function bindQuestNavigationOnce() {
  if (_questBound) return;
  const list = $("quest-list");
  if (!list) return;

  list.addEventListener("click", (ev) => {
    const item = ev.target.closest(".quest-item");
    if (!item) return;
    if (!_lastChart) return;

    // active state
    list.querySelectorAll(".quest-item").forEach((x) => x.classList.remove("is-active"));
    item.classList.add("is-active");

    const branch = item.dataset.branch;
    const idx = findPalaceIndexByBranch(branch);

    if (idx < 0) {
      showError(`找不到對應地支宮位：${branch}`);
      return;
    }

    // 如果命盤不在視窗內，先滑回去（尤其手機很重要）
    const chartSec = $("sec-chart");
    if (chartSec && !isInViewport(chartSec, 40)) {
      chartSec.scrollIntoView({ behavior: "smooth", block: "start" });
      // 等捲動開始後再選取（避免使用者看不到閃爍）
      setTimeout(() => {
        selectPalace(idx, { flash: true });
      }, 320);
    } else {
      selectPalace(idx, { flash: true });
    }
  });

  _questBound = true;
}

// ---------- overlay lines (clash + borrow) ----------
function drawOverlay() {
  const svg = $("svg-overlay");
  const root = $("map-root");
  if (!svg || !root) return;

  svg.innerHTML = "";
  const container = root.getBoundingClientRect();

  // red dashed line: 廉貞所在宮 → 對宮
  if (_lastLianZhenIdx >= 0) {
    const a = document.getElementById(`palace-${_lastLianZhenIdx}`);
    const b = document.getElementById(`palace-${(_lastLianZhenIdx + 6) % 12}`);
    if (a && b) {
      const r1 = a.getBoundingClientRect();
      const r2 = b.getBoundingClientRect();
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
  }

  // gold thin line: selected palace empty → opposite (borrow)
  if (_selectedPalaceIdx >= 0 && _lastChart) {
    const p = _lastChart.palaces[_selectedPalaceIdx];
    const majors = starsOfPalace(p);
    if (majors.length === 0) {
      const a = document.getElementById(`palace-${_selectedPalaceIdx}`);
      const b = document.getElementById(`palace-${(_selectedPalaceIdx + 6) % 12}`);
      if (a && b) {
        const r1 = a.getBoundingClientRect();
        const r2 = b.getBoundingClientRect();
        const x1 = r1.left - container.left + r1.width / 2;
        const y1 = r1.top - container.top + r1.height / 2;
        const x2 = r2.left - container.left + r2.width / 2;
        const y2 = r2.top - container.top + r2.height / 2;

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x1);
        line.setAttribute("y1", y1);
        line.setAttribute("x2", x2);
        line.setAttribute("y2", y2);
        line.setAttribute("stroke", "#D4AF37");
        line.setAttribute("stroke-width", "1.2");
        line.setAttribute("opacity", "0.55");
        svg.appendChild(line);
      }
    }
  }
}

// ---------- CSV export ----------
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
  const tob = $("tob")?.value || "";
  const gender = $("gender")?.value || "";
  const calendar = $("calendar")?.value || "";

  const idxJi = _lastLianZhenIdx;
  const idxLu = findPalaceIndexByStarName("天同");
  const jiKey = idxJi >= 0 ? normalizePalaceName(_lastChart.palaces[idxJi].name) : "";
  const luKey = idxLu >= 0 ? normalizePalaceName(_lastChart.palaces[idxLu].name) : "";
  const jiDef = jiKey ? palaceDefByName(jiKey) : null;
  const luDef = luKey ? palaceDefByName(luKey) : null;

  const rows = [];
  rows.push(["紫微戰略地圖｜匯出資料（2026）"]);
  rows.push([]);
  rows.push(["年度導航"]);
  rows.push(["項目", "內容"]);
  rows.push(["生日", dob ? `${dob.y}-${dob.m}-${dob.d}` : ""]);
  rows.push(["時間", tob]);
  rows.push(["性別", gender]);
  rows.push(["曆法", calendar]);
  rows.push(["五行局", _lastChart.fiveElementsClass]);
  rows.push(["命主", _lastChart.soul]);
  rows.push(["壓力點（忌）", jiKey ? `${jiKey}｜${jiDef?.label || ""}` : ""]);
  rows.push(["機會點（祿）", luKey ? `${luKey}｜${luDef?.label || ""}` : ""]);
  rows.push(["諮詢連結", FORM_URL]);
  rows.push([]);

  rows.push(["十二宮場景"]);
  rows.push(["宮位", "場景標籤", "核心描述", "主星(或借星)", "是否空宮", "借對宮", "2026 四化", "行動建議"]);

  _lastChart.palaces.forEach((p, idx) => {
    const key = normalizePalaceName(p.name);
    const def = palaceDefByName(key);
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
      .map((s) => (SIHUA_2026[s.name] ? `${s.name}化${SIHUA_2026[s.name]}` : ""))
      .filter(Boolean)
      .join("；");

    const cta = (def?.cta || []).slice(0, 3).join(" / ");

    rows.push([key, def?.label || "", def?.desc || "", majorsText, isEmpty ? "是" : "否", borrowFrom, huaList, cta]);
  });

  rows.push([]);
  rows.push(["流月戰略任務"]);
  rows.push(["月份", "地支定位", "主題", "任務描述"]);
  const months = buildMonthlyQuests(jiKey, luKey);
  months.forEach((mObj) => rows.push([mObj.m, mObj.branch, mObj.theme, mObj.task]));

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
window.exportCSV = exportCSV;

// ---------- init ----------
initDOBSelectors();
initBottomSheet();

const savedT = localStorage.getItem("sm_tob");
if (savedT && $("tob")) $("tob").value = savedT;
