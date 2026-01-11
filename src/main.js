import "./style.css";
import { astro } from "iztro";

// 2026 丙午年四化：同機昌廉
const SIHUA_2026 = { "天同": "祿", "天機": "權", "文昌": "科", "廉貞": "忌" };

let _lastChart = null;
let _lastLianZhenIdx = -1;
let _selectedPalaceIdx = -1;

function showError(msg) {
  const box = document.getElementById("error-box");
  box.textContent = msg;
  box.classList.remove("hidden");
}
function clearError() {
  const box = document.getElementById("error-box");
  box.textContent = "";
  box.classList.add("hidden");
}

function toSafeText(v) {
  return v === null || v === undefined ? "" : String(v);
}

// iztro timeIndex：0..12（含早/晚子）
// - 00:00~00:59 → 0（早子）
// - 23:00~23:59 → 12（晚子）
// - 其餘每 2 小時一段：1..11
function timeIndexFromInput(tob) {
  const hour = parseInt((tob || "12:00").split(":")[0], 10);
  if (hour === 0) return 0;
  if (hour === 23) return 12;
  return Math.floor((hour + 1) / 2);
}

function resetToInput() {
  document.getElementById("result-section").classList.add("hidden");
  document.getElementById("input-section").classList.remove("hidden");
  document.getElementById("btn-reset").classList.add("hidden");
  document.getElementById("btn-recalc").classList.add("hidden");
  clearError();

  _lastChart = null;
  _lastLianZhenIdx = -1;
  _selectedPalaceIdx = -1;

  document.getElementById("palace-detail").innerHTML =
    `<div class="text-zinc-500 text-[11px]">尚未選擇宮位。</div>`;
}

function scrollToTopQuests() {
  const el = document.getElementById("quest-list");
  el.scrollTop = 0;
}

function deployTacticalMap() {
  clearError();

  const dob = document.getElementById("dob").value;
  const tob = document.getElementById("tob").value;
  const gender = document.getElementById("gender")?.value || "male";
  const calendar = document.getElementById("calendar")?.value || "gregorian";

  if (!dob) {
    showError("請先輸入出生日期。");
    return;
  }

  // 顯示結果區
  document.getElementById("input-section").classList.add("hidden");
  document.getElementById("result-section").classList.remove("hidden");
  document.getElementById("btn-reset").classList.remove("hidden");
  document.getElementById("btn-recalc").classList.remove("hidden");

  const [y, m, d] = dob.split("-").map(Number);
  const timeIdx = timeIndexFromInput(tob);
  const genderZh = gender === "female" ? "女" : "男";

  let chart;
  try {
    if (calendar === "lunar") {
      // lunar: byLunar(year, month, day, isLeapMonth, timeIndex, gender, fixLeap, locale?)
      // 這裡用「非閏月」預設；若你需要閏月 UI，我可以再補。
      chart = astro.byLunar(y, m, d, false, timeIdx, genderZh, true, "zh-TW");
    } else {
      chart = astro.bySolar(`${y}-${m}-${d}`, timeIdx, genderZh, true, "zh-TW");
    }
  } catch (e) {
    console.error(e);
    showError("演算失敗：請確認輸入資料是否正確，或切換『曆法』重算。");
    resetToInput();
    return;
  }

  _lastChart = chart;
  _selectedPalaceIdx = -1;

  // 重建盤面（保留中心與 SVG overlay）
  const root = document.getElementById("map-root");
  const centerHole = root.querySelector(".center-hole");
  const svgOverlay = root.querySelector("#svg-overlay");
  root.innerHTML = "";
  root.appendChild(centerHole);
  root.appendChild(svgOverlay);

  // 命宮地支（iztro）
  const nominalBranch = chart.earthlyBranchOfSoulPalace;

  // 找廉貞位置（畫對沖線）
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

    // 主星
    (palace.majorStars || []).forEach((s) => {
      if (s.name === "廉貞") lianZhenIdx = idx;

      const star = document.createElement("div");
      star.className = "star-main";
      star.textContent = toSafeText(s.name);

      // 本命四化（如果資料有）
      if (s.lunarSihua) {
        const tag = document.createElement("div");
        tag.className = "hua-tag hua-birth";
        tag.textContent = toSafeText(s.lunarSihua);
        star.appendChild(tag);
      }

      // 2026 流年四化（固定映射）
      if (SIHUA_2026[s.name]) {
        const tag2 = document.createElement("div");
        tag2.className = "hua-tag hua-2026";
        tag2.textContent = toSafeText(SIHUA_2026[s.name]);
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

  document.getElementById("bureau-text").innerText = toSafeText(chart.fiveElementsClass);
  document.getElementById("destiny-text").innerText =
    `${toSafeText(chart.chineseDate)} 生 / 命主 ${toSafeText(chart.soul)}`;

  updateAnalysis(chart, lianZhenIdx);

  // 預設選命宮
  const nominalIdx = chart.palaces.findIndex((p) => p.earthlyBranch === nominalBranch);
  if (nominalIdx >= 0) selectPalace(nominalIdx);

  drawClashLine(lianZhenIdx);

  window.removeEventListener("resize", _onResizeRedraw);
  window.addEventListener("resize", _onResizeRedraw);
}

function _onResizeRedraw() {
  if (_lastChart) drawClashLine(_lastLianZhenIdx);
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
  renderPalaceDetail(palace, idx);
}

function renderPalaceDetail(palace, idx) {
  const major = (palace.majorStars || []).map((s) => {
    const birth = s.lunarSihua
      ? ` <span class="px-1.5 py-0.5 rounded bg-red-800/70 text-white text-[10px]">${toSafeText(s.lunarSihua)}</span>`
      : "";
    const ann = SIHUA_2026[s.name]
      ? ` <span class="px-1.5 py-0.5 rounded bg-blue-800/70 text-white text-[10px]">${toSafeText(SIHUA_2026[s.name])}</span>`
      : "";
    return `<div class="flex items-center gap-2">
      <div class="text-[#D4AF37] font-black">${toSafeText(s.name)}</div>
      <div class="flex gap-1">${birth}${ann}</div>
    </div>`;
  }).join("");

  const minor = (palace.minorStars || []).map((s) =>
    `<span class="inline-block mr-2 mb-2 px-2 py-1 border border-zinc-800 text-zinc-300 text-[11px]">${toSafeText(s.name)}</span>`
  ).join("");

  document.getElementById("palace-detail").innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-sm font-black">${toSafeText(palace.name)} <span class="text-[11px] text-zinc-500">#${idx}</span></div>
        <div class="text-[11px] text-zinc-500 font-mono mt-1">
          ${toSafeText(palace.heavenlyStem)}${toSafeText(palace.earthlyBranch)} ｜ ${toSafeText(palace.changsheng12)}
        </div>
      </div>
    </div>

    <div class="mt-4">
      <div class="text-[11px] text-zinc-400 mb-2">主星</div>
      <div class="space-y-2">${major || `<div class="text-zinc-500 text-[11px]">（無資料）</div>`}</div>
    </div>

    <div class="mt-4">
      <div class="text-[11px] text-zinc-400 mb-2">輔星</div>
      <div>${minor || `<div class="text-zinc-500 text-[11px]">（無資料）</div>`}</div>
    </div>
  `;
}

function updateAnalysis(chart, lzIdx) {
  const jiPalace = lzIdx >= 0 ? chart.palaces[lzIdx] : null;
  const luPalace = chart.palaces.find((p) => (p.majorStars || []).some((s) => s.name === "天同")) || null;

  const jiName = jiPalace ? jiPalace.name : "（未定位）";
  const luName = luPalace ? luPalace.name : "（未定位）";

  document.getElementById("aphorism-text").innerText =
    `2026 丙午年戰略重點在於「轉化」與「重組」。` +
    `流年化忌（廉貞）落入你的【${jiName}】，代表該領域在 2026 年容易面臨結構性壓力：先修系統、先補洞，再談衝刺。` +
    `而天同化祿進入【${luName}】，這裡是年度更容易出現「資源／合作／收入窗口」的突破口，適合把成果做成可複製的產品化流程。`;

  const months = buildMonthlyQuests(luName, jiName);
  document.getElementById("quest-list").innerHTML = months.map((q) => `
    <div class="quest-item">
      <div class="text-[#D4AF37] font-bold mb-1">${q.m}｜戰略任務</div>
      <div class="text-zinc-400 leading-relaxed">${q.task}</div>
    </div>
  `).join("");
}

function buildMonthlyQuests(luName, jiName) {
  const focus = {
    lu: `（機會點：${luName}）`,
    ji: `（壓力點：${jiName}）`
  };

  return [
    { m: "1 月",  task: `年度過渡期：清點資源、關掉不賺的支線，把 KPI 變成 2～3 個可執行指標。${focus.ji}` },
    { m: "2 月",  task: `啟動月：挑一個「最能變現」的切入點做 MVP，上線後用數據迭代。${focus.lu}` },
    { m: "3 月",  task: `擴散月：用合作／聯名／渠道換取曝光，建立「可重複成交」的內容漏斗。${focus.lu}` },
    { m: "4 月",  task: `修正月：做一次成本結構盤點（時間/人力/錢），把卡住的流程拆解到可交付。${focus.ji}` },
    { m: "5 月",  task: `權限月：把 SOP、權責、交付節點寫清楚，避免「人治」造成反覆返工。${focus.ji}` },
    { m: "6 月",  task: `產品月：把成果包裝成可銷售的方案（清楚價目、交付範圍、保固條款）。${focus.lu}` },
    { m: "7 月",  task: `轉換月：針對轉換率做優化：落地頁、報價結構、追蹤節點、客服腳本。${focus.lu}` },
    { m: "8 月",  task: `防火月：檢查合約與風險點，替最脆弱的一環做備援（人/系統/資金）。${focus.ji}` },
    { m: "9 月",  task: `品牌月：集中火力打造「你被記住的關鍵一句話」，統一視覺與訊息。${focus.lu}` },
    { m: "10 月", task: `整併月：砍掉低效專案，保留最強的 1～2 條主幹，把資源壓到能贏的地方。${focus.ji}` },
    { m: "11 月", task: `收割月：把年度成果做案例化（數據、前後對比、證言），用來打下一年度的單。${focus.lu}` },
    { m: "12 月", task: `封存月：年度復盤（哪些賺錢、哪些耗能），把流程與知識庫整理成可複製模板。${focus.ji}` },
  ];
}

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

  const c1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c1.setAttribute("cx", x1);
  c1.setAttribute("cy", y1);
  c1.setAttribute("r", "2.8");
  c1.setAttribute("fill", "#C41E3A");
  c1.setAttribute("opacity", "0.55");

  const c2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c2.setAttribute("cx", x2);
  c2.setAttribute("cy", y2);
  c2.setAttribute("r", "2.8");
  c2.setAttribute("fill", "#C41E3A");
  c2.setAttribute("opacity", "0.55");

  svg.appendChild(line);
  svg.appendChild(c1);
  svg.appendChild(c2);
}

// 讓 HTML onclick 可呼叫（Vite module scope 不會自動變全域）
window.deployTacticalMap = deployTacticalMap;
window.resetToInput = resetToInput;
window.scrollToTopQuests = scrollToTopQuests;
