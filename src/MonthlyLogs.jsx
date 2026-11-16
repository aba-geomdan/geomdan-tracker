// ============================================================
// 📄 월별 서식 탭 — QABA "Pre-QBA Certification Monthly Supervision Log"
//   - 채워진 서식(PDF·사진·Word)을 올리면 AI가 날짜별 A·B·C·D 시간, 관찰·역량 Y/N, 합계, 평가를 읽음
//   - 확인 화면에서 고친 뒤 저장 → 필드워크·슈퍼비전 기록으로 들어가 대시보드·5%·엑셀이 자동 계산
//   - 서식 원본은 보관함에 같이 저장 (QABA 7년 보관 대비)
//   - 같은 달을 다시 올리면 그 달 서식에서 들어온 기록만 바꿈 (직접 입력한 기록은 그대로)
// ============================================================
import React, { useState } from 'react';
import {
  readMonthlyForm, readMonthlyFormText, uploadMonthlyFile, getMonthlyFileUrl, saveMonthlyLog, deleteMonthlyLog,
  createFieldworkLog, deleteFieldworkLog, createSupervisionLog, deleteSupervisionLog,
} from './supabase';

const C = {
  pinkDeep: '#D88896', pinkLight: '#FAD5DA', pinkSoft: '#FCEEF1', pinkPale: '#FDF7F9', plumDark: '#8B6975',
  goodGreen: '#7BAE7E', warnYellow: '#D4A85F', dangerRed: '#C53030', grayText: '#707070', white: '#FFFFFF', inputBg: '#FFFCEB',
};
const RATING = { satisfactory: 'Satisfactory', needs_improvement: 'Needs Improvement', unsatisfactory: 'Unsatisfactory' };

// 이 달 서식에서 들어온 기록 표시 (다시 올리면 이 표시가 붙은 것만 바꿈)
export const monthTag = (month) => `월별서식:${month}`;
const isFromMonth = (log, month, kind) => kind === 'fw'
  ? (log.customActivities || []).includes(monthTag(month))
  : String(log.notes || '').startsWith(`[${monthTag(month)}]`);

const toHM = (v) => {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Math.min(23, Number(m[1])), mi = Math.min(59, Number(m[2] || 0));
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
};
const diffH = (s, e) => {
  const a = toHM(s), b = toHM(e);
  if (!a || !b) return null;
  const [sh, sm] = a.split(':').map(Number), [eh, em] = b.split(':').map(Number);
  const d = (eh * 60 + em) - (sh * 60 + sm);
  return d > 0 ? Math.round(d / 60 * 100) / 100 : null;
};
const addH = (start, h) => {
  const [sh, sm] = start.split(':').map(Number);
  const t = Math.min(23 * 60 + 59, sh * 60 + sm + Math.round(h * 60));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const cellHours = (c) => {
  if (!c) return 0;
  const d = diffH(c.start, c.end);
  return d != null ? d : (Number(c.hours) || 0);
};
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

function computeTotals(rows) {
  let a = 0, b = 0, c = 0, d = 0;
  (rows || []).forEach((r) => { a += cellHours(r.a); b += cellHours(r.b); c += cellHours(r.c); d += cellHours(r.d); });
  const independent = a + b, supervised = c + d;
  return { a: r1(a), b: r1(b), c: r1(c), d: r1(d), independent: r1(independent), supervised: r1(supervised),
    percent: independent > 0 ? Math.round(supervised / independent * 1000) / 10 : 0 };
}

// Word(.docx) → 글자로 바꾸기 (표는 한 줄씩, 칸은 | 로 나눔). 이 기능을 쓸 때만 불러옴
const docxToText = async (file) => {
  const mammoth = (await import('mammoth')).default;
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const walk = (el) => {
    for (const n of el.children) {
      if (n.tagName === 'TABLE') {
        out.push('[표]');
        for (const tr of n.querySelectorAll('tr')) {
          const cells = [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim());
          if (cells.some((c) => c)) out.push(cells.join(' | '));
        }
        out.push('[표 끝]');
      } else if (/^(P|H\d|LI)$/.test(n.tagName)) {
        const t = n.textContent.replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
      } else walk(n);
    }
  };
  walk(doc.body);
  return out.join('\n');
};

const fileToBase64 = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = () => rej(new Error('파일을 읽지 못했습니다'));
  fr.readAsDataURL(file);
});

// 읽은 결과를 확인 화면용으로 정리
function normalize(result) {
  const cell = (x) => ({ start: toHM(x?.start) || '', end: toHM(x?.end) || '', hours: x?.hours ?? '' });
  const rows = (Array.isArray(result?.rows) ? result.rows : []).map((r) => ({
    date: /^\d{4}-\d{2}-\d{2}$/.test(r?.date || '') ? r.date : '',
    a: cell(r?.a), b: cell(r?.b), c: cell(r?.c), d: cell(r?.d),
    observation: r?.observation === true, competencies: r?.competencies === true,
  }));
  let month = /^\d{4}-\d{2}$/.test(result?.month || '') ? result.month : '';
  if (!month && rows[0]?.date) month = rows[0].date.slice(0, 7);
  return { month, supervisor: result?.supervisor || '', rows, rating: RATING[result?.rating] ? result.rating : '',
    notes: result?.notes || '', live_contact: false, formTotals: result?.totals || null };
}

/* ---------------- 확인·고치기 화면 ---------------- */
function ReviewModal({ draft, setDraft, onSave, onClose, busy, existsMonth }) {
  const t = computeTotals(draft.rows);
  const setRow = (i, patch) => setDraft((d) => ({ ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const setCell = (i, k, f, v) => setDraft((d) => ({ ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, [k]: { ...r[k], [f]: v } } : r)) }));
  const inp = { padding: '4px 5px', fontSize: 12, border: `1px solid ${C.pinkLight}`, borderRadius: 4, background: C.inputBg, width: 52 };
  const cellEd = (i, k) => (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center', whiteSpace: 'nowrap' }}>
      <input value={draft.rows[i][k].start} onChange={(e) => setCell(i, k, 'start', e.target.value)} placeholder="시작" style={inp} />
      <span>~</span>
      <input value={draft.rows[i][k].end} onChange={(e) => setCell(i, k, 'end', e.target.value)} placeholder="끝" style={inp} />
      <span style={{ fontSize: 11, color: C.grayText, minWidth: 30, textAlign: 'right' }}>{cellHours(draft.rows[i][k]) ? r1(cellHours(draft.rows[i][k])) + 'h' : ''}</span>
    </div>
  );
  const pctOk = t.percent >= 5;
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, width: '100%', maxWidth: 1100, maxHeight: '92vh', overflow: 'auto' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.pinkLight}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18, color: C.pinkDeep }}>📄 읽은 내용 확인</h2>
          <span style={{ fontSize: 12.5, color: C.grayText }}>틀린 칸은 고친 뒤 저장하세요. 시간은 24시간제(예: 13:30)로 적습니다.</span>
          <button onClick={onClose} disabled={busy} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 22, color: C.grayText, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 12, color: C.plumDark, fontWeight: 700 }}>월
              <input type="month" value={draft.month} onChange={(e) => setDraft((d) => ({ ...d, month: e.target.value }))}
                     style={{ display: 'block', marginTop: 4, padding: '6px 8px', border: `1px solid ${C.pinkLight}`, borderRadius: 6, background: C.inputBg }} />
            </label>
            <label style={{ fontSize: 12, color: C.plumDark, fontWeight: 700 }}>슈퍼바이저
              <input value={draft.supervisor} onChange={(e) => setDraft((d) => ({ ...d, supervisor: e.target.value }))}
                     style={{ display: 'block', marginTop: 4, padding: '6px 8px', border: `1px solid ${C.pinkLight}`, borderRadius: 6, background: C.inputBg, width: 160 }} />
            </label>
            {existsMonth && <span style={{ fontSize: 12.5, color: C.warnYellow, fontWeight: 700 }}>⚠ 이 달 서식이 이미 있습니다. 저장하면 그 달 서식에서 들어온 기록만 새것으로 바뀝니다.</span>}
          </div>

          <div style={{ overflowX: 'auto', border: `1px solid ${C.pinkLight}`, borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.pinkSoft, color: C.plumDark }}>
                  <th style={th}>날짜</th>
                  <th style={th}>A. 직접 (Direct)</th>
                  <th style={th}>B. 간접 (Indirect)</th>
                  <th style={th}>C. 1:1 슈퍼비전</th>
                  <th style={th}>D. 그룹 슈퍼비전</th>
                  <th style={th}>관찰</th>
                  <th style={th}>역량·연구</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.pinkLight}` }}>
                    <td style={td}><input type="date" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} style={{ ...inp, width: 128 }} /></td>
                    <td style={td}>{cellEd(i, 'a')}</td>
                    <td style={td}>{cellEd(i, 'b')}</td>
                    <td style={td}>{cellEd(i, 'c')}</td>
                    <td style={td}>{cellEd(i, 'd')}</td>
                    <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={r.observation} onChange={(e) => setRow(i, { observation: e.target.checked })} /></td>
                    <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={r.competencies} onChange={(e) => setRow(i, { competencies: e.target.checked })} /></td>
                    <td style={td}><button onClick={() => setDraft((d) => ({ ...d, rows: d.rows.filter((_, j) => j !== i) }))} title="이 줄 빼기"
                                           style={{ border: 'none', background: 'none', color: C.dangerRed, cursor: 'pointer' }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setDraft((d) => ({ ...d, rows: [...d.rows, { date: '', a: { start: '', end: '', hours: '' }, b: { start: '', end: '', hours: '' }, c: { start: '', end: '', hours: '' }, d: { start: '', end: '', hours: '' }, observation: false, competencies: false }] }))}
                  style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: 12, background: C.pinkSoft, color: C.plumDark, border: `1px solid ${C.pinkLight}`, borderRadius: 6, cursor: 'pointer' }}>+ 줄 더하기</button>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, padding: 12, background: C.pinkPale, borderRadius: 8, fontSize: 13 }}>
            <div>독립 시간 (A+B)<br /><b style={{ fontSize: 16, color: C.pinkDeep }}>{t.independent} hr</b> <span style={{ fontSize: 11, color: C.grayText }}>(A {t.a} · B {t.b})</span></div>
            <div>슈퍼비전 (C+D)<br /><b style={{ fontSize: 16, color: C.plumDark }}>{t.supervised} hr</b> <span style={{ fontSize: 11, color: C.grayText }}>(C {t.c} · D {t.d})</span></div>
            <div>비율<br /><b style={{ fontSize: 16, color: pctOk ? C.goodGreen : C.dangerRed }}>{t.percent}%</b> <span style={{ fontSize: 11, color: C.grayText }}>{pctOk ? '5% 충족' : '5% 미만'}</span></div>
            {draft.formTotals && (draft.formTotals.independent != null || draft.formTotals.supervised != null) && (
              <div>서식에 적힌 합계<br /><span style={{ fontSize: 12, color: C.grayText }}>독립 {draft.formTotals.independent ?? '-'} · 슈퍼비전 {draft.formTotals.supervised ?? '-'} · {draft.formTotals.percent ?? '-'}%</span></div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, color: C.plumDark }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
              <input type="checkbox" checked={draft.live_contact} onChange={(e) => setDraft((d) => ({ ...d, live_contact: e.target.checked }))} />
              이달 대면 또는 실시간 화상 슈퍼비전 1시간 이상 있었음
            </label>
            <label>평가&nbsp;
              <select value={draft.rating} onChange={(e) => setDraft((d) => ({ ...d, rating: e.target.value }))}
                      style={{ padding: '5px 8px', border: `1px solid ${C.pinkLight}`, borderRadius: 6, background: C.inputBg }}>
                <option value="">(체크 없음)</option>
                {Object.entries(RATING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="평가 메모 (Notes)"
                   style={{ flex: '1 1 240px', padding: '6px 8px', border: `1px solid ${C.pinkLight}`, borderRadius: 6, background: C.inputBg }} />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} disabled={busy} style={{ padding: '10px 18px', background: C.white, border: `1px solid ${C.pinkLight}`, borderRadius: 8, color: C.grayText, cursor: 'pointer' }}>취소</button>
            <button onClick={onSave} disabled={busy || !draft.month} style={{ padding: '10px 22px', background: C.pinkDeep, border: 'none', borderRadius: 8, color: C.white, fontWeight: 700, cursor: 'pointer', opacity: busy || !draft.month ? 0.6 : 1 }}>
              {busy ? '저장하는 중…' : '✅ 저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
const th = { padding: '8px 8px', textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap' };
const td = { padding: '6px 8px', verticalAlign: 'middle' };

/* ---------------- 월별 서식 탭 ---------------- */
export default function MonthlyLogsTab({ supervisee, onChanged, showToast }) {
  const [reading, setReading] = useState(false);
  const [draft, setDraft] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const logs = supervisee.monthlyLogs || [];

  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setErr('파일이 너무 큽니다 (20MB까지).'); return; }
    setErr(''); setReading(true);
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.doc')) { setErr('옛날 Word 파일(.doc)은 못 읽어요. Word에서 "다른 이름으로 저장 → .docx" 또는 PDF로 저장해서 올려 주세요.'); return; }
      let res;
      if (name.endsWith('.docx')) {
        const text = await docxToText(file);
        if (!text.trim()) { setErr('Word 파일 안에 글자가 없어요. PDF나 사진으로 올려 주세요.'); return; }
        res = await readMonthlyFormText(text);
      } else {
        const b64 = await fileToBase64(file);
        const type = file.type || (name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
        res = await readMonthlyForm(b64, type);
      }
      if (res.error) { setErr(res.error); return; }
      setPendingFile(file);
      setDraft(normalize(res.result));
    } catch (e2) { setErr('파일을 읽지 못했습니다: ' + e2.message); }
    finally { setReading(false); }
  };

  const save = async () => {
    const d = draft;
    if (!/^\d{4}-\d{2}$/.test(d.month)) { setErr('월을 정해 주세요.'); return; }
    setSaving(true); setErr('');
    try {
      const month = d.month;
      const sup = d.supervisor || '';
      // 1) 원본 보관
      let file_path = (logs.find((l) => l.month === month) || {}).file_path || null;
      if (pendingFile) {
        const up = await uploadMonthlyFile(supervisee.ownerUid, supervisee.id, month, pendingFile);
        if (up.path) file_path = up.path;
        else showToast && showToast(up.error || '원본은 저장하지 못했습니다', 'danger');
      }
      // 2) 같은 달 서식에서 들어온 예전 기록 지우기 (직접 입력한 기록은 그대로)
      for (const l of (supervisee.fieldworkLogs || [])) if (isFromMonth(l, month, 'fw')) await deleteFieldworkLog(l.id);
      for (const l of (supervisee.supervisionLogs || [])) if (isFromMonth(l, month, 'sv')) await deleteSupervisionLog(l.id);
      // 3) 새 기록 넣기
      const rows = d.rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
      for (const r of rows) {
        let nextStart = '09:00'; // 시간대가 없으면 앞 칸이 끝난 시각부터 이어서 적음
        for (const k of ['a', 'b']) {
          const h = cellHours(r[k]);
          if (!h) continue;
          const start = toHM(r[k].start) || nextStart;
          const end = toHM(r[k].end) && diffH(r[k].start, r[k].end) ? toHM(r[k].end) : addH(start, h);
          await createFieldworkLog(supervisee.id, {
            date: r.date, startTime: start, endTime: end, direct: k === 'a' ? h : 0, supervisor: sup,
            activities: [], customActivities: [monthTag(month)],
          });
          nextStart = end;
        }
        for (const k of ['c', 'd']) {
          const h = cellHours(r[k]);
          if (!h) continue;
          const flags = `${r.observation ? ' [관찰 Y]' : ''}${r.competencies ? ' [역량·연구 Y]' : ''}`;
          const tf = toHM(r[k].start) && toHM(r[k].end) ? ` ${toHM(r[k].start)}~${toHM(r[k].end)}` : '';
          await createSupervisionLog(supervisee.id, {
            date: r.date, hours: h, type: k === 'c' ? 'individual' : 'group', supervisor: sup,
            notes: `[${monthTag(month)}]${tf}${flags}`,
          });
        }
      }
      // 4) 월별 서식 기록 저장
      const res = await saveMonthlyLog(supervisee.id, {
        month, file_path, rating: d.rating || null, notes: d.notes || '', live_contact: !!d.live_contact,
        supervisor: sup, rows, totals: computeTotals(rows),
      });
      if (res && res.error) throw new Error(res.error);
      setDraft(null); setPendingFile(null);
      showToast && showToast(`✅ ${month} 서식을 저장했습니다`, 'good');
      await onChanged();
    } catch (e) {
      setErr('저장하지 못했습니다: ' + e.message);
    } finally { setSaving(false); }
  };

  const openFile = async (path) => {
    const w = window.open('', '_blank');
    const r = await getMonthlyFileUrl(path);
    if (r.url && w) w.location.href = r.url;
    else { if (w) w.close(); showToast && showToast(r.error || '원본을 열지 못했습니다', 'danger'); }
  };
  const editMonth = (l) => {
    setPendingFile(null);
    setDraft({ month: l.month, supervisor: l.supervisor || '', rows: (l.rows || []).map((r) => ({ ...r })), rating: l.rating || '', notes: l.notes || '', live_contact: !!l.live_contact, formTotals: null });
  };
  const removeMonth = async (l) => {
    if (!await window.appConfirm(`${l.month} 서식을 지울까요?\n\n• 이 서식에서 들어온 필드워크·슈퍼비전 기록도 같이 지워집니다\n• 직접 입력한 기록은 그대로 남습니다`, '서식 지우기')) return;
    for (const x of (supervisee.fieldworkLogs || [])) if (isFromMonth(x, l.month, 'fw')) await deleteFieldworkLog(x.id);
    for (const x of (supervisee.supervisionLogs || [])) if (isFromMonth(x, l.month, 'sv')) await deleteSupervisionLog(x.id);
    await deleteMonthlyLog(l.id);
    await onChanged();
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: C.pinkDeep }}>📄 월별 서식</h2>
          <div style={{ fontSize: 12.5, color: C.grayText, marginTop: 4 }}>QABA "Pre-QBA Certification Monthly Supervision Log"를 올리면 날짜별 시간과 합계를 읽어서 기록에 넣습니다.</div>
        </div>
        <label style={{ marginLeft: 'auto', padding: '11px 18px', background: C.pinkDeep, color: C.white, borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: reading ? 'wait' : 'pointer', opacity: reading ? 0.6 : 1 }}>
          {reading ? '읽는 중… (30초쯤 걸려요)' : '📄 월별 서식 올리기'}
          <input type="file" accept="application/pdf,image/*,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={pick} disabled={reading} style={{ display: 'none' }} />
        </label>
      </div>
      {err && <div style={{ marginBottom: 12, padding: '10px 14px', background: '#FFF0F0', color: C.dangerRed, borderRadius: 8, fontSize: 13, fontWeight: 700 }}>{err}</div>}

      {logs.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', background: C.pinkPale, border: `2px dashed ${C.pinkLight}`, borderRadius: 12, color: C.plumDark, fontSize: 14, lineHeight: 1.8 }}>
          아직 올린 서식이 없습니다.<br />채워진 월별 서식을 PDF·사진·Word(.docx) 중 편한 것으로 올려 주세요.
        </div>
      ) : (
        <div style={{ background: C.white, borderRadius: 12, padding: 6, overflowX: 'auto', border: `1px solid ${C.pinkLight}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.pinkSoft, color: C.plumDark }}>
                <th style={th}>월</th><th style={th}>독립 시간</th><th style={th}>슈퍼비전</th><th style={th}>비율</th>
                <th style={th}>대면·화상 1시간</th><th style={th}>평가</th><th style={th}>슈퍼바이저</th><th style={th}>원본·관리</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const t = l.totals && l.totals.independent != null ? l.totals : computeTotals(l.rows);
                const ok = (t.percent || 0) >= 5;
                return (
                  <tr key={l.id} style={{ borderTop: `1px solid ${C.pinkLight}` }}>
                    <td style={{ ...td, fontWeight: 700, color: C.plumDark }}>{l.month}</td>
                    <td style={td}>{t.independent} hr <span style={{ fontSize: 11, color: C.grayText }}>(A {t.a} · B {t.b})</span></td>
                    <td style={td}>{t.supervised} hr <span style={{ fontSize: 11, color: C.grayText }}>(1:1 {t.c} · 그룹 {t.d})</span></td>
                    <td style={{ ...td, fontWeight: 700, color: ok ? C.goodGreen : C.dangerRed }}>{t.percent}% {ok ? '✓' : '⚠'}</td>
                    <td style={{ ...td, color: l.live_contact ? C.goodGreen : C.dangerRed, fontWeight: 700 }}>{l.live_contact ? '✓' : '⚠ 확인 필요'}</td>
                    <td style={td}>{RATING[l.rating] || '-'}</td>
                    <td style={td}>{l.supervisor || '-'}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {l.file_path && <button onClick={() => openFile(l.file_path)} style={smallBtn}>📎 원본</button>}
                        <button onClick={() => editMonth(l)} style={smallBtn}>✏️ 고치기</button>
                        <button onClick={() => removeMonth(l)} style={{ ...smallBtn, color: C.dangerRed, borderColor: '#FFD0D0', background: '#FFF0F0' }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 11.5, color: C.grayText, lineHeight: 1.7 }}>
        ※ QABA는 이 서식을 슈퍼바이저와 슈퍼바이지가 7년 보관하도록 하고, 감사 때 원본 서명본을 요구합니다. 서명은 직접 쓰거나 전자서명만 인정되고 서명 이미지·복사본은 인정되지 않습니다.
      </div>

      {draft && (
        <ReviewModal draft={draft} setDraft={setDraft} onSave={save} onClose={() => { if (!saving) { setDraft(null); setPendingFile(null); } }}
                     busy={saving} existsMonth={!!logs.find((l) => l.month === draft.month)} />
      )}
    </div>
  );
}
const smallBtn = { padding: '4px 9px', fontSize: 11.5, background: C.pinkSoft, color: C.plumDark, border: `1px solid ${C.pinkLight}`, borderRadius: 5, cursor: 'pointer' };
