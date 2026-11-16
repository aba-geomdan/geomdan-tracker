import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  loadMyData, saveMyData, updateMyCerts,
  uploadReceipt, getReceiptUrl, deleteReceipt, getLoginToken,
  CEU_RELAY_URL, CEU_ANON_KEY, importFromOldCeu,
} from "./ceuApi.js";


/* ============================================================
   [트래커 안 🏅 연수시간(CEU) 탭]  geomdan-ceu 앱을 트래커 안으로 옮긴 것
   - 로그인·로그아웃·관리자(계정 관리)는 트래커가 맡으므로 여기서는 뺐음
   - 화면(한눈에 보기·이수증 관리·설정·PDF)은 CEU 앱과 같음
   ABA 자격증 갱신 연수시간 관리 (geomdan-ceu)
   Supabase Auth + RLS (A방식) · 이수증은 본인만 · 관리자는 계정만 관리
   ============================================================ */

const PK = "#F5A0B1";
const PKL = "#FFF0F3";
const PKD = "#D4728A";
const INK = "#3A2B30";
const MUTE = "#8A7A80";
const LINE = "#F0DDE2";
const OK = "#2E9E6B";
const WARN = "#D98324";
const BAD = "#D4586A";

const COPYRIGHT = "© 검단ABA언어행동연구소. All rights reserved.";

// 이수증 인식용 Edge Function → ceuApi.js 의 CEU_RELAY_URL (트래커 서버)
const RELAY_KEY = CEU_ANON_KEY;

const CATS = [
  { key: "ethics", label: "윤리" },
  { key: "superv", label: "수퍼비전" },
  { key: "general", label: "일반" },
  { key: "trauma", label: "트라우마 케어" },
  { key: "comorbid", label: "동반질환" },
];
const catLabel = (k) => CATS.find((c) => c.key === k)?.label || k;
// 항목 목록: 자격의 첫 갱신 여부에 따라 노출할 항목 결정
function catsFor(cert) {
  const base = ["ethics", "superv", "general"];
  const extra = (cert.firstRenewal && cert.firstExtra) ? Object.keys(cert.firstExtra) : [];
  return CATS.filter((c) => base.includes(c.key) || extra.includes(c.key));
}
// 표시·집계용 항목 목록: 위 항목 + 실제로 시간이 입력된 항목도 포함
// (첫 갱신을 껐다 켜도 넣어둔 값이 사라지지 않게)
function catsForWithData(cert, records) {
  const base = ["ethics", "superv", "general"];
  const extra = (cert.firstRenewal && cert.firstExtra) ? Object.keys(cert.firstExtra) : [];
  const sums = sumForCert(records || [], cert.name);
  return CATS.filter((c) => base.includes(c.key) || extra.includes(c.key) || (sums[c.key] || 0) > 0);
}

const DEFAULT_CERTS = {
  BCBA: { org: "BACB", cycle: 24, total: 32, req: { ethics: 4, superv: 3, general: 0 },
    note: "수퍼비전 3시간은 RBT·BCaBA·수련생을 감독하는 경우에만 필수. 2027-01-01 이후 시작 주기부터 수퍼비전 4시간으로 상향. CEU는 BACB 승인(ACE) 제공기관 이수분만 인정.", src: "bacb.com BCBA Handbook",
    firstExtra: null,
    training: "감독을 하려면 인증 전(최대 180일 이내)에 8시간 수퍼비전 트레이닝을 최초 1회 이수해야 합니다. (갱신 CEU와 별개)" },
  "ABAS-1": { org: "한국 KACBA", cycle: 24, total: 32, req: { ethics: 4, superv: 3, general: 0 },
    note: "응용행동분석전문가 1급. 윤리 4시간·수퍼비전 3시간 의무. 한 과목을 윤리·수퍼비전 이중 계산 불가.", src: "abas.co.kr 자격 유지",
    firstExtra: null,
    training: "수퍼바이저 자격훈련을 최초 1회 이수해야 자격이 발급됩니다(BACB 8시간 트레이닝으로 대체 가능). 이후에는 수퍼비전 3시간만. (갱신 CEU와 별개)" },
  QBA: { org: "QABA", cycle: 24, total: 32, req: { ethics: 3, superv: 8, general: 0 },
    note: "수퍼비전은 대면/실시간 온라인 25% 이상 수강.", src: "qababoard.com Renewal",
    firstExtra: { trauma: 2, comorbid: 2 },
    training: null },
  "QASP-S": { org: "QABA", cycle: 24, total: 20, req: { ethics: 2, superv: 0, general: 0 },
    note: "총 20시간·윤리 2시간. 수퍼비전은 CEU가 아니라 직접케어 5% 감독(별개 실무요건). 수퍼바이저 자격 유지 위해 8시간 수퍼비전 코스워크 필요.", src: "qababoard.com Renewal",
    firstExtra: { trauma: 2 },
    training: null },
  KBA: { org: "한국행동분석학회", cycle: 36, total: 36, req: { ethics: 0, superv: 0, general: 0 },
    note: "3년마다 갱신, 3년간 36시간 이상(50분 단위). 윤리·수퍼비전 세부 의무시간 규정 없음. 갱신 기산일=취득일.", src: "kabac.or.kr 자격 유지 안내",
    firstExtra: null,
    training: null },
};
const CERT_NAMES = Object.keys(DEFAULT_CERTS);

const uid = () => Math.random().toString(36).slice(2, 9);
const todayISO = () => { const d = new Date(); const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0"); return `${y}-${mo}-${da}`; };

function addMonths(iso, m) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00"); if (isNaN(d)) return "";
  const day = d.getDate(); d.setMonth(d.getMonth() + Number(m || 0));
  if (d.getDate() < day) d.setDate(0);
  const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000);
}
function fmtK(iso) {
  if (!iso) return "-";
  const d = new Date(iso + "T00:00:00"); if (isNaN(d)) return iso;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

function blankCert(name) {
  const b = DEFAULT_CERTS[name];
  return { name, org: b.org, acquired: "", cycle: b.cycle, total: b.total, req: { ...b.req },
    note: b.note, src: b.src, firstExtra: b.firstExtra || null, training: b.training || null,
    firstRenewal: false, trainingDone: false, history: [] };
}
function blankRecord() { return { id: uid(), title: "", date: todayISO(), appliesTo: {} }; }

// PDF → 첫 페이지 JPEG 변환용 (pdf.js를 CDN에서 1회 로드)
let _pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; } catch (e) {}
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error("PDF 처리 모듈을 불러오지 못했습니다."));
    document.head.appendChild(s);
  });
  return _pdfjsPromise;
}
// PDF 파일 → 모든 페이지를 세로로 이어붙인 한 장의 JPEG base64(순수 데이터)로 반환
async function pdfToStackedJpeg(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const n = pdf.numPages;

  // 1) 각 페이지를 개별 캔버스로 렌더
  const pages = [];
  let maxW = 0;
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(1.5, 1600 / baseVp.width));
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const cx = c.getContext("2d");
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: cx, viewport: vp }).promise;
    pages.push(c);
    if (c.width > maxW) maxW = c.width;
  }

  // 2) 세로로 합치기 (Anthropic 이미지 한도 고려해 전체 높이 8000px로 제한)
  const GAP = 12, MAX_H = 8000;
  let totalH = pages.reduce((s, c) => s + c.height, 0) + GAP * (pages.length - 1);
  let ratio = 1;
  if (totalH > MAX_H) ratio = MAX_H / totalH;

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.floor(maxW * ratio));
  out.height = Math.max(1, Math.floor(totalH * ratio));
  const octx = out.getContext("2d");
  octx.fillStyle = "#fff"; octx.fillRect(0, 0, out.width, out.height);
  let y = 0;
  for (const c of pages) {
    const w = c.width * ratio, h = c.height * ratio;
    octx.drawImage(c, 0, y, w, h);
    y += h + GAP * ratio;
  }
  const dataUrl = out.toDataURL("image/jpeg", 0.85);
  return dataUrl.split(",")[1];
}

// 한 이수증의 한 자격 인정분을 항목별 줄로 (예: 일반 3 + 윤리 1)
// 줄이 하나면 예전과 같은 {hours, cat} 모양, 여러 줄이면 {hours: 합계, cat: 첫 항목, parts: [...]}
function partsOf(a) {
  if (!a) return [];
  if (Array.isArray(a.parts) && a.parts.length) return a.parts.map((p) => ({ hours: p.hours, cat: p.cat }));
  return [{ hours: a.hours, cat: a.cat }];
}
function fromParts(parts) {
  const p = parts.map((x) => ({ hours: Number(x.hours) || 0, cat: x.cat }));
  if (p.length <= 1) return { hours: p[0] ? p[0].hours : 0, cat: p[0] ? p[0].cat : "general" };
  const total = Math.round(p.reduce((acc, x) => acc + x.hours, 0) * 100) / 100;
  return { hours: total, cat: p[0].cat, parts: p };
}
function isSplit(a) { return !!(a && Array.isArray(a.parts) && a.parts.length > 1); }
function partsLabel(a) { return partsOf(a).map((x) => `${catLabel(x.cat)} ${x.hours}h`).join(" · "); }

function sumForCert(records, name) {
  const s = { ethics: 0, superv: 0, general: 0, trauma: 0, comorbid: 0 };
  records.forEach((r) => {
    const a = r.appliesTo[name];
    if (a) partsOf(a).forEach((x) => { s[x.cat] = (s[x.cat] || 0) + Number(x.hours || 0); });
  });
  return s;
}
// 기초(중간부터 기록) 이수시간용 record 판별/집계
const BASELINE_TITLE = "기초 이수시간 (이수증 없이 입력)";
function isBaselineRecord(r) { return typeof r.id === "string" && r.id.indexOf("baseline::") === 0; }
function baselineId(certName, cat) { return `baseline::${certName}::${cat}`; }
// 특정 자격의 현재 기초 시간(항목별) 읽기
function baselineHoursFor(records, certName) {
  const out = {};
  records.forEach((r) => {
    if (!isBaselineRecord(r)) return;
    const a = r.appliesTo[certName];
    if (a) out[a.cat] = Number(a.hours || 0);
  });
  return out;
}
// 첫 갱신 여부 반영한 총 필요시간(추가 CEU 포함)
function totalNeeded(cert) {
  let t = Number(cert.total || 0);
  if (cert.firstRenewal && cert.firstExtra) {
    Object.values(cert.firstExtra).forEach((h) => { t += Number(h || 0); });
  }
  return t;
}
// 현재 자격에서 요구하는 항목별 최소요구(첫 갱신 추가 포함)
function reqFor(cert) {
  const r = { ...cert.req };
  if (cert.firstRenewal && cert.firstExtra) {
    Object.entries(cert.firstExtra).forEach(([k, h]) => { r[k] = Number(h || 0); });
  }
  return r;
}

// 내 데이터 기본 형태
function emptyData() {
  return { myCerts: [], certs: {}, records: [] };
}
// 보유자격에 맞춰 certs 채우기(없는 건 생성, 있으면 유지)
function ensureCerts(data) {
  const certs = { ...(data.certs || {}) };
  (data.myCerts || []).forEach((n) => {
    if (!certs[n]) certs[n] = blankCert(n);
    else if (!Array.isArray(certs[n].history)) certs[n] = { ...certs[n], history: [] };
  });
  return { ...data, certs, records: data.records || [] };
}

/* ============================================================
   최상위 App — Supabase Auth 연결
   ============================================================ */

/* ---------------- 로그인 ---------------- */

/* ---------------- 자격 선택 (첫 로그인) ---------------- */
function PickCerts({ me, onDone }) {
  const [picked, setPicked] = useState([]);
  const toggle = (n) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  return (
    <div style={{ display: "grid", placeItems: "center", padding: "24px 0" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 20 }}>{me.name}님, 환영합니다</div>
          <div style={{ fontSize: 13.5, color: MUTE, marginTop: 6 }}>보유하신 자격증을 선택하세요. 선택한 자격만 관리 화면에 표시됩니다.</div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {CERT_NAMES.map((n) => {
              const on = picked.includes(n);
              return (
                <button key={n} onClick={() => toggle(n)} style={{
                  textAlign: "left", border: `1.5px solid ${on ? PK : LINE}`, background: on ? PKL : "#fff",
                  borderRadius: 12, padding: "13px 15px", display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15.5 }}>{n}</div>
                    <div style={{ fontSize: 12, color: MUTE, marginTop: 2 }}>{DEFAULT_CERTS[n].org} · 갱신 {DEFAULT_CERTS[n].cycle}개월 · {DEFAULT_CERTS[n].total}시간</div>
                  </div>
                  <span style={{ width: 24, height: 24, borderRadius: 7, border: `2px solid ${on ? PK : LINE}`, background: on ? PK : "#fff", color: "#fff", display: "grid", placeItems: "center", fontSize: 15, fontWeight: 800 }}>{on ? "✓" : ""}</span>
                </button>
              );
            })}
          </div>
          <button className="btn btn-pk" style={{ width: "100%", marginTop: 18, padding: "11px 0", opacity: picked.length ? 1 : 0.5 }}
            disabled={!picked.length} onClick={() => onDone(picked)}>시작하기</button>
          <div style={{ fontSize: 11.5, color: MUTE, marginTop: 10, textAlign: "center" }}>나중에 설정에서 언제든 바꿀 수 있어요.</div>
        </div>
      </div>
    </div>
  );
}




/* ---------------- PDF 요약 (인쇄용 새 창) ---------------- */
function printReport(me, data, cards) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const today = fmtK(todayISO());

  const certSections = cards.map((c) => {
    const cert = c.cert;
    const sums = sumForCert(data.records, cert.name);
    const visibleCats = catsForWithData(cert, data.records);
    const need = reqFor(cert);
    const ddayTxt = c.dday == null ? "-" : (c.dday < 0 ? `기한 ${-c.dday}일 경과` : `D-${c.dday}`);
    const catRows = visibleCats.map((cat) => {
      const done = sums[cat.key] || 0, needH = Number(need[cat.key] || 0), met = done >= needH;
      const isExtra = cert.firstExtra && cert.firstExtra[cat.key] != null;
      return `<tr>
        <td>${esc(cat.label)}${isExtra ? " <span style='color:#D4728A'>(첫 갱신)</span>" : ""}</td>
        <td style="text-align:center">${done}h</td>
        <td style="text-align:center">${needH > 0 ? needH + "h" : "-"}</td>
        <td style="text-align:center;color:${met ? "#2E9E6B" : "#D4586A"}">${needH > 0 ? (met ? "충족" : "부족 " + Math.max(0, needH - done) + "h") : "요구없음"}</td>
      </tr>`;
    }).join("");
    const recs = data.records.filter((r) => r.appliesTo[cert.name]);
    const recRows = recs.length ? recs.map((r) => {
      const a = r.appliesTo[cert.name];
      return `<tr><td>${esc(r.title)}</td><td style="text-align:center">${esc(fmtK(r.date))}</td><td style="text-align:center">${a.hours}h</td><td style="text-align:center">${esc(isSplit(a) ? partsLabel(a) : catLabel(a.cat))}</td></tr>`;
    }).join("") : `<tr><td colspan="4" style="text-align:center;color:#999">등록된 이수증 없음</td></tr>`;

    return `
      <div class="cert">
        <div class="cert-head">
          <div class="cert-name">${esc(cert.name)} <span class="cert-org">${esc(cert.org)}</span></div>
          <div class="cert-dday">${esc(ddayTxt)}</div>
        </div>
        <div class="cert-meta">취득일 ${esc(fmtK(cert.acquired))} · 갱신주기 ${cert.cycle}개월 · 갱신예정 ${esc(fmtK(c.renewal))}${cert.firstRenewal ? " · <b>첫 갱신</b>" : ""}</div>
        <div class="cert-total">전체 이수 <b>${c.done} / ${c.tot}시간</b> ${c.done >= c.tot ? "<span style='color:#2E9E6B'>(충족)</span>" : `<span style='color:#D4586A'>(${c.lackTotal}h 부족)</span>`}</div>
        <table><thead><tr><th>항목</th><th>이수</th><th>요구</th><th>상태</th></tr></thead><tbody>${catRows}</tbody></table>
        <div class="rec-title">이수증 목록 (${recs.length}건)</div>
        <table><thead><tr><th>강의명</th><th>날짜</th><th>시간</th><th>항목</th></tr></thead><tbody>${recRows}</tbody></table>
      </div>`;
  }).join("");

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>연수시간 현황 - ${esc(me.name)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Malgun Gothic','Apple SD Gothic Neo',sans-serif; color: #3A2B30; padding: 32px; max-width: 800px; margin: 0 auto; }
      .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #F5A0B1; padding-bottom: 14px; margin-bottom: 8px; }
      .head h1 { font-size: 20px; margin: 0; }
      .head .sub { font-size: 12px; color: #8A7A80; margin-top: 4px; }
      .head .date { font-size: 12px; color: #8A7A80; }
      .cert { margin-top: 24px; page-break-inside: avoid; border: 1px solid #F0DDE2; border-radius: 10px; padding: 16px; }
      .cert-head { display: flex; justify-content: space-between; align-items: center; }
      .cert-name { font-size: 17px; font-weight: 800; }
      .cert-org { font-size: 12px; color: #8A7A80; font-weight: 500; }
      .cert-dday { font-weight: 800; color: #D4728A; }
      .cert-meta { font-size: 12px; color: #8A7A80; margin-top: 4px; }
      .cert-total { font-size: 14px; margin: 10px 0; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12.5px; }
      th, td { border: 1px solid #F0DDE2; padding: 6px 9px; }
      th { background: #FFF0F3; color: #D4728A; font-weight: 700; }
      .rec-title { font-size: 13px; font-weight: 700; margin-top: 14px; color: #D4728A; }
      .foot { margin-top: 28px; text-align: center; font-size: 11px; color: #8A7A80; border-top: 1px solid #F0DDE2; padding-top: 12px; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <div class="head">
      <div><h1>자격증 갱신 연수시간(CEU) 현황</h1><div class="sub">${esc(me.name)} 선생님 · 검단ABA언어행동연구소</div></div>
      <div class="date">출력일 ${esc(today)}</div>
    </div>
    ${certSections}
    <div class="foot">${esc(COPYRIGHT)}</div>
    <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
    </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요."); return; }
  w.document.write(html);
  w.document.close();
}

/* ---------------- 대시보드 ---------------- */
function Dashboard({ me, data, onOpen }) {
  const [showHelp, setShowHelp] = useState(true);
  const cards = me.myCerts.map((n) => {
    const cert = data.certs[n];
    const sums = sumForCert(data.records, n);
    const need = reqFor(cert);
    const tot = totalNeeded(cert);
    const visibleCats = catsForWithData(cert, data.records);
    // 노출 항목의 합만 총 이수로 집계 (값이 입력된 항목은 항상 포함)
    const done = visibleCats.reduce((acc, c) => acc + (sums[c.key] || 0), 0);
    const pct = tot ? Math.min(100, Math.round((done / tot) * 100)) : 0;
    const renewal = addMonths(cert.acquired, cert.cycle);
    const dday = daysBetween(renewal, todayISO());
    const lackTotal = Math.max(0, tot - done);
    const lacks = visibleCats.filter((c) => need[c.key] > 0).map((c) => ({ label: c.label, lack: Math.max(0, need[c.key] - sums[c.key]) }));
    return { n, cert, done, tot, pct, renewal, dday, lackTotal, lacks };
  });

  // 갱신 임박(D-90 이내) 또는 기한 경과 자격 → 상단 배너
  const alerts = cards
    .filter((c) => c.dday !== null && c.dday <= 90)
    .sort((a, b) => a.dday - b.dday);

  return (
    <>
      {alerts.length > 0 && (
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {alerts.map((c) => {
            const overdue = c.dday < 0;
            const done = c.lackTotal === 0 && c.lacks.every((l) => l.lack === 0);
            const bg = overdue ? "#FDECEE" : "#FFF7EE";
            const bd = overdue ? "#F5CDD3" : "#F5E3CC";
            const col = overdue ? BAD : WARN;
            return (
              <button key={c.n} onClick={() => onOpen(c.n)} style={{ textAlign: "left", background: bg, border: `1px solid ${bd}`, borderRadius: 12, padding: "12px 15px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 18 }}>{overdue ? "🚨" : "⚠️"}</span>
                <div style={{ marginRight: "auto", minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14.5, color: col }}>
                    {c.n} 갱신 {overdue ? `기한 ${-c.dday}일 지남` : `D-${c.dday}`}
                  </div>
                  <div style={{ fontSize: 12.5, color: MUTE, marginTop: 2 }}>
                    갱신예정 {fmtK(c.renewal)} · {done ? "이수 완료 ✓ 갱신 신청만 하면 돼요" : `아직 ${c.lackTotal}시간 부족`}
                  </div>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: col, flexShrink: 0 }}>바로가기 →</span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>한눈에 보기</div>
          <div style={{ fontSize: 13, color: MUTE, marginTop: 3 }}>보유 자격의 이수 현황과 갱신까지 남은 기간이에요. <b style={{ color: PKD }}>카드를 누르면</b> 이수증 입력·관리 화면으로 이동합니다.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => printReport(me, data, cards)} className="btn btn-pk" style={{ padding: "8px 14px", fontSize: 13 }}>📄 PDF 요약</button>
          {!showHelp && (
            <button onClick={() => setShowHelp(true)} className="btn btn-ghost" style={{ padding: "8px 12px", fontSize: 12.5 }}>사용법 보기</button>
          )}
        </div>
      </div>

      {showHelp && (
        <div className="card" style={{ padding: 18, marginBottom: 16, background: PKL, border: `1px solid ${LINE}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: PKD }}>이렇게 사용하세요</div>
            <button onClick={() => setShowHelp(false)} className="btn btn-ghost" style={{ padding: "5px 11px", fontSize: 12.5, background: "#fff" }}>닫기</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
            {[
              ["① 자격 카드 열기", "가진 자격 카드를 누르면 상세 화면에서 이수증을 넣고 관리할 수 있어요."],
              ["② 이수증 인식", "이수증 사진이나 PDF를 올리면 강의명·날짜·시간·항목과 인정 자격을 자동으로 읽어줘요. 확인 후 저장하면 끝."],
              ["③ 하나로 여러 자격", "이수증 한 건이 BCBA·QBA처럼 여러 자격에 인정되면 한 번만 등록해도 각 자격에 함께 반영돼요."],
              ["④ 부족분·D-day 확인", "각 카드에서 남은 시간, 항목별 부족분, 갱신까지 남은 날짜(D-day)를 한눈에 볼 수 있어요."],
            ].map(([t, d]) => (
              <div key={t}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 3 }}>{t}</div>
                <div style={{ fontSize: 12.5, color: MUTE, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14 }}>
        {cards.map((c) => {
          let ddBg = OK, ddTxt = `D-${c.dday}`, ddMsg = "여유";
          const noDate = c.dday === null;
          if (noDate) { ddBg = "#F1EFE8"; ddTxt = "취득일 입력 필요"; }
          else if (c.dday < 0) { ddBg = BAD; ddTxt = `D+${-c.dday}`; ddMsg = "기한 경과"; }
          else if (c.dday <= 90) { ddBg = BAD; ddMsg = "임박"; }
          else if (c.dday <= 180) { ddBg = WARN; ddMsg = "준비"; }
          const complete = c.done >= c.tot && c.lacks.every((l) => l.lack === 0);
          return (
            <button key={c.n} onClick={() => onOpen(c.n)} className="card" style={{ padding: 18, textAlign: "left", cursor: "pointer", border: `1px solid ${LINE}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{c.n}</div>
                  <div style={{ fontSize: 12, color: MUTE, marginTop: 2 }}>{c.cert.org}</div>
                </div>
                <span style={{ background: ddBg, color: noDate ? "#5F5E5A" : "#fff", borderRadius: 999, padding: "4px 10px", fontWeight: 800, fontSize: 12.5, flexShrink: 0 }}>{ddTxt}</span>
              </div>

              <div style={{ margin: "14px 0 6px", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>{c.done} / {c.tot} 시간</span>
                <span style={{ color: complete ? OK : PKD, fontWeight: 800 }}>{complete ? "충족 ✓" : `${c.lackTotal}시간 부족`}</span>
              </div>
              <div style={{ height: 10, background: LINE, borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${c.pct}%`, height: "100%", background: complete ? OK : PK }} />
              </div>

              {c.lacks.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                  {c.lacks.map((l) => (
                    <span key={l.label} style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "3px 9px",
                      background: l.lack === 0 ? "#EAF7F0" : "#FDECEE", color: l.lack === 0 ? OK : BAD }}>
                      {l.label} {l.lack === 0 ? "✓" : `-${l.lack}h`}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                <div style={{ fontSize: 12, color: MUTE }}>{noDate ? "취득일을 넣으면 갱신일이 계산돼요" : `갱신예정 ${fmtK(c.renewal)}`}</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: PKD }}>이수증 관리 →</span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- 자격별 상세 (이수증 관리) ---------------- */
function Detail({ cert, records, onBack, onChangeCert, setRecords, activeCert, allMyCerts, certsMap, onStartNewCycle }) {
  const [showHistory, setShowHistory] = useState(false);
  const [confirmCycle, setConfirmCycle] = useState(false);
  const renewalDate = useMemo(() => addMonths(cert.acquired, cert.cycle), [cert.acquired, cert.cycle]);
  const dday = useMemo(() => daysBetween(renewalDate, todayISO()), [renewalDate]);
  const sums = useMemo(() => sumForCert(records, cert.name), [records, cert.name]);
  const visibleCats = catsForWithData(cert, records);
  const need = reqFor(cert);
  const tot = totalNeeded(cert);
  const totalDone = visibleCats.reduce((acc, c) => acc + (sums[c.key] || 0), 0);
  const totalPct = tot ? Math.min(100, Math.round((totalDone / tot) * 100)) : 0;

  return (
    <>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 14 }}>← 한눈에 보기</button>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{cert.name}</div>
            <div style={{ fontSize: 13, color: MUTE, marginTop: 3 }}>{cert.org} · 갱신주기 {cert.cycle}개월 · 필요시간 {tot}시간{cert.firstRenewal && cert.firstExtra ? " (첫 갱신 추가 포함)" : ""}</div>
          </div>
          {dday === null && (
            <span style={{ background: "#F1EFE8", color: "#5F5E5A", borderRadius: 999, padding: "5px 13px", fontWeight: 800, fontSize: 13 }}>취득일 입력 필요</span>
          )}
          {dday !== null && (
            <span style={{ background: dday < 0 ? BAD : dday <= 90 ? BAD : dday <= 180 ? WARN : OK, color: "#fff", borderRadius: 999, padding: "5px 13px", fontWeight: 800, fontSize: 15 }}>
              {dday < 0 ? `D+${-dday}` : `D-${dday}`}
            </span>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginTop: 16 }}>
          <div><label className="lbl">현재취득일(직전 갱신)</label>
            <input type="date" className="inp" value={cert.acquired} onChange={(e) => onChangeCert({ acquired: e.target.value })} /></div>
          <div><label className="lbl">갱신주기(개월)</label>
            <input type="number" className="inp" value={cert.cycle} onChange={(e) => onChangeCert({ cycle: Number(e.target.value) })} /></div>
          <div><label className="lbl">이수필요시간</label>
            <input type="number" className="inp" value={cert.total} onChange={(e) => onChangeCert({ total: Number(e.target.value) })} /></div>
          <div><label className="lbl">갱신예정일(자동)</label>
            <div className="inp" style={{ background: PKL, fontWeight: 700, color: PKD }}>{renewalDate ? fmtK(renewalDate) : "취득일을 먼저 넣어 주세요"}</div></div>
        </div>

        {cert.note && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: WARN, background: "#FFF7EE", border: `1px solid #F5E3CC`, borderRadius: 10, padding: "9px 12px", lineHeight: 1.5 }}>
            ⚠ {cert.note}<span style={{ display: "block", marginTop: 4, color: MUTE, fontSize: 11 }}>근거: {cert.src}</span>
          </div>
        )}

        {/* 첫 갱신 여부 (추가 CEU가 있는 자격만 체크 의미가 큼) */}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            <input type="checkbox" checked={!!cert.firstRenewal} onChange={(e) => onChangeCert({ firstRenewal: e.target.checked })} />
            이번이 첫 갱신입니다
          </label>
          {cert.firstRenewal && cert.firstExtra && (
            <span style={{ fontSize: 12, color: PKD, fontWeight: 700 }}>
              → 추가 요건: {Object.entries(cert.firstExtra).map(([k, h]) => `${catLabel(k)} ${h}h`).join(", ")}
            </span>
          )}
          {cert.firstRenewal && !cert.firstExtra && (
            <span style={{ fontSize: 12, color: MUTE }}>→ 이 자격은 첫 갱신 추가 CEU가 없습니다.</span>
          )}
        </div>

        {/* 1회성 트레이닝 안내 (BCBA·ABAS-1) */}
        {cert.training && (
          <div style={{ marginTop: 10, fontSize: 12.5, background: PKL, border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 12px", lineHeight: 1.5 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={!!cert.trainingDone} onChange={(e) => onChangeCert({ trainingDone: e.target.checked })} style={{ marginTop: 2 }} />
              <span><b style={{ color: PKD }}>1회성 수퍼바이저 트레이닝</b> — {cert.training} {cert.trainingDone ? "✓ 이수함" : ""}</span>
            </label>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
            <span style={{ fontWeight: 700 }}>전체 이수</span>
            <span style={{ fontWeight: 800, color: totalDone >= tot ? OK : PKD }}>{totalDone} / {tot} 시간</span>
          </div>
          <div style={{ height: 12, background: LINE, borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${totalPct}%`, height: "100%", background: totalDone >= tot ? OK : PK }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginTop: 16 }}>
          {visibleCats.map((c) => {
            const done = sums[c.key], needH = Number(need[c.key] || 0), met = done >= needH;
            const isExtra = cert.firstExtra && cert.firstExtra[c.key] != null; // 첫갱신 추가 항목
            return (
              <div key={c.key} style={{ border: `1px solid ${isExtra ? PK : LINE}`, borderRadius: 12, padding: 14, background: isExtra ? PKL : "#fff" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isExtra ? PKD : MUTE, marginBottom: 8 }}>{c.label}{isExtra ? " (첫 갱신)" : ""}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: met ? OK : INK }}>{done}<span style={{ fontSize: 14, color: MUTE, fontWeight: 600 }}> 시간</span></div>
                <div style={{ fontSize: 12, marginTop: 6, color: met ? OK : BAD, fontWeight: 700 }}>
                  {needH > 0 ? (met ? "✓ 요구 충족" : `${Math.max(0, needH - done)}시간 부족 (요구 ${needH})`) : "요구 없음"}
                </div>
                {!isExtra && (
                  <div style={{ marginTop: 5 }}>
                    <label className="lbl" style={{ margin: 0, fontSize: 11 }}>최소요구</label>
                    <input type="number" className="inp" style={{ padding: "5px 8px", fontSize: 13 }} value={cert.req[c.key] ?? 0}
                      onChange={(e) => onChangeCert({ req: { ...cert.req, [c.key]: Number(e.target.value) } })} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <BaselineHours key={cert.name + ":" + (cert.firstRenewal ? "1" : "0")} cert={cert} records={records} setRecords={setRecords} />
      <RecordManager activeCert={activeCert} records={records} setRecords={setRecords} myCerts={allMyCerts} certsMap={certsMap} />

      {/* 지난 주기 이력 */}
      {cert.history && cert.history.length > 0 && (
        <div className="card" style={{ padding: 20, marginTop: 16 }}>
          <button onClick={() => setShowHistory((v) => !v)} style={{ width: "100%", background: "transparent", border: "none", display: "flex", justifyContent: "space-between", alignItems: "center", padding: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>📚 지난 주기 이력 <span style={{ color: MUTE, fontWeight: 600, fontSize: 13 }}>({cert.history.length}개 주기)</span></span>
            <span style={{ color: PKD, fontSize: 13, fontWeight: 700 }}>{showHistory ? "접기 ▲" : "펼치기 ▼"}</span>
          </button>
          {showHistory && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
              {cert.history.map((h) => {
                const hsum = (h.records || []).reduce((a, r) => a + Number(r.hours || 0), 0);
                return (
                  <div key={h.id} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{fmtK(h.periodStart)} ~ {fmtK(h.periodEnd)}</div>
                      <div style={{ fontSize: 12.5, color: MUTE }}>이수 {hsum}시간 · {(h.records || []).length}건 · 마감 {fmtK(h.closedAt)}</div>
                    </div>
                    {(h.records || []).length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {h.records.map((r, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, borderTop: i ? `1px solid ${LINE}` : "none", paddingTop: i ? 5 : 0 }}>
                            <span style={{ minWidth: 0 }}>{r.title || "(제목 없음)"}</span>
                            <span style={{ color: MUTE, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>{fmtK(r.date)} · {r.hours}h · {isSplit(r) ? partsLabel(r) : catLabel(r.cat)}{r.receiptPath && <ReceiptButton path={r.receiptPath} small />}</span>
                          </div>
                        ))}
                      </div>
                    ) : <div style={{ fontSize: 12.5, color: MUTE }}>이수증 없음</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 갱신 완료 → 새 주기 시작 */}
      <div className="card" style={{ padding: 20, marginTop: 16, background: PKL, border: `1px solid ${LINE}` }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>갱신을 완료하셨나요?</div>
        <div style={{ fontSize: 12.5, color: MUTE, lineHeight: 1.6, marginBottom: 12 }}>
          이 자격의 갱신을 마쳤다면 <b>새 주기 시작</b>을 누르세요. 현재 {cert.name} 이수증은 <b>지난 주기 이력</b>으로 보관되고,
          취득일이 {fmtK(renewalDate)}로 갱신되며 새 주기는 0시간부터 시작됩니다. (다른 자격은 영향받지 않아요.)
        </div>
        {!renewalDate ? (
          <div style={{ fontSize: 12.5, color: MUTE, fontWeight: 700 }}>취득일을 먼저 넣어야 새 주기를 시작할 수 있어요.</div>
        ) : !confirmCycle ? (
          <button className="btn btn-ghost" style={{ background: "#fff" }} onClick={() => setConfirmCycle(true)}>🔄 새 주기 시작</button>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: PKD }}>{cert.name} 새 주기를 시작할까요?</span>
            <button className="btn btn-pk" onClick={() => { onStartNewCycle(); setConfirmCycle(false); setShowHistory(true); }}>네, 시작</button>
            <button className="btn btn-ghost" style={{ background: "#fff" }} onClick={() => setConfirmCycle(false)}>취소</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- 기초 이수시간 (중간부터 기록) ---------------- */
function BaselineHours({ cert, records, setRecords }) {
  const saved = baselineHoursFor(records, cert.name);
  // 입력 항목 = 현재 노출 항목 + 이미 기초값이 들어있는 항목
  // (첫 갱신을 껐다 켜도 넣어둔 trauma/comorbid 기초값이 사라지지 않게)
  const baseCats = catsFor(cert);
  const cats = CATS.filter((c) => baseCats.some((b) => b.key === c.key) || saved[c.key] != null);
  const hasBaseline = Object.keys(saved).length > 0;
  // 처음엔 항상 접힘 — 필요한 사람만 링크를 눌러 펼침
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => {
    const d = {}; cats.forEach((c) => { d[c.key] = saved[c.key] != null ? saved[c.key] : ""; });
    return d;
  });

  const total = cats.reduce((s, c) => s + (Number(draft[c.key]) || 0), 0);

  const save = () => {
    setRecords((rs) => {
      // 이 자격의 기존 기초 record 전부 제거 후 새로 기록
      let next = rs.filter((r) => !(isBaselineRecord(r) && r.appliesTo[cert.name]));
      cats.forEach((c) => {
        const h = Number(draft[c.key]) || 0;
        if (h > 0) next.push({ id: baselineId(cert.name, c.key), title: BASELINE_TITLE, date: cert.acquired || todayISO(), appliesTo: { [cert.name]: { hours: h, cat: c.key } } });
      });
      return next;
    });
    // 저장하면 항상 접는다 (값이 0이면 다시 입력 링크로, 있으면 요약으로)
    setOpen(false);
  };

  const cancel = () => {
    // 저장 안 하고 닫으면 입력값을 저장된 값 기준으로 되돌림
    const d = {}; cats.forEach((c) => { d[c.key] = saved[c.key] != null ? saved[c.key] : ""; });
    setDraft(d);
    setOpen(false);
  };

  if (!open) {
    const savedTotal = Object.values(saved).reduce((s, h) => s + (Number(h) || 0), 0);
    // 기초값이 없으면 얇은 링크만, 있으면 요약 + 수정
    if (!hasBaseline) {
      return (
        <div style={{ marginBottom: 16 }}>
          <button className="btn btn-ghost" style={{ padding: "8px 12px", fontSize: 12.5, color: MUTE }} onClick={() => setOpen(true)}>
            <i className="ti ti-history" aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6, color: PKD }} />
            기초 이수시간 입력 <span style={{ color: MUTE }}>(중간부터 쓰는 경우)</span>
          </button>
        </div>
      );
    }
    return (
      <div className="card" style={{ padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: MUTE }}>
          <i className="ti ti-history" aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6, color: PKD }} />
          기초 이수시간 <b style={{ color: PKD }}>{savedTotal}시간</b> 반영됨
        </div>
        <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12.5 }} onClick={() => setOpen(true)}>수정</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <i className="ti ti-history" aria-hidden="true" style={{ color: PKD, fontSize: 18 }} />
        <span style={{ fontWeight: 800, fontSize: 15 }}>기초 이수시간</span>
      </div>
      <div style={{ fontSize: 12.5, color: MUTE, marginBottom: 14, lineHeight: 1.6 }}>
        앱을 중간부터 쓰는 경우, 이미 이수한 시간을 이수증 없이 한번에 넣을 수 있어요. 이후 이수증을 추가하면 그 위에 더해집니다. 넣을 게 없으면 취소를 눌러 닫으세요.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {cats.map((c) => {
          const isExtra = cert.firstExtra && cert.firstExtra[c.key] != null;
          return (
            <div key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 13, color: INK }}>{c.label}{isExtra ? " (첫 갱신)" : ""}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="number" className="inp" style={{ width: 90, textAlign: "right", padding: "6px 9px" }} min="0"
                  value={draft[c.key]} placeholder="0"
                  onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value }))} />
                <span style={{ fontSize: 12.5, color: MUTE, minWidth: 22 }}>시간</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
        <span style={{ fontSize: 12.5, color: MUTE }}>합계 <b style={{ color: PKD }}>{total}시간</b> 기초 반영</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: 13 }} onClick={cancel}>취소</button>
          <button className="btn btn-pk" style={{ padding: "7px 16px", fontSize: 13 }} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 이수증 관리 ---------------- */
function RecordManager({ activeCert, records, setRecords, myCerts, certsMap }) {
  const certList = (myCerts && myCerts.length) ? CERT_NAMES.filter((n) => myCerts.includes(n)) : CERT_NAMES;
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [review, setReview] = useState(null);
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState("new"); // new | old
  const [catFilter, setCatFilter] = useState("all");
  const fileRef = useRef(null);

  const saveRecord = (rec) => setRecords((rs) => {
    const i = rs.findIndex((r) => r.id === rec.id);
    if (i >= 0) { const c = [...rs]; c[i] = rec; return c; }
    return [...rs, rec];
  });
  const delRecord = (id) => setRecords((rs) => {
    const target = rs.find((r) => r.id === id);
    // 지난 주기 이력에서 쓰는 원본 사진은 지우지 않음
    const inHistory = new Set();
    Object.values(certsMap || {}).forEach((c) => (c.history || []).forEach((h) => (h.records || []).forEach((hr) => {
      if (hr.receiptPath) inHistory.add(hr.receiptPath);
      (hr.extraReceiptPaths || []).forEach((x) => inHistory.add(x));
    })));
    const drop = (pth) => { if (pth && !inHistory.has(pth)) deleteReceipt(pth); };
    if (target && target.receiptPath) drop(target.receiptPath);
    // 합치면서 따로 보관된 원본 사진도 함께 정리
    if (target && Array.isArray(target.extraReceiptPaths)) target.extraReceiptPaths.forEach(drop);
    return rs.filter((r) => r.id !== id);
  });

  // 이 자격에 인정되는 이수증 → 검색·필터·정렬 적용 (기초 시간 record는 목록에서 제외)
  const visible = records
    .filter((r) => r.appliesTo[activeCert] && !isBaselineRecord(r))
    .filter((r) => !query.trim() || (r.title || "").toLowerCase().includes(query.trim().toLowerCase()))
    .filter((r) => catFilter === "all" || (r.appliesTo[activeCert] && partsOf(r.appliesTo[activeCert]).some((x) => x.cat === catFilter)))
    .sort((a, b) => sortOrder === "new" ? (b.date || "").localeCompare(a.date || "") : (a.date || "").localeCompare(b.date || ""));
  // 이 자격 이수증에 실제로 존재하는 항목만 필터 옵션으로
  const usableCats = (() => {
    const present = new Set(records.filter((r) => r.appliesTo[activeCert] && !isBaselineRecord(r)).flatMap((r) => partsOf(r.appliesTo[activeCert]).map((x) => x.cat)));
    return CATS.filter((c) => present.has(c.key));
  })();

  const onFile = async (file) => {
    if (!file) return;
    setErrMsg(""); setBusy(true);
    try {
      const isPdf = (file.type === "application/pdf") || /\.pdf$/i.test(file.name || "");
      let b64, media;
      if (isPdf) {
        // PDF는 전체 페이지를 한 장의 이미지로 합쳐서 기존 이미지 인식 경로로 처리
        b64 = await pdfToStackedJpeg(file);
        media = "image/jpeg";
      } else {
        b64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(",")[1]);
          r.onerror = () => rej(new Error("파일을 읽지 못했습니다")); r.readAsDataURL(file);
        });
        media = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";
      }
      const prompt = `이 이미지는 ABA 관련 연수·교육 이수증(CEU 증명서)입니다.
자격증 후보: BCBA(BACB), ABAS-1(한국 KACBA), QBA(QABA), QASP-S(QABA), KBA(한국행동분석학회). 이수증에 인정 자격 문구가 있으면 그 자격들에 인정됩니다.
다음 JSON만 출력(설명·코드블록 금지): {"title":"강의명","date":"YYYY-MM-DD","applies":[{"cert":"BCBA","hours":숫자,"cat":"ethics|superv|general|trauma|comorbid"}]}
- 같은 자격이라도 윤리·일반처럼 항목별 시간이 나뉘어 있으면 항목마다 applies에 따로 넣으세요(예: QBA 일반 3, QBA 윤리 1).
- cat: 윤리=ethics, 수퍼비전=superv, 트라우마 케어/트라우마 기반 케어=trauma, 동반질환/다중진단=comorbid, 그 외=general. 인정 자격 못찾으면 applies는 빈 배열. 날짜는 YYYY-MM-DD.`;
      // 로그인한 사람만 AI를 쓸 수 있게 내 로그인 표를 실어 보냄 (공개 열쇠로는 서버가 거절)
      const loginToken = await getLoginToken();
      if (!loginToken) throw new Error("로그인 시간이 지났어요. 로그아웃 후 다시 로그인해 주세요.");
      const resp = await fetch(CEU_RELAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginToken}`, apikey: RELAY_KEY },
        body: JSON.stringify({ prompt, max_tokens: 1000, image: { media_type: media, data: b64 } }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const text = data.text || "";
      const o = JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim());
      const appliesTo = {};
      (Array.isArray(o.applies) ? o.applies : []).forEach((a) => {
        if (!certList.includes(a.cert)) return;
        const cat = ["ethics", "superv", "general", "trauma", "comorbid"].includes(a.cat) ? a.cat : "general";
        const h = Number(a.hours) || 0;
        const parts = appliesTo[a.cert] ? partsOf(appliesTo[a.cert]) : [];
        const same = parts.find((x) => x.cat === cat);
        if (same) same.hours = (Number(same.hours) || 0) + h; else parts.push({ hours: h, cat });
        appliesTo[a.cert] = fromParts(parts);
      });
      if (Object.keys(appliesTo).length === 0) appliesTo[activeCert] = { hours: 0, cat: "general" };
      // 이수증 원본 사진을 Storage에 저장(실패해도 인식 결과는 유지)
      let receiptPath = null;
      const up = await uploadReceipt(b64, media);
      if (up && up.path) receiptPath = up.path;
      setReview({ id: uid(), title: String(o.title || "이수 항목"), date: /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : todayISO(), appliesTo, receiptPath });
    } catch (err) {
      setErrMsg(err.message || "인식에 실패했습니다. 직접 입력해주세요.");
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const exportCSV = () => {
    const rows = [["강의명", "날짜", ...CERT_NAMES.flatMap((n) => [`${n} 시간`, `${n} 항목`])]];
    records.filter((r) => !isBaselineRecord(r)).forEach((r) => {
      const row = [r.title, r.date];
      CERT_NAMES.forEach((n) => { const a = r.appliesTo[n]; row.push(a ? a.hours : "", a ? (isSplit(a) ? partsLabel(a) : catLabel(a.cat)) : ""); });
      rows.push(row);
    });
    const csv = "\uFEFF" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "이수증_전체.csv"; a.click(); URL.revokeObjectURL(url);
  };

  // 기초 record를 뺀 실제 이수증(개수·빈 상태 판단용)
  const realRecords = records.filter((r) => !isBaselineRecord(r));

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>이수증 <span style={{ color: MUTE, fontWeight: 600, fontSize: 13 }}>· {activeCert} 인정 {visible.length}건 / 전체 {realRecords.length}건</span></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "인식 중…" : "📷 이수증 인식 (사진·PDF)"}</button>
          <button className="btn btn-ghost" onClick={() => setEditing(blankRecord())}>+ 직접 추가</button>
          <button className="btn btn-ghost" onClick={exportCSV} disabled={!realRecords.length}>엑셀(CSV)</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      <div style={{ fontSize: 12, color: MUTE, marginBottom: 14 }}>이수증 한 건이 여러 자격에 인정될 수 있어요. 인정되는 자격을 체크하면 각 자격에 자동 반영됩니다.</div>

      {realRecords.some((r) => r.appliesTo[activeCert]) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
          <input className="inp" style={{ flex: "1 1 180px", padding: "8px 11px" }} placeholder="🔍 강의명 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="inp" style={{ width: "auto", padding: "8px 11px" }} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
            <option value="new">최신순</option>
            <option value="old">오래된순</option>
          </select>
          <select className="inp" style={{ width: "auto", padding: "8px 11px" }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="all">전체 항목</option>
            {usableCats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      )}

      {busy && <div style={{ display: "flex", alignItems: "center", gap: 10, background: PKL, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: PKD }}>
        <span style={{ width: 16, height: 16, border: `2px solid ${PK}`, borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />
        이수증을 읽어 강의명·날짜·시간·항목과 인정 자격을 확인하고 있어요…</div>}
      {errMsg && <div style={{ background: "#FDECEE", border: `1px solid #F5CDD3`, color: BAD, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>{errMsg}</div>}

      {realRecords.length === 0 ? (
        <div style={{ textAlign: "center", padding: "28px 0", color: MUTE, fontSize: 13.5 }}>아직 이수증이 없습니다. 직접 추가하거나 이수증을 인식해보세요.</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: "center", padding: "28px 0", color: MUTE, fontSize: 13.5 }}>조건에 맞는 이수증이 없습니다. 검색어나 필터를 바꿔보세요.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((r) => <RecordRow key={r.id} rec={r} activeCert={activeCert} onEdit={() => setEditing(r)} onDelete={() => delRecord(r.id)} />)}
        </div>
      )}

      {review && <RecordEditor title="인식 결과 확인" subtitle="AI가 읽은 내용이에요. 자격·시간·항목을 확인하고 저장하세요." certList={certList} certsMap={certsMap} existingRecords={records}
        rec={review} onCancel={() => { if (review.receiptPath) deleteReceipt(review.receiptPath); setReview(null); }} onSave={(rec) => { saveRecord(rec); setReview(null); }} />}
      {editing && <RecordEditor title={records.some((r) => r.id === editing.id) ? "이수증 편집" : "이수증 직접 추가"} certList={certList} certsMap={certsMap} existingRecords={records}
        rec={editing} onCancel={() => setEditing(null)} onSave={(rec) => { saveRecord(rec); setEditing(null); }} />}
    </div>
  );
}

// 원본 사진 보기 버튼 (지난 주기 이력용)
function ReceiptButton({ path, small }) {
  const [loading, setLoading] = useState(false);
  const open = async () => {
    if (loading) return;
    setLoading(true);
    const res = await getReceiptUrl(path);
    setLoading(false);
    if (res && res.url) window.open(res.url, "_blank");
    else alert("원본을 불러오지 못했습니다.");
  };
  return (
    <button onClick={open} className="btn btn-ghost" style={{ padding: small ? "2px 8px" : "5px 10px", fontSize: small ? 11.5 : 12.5 }}>
      {loading ? "…" : "📎 원본"}
    </button>
  );
}

function RecordRow({ rec, activeCert, onEdit, onDelete }) {
  const list = CERT_NAMES.filter((n) => rec.appliesTo[n]);
  const [askDel, setAskDel] = useState(false);
  const [loadingImg, setLoadingImg] = useState(false);
  const viewReceipt = async () => {
    if (loadingImg) return;
    setLoadingImg(true);
    const res = await getReceiptUrl(rec.receiptPath);
    setLoadingImg(false);
    if (res && res.url) window.open(res.url, "_blank");
    else alert("원본을 불러오지 못했습니다.");
  };
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{rec.title || "(제목 없음)"}</div>
          <div style={{ fontSize: 12.5, color: MUTE, marginTop: 2 }}>{fmtK(rec.date)}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {rec.receiptPath && (
            <button onClick={viewReceipt} className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12.5 }}>
              {loadingImg ? "…" : "📎 원본"}
            </button>
          )}
          <button onClick={onEdit} className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12.5 }}>편집</button>
          <button onClick={() => setAskDel(true)} title="삭제" style={{ border: "none", background: "transparent", color: MUTE, fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      </div>
      {askDel && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10, background: "#FDECEE", borderRadius: 9, padding: "8px 10px" }}>
          <span style={{ fontSize: 12.5, color: BAD, fontWeight: 700 }}>이 이수증{rec.receiptPath ? "과 원본 사진" : ""}을 지울까요? 되돌릴 수 없어요.</span>
          <span style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12.5, background: "#fff" }} onClick={() => setAskDel(false)}>취소</button>
            <button className="btn" style={{ padding: "5px 12px", fontSize: 12.5, background: BAD, color: "#fff" }} onClick={() => { setAskDel(false); onDelete(); }}>지우기</button>
          </span>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {list.map((n) => {
          const a = rec.appliesTo[n], on = n === activeCert;
          return <span key={n} style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: on ? PK : PKL, color: on ? "#fff" : PKD, border: `1px solid ${on ? PK : LINE}` }}>{n} · {isSplit(a) ? partsLabel(a) : `${a.hours}h · ${catLabel(a.cat)}`}</span>;
        })}
      </div>
    </div>
  );
}

function RecordEditor({ title, subtitle, rec, onCancel, onSave, certList, certsMap, existingRecords }) {
  const names = (certList && certList.length) ? certList : CERT_NAMES;
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(rec)));
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggleCert = (name) => setDraft((d) => {
    const a = { ...d.appliesTo };
    if (a[name]) delete a[name];
    else { const ex = Object.values(a)[0]; a[name] = ex ? fromParts(partsOf(ex)) : { hours: 0, cat: "general" }; }
    return { ...d, appliesTo: a };
  });
  // 항목 줄(시간·항목) 편집 / 추가 / 삭제
  const setPart = (name, i, f, v) => setDraft((d) => {
    const parts = partsOf(d.appliesTo[name]);
    parts[i] = { ...parts[i], [f]: v };
    return { ...d, appliesTo: { ...d.appliesTo, [name]: fromParts(parts) } };
  });
  const addPart = (name) => setDraft((d) => {
    const parts = partsOf(d.appliesTo[name]);
    const used = parts.map((x) => x.cat);
    const next = catOptionsFor(name, null).find((c) => !used.includes(c.key));
    parts.push({ hours: 0, cat: next ? next.key : "general" });
    return { ...d, appliesTo: { ...d.appliesTo, [name]: fromParts(parts) } };
  });
  const removePart = (name, i) => setDraft((d) => {
    const parts = partsOf(d.appliesTo[name]).filter((_, j) => j !== i);
    return { ...d, appliesTo: { ...d.appliesTo, [name]: fromParts(parts) } };
  });
  // 자격별 항목 선택지 (기존 규칙 그대로: 첫 갱신 상태일 때만 추가 항목, 이미 고른 항목은 항상 보임)
  const catOptionsFor = (n, cur) => {
    const base = ["ethics", "superv", "general"];
    const inst = certsMap && certsMap[n];
    const extraAll = (inst && inst.firstExtra) ? Object.keys(inst.firstExtra) : (DEFAULT_CERTS[n] && DEFAULT_CERTS[n].firstExtra ? Object.keys(DEFAULT_CERTS[n].firstExtra) : []);
    const extra = (inst && inst.firstRenewal) ? extraAll : [];
    return CATS.filter((c) => base.includes(c.key) || extra.includes(c.key) || c.key === cur)
      .map((c) => ({ ...c, isExtra: extraAll.includes(c.key) }));
  };
  const anyCert = Object.keys(draft.appliesTo).length > 0;

  // 이수증 날짜가 자격의 취득일(직전 갱신일)보다 이전이면 경고 (막지는 않음)
  const preWarnings = Object.keys(draft.appliesTo)
    .map((n) => {
      const inst = certsMap && certsMap[n];
      if (!inst || !inst.acquired || !draft.date) return null;
      if (draft.date < inst.acquired) return { name: n, acquired: inst.acquired };
      return null;
    })
    .filter(Boolean);

  // 같은 강의명 + 같은 날짜의 이수증이 이미 있으면 중복 의심 (자기 자신 편집 제외, 기초 record 제외)
  const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
  const dupRecords = (existingRecords || []).filter((r) =>
    !isBaselineRecord(r) && r.id !== draft.id && draft.title.trim() &&
    norm(r.title) === norm(draft.title) && (r.date || "") === (draft.date || "")
  );
  const isDup = dupRecords.length > 0;

  const handleSave = () => {
    if (isDup) {
      const ok = window.confirm(`같은 강의명·날짜의 이수증이 이미 등록돼 있어요.\n\n· ${draft.title.trim()} (${fmtK(draft.date)})\n\n실수로 같은 이수증을 또 올린 게 아닌지 확인해 주세요. 그래도 추가할까요?`);
      if (!ok) return;
    }
    if (preWarnings.length > 0) {
      const lines = preWarnings.map((w) => `· ${w.name}: 취득일 ${fmtK(w.acquired)}`).join("\n");
      const ok = window.confirm(`이수증 날짜(${fmtK(draft.date)})가 아래 자격의 현재 취득일(직전 갱신일)보다 이전이에요.\n\n${lines}\n\n지난 주기에 이수한 내역일 수 있어요. 그래도 이번 주기에 추가할까요?`);
      if (!ok) return;
    }
    onSave(draft);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(58,43,48,.45)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }} onClick={onCancel}>
      <div className="card" style={{ padding: 20, width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: 17 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: MUTE, marginTop: 3 }}>{subtitle}</div>}
        <div style={{ marginTop: 14 }}><label className="lbl">강의명</label>
          <input className="inp" value={draft.title} placeholder="예: 행동분석 윤리 워크숍" onChange={(e) => set({ title: e.target.value })} /></div>
        <div style={{ marginTop: 12 }}><label className="lbl">날짜</label>
          <input type="date" className="inp" value={draft.date} onChange={(e) => set({ date: e.target.value })} /></div>
        {isDup && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: BAD, background: "#FDECEE", border: `1px solid #F5CDD3`, borderRadius: 10, padding: "9px 12px", lineHeight: 1.5 }}>
            ⚠ 같은 강의명·날짜의 이수증이 이미 등록돼 있어요. 실수로 같은 이수증을 또 올린 건 아닌지 확인해 주세요.
          </div>
        )}
        {preWarnings.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: WARN, background: "#FFF7EE", border: `1px solid #F5E3CC`, borderRadius: 10, padding: "9px 12px", lineHeight: 1.5 }}>
            ⚠ 이 날짜는 {preWarnings.map((w) => w.name).join(", ")}의 현재 취득일(직전 갱신일)보다 이전이에요. 지난 주기 이수 내역일 수 있어요.
            <span style={{ display: "block", marginTop: 3, color: MUTE, fontSize: 11 }}>
              {preWarnings.map((w) => `${w.name} 취득일 ${fmtK(w.acquired)}`).join(" · ")}
            </span>
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <label className="lbl">인정되는 자격 (체크한 자격에만 반영)</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {names.map((n) => {
              const on = !!draft.appliesTo[n];
              return (
                <div key={n} style={{ border: `1px solid ${on ? PK : LINE}`, borderRadius: 11, padding: on ? "10px 12px" : "8px 12px", background: on ? PKL : "#fff" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                    <input type="checkbox" checked={on} onChange={() => toggleCert(n)} />
                    {n} <span style={{ fontWeight: 600, color: MUTE, fontSize: 12 }}>· {DEFAULT_CERTS[n].org}</span>
                  </label>
                  {on && (() => {
                    const parts = partsOf(draft.appliesTo[n]);
                    const multi = parts.length > 1;
                    const cols = multi ? "1fr 1.2fr 28px" : "1fr 1.2fr";
                    return (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8 }}>
                          <label className="lbl" style={{ fontSize: 11, margin: 0 }}>시간</label>
                          <label className="lbl" style={{ fontSize: 11, margin: 0 }}>항목</label>
                          {multi && <span />}
                        </div>
                        {parts.map((p, i) => (
                          <div key={i} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, marginTop: 5, alignItems: "center" }}>
                            <input type="number" className="inp" style={{ padding: "6px 9px" }} value={p.hours} onChange={(e) => setPart(n, i, "hours", Number(e.target.value))} />
                            <select className="inp" style={{ padding: "6px 9px" }} value={p.cat} onChange={(e) => setPart(n, i, "cat", e.target.value)}>
                              {catOptionsFor(n, p.cat).map((c) => <option key={c.key} value={c.key}>{c.label}{c.isExtra ? " (첫 갱신)" : ""}</option>)}
                            </select>
                            {multi && (
                              <button type="button" onClick={() => removePart(n, i)} title="이 줄 삭제"
                                style={{ border: "none", background: "transparent", color: PKD, fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
                            )}
                          </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                          <button type="button" onClick={() => addPart(n)}
                            style={{ border: "none", background: "transparent", color: PKD, fontSize: 12.5, fontWeight: 700, padding: 0 }}>+ 항목 추가</button>
                          {multi && <span style={{ fontSize: 12.5, fontWeight: 700, color: PKD }}>합계 {draft.appliesTo[n].hours}시간</span>}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onCancel}>취소</button>
          <button className="btn btn-pk" disabled={!anyCert || !draft.title.trim()} style={{ opacity: !anyCert || !draft.title.trim() ? 0.5 : 1 }} onClick={handleSave}>저장</button>
        </div>
        {!anyCert && <div style={{ fontSize: 12, color: BAD, marginTop: 8, textAlign: "right" }}>인정되는 자격을 최소 1개 체크하세요.</div>}
      </div>
    </div>
  );
}


/* ---------------- 설정 (가진 자격 변경) ---------------- */
function Settings({ myCerts, onSave }) {
  const [picked, setPicked] = useState(myCerts || []);
  const toggle = (n) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>설정</div>
      <div style={{ fontSize: 13, color: MUTE, marginBottom: 16 }}>보유 자격을 변경하면 화면에 표시되는 자격이 바뀝니다. 이미 입력한 이수증은 그대로 보존됩니다.</div>
      <div className="card" style={{ padding: 20 }}>
        <label className="lbl">보유 자격증</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {CERT_NAMES.map((n) => {
            const on = picked.includes(n);
            return (
              <button key={n} onClick={() => toggle(n)} style={{ textAlign: "left", border: `1.5px solid ${on ? PK : LINE}`, background: on ? PKL : "#fff", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div><div style={{ fontWeight: 800, fontSize: 15 }}>{n}</div><div style={{ fontSize: 12, color: MUTE, marginTop: 2 }}>{DEFAULT_CERTS[n].org}</div></div>
                <span style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${on ? PK : LINE}`, background: on ? PK : "#fff", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800 }}>{on ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
        <button className="btn btn-pk" style={{ width: "100%", marginTop: 16, opacity: picked.length ? 1 : 0.5 }} disabled={!picked.length} onClick={() => onSave(picked)}>저장</button>
      </div>
    </div>
  );
}

/* ---------------- 관리자 (Supabase 계정 관리) ---------------- */

/* ---------------- [한 번만] 예전 CEU 앱에서 가져오기 ---------------- */
// 지금 탭의 기록에 예전 기록을 더함 (같은 이수증은 한 번만). 지금 탭이 비어 있으면 예전 것 그대로.
function mergeImported(cur, old) {
  const o = ensureCerts({ ...emptyData(), ...old });
  const c = cur ? ensureCerts(cur) : null;
  if (!c || (!(c.records || []).length && !Object.values(c.certs || {}).some((x) => x && x.acquired))) {
    return { ...o, importedFromOld: todayISO() };
  }
  const myCerts = Array.from(new Set([...(c.myCerts || []), ...(o.myCerts || [])]));
  const certs = { ...c.certs };
  Object.keys(o.certs || {}).forEach((n) => {
    if (!certs[n] || !certs[n].acquired) certs[n] = o.certs[n];
  });
  const ids = new Set((c.records || []).map((r) => r.id));
  const records = [...(c.records || []), ...(o.records || []).filter((r) => !ids.has(r.id))];
  return ensureCerts({ ...c, myCerts, certs, records, importedFromOld: todayISO() });
}

function ImportOldModal({ hasCurrent, onDone, onClose }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [stepText, setStepText] = useState("");
  const [err, setErr] = useState("");
  const go = async () => {
    if (!email.trim() || !pw) { setErr("이메일과 비밀번호를 모두 넣어 주세요."); return; }
    setBusy(true); setErr(""); setStepText("");
    const res = await importFromOldCeu(email, pw, setStepText);
    setPw("");
    if (res.error) { setBusy(false); setErr(res.error); return; }
    await onDone(res);
    setBusy(false);
  };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 1000, display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 420, padding: 22 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>예전 CEU 앱에서 가져오기</div>
        <div style={{ fontSize: 13, color: MUTE, lineHeight: 1.6, marginBottom: 14 }}>
          예전 연수시간 관리 앱에 쓰던 이메일과 비밀번호를 넣으면, 기록·보유 자격·갱신 이력·이수증 사진을 이곳으로 옮깁니다.
          예전 앱의 기록은 지우지 않고 그대로 둡니다. 비밀번호는 저장하지 않습니다.
          {hasCurrent && <><br /><b style={{ color: PKD }}>지금 이 탭에 있는 기록은 그대로 두고, 예전 기록을 더합니다.</b></>}
        </div>
        <label className="lbl">예전 CEU 앱 이메일</label>
        <input className="inp" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" disabled={busy} style={{ marginBottom: 10 }} />
        <label className="lbl">비밀번호</label>
        <input className="inp" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) go(); }} />
        {stepText && busy && <div style={{ marginTop: 12, fontSize: 13, color: PKD, fontWeight: 700 }}>{stepText}</div>}
        {err && <div style={{ marginTop: 12, fontSize: 13, color: BAD, fontWeight: 700 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={busy}>닫기</button>
          <button className="btn btn-pk" style={{ flex: 2, opacity: busy ? 0.6 : 1 }} onClick={go} disabled={busy}>{busy ? "옮기는 중…" : "가져오기"}</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   트래커 안 🏅 연수시간(CEU) 탭 — 맨 위 화면
   me: { id, name } (트래커에 로그인한 사람)
   ============================================================ */
export default function CeuTab({ me }) {
  const [loadErr, setLoadErr] = useState("");
  const [data, setData] = useState(null); // { myCerts, certs, records }
  const [screen, setScreen] = useState("loading"); // loading | pickCerts | dashboard | detail | settings
  const [activeCert, setActiveCert] = useState(null);
  const saveTimer = useRef(null);
  const [saveState, setSaveState] = useState(null); // null | saving | saved | error
  const latestData = useRef(null);
  const saveSeq = useRef(0);
  const dirty = useRef(false);

  // 처음 열 때 내 기록 불러오기 (불러오기에 실패하면 빈 화면으로 덮어쓰지 않게 멈춤)
  const load = async () => {
    setLoadErr("");
    setScreen("loading");
    const raw = await loadMyData();
    if (raw && raw.error) { setLoadErr(raw.error); return; }
    const d = ensureCerts(raw || emptyData());
    setData(d);
    setScreen(d.myCerts.length ? "dashboard" : "pickCerts");
  };
  useEffect(() => { load(); }, []);

  const doSave = async (d) => {
    const seq = ++saveSeq.current;
    setSaveState("saving");
    let ok = false;
    try { const res = await saveMyData(d); ok = !!(res && res.ok); } catch (e) { ok = false; }
    if (seq !== saveSeq.current) return;
    dirty.current = !ok;
    setSaveState(ok ? "saved" : "error");
  };
  const persist = (next) => {
    setData(next);
    latestData.current = next;
    dirty.current = true;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; doSave(next); }, 700);
  };
  const retrySave = () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (latestData.current) doSave(latestData.current);
  };
  // 다른 탭으로 옮기거나 창을 닫을 때 아직 안 올라간 변경이 있으면 바로 저장
  useEffect(() => {
    const onLeave = (e) => {
      if (!dirty.current) return;
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; if (latestData.current) doSave(latestData.current); }
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; if (latestData.current) saveMyData(latestData.current); }
    };
  }, []);

  const finishPickCerts = (picked) => {
    const d = ensureCerts({ ...(data || emptyData()), myCerts: picked });
    persist(d);
    updateMyCerts(picked);
    setScreen("dashboard");
  };
  const updateCert = (name, patch) => {
    const d = { ...data, certs: { ...data.certs, [name]: { ...data.certs[name], ...patch } } };
    persist(d);
  };
  const setRecords = (updater) => {
    const nextRecords = typeof updater === "function" ? updater(data.records) : updater;
    persist({ ...data, records: nextRecords });
  };
  // 갱신 완료 → 새 주기 시작 (CEU 앱과 같음)
  const startNewCycle = (name) => {
    const cert = data.certs[name];
    const renewal = addMonths(cert.acquired, cert.cycle);
    const snapshotRecs = data.records
      .filter((r) => r.appliesTo[name])
      .map((r) => ({ title: r.title, date: r.date, hours: r.appliesTo[name].hours, cat: r.appliesTo[name].cat,
        ...(isSplit(r.appliesTo[name]) ? { parts: r.appliesTo[name].parts } : {}),
        ...(r.receiptPath ? { receiptPath: r.receiptPath } : {}),
        ...(Array.isArray(r.extraReceiptPaths) && r.extraReceiptPaths.length ? { extraReceiptPaths: r.extraReceiptPaths } : {}) }));
    const snapshot = { id: uid(), periodStart: cert.acquired, periodEnd: renewal, closedAt: todayISO(), total: totalNeeded(cert), records: snapshotRecs };
    const nextRecords = [];
    data.records.forEach((r) => {
      if (!r.appliesTo[name]) { nextRecords.push(r); return; }
      const rest = { ...r.appliesTo };
      delete rest[name];
      if (Object.keys(rest).length > 0) nextRecords.push({ ...r, appliesTo: rest });
    });
    const newCert = { ...cert, acquired: renewal, firstRenewal: false, history: [snapshot, ...(cert.history || [])] };
    persist({ ...data, certs: { ...data.certs, [name]: newCert }, records: nextRecords });
  };
  const goDetail = (name) => { setActiveCert(name); setScreen("detail"); };

  // 예전 CEU 앱에서 가져오기
  const [showImport, setShowImport] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const doImport = async (res) => {
    const merged = mergeImported(data, res.data);
    setData(merged);
    latestData.current = merged;
    await doSave(merged);
    setShowImport(false);
    setImportMsg(`예전 기록을 옮겼습니다. 이수증 사진 ${res.photos}장${res.photoFail ? ` (못 옮긴 사진 ${res.photoFail}장)` : ""}`);
    setScreen(merged.myCerts && merged.myCerts.length ? "dashboard" : "pickCerts");
  };
  const importBtn = data && !data.importedFromOld ? (
    <button className="btn btn-ghost" onClick={() => setShowImport(true)} style={{ padding: "7px 12px", fontSize: 13 }}>예전 CEU 앱에서 가져오기</button>
  ) : null;

  const subBtn = (id, label) => (
    <button key={id} onClick={() => setScreen(id)} className="btn"
      style={{ background: screen === id ? PK : "#fff", color: screen === id ? "#fff" : INK, border: `1px solid ${screen === id ? PK : LINE}`, padding: "7px 13px" }}>{label}</button>
  );

  return (
    <div className="ceu-root" style={{ color: INK, fontFamily: "'Pretendard','Apple SD Gothic Neo',system-ui,sans-serif" }}>
      <style>{`
        .ceu-root * { box-sizing: border-box; }
        .ceu-root button { font-family: inherit; cursor: pointer; }
        .ceu-root input, .ceu-root select { font-family: inherit; }
        .ceu-root .card { background:#fff; border:1px solid ${LINE}; border-radius:16px; }
        .ceu-root .btn { border:none; border-radius:10px; padding:9px 14px; font-weight:700; font-size:14px; }
        .ceu-root .btn-pk { background:${PK}; color:#fff; }
        .ceu-root .btn-pk:hover { background:${PKD}; }
        .ceu-root .btn-ghost { background:${PKL}; color:${PKD}; border:1px solid ${LINE}; }
        .ceu-root .btn-ghost:hover { background:#fff; }
        .ceu-root .inp { border:1px solid ${LINE}; border-radius:9px; padding:10px 12px; font-size:14px; color:${INK}; outline:none; width:100%; background:#fff; }
        .ceu-root .inp:focus { border-color:${PK}; box-shadow:0 0 0 3px ${PK}22; }
        .ceu-root .lbl { font-size:12px; font-weight:700; color:${MUTE}; margin-bottom:5px; display:block; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {screen === "loading" && (
        <div style={{ textAlign: "center", padding: 60, color: PKD, fontWeight: 700 }}>
          {loadErr ? (
            <>
              <div style={{ color: BAD, marginBottom: 12 }}>연수시간 기록을 불러오지 못했습니다. ({loadErr})</div>
              <button className="btn btn-pk" onClick={load}>다시 불러오기</button>
            </>
          ) : "불러오는 중…"}
        </div>
      )}

      {screen === "pickCerts" && (
        <>
          {importBtn && (
            <div className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", maxWidth: 560, margin: "10px auto 0" }}>
              <div style={{ flex: 1, minWidth: 240, fontSize: 13, color: INK, wordBreak: "keep-all" }}>예전 CEU 앱에 기록이 있다면 먼저 가져오세요.</div>
              {importBtn}
            </div>
          )}
          <PickCerts me={me} onDone={finishPickCerts} />
        </>
      )}
      {showImport && <ImportOldModal hasCurrent={!!(data && (data.records || []).length)} onDone={doImport} onClose={() => setShowImport(false)} />}

      {data && screen !== "loading" && screen !== "pickCerts" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {subBtn("dashboard", "한눈에 보기")}
            {subBtn("settings", "보유 자격 설정")}
            {importBtn}
            <span style={{ marginLeft: "auto" }} />
            {saveState === "saving" && <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: PKL, color: PKD }}>저장 중…</span>}
            {saveState === "saved" && <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: "#EAF7F0", color: OK }}>저장됨</span>}
            {saveState === "error" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: "#FDECEE", color: BAD }}>저장 안 됨</span>
                <button onClick={retrySave} className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>다시 저장</button>
              </span>
            )}
          </div>
          {importMsg && (
            <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, background: "#EAF7F0", color: OK, fontWeight: 700, fontSize: 13.5 }}>{importMsg}</div>
          )}
          {screen === "dashboard" && (
            <Dashboard me={{ ...me, myCerts: data.myCerts }} data={data} onOpen={goDetail} />
          )}
          {screen === "detail" && activeCert && data.certs[activeCert] && (
            <Detail cert={data.certs[activeCert]} records={data.records}
              onBack={() => setScreen("dashboard")}
              onChangeCert={(patch) => updateCert(activeCert, patch)}
              setRecords={setRecords} activeCert={activeCert} allMyCerts={data.myCerts} certsMap={data.certs}
              onStartNewCycle={() => startNewCycle(activeCert)} />
          )}
          {screen === "settings" && (
            <Settings myCerts={data.myCerts} onSave={(picked) => finishPickCerts(picked)} />
          )}
        </>
      )}
    </div>
  );
}
