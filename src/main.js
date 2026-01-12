import "./style.css";
import { astro } from "iztro";
import { KB2026 } from "./kb_2026.js";

/** =======================
 *  Config
 *  ======================= */
const SIHUA_2026 =
  KB2026?.annual_sihua_2026 || { 天同: "祿", 天機: "權", 文昌: "科", 廉貞: "忌" };

const CONSULT_URL = "https://forms.gle/Vvs6U12TeMYtab8A6";

/** =======================
 *  State
 *  ======================= */
let _lastChart = null;
let _lastLianZhenIdx = -1;
let _selectedPalaceIdx = -1;
let _borrowOppIdx = -1;

let _sheet = null;
let _monthlyCtaTimer = null;

/** =======================
 *  Helpers
 *  ======================= */
function toSafeText(v) {
  return v === null || v === undefined ? "" : String(v);
}

function normalizePalaceName(name) {
  return (name || "").replace("宮", "");
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

// iztro timeIndex：0..12（含早/晚子）
function timeIndexFromInput(tob) {
  const hour = parseInt((tob || "12:00").split(":")[0], 10);
  if (hour === 0) return 0; // 早子
  if (hour === 23) return 12; // 晚子
  return Math.floor((hour + 1) / 2);
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate(); // m: 1..12
}

/** =======================
 *  DOB Selectors (mobile-friendly)
 *  ======================= */
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
  if (yEl && mEl && dEl) {
    const y = parseInt(yEl.value, 10);
    const m = parseInt(mEl.value, 10);
    const d = parseInt(dEl.value, 10);
    if ([y, m, d].every(Number.isFinite)) return { y, m, d };
  }
  return null;
}

/** =======================
 *  Scroll / Nav
 *  ======================= */
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** =======================
 *  Bottom Sheet (mobile)
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

/** =======================
 *  KB helpers
 *  ======================= */
function palaceDefByName(palaceName) {
  const key = normalizePalaceName(palaceName);
  return KB2026?.palace_definitions?.[key] || null;
}

function starsOfPalace(palace) {
  return (palace?.majorStars || []).map((s) => s.name).filter(Boolean);
}

function starTagForMajors(majors) {
  if (!majors || majors.length === 0) return null;
  if (majors.length >= 2) {
    const combo1 = `${majors[0]}${majors[1]}`;
    const combo2 = `${majors[1]}${majors[0]}`;
    const hit = KB2026?.star_profiles?.[combo1] || KB2026?.star_profiles?.[combo2];
    if (hit) return hit;
  }
  return KB2026?.star_profiles?.[majors[0]] || null;
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

function huaDef(hua) {
  return KB2026?.hua_definitions?.[hua] || null;
}

function findPalaceIndexByStarName(starName) {
  if (!_lastChart) return -1;
  return _lastChart.palaces.findIndex((p) => (p.majorStars || []).some((s) => s.name === starName));
}

/** =======================
 *  UI: Reset / Render
 *  ======================= */
function resetToInput() {
  document.getElementById("result-section")?.classList.add("hidden");
  document.getElementById("input-section")?.classList.remove("hidden");
  document.getElementById("btn-reset")?.classList.add("hidden");
  document.getElementById("btn-recalc")?.classList.add("hidden");
  clearError();

  _lastChart = null;
  _lastLianZhenIdx = -1;
  _selectedPalaceIdx = -1;
  _borrowOppIdx = -1;

  const detail = document.getElementById("palace-detail");
  if (detail) detail.textContent = "尚未選擇宮位。";

  const profile = document.getElementById("profile-summary");
  if (profile) profile.textContent = "請先啟動演算。";

  const aph = document.getElementById("aphorism-text");
  if (aph) aph.textContent = "";

  const ql = document.getElementById("quest-list");
  if (ql) ql.innerHTML = "";
}

function deployTacticalMap() {
  clearError();

  const dob = getDOBParts();
  const tob = document.getElementById("tob")?.value || "12:00";
  const gender = document.getElementById("gender")?.value || "male";
  const calendar = document.getElementById("calendar")?.value || "gregorian";

  if (!dob) {
    showError("請先選擇出生年月日。");
    return;
  }

  localStorage.setItem("sm_dob", `${dob.y}-${dob.m}-${dob.d}`);
  localStorage.setItem("sm_tob", tob);

  document.getElementById("input-section")?.classList.add("hidden");
  document.getElementById("result-section")?.classList.remove("hidden");
  document.getElementById("btn-reset")?.classList.remove("hidden");
  document.getElementById("btn-recalc")?.classList.remove("hidden");

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
  _borrowOppIdx = -1;

  renderChart(chart);
  updateAnalysis(chart);
  renderProfileSummary();

  // 預設選命宮（宮名=命）
  const nominalIdx = chart.palaces.findIndex((p) => normalizePalaceName(p.name) === "命");
  if (nominalIdx >= 0) selectPalace(nominalIdx);

  window.removeEventListener("resize", _onResizeRedraw);
  window.addEventListener("resize", _onResizeRedraw);
}

function _onResizeRedraw() {
  if (_lastChart) drawOverlay();
}

function renderChart(chart) {
  const root = document.getElementById("map-root");
  const centerHole = root?.querySelector(".center-hole");
  const svgOverlay = root?.querySelector("#svg-overlay");
  if (!root || !centerHole || !svgOverlay) {
    showError("頁面結構缺失：找不到盤面容器（map-root）。");
    return;
  }

  // 清空重建
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

    // Energy classes (annual sihua)
    const huaSet = new Set(
      (palace.majorStars || [])
        .map((s) => SIHUA_2026[s.name] || "")
        .filter(Boolean)
    );
    if (huaSet.has("祿")) pDiv.classList.add("has-lu");
    if (huaSet.has("權")) pDiv.classList.add("has-quan");
    if (huaSet.has("科")) pDiv.classList.add("has-ke");
    if (huaSet.has("忌")) pDiv.classList.add("has-ji");

    // Borrow mark (空宮)
    if ((palace.majorStars || []).length === 0) pDiv.classList.add("is-borrow");

    const flex = document.createElement("div");
    flex.className = "flex h-full";

    const majorWrap = document.createElement("div");
    majorWrap.className = "flex";

    const minorWrap = document.createElement("div");
    minorWrap.className = "flex";

    // 主星（若空宮，顯示借對宮主星為括號 + 半透明）
    const majors = palace.majorStars || [];
    if (majors.length) {
      majors.forEach((s) => {
        if (s.name === "廉貞") lianZhenIdx = idx;

        const star = document.createElement("div");
        star.className = "star-main";
        star.textContent = toSafeText(s.name);

        if (s.lunarSihua) {
          const tag = document.createElement("div");
          tag.className = "hua-tag hua-birth";
          tag.textContent = `本命${toSafeText(s.lunarSihua)}`;
          star.appendChild(tag);
        }

        if (SIHUA_2026[s.name]) {
          const hua = SIHUA_2026[s.name];
          const icon = hua === "祿" ? "▲" : hua === "忌" ? "⚠" : hua === "權" ? "◆" : "●";
          const tag2 = document.createElement("div");
          tag2.className = "hua-tag hua-2026";
          tag2.textContent = `2026${hua}${icon}`;
          star.appendChild(tag2);
        }

        majorWrap.appendChild(star);
      });
    } else {
      const opp = chart.palaces[(idx + 6) % 12];
      const oppMajors = (opp?.majorStars || []).map((x) => x.name).filter(Boolean);
      const text = oppMajors.length ? `(${oppMajors.join("、")})` : "(—)";
      const star = document.createElement("div");
      star.className = "star-main borrowed";
      star.textContent = text;
      majorWrap.appendChild(star);
    }

    // 輔星
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

  // Center texts
  const b = document.getElementById("bureau-text");
  if (b) b.innerText = toSafeText(chart.fiveElementsClass);

  const d = document.getElementById("destiny-text");
  if (d) d.innerText = `${toSafeText(chart.chineseDate)} 生 / 命主 ${toSafeText(chart.soul)}`;

  drawOverlay();
}

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

  const pack = getMajorStarsOrBorrow(idx);
  _borrowOppIdx = pack.mode === "borrow" ? pack.oppIdx : -1;

  const html = buildPalaceDetailHTML(palace, idx);
  if (isMobileView()) {
    openBottomSheet({ title: toSafeText(palace.name), html });
  } else {
    const detailEl = document.getElementById("palace-detail");
    if (detailEl) detailEl.innerHTML = html;
  }

  drawOverlay();
}

function buildPalaceDetailHTML(palace, idx) {
  const def = palaceDefByName(palace.name);
  const pack = getMajorStarsOrBorrow(idx);
  const majors = pack.majors || [];
  const persona = starTagForMajors(majors);

  const majorsDirect = starsOfPalace(palace);
  const isEmpty = majorsDirect.length === 0;

  // Level 2: tags + 3 bullets
  const bullets = [];
  if (def?.cta?.length) bullets.push(...def.cta.slice(0, 3));
  if (bullets.length < 3) {
    bullets.push("先把這一宮的『最耗能點』列出來，避免用意志力硬扛。");
    bullets.push("把目標縮到一個可交付的小步驟，先完成再優化。");
  }
  const bulletsHTML = bullets.slice(0, 3).map((t) => `<li>• ${toSafeText(t)}</li>`).join("");

  // Hua hints (annual on this palace)
  const annualHuaLines = (palace.majorStars || [])
    .map((s) => (SIHUA_2026[s.name] ? `${s.name} 化${SIHUA_2026[s.name]}` : ""))
    .filter(Boolean);

  const huaText = annualHuaLines.length
    ? annualHuaLines.map((x) => `• 2026：${x}（${toSafeText(huaDef(x.slice(-1))?.status || "")}）`).join("<br/>")
    : "• 2026：此宮未出現明顯四化標記，重點回到『場景＋你的行動策略』。";

  const emptyExplain =
    isEmpty && pack.mode === "borrow"
      ? `<div class="mt-2 text-[12px] text-zinc-400 leading-relaxed">
          <span class="text-zinc-200 font-black">空宮 🔗（借星）</span>：不是「沒有」，而是你在這個領域更像「環境映射型」——會依照對手與情境調整打法。<br/>
          借對宮：<span class="text-zinc-200 font-bold">${toSafeText(pack.opp?.name)}</span>（主星：${(pack.majors || []).join("、") || "—"}）
        </div>`
      : "";

  // Level 3: long read in details
  const longRead = `
    <details class="mt-4 border border-zinc-800 rounded-lg p-3">
      <summary class="cursor-pointer text-[12px] text-zinc-200 font-black">
        查看完整 2026 攻略（延伸閱讀）
      </summary>
      <div class="mt-2 text-[12px] text-zinc-400 leading-relaxed">
        ${def ? `
          <div><span class="text-zinc-200 font-bold">場景標籤：</span>${toSafeText(def.label)}｜${toSafeText(def.desc)}</div>
          <div class="mt-2"><span class="text-zinc-200 font-bold">你在乎的是：</span>${toSafeText(def.cares || "")}</div>
        ` : `<div>（尚未建立此宮位的 KB 資料）</div>`}
        <div class="mt-3"><span class="text-zinc-200 font-bold">四化提示：</span><br/>${huaText}</div>
        <div class="mt-3">
          <a class="underline text-[#D4AF37] font-black" href="${CONSULT_URL}" target="_blank" rel="noopener noreferrer">
            需要把這宮變成「可執行清單」？申請深度諮詢（NT$3600） ↗
          </a>
        </div>
      </div>
    </details>
  `;

  return `
    <div class="text-zinc-100 font-black text-[14px] md:text-[15px]">
      ${toSafeText(palace.name)} <span class="text-[12px] text-zinc-500">#${idx}</span>
    </div>
    <div class="text-[12px] text-zinc-500 font-mono mt-1">
      ${toSafeText(palace.heavenlyStem)}${toSafeText(palace.earthlyBranch)} ｜ ${toSafeText(palace.changsheng12)}
    </div>

    ${def ? `<div class="mt-2 text-[13px] text-zinc-200 leading-relaxed">
      新手白話：這是【${toSafeText(palace.name)}】＝<span class="text-[#D4AF37] font-black">${toSafeText(def.label)}</span><br/>
      核心：<span class="text-zinc-300">${toSafeText(def.cares || "")}</span>
    </div>` : ""}

    ${emptyExplain}

    <div class="mt-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/30">
      <div class="text-[12px] text-zinc-400 mb-1">戰略標籤（先懂這 3 句就夠）</div>
      ${persona ? `<div class="text-[13px] text-zinc-200">
        主星人設：<span class="text-[#D4AF37] font-black">${toSafeText(persona.tag)}</span>
        <span class="text-zinc-400">（${toSafeText(majors.join("、")) || "—"}）</span>
      </div>
      <div class="text-[12px] text-zinc-400 mt-1">${toSafeText(persona.workplace || persona.logic || "")}</div>` : `
      <div class="text-[12px] text-zinc-400">主星人設：尚未建立（可後續擴充）</div>`}

      <ul class="mt-2 text-[13px] text-zinc-300 leading-relaxed">
        ${bulletsHTML}
      </ul>
    </div>

    <div class="mt-3 text-[12px] text-zinc-400 leading-relaxed">
      <div class="text-zinc-500 mb-1">四化提示（今年的紅綠燈）</div>
      ${huaText}
    </div>

    ${longRead}
  `;
}

/** =======================
 *  Overlay: Clash + Borrow line
 *  ======================= */
function drawOverlay() {
  const svg = document.getElementById("svg-overlay");
  const root = document.getElementById("map-root");
  if (!svg || !root) return;

  svg.innerHTML = "";

  const container = root.getBoundingClientRect();

  // 1) Clash line (廉貞所在宮 vs 對宮)
  if (_lastLianZhenIdx >= 0) {
    const el1 = document.getElementById(`palace-${_lastLianZhenIdx}`);
    const el2 = document.getElementById(`palace-${(_lastLianZhenIdx + 6) % 12}`);
    if (el1 && el2) {
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
  }

  // 2) Borrow line (selected empty palace -> opposite)
  if (_selectedPalaceIdx >= 0 && _borrowOppIdx >= 0) {
    const el1 = document.getElementById(`palace-${_selectedPalaceIdx}`);
    const el2 = document.getElementById(`palace-${_borrowOppIdx}`);
    if (el1 && el2) {
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
      line.setAttribute("stroke", "#D4AF37");
      line.setAttribute("stroke-width", "1.4");
      line.setAttribute("stroke-dasharray", "3,5");
      line.setAttribute("opacity", "0.35");
      svg.appendChild(line);
    }
  }
}

/** =======================
 *  Profile summary + Annual + Monthly
 *  ======================= */
function renderProfileSummary() {
  const el = document.getElementById("profile-summary");
  if (!el) return;
  if (!_lastChart) {
    el.textContent = "請先啟動演算。";
    return;
  }

  const getIdx = (k) => _lastChart.palaces.findIndex((p) => normalizePalaceName(p.name) === k);

  const idxMing = getIdx("命");
  const idxFude = getIdx("福德");
  const idxJie = getIdx("疾厄");
  const idxFuqi = getIdx("夫妻");
  const idxFriends = getIdx("交友");

  const mingPack = getMajorStarsOrBorrow(idxMing);
  const fudePack = getMajorStarsOrBorrow(idxFude);
  const jiePack = getMajorStarsOrBorrow(idxJie);
  const fuqiPack = getMajorStarsOrBorrow(idxFuqi);
  const frPack = getMajorStarsOrBorrow(idxFriends);

  const mingTag = starTagForMajors(mingPack.majors);
  const fudeTag = starTagForMajors(fudePack.majors);
  const jieTag = starTagForMajors(jiePack.majors);

  const idxJi = _lastLianZhenIdx;
  const idxLu = findPalaceIndexByStarName("天同");

  const jiKey = idxJi >= 0 ? normalizePalaceName(_lastChart.palaces[idxJi].name) : "";
  const luKey = idxLu >= 0 ? normalizePalaceName(_lastChart.palaces[idxLu].name) : "";

  const jiDef = jiKey ? KB2026?.palace_definitions?.[jiKey] : null;
  const luDef = luKey ? KB2026?.palace_definitions?.[luKey] : null;

  const title =
    jiKey === "田宅" && luKey === "遷移"
      ? "🌟 2026 年度導航：先蹲後跳的「系統重組年」"
      : `🌟 2026 年度導航：先修「${jiDef?.label || "壓力區"}」再放大「${luDef?.label || "機會區"}」`;

  const line1 = `你的性格核心（命宮）：${
    mingTag ? `${mingTag.tag}（${(mingPack.majors || []).join("、") || "—"}）`
           : `鏡面模式（空宮借${toSafeText(mingPack.opp?.name)}）`
  }`;

  const line2 = `快樂與安全感（福德）：${
    fudeTag ? `${fudeTag.tag}（${(fudePack.majors || []).join("、") || "—"}）`
           : `鏡面模式（空宮借${toSafeText(fudePack.opp?.name)}）`
  }`;

  const line3 = `壓力反應（疾厄）：${
    jieTag ? `${(jiePack.majors || []).join("、") || "—"}（${jieTag.tag}）` : `${(jiePack.majors || []).join("、") || "以場景判讀"}`
  }`;

  const line4 = `關係模式（夫妻 / 交友）：${(fuqiPack.majors || []).join("、") || "空宮"} ／ ${(frPack.majors || []).join("、") || "空宮"}`;

  const line5 = `今年的坎（忌）：${jiKey ? `${jiKey}｜${jiDef?.label || ""}` : "（未定位）"}`;
  const line6 = `今年的光（祿）：${luKey ? `${luKey}｜${luDef?.label || ""}` : "（未定位）"}`;

  el.innerHTML = `
    <div class="font-black text-zinc-200 mb-2">${title}</div>
    <div class="space-y-1">
      <div>${line1}</div>
      <div>${line2}</div>
      <div>${line3}</div>
      <div>${line4}</div>
      <div class="mt-2">${line5}</div>
      <div>${line6}</div>
    </div>
    <div class="mt-3 text-[12px] text-zinc-500 leading-relaxed">
      讀盤順序（小白版）：命宮看「你怎麼做事」→ 福德看「你怎麼快樂」→ 疾厄看「你怎麼耗損」→ 夫妻/交友看「你怎麼連結」。
      四化是今年在哪裡更容易舒服/卡住的提示。
    </div>
  `;
}

function updateAnalysis(chart) {
  // Annual aphorism
  const idxJi = _lastLianZhenIdx;
  const idxLu = findPalaceIndexByStarName("天同");

  const jiPalace = idxJi >= 0 ? chart.palaces[idxJi] : null;
  const luPalace = idxLu >= 0 ? chart.palaces[idxLu] : null;

  const jiKey = jiPalace ? normalizePalaceName(jiPalace.name) : "";
  const luKey = luPalace ? normalizePalaceName(luPalace.name) : "";

  const jiDef = jiKey ? KB2026?.palace_definitions?.[jiKey] : null;
  const luDef = luKey ? KB2026?.palace_definitions?.[luKey] : null;

  const aph = document.getElementById("aphorism-text");
  if (aph) {
    const jiLabel = jiDef?.label || jiKey || "壓力區";
    const luLabel = luDef?.label || luKey || "機會區";
    aph.textContent =
      `2026 丙午年戰略重點在於「轉化」與「重組」。` +
      `流年化忌（廉貞）落入你的【${toSafeText(jiPalace?.name || "未定位")}】（${jiLabel}），代表今年更像「補洞/修繕年」：先修系統、先補根基，再談衝刺。` +
      `而天同化祿進入【${toSafeText(luPalace?.name || "未定位")}】（${luLabel}），這裡是年度更容易出現「資源／合作／好運窗口」的突破口：多走出去、多曝光、多連結，順勢擴張。`;
  }

  // Monthly quests (click -> blink branch)
  const ql = document.getElementById("quest-list");
  if (!ql) return;

  const monthToBranch = ["寅","卯","辰","巳","午","未","申","酉","戌","亥","子","丑"]; // MVP mapping

  const months = (KB2026?.monthly_strategy || []).map((it, i) => {
    const branch = monthToBranch[(it.month - 1) % 12] || "";
    const tail =
      it.color === "red" ? `（提醒：今年要特別顧「${jiDef?.label || jiKey || "壓力區"}」）` :
      it.color === "green" ? `（加分：把成果丟到「${luDef?.label || luKey || "機會區"}」舞台）` :
      it.color === "yellow" ? `（修煉：用專業拿回節奏）` :
      `（穩定：用口碑與條理累積信用）`;

    return {
      month: it.month,
      theme: it.theme,
      desc: it.desc,
      action: it.action,
      color: it.color,
      branch,
      full: `${toSafeText(it.desc)} 行動：${toSafeText(it.action)} ${tail}`,
    };
  });

  ql.innerHTML = months.map((q) => `
    <div class="quest-item" data-branch="${q.branch}">
      <div class="text-[#D4AF37] font-black mb-1">${q.month} 月｜${toSafeText(q.theme)}</div>
      <div class="text-zinc-400 leading-relaxed">${toSafeText(q.full)}</div>
      <div class="text-[11px] text-zinc-500 mt-2">定位：${q.branch}宮（點我高亮）</div>
    </div>
  `).join("");

  ql.querySelectorAll(".quest-item").forEach((item) => {
    item.addEventListener("click", () => {
      const branch = item.getAttribute("data-branch") || "";
      blinkBranch(branch);
      scrollToSection("sec-chart");
    });
  });
}

function blinkBranch(branch) {
  if (!branch) return;
  const el = document.querySelector(`.p-${branch}`);
  if (!el) return;
  el.classList.add("blink");
  setTimeout(() => el.classList.remove("blink"), 900);
}

/** =======================
 *  CSV Export
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
  const gender = document.getElementById("gender")?.value || "";
  const calendar = document.getElementById("calendar")?.value || "";

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
  rows.push(["生日", dob ? `${dob.y}-${dob.m}-${dob.d}` : ""]);
  rows.push(["時間", tob]);
  rows.push(["性別", gender]);
  rows.push(["曆法", calendar]);
  rows.push(["五行局", _lastChart.fiveElementsClass]);
  rows.push(["命主", _lastChart.soul]);
  rows.push(["壓力點（忌）", jiKey ? `${jiKey}｜${jiDef?.label || ""}` : ""]);
  rows.push(["機會點（祿）", luKey ? `${luKey}｜${luDef?.label || ""}` : ""]);
  rows.push(["深度諮詢報名", CONSULT_URL]);
  rows.push([]);

  rows.push(["十二宮場景"]);
  rows.push(["宮位", "場景標籤", "核心描述", "主星(或借星)", "是否空宮", "借對宮", "2026 四化", "行動建議"]);

  _lastChart.palaces.forEach((p, idx) => {
    const key = normalizePalaceName(p.name);
    const def = KB2026?.palace_definitions?.[key];

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
  rows.push(["月份", "主題", "任務描述", "行動", "顏色"]);

  (KB2026?.monthly_strategy || []).forEach((it) => {
    rows.push([it.month, it.theme, it.desc, it.action, it.color]);
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
 *  Monthly CTA delayed reveal
 *  ======================= */
function setupMonthlyCtaObserver() {
  const sec = document.getElementById("sec-monthly");
  const cta = document.getElementById("cta-monthly");
  if (!sec || !cta) return;

  const obs = new IntersectionObserver(
    (entries) => {
      const hit = entries.some((e) => e.isIntersecting);
      if (!hit) return;

      if (_monthlyCtaTimer) return;
      _monthlyCtaTimer = setTimeout(() => {
        cta.classList.remove("cta-hidden");
        cta.classList.add("cta-show");
      }, 2000);
    },
    { threshold: 0.35 }
  );

  obs.observe(sec);
}

/** =======================
 *  Expose for HTML onclick
 *  ======================= */
window.deployTacticalMap = deployTacticalMap;
window.resetToInput = resetToInput;
window.exportCSV = exportCSV;
window.scrollToSection = scrollToSection;

/** =======================
 *  Init
 *  ======================= */
initDOBSelectors();
initBottomSheet();
setupMonthlyCtaObserver();

const savedT = localStorage.getItem("sm_tob");
if (savedT) {
  const tob = document.getElementById("tob");
  if (tob) tob.value = savedT;
}
