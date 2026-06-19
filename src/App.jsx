import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  RadialBarChart, RadialBar
} from 'recharts';

// ============================================
// QABA 공식 규정 기준 데이터
// ============================================
const EXAM_DATA = {
  'QBA': {
    total: 2000,            // 필드워크 총 시간
    svPercent: 5,           // 슈퍼비전: 서비스의 5%
    hasRoleDivision: false  // 역할 구분 없음
  },
  'QASP-S': {
    total: 1000,                // 필드워크 총 시간
    svPercent: 5,               // 슈퍼비전: 서비스의 5%
    hasRoleDivision: true,      // 슈퍼바이저 역할 구분 있음
    supervisorMin: 600,         // 슈퍼바이저/프로그램 개발 최소 600시간
    serviceMax: 400             // 직접 서비스 최대 400시간
  }
};

const ACTIVITY_TYPES = [
  '직접 회기', '그룹 회기', '평가', '부모교육', '데이터 분석',
  '회기 계획', '보고서 작성', '자료 제작', '사례 회의', '자기학습'
];

const C = {
  pinkDeep: '#D88896', pinkMid: '#E8A8B0', pinkLight: '#FAD5DA',
  pinkSoft: '#FCEEF1', pinkPale: '#FDF7F9', plumDark: '#8B6975',
  pinkGold: '#F0C8A8', goldDeep: '#D4A574',
  goodGreen: '#7BAE7E', warnYellow: '#D4A85F', dangerRed: '#C53030',
  inputBg: '#FFFCEB', grayText: '#707070', grayHead: '#555555',
  bg: '#FAF7F8', white: '#FFFFFF'
};

const STORAGE_KEY = 'geomdan_aba_qualification_data';

// 레거시 데이터 마이그레이션 (v3 → v4)
const migrateData = (raw) => {
  if (!raw) return null;
  let migrated = false;
  const d = { ...raw };

  // 필드워크: direct 필드 → 역할 선택 + activities 정리
  if (Array.isArray(d.fieldworkLogs)) {
    d.fieldworkLogs = d.fieldworkLogs.map(log => {
      const out = { ...log };
      // direct 필드 제거 (v4에서 사용 안 함)
      if ('direct' in out) {
        delete out.direct;
        migrated = true;
      }
      // notes 필드 제거 (필드워크는 메모 없음)
      if ('notes' in out) {
        delete out.notes;
        migrated = true;
      }
      // activity 문자열 → activities 배열
      if (out.activity && !out.activities) {
        out.activities = out.activity.split(',').map(s => s.trim()).filter(Boolean);
        migrated = true;
      }
      // role 필드 없으면 기본값 (QASP-S 사용자 대비)
      if (!out.role) {
        out.role = 'service';
      }
      return out;
    });
  }

  // 슈퍼비전: group/individual → hours (합산)
  if (Array.isArray(d.supervisionLogs)) {
    d.supervisionLogs = d.supervisionLogs.map(log => {
      const out = { ...log };
      if (('group' in out || 'individual' in out) && !('hours' in out)) {
        const g = Number(out.group) || 0;
        const i = Number(out.individual) || 0;
        out.hours = g + i;
        delete out.group;
        delete out.individual;
        migrated = true;
      }
      return out;
    });
  }

  // supervisors 배열 없으면 추가
  if (!Array.isArray(d.supervisors)) {
    d.supervisors = [];
    migrated = true;
  }

  return { data: d, migrated };
};

const loadData = () => {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      const raw = JSON.parse(s);
      const result = migrateData(raw);
      if (result && result.migrated) {
        // 마이그레이션 후 즉시 저장
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(result.data)); } catch (e) {}
      }
      return result ? result.data : raw;
    }
  } catch (e) {}
  return {
    examType: 'QASP-S',
    superviseeName: '',
    mainSupervisor: '',
    supervisors: [],
    startDate: '',
    fieldworkLogs: [],
    supervisionLogs: []
  };
};

const parseLocalDate = (yyyymmdd) => {
  if (!yyyymmdd) return null;
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const dateToYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const todayYMD = () => dateToYMD(new Date());

const timeToHours = (s, e) => {
  if (!s || !e) return 0;
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  const dm = (eh * 60 + em) - (sh * 60 + sm);
  return dm <= 0 ? 0 : Math.round(dm / 60 * 100) / 100;
};

const fmt = n => Number(n || 0).toFixed(1);
const fmtI = n => Math.round(Number(n || 0)).toLocaleString();

// ============================================
// 메인 App
// ============================================
export default function App() {
  const [data, setData] = useState(loadData());
  const [tab, setTab] = useState('dashboard');
  const [showGuide, setShowGuide] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
  }, [data]);

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const exam = EXAM_DATA[data.examType];
  const update = (c) => setData(p => ({ ...p, ...c }));

  // 백업 다운로드
  const exportData = () => {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `검단ABA_백업_${todayYMD()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('백업 파일이 다운로드되었습니다', 'good');
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!imported.fieldworkLogs || !imported.supervisionLogs) {
          showToast('올바른 백업 파일이 아닙니다', 'danger');
          return;
        }
        if (window.confirm('현재 데이터를 백업 파일로 덮어쓸까요?\n(현재 데이터는 삭제됩니다)')) {
          setData(imported);
          showToast('데이터가 복원되었습니다', 'good');
        }
      } catch (err) {
        showToast('파일을 읽을 수 없습니다', 'danger');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // 통계 계산
  const stats = useMemo(() => {
    // 필드워크
    const fwTotal = data.fieldworkLogs.reduce((s, l) => s + timeToHours(l.startTime, l.endTime), 0);

    // QASP-S 역할 구분
    let supervisorRole = 0, serviceRole = 0;
    if (exam.hasRoleDivision) {
      data.fieldworkLogs.forEach(l => {
        const hrs = timeToHours(l.startTime, l.endTime);
        if (l.role === 'supervisor') supervisorRole += hrs;
        else serviceRole += hrs;
      });
    }

    // 슈퍼비전
    const svTotal = data.supervisionLogs.reduce((s, l) => s + (Number(l.hours) || 0), 0);

    // 슈퍼비전 5% 요구 (전체 필드워크 기준)
    const svRequired = fwTotal * (exam.svPercent / 100);
    const svDiff = svTotal - svRequired;

    // 월별 데이터
    const monthMap = {};
    data.fieldworkLogs.forEach(l => {
      if (!l.date) return;
      const ym = l.date.substring(0, 7);
      const hrs = timeToHours(l.startTime, l.endTime);
      if (!monthMap[ym]) monthMap[ym] = { ym, fw: 0, sv: 0, supervisor: 0, service: 0 };
      monthMap[ym].fw += hrs;
      if (exam.hasRoleDivision) {
        if (l.role === 'supervisor') monthMap[ym].supervisor += hrs;
        else monthMap[ym].service += hrs;
      }
    });
    data.supervisionLogs.forEach(l => {
      if (!l.date) return;
      const ym = l.date.substring(0, 7);
      if (!monthMap[ym]) monthMap[ym] = { ym, fw: 0, sv: 0, supervisor: 0, service: 0 };
      monthMap[ym].sv += Number(l.hours) || 0;
    });
    const monthlyData = Object.values(monthMap).sort((a, b) => a.ym.localeCompare(b.ym))
      .map(m => ({
        ym: m.ym,
        fw: m.fw,
        sv: m.sv,
        필드워크: Math.round(m.fw * 10) / 10,
        슈퍼비전: Math.round(m.sv * 10) / 10,
        필요슈퍼비전: Math.round(m.fw * (exam.svPercent / 100) * 10) / 10,
        누적: 0
      }));
    let cum = 0;
    monthlyData.forEach(m => { cum += m.필드워크; m.누적 = Math.round(cum * 10) / 10; });

    // 페이스
    const dates = data.fieldworkLogs.map(l => l.date).filter(Boolean).sort();
    const startDate = data.startDate || (dates[0] || '');
    let weeksElapsed = 0;
    if (startDate) {
      const start = parseLocalDate(startDate);
      const now = new Date();
      weeksElapsed = Math.max(1, Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000)));
    }
    const weeklyPace = weeksElapsed > 0 ? fwTotal / weeksElapsed : 0;
    const remaining = Math.max(0, exam.total - fwTotal);

    let estCompletion = '-';
    if (weeklyPace > 0 && startDate && remaining > 0) {
      const weeksRemaining = remaining / weeklyPace;
      if (weeksRemaining <= 520) {
        const target = new Date(Date.now() + weeksRemaining * 7 * 24 * 60 * 60 * 1000);
        estCompletion = dateToYMD(target);
      } else {
        estCompletion = '🐢 페이스 부족';
      }
    } else if (remaining === 0) {
      estCompletion = '✅ 달성!';
    }

    const now = new Date();
    const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisMonth = monthMap[thisYM] || { fw: 0, sv: 0 };
    const thisMonthSvRequired = thisMonth.fw * (exam.svPercent / 100);

    // 월별 5% 미충족 분석 (지난달 까지만)
    const currentYM = thisYM;
    const monthsShort = monthlyData.filter(m => {
      if (m.ym >= currentYM) return false; // 이번 달은 진행 중이라 제외
      if (m.fw === 0) return false; // 필드워크 없으면 슈퍼비전 의무도 없음
      const needed = m.fw * (exam.svPercent / 100);
      return m.sv < needed - 0.01;
    }).map(m => ({
      ym: m.ym,
      fw: m.fw,
      sv: m.sv,
      needed: Math.round(m.fw * (exam.svPercent / 100) * 10) / 10,
      shortage: Math.round((m.fw * (exam.svPercent / 100) - m.sv) * 10) / 10
    }));

    return {
      fwTotal, svTotal, svRequired, svDiff,
      supervisorRole, serviceRole,
      monthlyData, weeklyPace, remaining, estCompletion,
      thisMonthFW: thisMonth.fw, thisMonthSV: thisMonth.sv, thisMonthSvRequired,
      monthsShort
    };
  }, [data, exam]);

  // 충족도 경고
  const warnings = useMemo(() => {
    const w = [];

    // 필드워크 총 시간
    const fwDiff = exam.total - stats.fwTotal;
    w.push(fwDiff > 0
      ? { type: '필드워크 총 시간', status: 'warn', msg: `${fmtI(fwDiff)}hr 더 필요`, guide: `${fmtI(exam.total)}hr 채우기` }
      : { type: '필드워크 총 시간', status: 'good', msg: '✓ 달성!', guide: `${fmtI(exam.total)}hr 채우기` });

    // 슈퍼비전 5%
    if (stats.fwTotal > 0) {
      if (Math.abs(stats.svDiff) < 0.5) {
        w.push({ type: '슈퍼비전 5%', status: 'good', msg: '✓ 적정', guide: `현재 ${fmt(stats.svRequired)}hr 필요` });
      } else if (stats.svDiff < 0) {
        w.push({ type: '슈퍼비전 5%', status: 'warn', msg: `${fmt(-stats.svDiff)}hr 부족`, guide: `현재 ${fmt(stats.svRequired)}hr 필요` });
      } else {
        w.push({ type: '슈퍼비전 5%', status: 'good', msg: `+${fmt(stats.svDiff)}hr 여유`, guide: `현재 ${fmt(stats.svRequired)}hr 필요` });
      }
    }

    // QASP-S 슈퍼바이저 역할
    if (exam.hasRoleDivision) {
      const supDiff = exam.supervisorMin - stats.supervisorRole;
      w.push(supDiff > 0
        ? { type: '슈퍼바이저 역할', status: 'warn', msg: `${fmtI(supDiff)}hr 더 필요`, guide: `${fmtI(exam.supervisorMin)}hr 이상 필수` }
        : { type: '슈퍼바이저 역할', status: 'good', msg: '✓ 달성!', guide: `${fmtI(exam.supervisorMin)}hr 이상 필수` });
    }

    return w;
  }, [stats, exam]);

  return (
    <div style={{ fontFamily: '"Pretendard", "맑은 고딕", -apple-system, sans-serif', background: C.bg, minHeight: '100vh', color: C.grayText }}>
      <header style={{ background: C.white, borderBottom: `1px solid ${C.pinkLight}`, padding: '24px 0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, color: C.pinkDeep, fontWeight: 700, letterSpacing: '-0.02em' }}>검단ABA 자격시간 추적</h1>
            <p style={{ margin: '6px 0 0 0', fontSize: 13, color: C.plumDark }}>QBA · QASP-S 자격 준비 보조</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={data.examType} onChange={e => {
              if (window.confirm(`시험을 ${e.target.value}로 변경하시겠습니까?\n(기존 데이터는 유지되며, 기준만 바뀝니다)`)) {
                update({ examType: e.target.value });
              } else {
                e.target.value = data.examType;
              }
            }}
                    style={{ padding: '10px 16px', fontSize: 14, fontWeight: 600, color: C.pinkDeep, background: C.inputBg, border: `1.5px solid ${C.pinkGold}`, borderRadius: 8, cursor: 'pointer', outline: 'none' }}>
              <option value="QBA">QBA</option>
              <option value="QASP-S">QASP-S</option>
            </select>
            <button onClick={exportData} title="JSON 백업 다운로드"
                    style={headerBtnStyle}>💾</button>
            <button onClick={() => fileInputRef.current?.click()} title="백업 파일 복원"
                    style={headerBtnStyle}>📂</button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={importData} style={{ display: 'none' }} />
            <button onClick={() => setShowGuide(true)} title="사용 안내"
                    style={headerBtnStyle}>📖</button>
          </div>
        </div>
      </header>

      <nav style={{ background: C.white, borderBottom: `1px solid ${C.pinkLight}`, display: 'flex', maxWidth: 1200, margin: '0 auto', padding: '0 24px', gap: 4, overflowX: 'auto' }}>
        {[
          { id: 'dashboard', l: '📊 대시보드' },
          { id: 'fieldwork', l: '📋 필드워크' },
          { id: 'supervision', l: '🎓 슈퍼비전' },
          { id: 'analysis', l: '📂 슈퍼바이저별' },
          { id: 'info', l: '📚 시험 정보' }
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ padding: '14px 22px', fontSize: 14, color: tab === t.id ? C.pinkDeep : C.grayText, background: 'transparent', border: 'none',
                           borderBottom: tab === t.id ? `2.5px solid ${C.pinkDeep}` : '2.5px solid transparent',
                           cursor: 'pointer', fontWeight: tab === t.id ? 600 : 500, whiteSpace: 'nowrap', transition: 'all 0.15s' }}>{t.l}</button>
        ))}
      </nav>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <datalist id="supervisor-list">
          {data.mainSupervisor && <option value={data.mainSupervisor} />}
          {(data.supervisors || []).map(s => <option key={s} value={s} />)}
        </datalist>

        {tab === 'dashboard' && <Dashboard data={data} stats={stats} exam={exam} warnings={warnings} update={update} />}
        {tab === 'fieldwork' && <FieldworkLog data={data} exam={exam} update={update} />}
        {tab === 'supervision' && <SupervisionLog data={data} update={update} />}
        {tab === 'analysis' && <BySupervisor data={data} />}
        {tab === 'info' && <ExamInfoTab />}
      </main>

      <footer style={{ background: C.pinkPale, padding: '28px 24px', textAlign: 'center', borderTop: `1px solid ${C.pinkLight}`, marginTop: 40 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.plumDark, marginBottom: 6 }}>© 검단ABA언어행동연구소 · All Rights Reserved</div>
        <div style={{ fontSize: 11, color: '#8B3A3A', marginBottom: 4 }}>본 자료는 검단ABA언어행동연구소의 지적재산입니다. 무단 복제·배포·재판매·온라인 게시를 엄격히 금지합니다.</div>
        <div style={{ fontSize: 10, color: C.grayText, fontStyle: 'italic' }}>위반 시 저작권법에 따라 민·형사상 책임을 묻습니다.</div>
      </footer>

      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
      {toast && <Toast {...toast} />}
    </div>
  );
}

const headerBtnStyle = {
  padding: '10px 12px', fontSize: 16,
  background: C.pinkSoft, color: C.plumDark,
  border: `1px solid ${C.pinkLight}`, borderRadius: 8,
  cursor: 'pointer', fontWeight: 500,
  minWidth: 42
};

function Toast({ msg, type }) {
  const colors = { good: C.goodGreen, danger: C.dangerRed, info: C.plumDark };
  return (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                  background: C.white, color: colors[type], padding: '12px 24px', borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontSize: 14, fontWeight: 500,
                  borderLeft: `4px solid ${colors[type]}`, zIndex: 2000 }}>
      {msg}
    </div>
  );
}

const tooltipStyle = {
  background: C.white, border: `1px solid ${C.pinkLight}`, borderRadius: 8,
  fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
};

// ============================================
// 🎉 환영/시작 안내 카드
// ============================================
function WelcomeCard({ examType }) {
  const isQASP = examType === 'QASP-S';
  return (
    <div style={{
      background: `linear-gradient(135deg, ${C.pinkSoft} 0%, ${C.pinkPale} 100%)`,
      border: `1px solid ${C.pinkLight}`,
      borderRadius: 16,
      padding: 28
    }}>
      <h2 style={{ margin: '0 0 12px 0', color: C.pinkDeep, fontSize: 22, fontWeight: 700 }}>
        🎉 검단ABA 자격시간 추적에 오신 것을 환영합니다
      </h2>
      <p style={{ margin: '0 0 20px 0', fontSize: 14, color: C.plumDark, lineHeight: 1.7 }}>
        <strong>{examType}</strong> 자격 준비를 함께 시작해요. 아래 3단계로 시작할 수 있습니다.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <StartStep num="1" title="사용자 정보 입력" desc="아래 본인·슈퍼바이저 이름을 적어주세요" />
        <StartStep num="2" title="필드워크 기록 추가" desc={`📋 탭에서 매 회기를 입력하세요${isQASP ? ' (역할 선택!)' : ''}`} />
        <StartStep num="3" title="슈퍼비전 기록 추가" desc="🎓 탭에서 슈퍼비전 받은 시간을 입력하세요" />
      </div>
      <div style={{ marginTop: 16, padding: 12, background: C.white, borderRadius: 8, fontSize: 12, color: C.grayHead, lineHeight: 1.6 }}>
        💡 <strong>{examType} 기준</strong>: 필드워크 <strong>{isQASP ? '1,000' : '2,000'}시간</strong>
        {isQASP && ' (이 중 슈퍼바이저 역할 600시간 이상)'}
        + 매월 슈퍼비전 <strong>5%</strong>
      </div>
    </div>
  );
}

function StartStep({ num, title, desc }) {
  return (
    <div style={{ background: C.white, borderRadius: 10, padding: 14, border: `1px solid ${C.pinkLight}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%', background: C.pinkDeep,
          color: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700
        }}>{num}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.plumDark }}>{title}</div>
      </div>
      <div style={{ fontSize: 12, color: C.grayText, lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

// ============================================
// ⚠️ 월별 5% 미충족 알림
// ============================================
function MonthlyShortAlert({ monthsShort }) {
  const [expanded, setExpanded] = useState(false);
  const count = monthsShort.length;
  const visible = expanded ? monthsShort : monthsShort.slice(0, 3);

  return (
    <div style={{
      background: '#FBEFD3',
      border: `1px solid ${C.warnYellow}`,
      borderRadius: 12,
      padding: 16
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#8A6D2A' }}>
          ⚠️ 슈퍼비전 5%를 채우지 못한 달이 {count}개월 있어요
        </div>
        {count > 3 && (
          <button onClick={() => setExpanded(!expanded)}
            style={{ background: 'transparent', border: 'none', color: '#8A6D2A', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>
            {expanded ? '접기 ▲' : `모두 보기 (${count}) ▼`}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {visible.map(m => (
          <div key={m.ym} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 12px', background: C.white, borderRadius: 6, fontSize: 12
          }}>
            <span style={{ color: C.plumDark, fontWeight: 600 }}>{m.ym}</span>
            <span style={{ color: C.grayText }}>
              필드워크 {fmt(m.fw)}hr · 슈퍼비전 {fmt(m.sv)}/{fmt(m.needed)}hr ·
              <strong style={{ color: C.dangerRed, marginLeft: 4 }}>{fmt(m.shortage)}hr 부족</strong>
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: '#8A6D2A', fontStyle: 'italic' }}>
        💡 슈퍼비전은 매월 단위로 5%를 충족해야 합니다. 이미 지난 달의 부족분은 다음 달에 보충하기 어려울 수 있어요.
      </div>
    </div>
  );
}

// ============================================
// 📊 DASHBOARD
// ============================================
function Dashboard({ data, stats, exam, warnings, update }) {
  const hasNoData = data.fieldworkLogs.length === 0 && data.supervisionLogs.length === 0;

  const progressData = [{
    name: 'progress',
    value: Math.min(100, (stats.fwTotal / exam.total) * 100),
    fill: C.pinkDeep
  }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. 빈 상태 환영 카드 */}
      {hasNoData && <WelcomeCard examType={data.examType} />}

      {/* 2. 월별 5% 미충족 경고 */}
      {stats.monthsShort && stats.monthsShort.length > 0 && (
        <MonthlyShortAlert monthsShort={stats.monthsShort} />
      )}

      {/* 3. 사용자 정보 (컴팩트) */}
      <CompactUserInfo data={data} update={update} />

      {/* 4. 🎯 한눈에 보기 - 라디얼 + 핵심 수치 통합 */}
      <Section title="🎯 한눈에 보기">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) 2fr', gap: 24, alignItems: 'center' }}>
          {/* 좌: 라디얼 */}
          <div style={{ position: 'relative', height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="65%" outerRadius="95%" data={progressData} startAngle={90} endAngle={-270}>
                <RadialBar dataKey="value" cornerRadius={10} fill={C.pinkDeep} background={{ fill: C.pinkSoft }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: C.pinkDeep, letterSpacing: '-0.02em' }}>
                {((stats.fwTotal / exam.total) * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: 12, color: C.grayText, marginTop: 4 }}>
                {fmt(stats.fwTotal)} / {fmtI(exam.total)} hr
              </div>
            </div>
          </div>

          {/* 우: 핵심 수치 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <StatBox
              label="📋 필드워크"
              value={fmt(stats.fwTotal)}
              unit="hr"
              sub={`/ ${fmtI(exam.total)}hr`}
              color={C.pinkDeep}
            />
            <StatBox
              label="🎓 슈퍼비전"
              value={fmt(stats.svTotal)}
              unit="hr"
              sub={stats.fwTotal > 0 ? `5% 필요량 ${fmt(stats.svRequired)}hr` : '필드워크 입력 시 자동'}
              color={C.plumDark}
            />
            {exam.hasRoleDivision ? (
              <StatBox
                label="👨‍💼 슈퍼바이저 역할"
                value={fmt(stats.supervisorRole)}
                unit="hr"
                sub={`최소 ${fmtI(exam.supervisorMin)}hr`}
                color={C.goldDeep}
              />
            ) : (
              <StatBox
                label="⏳ 남은 시간"
                value={fmtI(stats.remaining)}
                unit="hr"
                sub="목표까지"
                color={C.pinkMid}
              />
            )}
            <StatBox
              label="⚡ 주당 페이스"
              value={fmt(stats.weeklyPace)}
              unit="hr/주"
              sub={`예상 완료: ${stats.estCompletion}`}
              color={C.pinkGold}
            />
          </div>
        </div>

        {/* 시작일 설정 (작게) */}
        <div style={{ marginTop: 16, padding: 12, background: C.pinkPale, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600 }}>📅 시작일:</span>
          <input type="date" value={data.startDate || ''} onChange={e => update({ startDate: e.target.value })}
                 style={{ ...inputStyle, width: 'auto', flex: '0 1 200px' }} />
          <span style={{ fontSize: 11, color: C.grayText, fontStyle: 'italic' }}>비우면 첫 회기 자동</span>
        </div>
      </Section>

      {/* 5. 자격 기준 충족도 */}
      <Section title="📊 자격 기준 충족도">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {warnings.map((w, i) => <WarnCard key={i} {...w} />)}
        </div>
      </Section>

      {/* 6. 월별 추이 */}
      <Section title="📈 월별 필드워크·슈퍼비전 추이">
        {stats.monthlyData.length > 0 ? (
          <div style={{ height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={stats.monthlyData} margin={{ top: 20, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.pinkLight} vertical={false} />
                <XAxis dataKey="ym" tick={{ fontSize: 12, fill: C.grayText }} axisLine={{ stroke: C.pinkLight }} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 12, fill: C.grayText }} axisLine={false} tickLine={false}
                       label={{ value: '시간(hr)', angle: -90, position: 'insideLeft', style: { fill: C.grayText, fontSize: 11 } }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: C.grayText }} axisLine={false} tickLine={false}
                       label={{ value: '누적(hr)', angle: 90, position: 'insideRight', style: { fill: C.grayText, fontSize: 11 } }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${fmt(v)} hr`, n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Bar yAxisId="left" dataKey="필드워크" fill={C.pinkDeep} radius={[4, 4, 0, 0]} barSize={20} />
                <Bar yAxisId="left" dataKey="슈퍼비전" fill={C.plumDark} radius={[4, 4, 0, 0]} barSize={20} />
                <Line yAxisId="right" type="monotone" dataKey="누적" stroke={C.goldDeep} strokeWidth={2.5} dot={{ fill: C.goldDeep, r: 4 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart msg="월별 데이터가 없습니다. 필드워크 입력 후 표시됩니다." />}
      </Section>

      {/* 7. 슈퍼비전 5% 비교 */}
      <Section title="🎓 월별 슈퍼비전 5% 달성 비교">
        {stats.monthlyData.some(m => m.필드워크 > 0) ? (
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.monthlyData} margin={{ top: 20, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.pinkLight} vertical={false} />
                <XAxis dataKey="ym" tick={{ fontSize: 12, fill: C.grayText }} axisLine={{ stroke: C.pinkLight }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: C.grayText }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${fmt(v)} hr`, n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Bar dataKey="필요슈퍼비전" name="필요 (5%)" fill={C.pinkGold} radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="슈퍼비전" name="실제 받은" fill={C.plumDark} radius={[4, 4, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart msg="필드워크 입력 후 표시됩니다" />}
      </Section>
    </div>
  );
}

// StatBox - 컴팩트한 숫자 카드 ("한눈에 보기" 우측)
function StatBox({ label, value, unit, sub, color }) {
  return (
    <div style={{
      padding: 14,
      background: C.pinkPale,
      borderRadius: 10,
      borderLeft: `3px solid ${color}`
    }}>
      <div style={{ fontSize: 11, color: C.grayText, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'baseline' }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: color, letterSpacing: '-0.02em' }}>{value}</span>
        <span style={{ fontSize: 12, color: C.grayText, marginLeft: 4 }}>{unit}</span>
      </div>
      <div style={{ fontSize: 10, color: C.grayText, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// CompactUserInfo - 한 줄짜리 사용자 정보 + 슈퍼바이저 관리 토글
function CompactUserInfo({ data, update }) {
  const [showSupervisors, setShowSupervisors] = useState(false);
  const supervisors = data.supervisors || [];
  const [newName, setNewName] = useState('');

  const addSupervisor = () => {
    const name = newName.trim();
    if (!name) return;
    if (supervisors.includes(name)) {
      window.alert('이미 추가된 슈퍼바이저입니다.');
      return;
    }
    if (name === data.mainSupervisor) {
      window.alert('메인 슈퍼바이저와 같습니다.');
      return;
    }
    update({ supervisors: [...supervisors, name] });
    setNewName('');
  };

  const removeSupervisor = (name) => {
    if (window.confirm(`'${name}' 슈퍼바이저를 목록에서 제거할까요?\n(이미 입력된 기록은 유지됩니다)`)) {
      update({ supervisors: supervisors.filter(s => s !== name) });
    }
  };

  return (
    <div style={{ background: C.white, borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600 }}>👤</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px' }}>
          <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600, whiteSpace: 'nowrap' }}>슈퍼바이지</span>
          <input type="text" value={data.superviseeName || ''} onChange={e => update({ superviseeName: e.target.value })}
                 style={{ ...inputStyle, padding: '7px 10px', fontSize: 13 }} placeholder="이름" />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px' }}>
          <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600, whiteSpace: 'nowrap' }}>메인 슈퍼바이저</span>
          <input type="text" value={data.mainSupervisor || ''} onChange={e => update({ mainSupervisor: e.target.value })}
                 style={{ ...inputStyle, padding: '7px 10px', fontSize: 13 }} placeholder="이름" />
        </label>
        <button onClick={() => setShowSupervisors(!showSupervisors)}
                style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500,
                         background: showSupervisors ? C.pinkDeep : C.pinkSoft,
                         color: showSupervisors ? C.white : C.plumDark,
                         border: `1px solid ${C.pinkLight}`, borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          + 추가 슈퍼바이저 ({supervisors.length})
        </button>
      </div>

      {showSupervisors && (
        <div style={{ marginTop: 12, padding: 12, background: C.pinkPale, borderRadius: 8 }}>
          {supervisors.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {supervisors.map(name => (
                <div key={name}
                     style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 10px', background: C.white, border: `1px solid ${C.pinkLight}`, borderRadius: 14, fontSize: 12 }}>
                  <span style={{ color: C.plumDark, fontWeight: 500 }}>{name}</span>
                  <button onClick={() => removeSupervisor(name)}
                          style={{ background: 'none', border: 'none', color: C.grayText, cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSupervisor()}
              placeholder="슈퍼바이저 이름 입력 후 Enter"
              style={{ ...inputStyle, padding: '7px 10px', fontSize: 13, flex: 1 }}
            />
            <button onClick={addSupervisor}
                    style={{ padding: '7px 14px', background: C.pinkDeep, color: C.white, border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + 추가
            </button>
          </div>
          <p style={{ margin: '8px 0 0 0', fontSize: 10, color: C.grayText, fontStyle: 'italic' }}>
            여러 슈퍼바이저와 일하는 경우 추가하세요. 기록 입력 시 자동완성됩니다.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================
// 공통 컴포넌트
// ============================================
const Section = ({ title, children }) => (
  <section style={{ background: C.white, borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
    <h2 style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 700, color: C.plumDark, letterSpacing: '-0.01em' }}>{title}</h2>
    {children}
  </section>
);

const EmptyChart = ({ msg }) => (
  <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.grayText, background: C.pinkPale, borderRadius: 8, fontSize: 13 }}>
    {msg}
  </div>
);

const inputStyle = {
  padding: '9px 12px', fontSize: 14, border: `1px solid #E0D5D8`, borderRadius: 6,
  background: C.white, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none'
};

function WarnCard({ type, status, msg, guide }) {
  const cs = { good: { bg: '#E8F1E8', text: C.goodGreen, ic: '✓' },
               warn: { bg: '#FBEFD3', text: C.warnYellow, ic: '⚠' },
               danger: { bg: '#FBE0E0', text: C.dangerRed, ic: '❌' } }[status];
  return (
    <div style={{ background: cs.bg, borderRadius: 8, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: cs.text, letterSpacing: '-0.01em' }}>{cs.ic} {msg}</div>
      <div style={{ fontSize: 12, color: C.grayHead, fontWeight: 600, marginTop: 8 }}>{type}</div>
      <div style={{ fontSize: 10, color: C.grayText, fontStyle: 'italic', marginTop: 4 }}>{guide}</div>
    </div>
  );
}

// ============================================
// 📋 FIELDWORK LOG
// ============================================
function FieldworkLog({ data, exam, update }) {
  const [sortBy, setSortBy] = useState('desc');
  const [recentlyAddedId, setRecentlyAddedId] = useState(null);

  const add = () => {
    const id = Date.now();
    const newLog = {
      id,
      supervisor: data.mainSupervisor || '',
      date: todayYMD(),
      startTime: '',
      endTime: '',
      activities: [],
      role: exam.hasRoleDivision ? 'service' : null
    };
    update({ fieldworkLogs: [newLog, ...data.fieldworkLogs] });
    setRecentlyAddedId(id);
  };
  const upd = (id, c) => update({ fieldworkLogs: data.fieldworkLogs.map(l => l.id === id ? { ...l, ...c } : l) });
  const del = (id) => { if (window.confirm('이 기록을 삭제할까요?')) update({ fieldworkLogs: data.fieldworkLogs.filter(l => l.id !== id) }); };

  const sortedLogs = useMemo(() => {
    return [...data.fieldworkLogs].sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      return sortBy === 'desc' ? -d : d;
    });
  }, [data.fieldworkLogs, sortBy]);

  return (
    <div>
      <InfoBanner>
        💡 <strong>필드워크 기록</strong>: 행동분석 서비스를 제공한 모든 시간을 입력하세요.
        {exam.hasRoleDivision && <><br/>QASP-S는 <strong>슈퍼바이저/프로그램 개발 역할</strong>과 <strong>직접 서비스</strong>를 구분해주세요.</>}
      </InfoBanner>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.plumDark }}>📋 필드워크 기록</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: C.grayText }}>총 {data.fieldworkLogs.length}건</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  style={{ padding: '8px 12px', fontSize: 13, border: `1px solid ${C.pinkLight}`, borderRadius: 6, background: C.white, color: C.plumDark, cursor: 'pointer' }}>
            <option value="desc">최신순 ↓</option>
            <option value="asc">오래된순 ↑</option>
          </select>
          <button onClick={add} style={addBtnStyle}>+ 새 회기</button>
        </div>
      </div>
      {sortedLogs.length === 0 ? <EmptyState msg='아직 입력된 회기가 없습니다.' sub='"새 회기" 버튼을 눌러 시작하세요.' /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sortedLogs.map(log => <FieldworkItem key={log.id} log={log} exam={exam} onUpdate={c => upd(log.id, c)} onDelete={() => del(log.id)} defaultExpanded={log.id === recentlyAddedId} />)}
        </div>
      )}
    </div>
  );
}

const InfoBanner = ({ children }) => (
  <div style={{ background: '#FFF8E7', border: `1px solid ${C.pinkGold}`, borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#7A5538', lineHeight: 1.6 }}>
    {children}
  </div>
);

function FieldworkItem({ log, exam, onUpdate, onDelete, defaultExpanded }) {
  const ft = timeToHours(log.startTime, log.endTime);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const selectedActivities = (log.activities && Array.isArray(log.activities))
    ? log.activities
    : [];

  const toggleActivity = (activity) => {
    const next = selectedActivities.includes(activity)
      ? selectedActivities.filter(a => a !== activity)
      : [...selectedActivities, activity];
    onUpdate({ activities: next });
  };

  // 요약 정보
  const dateLabel = log.date || '날짜 없음';
  const timeLabel = (log.startTime && log.endTime) ? `${log.startTime}~${log.endTime}` : '시간 미입력';
  const roleLabel = exam.hasRoleDivision
    ? (log.role === 'supervisor' ? '👨‍💼 슈퍼바이저' : '🤝 직접 서비스')
    : null;
  const actCount = selectedActivities.length;

  return (
    <div style={logCardStyle}>
      {/* 요약 헤더 (항상 보임) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
           onClick={() => setExpanded(!expanded)}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.plumDark, minWidth: 100 }}>
            📅 {dateLabel}
          </div>
          <div style={{ fontSize: 13, color: C.grayText }}>
            ⏰ {timeLabel} <strong style={{ color: C.pinkDeep }}>({fmt(ft)}hr)</strong>
          </div>
          {log.supervisor && (
            <div style={{ fontSize: 13, color: C.grayText }}>👤 {log.supervisor}</div>
          )}
          {roleLabel && (
            <div style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 4,
              background: log.role === 'supervisor' ? C.pinkGold : C.pinkLight,
              color: C.plumDark, fontWeight: 600
            }}>{roleLabel}</div>
          )}
          {actCount > 0 && (
            <div style={{ fontSize: 11, color: C.grayText, fontStyle: 'italic' }}>
              활동 {actCount}개
            </div>
          )}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={delBtnStyle}>🗑</button>
        <div style={{ fontSize: 14, color: C.grayText, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</div>
      </div>

      {/* 상세 입력 (펼침) */}
      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.pinkLight}` }}>
          <div style={rowStyle}>
            <Field label="날짜">
              <input type="date" value={log.date || ''} onChange={e => onUpdate({ date: e.target.value })} style={logInputStyle} />
            </Field>
            <Field label="슈퍼바이저" flex={1}>
              <input type="text" value={log.supervisor || ''} onChange={e => onUpdate({ supervisor: e.target.value })} list="supervisor-list" style={logInputStyle} placeholder="이름 입력" />
            </Field>
          </div>
          <div style={rowStyle}>
            <Field label="시작"><input type="time" value={log.startTime || ''} onChange={e => onUpdate({ startTime: e.target.value })} style={logInputStyle} /></Field>
            <Field label="종료"><input type="time" value={log.endTime || ''} onChange={e => onUpdate({ endTime: e.target.value })} style={logInputStyle} /></Field>
            <Field label="총 시간 (자동)">
              <div style={{ ...logInputStyle, background: '#F5F5F5', color: C.plumDark, fontWeight: 700, minWidth: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
                {fmt(ft)} hr
              </div>
            </Field>
          </div>

          {/* QASP-S 역할 선택 */}
          {exam.hasRoleDivision && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.grayText, fontWeight: 600, marginBottom: 8 }}>
                이 세션의 역할 <span style={{ color: C.dangerRed }}>*</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { id: 'supervisor', label: '👨‍💼 슈퍼바이저·프로그램 개발', color: C.goldDeep },
                  { id: 'service', label: '🤝 직접 서비스', color: C.pinkDeep }
                ].map(r => {
                  const isSelected = log.role === r.id;
                  return (
                    <button key={r.id} onClick={() => onUpdate({ role: r.id })}
                      style={{
                        flex: 1, padding: '10px 12px', fontSize: 13, fontWeight: 600,
                        border: `1.5px solid ${isSelected ? r.color : '#E0D5D8'}`,
                        borderRadius: 8,
                        background: isSelected ? r.color : C.white,
                        color: isSelected ? C.white : C.grayText,
                        cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'all 0.15s'
                      }}>
                      {isSelected && '✓ '}{r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: C.grayText, fontWeight: 600, marginBottom: 8 }}>
              활동 유형 (여러 개 선택 가능, 참고용)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ACTIVITY_TYPES.map(activity => {
                const isSelected = selectedActivities.includes(activity);
                return (
                  <button
                    key={activity}
                    onClick={() => toggleActivity(activity)}
                    style={{
                      padding: '6px 12px', fontSize: 13, fontWeight: 500,
                      border: `1.5px solid ${isSelected ? C.pinkDeep : '#E0D5D8'}`,
                      borderRadius: 16,
                      background: isSelected ? C.pinkDeep : C.white,
                      color: isSelected ? C.white : C.grayText,
                      cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit'
                    }}
                  >
                    {isSelected ? '✓ ' : ''}{activity}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// 🎓 SUPERVISION LOG
// ============================================
function SupervisionLog({ data, update }) {
  const [sortBy, setSortBy] = useState('desc');
  const [recentlyAddedId, setRecentlyAddedId] = useState(null);

  const add = () => {
    const id = Date.now();
    const newLog = { id, date: todayYMD(), hours: '', supervisor: data.mainSupervisor || '', notes: '' };
    update({ supervisionLogs: [newLog, ...data.supervisionLogs] });
    setRecentlyAddedId(id);
  };
  const upd = (id, c) => update({ supervisionLogs: data.supervisionLogs.map(l => l.id === id ? { ...l, ...c } : l) });
  const del = (id) => { if (window.confirm('이 기록을 삭제할까요?')) update({ supervisionLogs: data.supervisionLogs.filter(l => l.id !== id) }); };

  const sortedLogs = useMemo(() => {
    return [...data.supervisionLogs].sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      return sortBy === 'desc' ? -d : d;
    });
  }, [data.supervisionLogs, sortBy]);

  return (
    <div>
      <InfoBanner>
        💡 <strong>슈퍼비전 기록</strong>: QABA 공식 규정에 따르면 매월 제공한 서비스의 <strong>5%</strong>를 슈퍼비전 받아야 합니다.<br/>
        시간 버튼 클릭 또는 직접 입력 가능합니다.
      </InfoBanner>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.plumDark }}>🎓 슈퍼비전 기록</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: C.grayText }}>총 {data.supervisionLogs.length}건</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  style={{ padding: '8px 12px', fontSize: 13, border: `1px solid ${C.pinkLight}`, borderRadius: 6, background: C.white, color: C.plumDark, cursor: 'pointer' }}>
            <option value="desc">최신순 ↓</option>
            <option value="asc">오래된순 ↑</option>
          </select>
          <button onClick={add} style={addBtnStyle}>+ 새 슈퍼비전</button>
        </div>
      </div>
      {sortedLogs.length === 0 ? <EmptyState msg='아직 입력된 슈퍼비전이 없습니다.' sub='"새 슈퍼비전" 버튼을 눌러 시작하세요.' /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sortedLogs.map(log => (
            <SupervisionItem
              key={log.id}
              log={log}
              onUpdate={(c) => upd(log.id, c)}
              onDelete={() => del(log.id)}
              defaultExpanded={log.id === recentlyAddedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SupervisionItem({ log, onUpdate, onDelete, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hrs = Number(log.hours) || 0;

  return (
    <div style={logCardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
           onClick={() => setExpanded(!expanded)}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.plumDark, minWidth: 100 }}>
            📅 {log.date || '날짜 없음'}
          </div>
          <div style={{ fontSize: 13, color: C.grayText }}>
            ⏱ <strong style={{ color: C.plumDark }}>{fmt(hrs)} hr</strong>
          </div>
          {log.supervisor && (
            <div style={{ fontSize: 13, color: C.grayText }}>👤 {log.supervisor}</div>
          )}
          {log.notes && (
            <div style={{ fontSize: 11, color: C.grayText, fontStyle: 'italic', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              📝 {log.notes}
            </div>
          )}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={delBtnStyle}>🗑</button>
        <div style={{ fontSize: 14, color: C.grayText, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</div>
      </div>

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.pinkLight}` }}>
          <div style={rowStyle}>
            <Field label="날짜">
              <input type="date" value={log.date || ''} onChange={e => onUpdate({ date: e.target.value })} style={logInputStyle} />
            </Field>
            <Field label="슈퍼바이저" flex={1}>
              <input type="text" value={log.supervisor || ''} onChange={e => onUpdate({ supervisor: e.target.value })} list="supervisor-list" style={logInputStyle} placeholder="이름 입력" />
            </Field>
          </div>

          <SvTimePicker
            label="슈퍼비전 시간"
            value={log.hours}
            onChange={(v) => onUpdate({ hours: v })}
          />

          <div style={rowStyle}>
            <Field label="슈퍼비전 내용" flex={1}>
              <textarea value={log.notes || ''} onChange={e => onUpdate({ notes: e.target.value })} style={{ ...logInputStyle, minHeight: 50, fontFamily: 'inherit' }} placeholder="논의 내용·피드백 등" />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// 📂 BY SUPERVISOR
// ============================================
function BySupervisor({ data }) {
  const bySup = useMemo(() => {
    const m = {};
    data.fieldworkLogs.forEach(l => {
      if (!l.supervisor) return;
      const hrs = timeToHours(l.startTime, l.endTime);
      if (!m[l.supervisor]) m[l.supervisor] = { supervisor: l.supervisor, fieldwork: 0, supervision: 0, count: 0 };
      m[l.supervisor].fieldwork += hrs;
      m[l.supervisor].count += 1;
    });
    data.supervisionLogs.forEach(l => {
      if (!l.supervisor) return;
      if (!m[l.supervisor]) m[l.supervisor] = { supervisor: l.supervisor, fieldwork: 0, supervision: 0, count: 0 };
      m[l.supervisor].supervision += Number(l.hours) || 0;
    });
    return Object.values(m).sort((a, b) => (b.fieldwork + b.supervision) - (a.fieldwork + a.supervision));
  }, [data.fieldworkLogs, data.supervisionLogs]);

  const chartData = bySup.map(s => ({
    name: s.supervisor,
    필드워크: Math.round(s.fieldwork * 10) / 10,
    슈퍼비전: Math.round(s.supervision * 10) / 10
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.plumDark }}>📂 슈퍼바이저별 분석</h2>
      {bySup.length === 0 ? <EmptyState msg='슈퍼바이저별 데이터가 없습니다.' /> : (
        <>
          <Section title="📊 슈퍼바이저별 시간 비교">
            <div style={{ height: Math.max(240, bySup.length * 50) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 24, left: 60, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.pinkLight} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12, fill: C.grayText }} axisLine={{ stroke: C.pinkLight }} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 13, fill: C.plumDark, fontWeight: 600 }} axisLine={false} tickLine={false} width={80} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${fmt(v)} hr`} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                  <Bar dataKey="필드워크" stackId="a" fill={C.pinkDeep} />
                  <Bar dataKey="슈퍼비전" stackId="a" fill={C.plumDark} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {bySup.map((s, i) => (
              <div key={i} style={{ background: C.white, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderLeft: `3px solid ${C.pinkDeep}` }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.plumDark, marginBottom: 12 }}>👤 {s.supervisor}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: C.grayText }}>
                  <div><strong style={{ fontSize: 18, color: C.pinkDeep }}>{fmt(s.fieldwork + s.supervision)}</strong> hr 총</div>
                  <div>필드워크 {fmt(s.fieldwork)} · 슈퍼비전 {fmt(s.supervision)}</div>
                  <div style={{ fontSize: 12, fontStyle: 'italic' }}>{s.count}회 세션</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================
// 📚 EXAM INFO TAB (정확한 공식 규정)
// ============================================
function ExamInfoTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.plumDark }}>📚 시험 정보</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 13, color: C.grayText }}>QABA(Qualified Applied Behavior Analysis Credentialing Board) 자격 안내</p>
      </div>

      <InfoBanner>
        ⚠️ <strong>자세하고 정확한 정보는 반드시 QABA 공식 사이트에서 확인하세요.</strong> 시험 요건은 변경될 수 있습니다.
      </InfoBanner>

      {/* 자격 준비 단계 */}
      <Section title="🗺️ 자격 준비 단계 한눈에 보기">
        <div style={{ display: 'grid', gap: 12 }}>
          <PrepStep num="1" title="자격 선택" desc="본인 학력에 맞는 자격 선택 (석사 → QBA, 학사 → QASP-S)" />
          <PrepStep num="2" title="코스워크 이수" desc="QABA 승인 교육기관에서 코스워크 수강 (QBA 270시간 · QASP-S 188시간)" />
          <PrepStep num="3" title="슈퍼바이저 매칭" desc="QBA 자격 보유자(또는 동급) 슈퍼바이저 확정. 슈퍼비전 합의서 작성" />
          <PrepStep num="4" title="필드워크 시작" desc="이 시스템에 필드워크 시간 기록 시작. 매월 5% 슈퍼비전도 함께 추적" />
          <PrepStep num="5" title="요건 충족" desc={"필드워크 총 시간 달성 + 매월 슈퍼비전 5% 충족 + 코스워크 수료 증명"} />
          <PrepStep num="6" title="시험 응시" desc="QABA 공식 사이트에서 시험 신청 → 응시 → 합격" />
          <PrepStep num="7" title="자격 유지" desc="2년마다 CEU 이수 + 윤리 강령 동의 + 갱신 신청" />
        </div>
      </Section>

      <Section title="🎓 QBA (Qualified Behavior Analyst)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SimpleInfoRow label="대상" value="마스터급 행동분석가" />
          <SimpleInfoRow label="학력" value="석사 학위 (ABA, 교육, 심리, 사회복지 등 관련 분야)" />
          <SimpleInfoRow label="코스워크" value="270시간" />
          <SimpleInfoRow label="필드워크" value="2,000시간 (2026년 1월 이후 시작자 기준)" />
          <SimpleInfoRow label="슈퍼비전" value="매월 서비스 제공 시간의 5%" />
          <SimpleInfoRow label="갱신" value="2년마다 32 CEU" />
        </div>
      </Section>

      <Section title="🎓 QASP-S (Qualified Autism Services Practitioner – Supervisor)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SimpleInfoRow label="대상" value="중간급 자폐 서비스 실무자 및 슈퍼바이저" />
          <SimpleInfoRow label="학력" value="학사 학위 (ABA, 교육, 심리, 사회복지 등 관련 분야)" />
          <SimpleInfoRow label="코스워크" value="188시간 (슈퍼비전 8시간 포함)" />
          <SimpleInfoRow label="필드워크" value="1,000시간 (이 중 최소 600시간은 슈퍼바이저·프로그램 개발 역할)" />
          <SimpleInfoRow label="슈퍼비전" value="매월 서비스 제공 시간의 5%" />
          <SimpleInfoRow label="갱신" value="2년마다 20 CEU" />
        </div>
      </Section>

      {/* FAQ */}
      <Section title="❓ 자주 묻는 질문">
        <FAQItem
          q="필드워크 시간을 슈퍼바이저에게 어떻게 보고하나요?"
          a="이 시스템의 '슈퍼바이저별' 탭에서 누적 시간을 확인하고, 필요시 백업(JSON)을 전달하세요. 슈퍼바이저는 QABA 온라인 시스템에서 본인이 직접 인증해야 합니다."
        />
        <FAQItem
          q="슈퍼비전 5%는 매월마다 채워야 하나요?"
          a="네, QABA 공식 규정상 슈퍼비전은 매월 단위로 5%를 충족해야 합니다. 이미 지난 달의 부족분은 다음 달에 보충하기 어려울 수 있으니, 미리 슈퍼바이저와 일정을 잡는 것이 좋습니다."
        />
        <FAQItem
          q="QASP-S에서 '슈퍼바이저 역할 600시간'이란 무엇인가요?"
          a="단순히 클라이언트와 1:1 작업하는 시간이 아니라, 프로그램을 설계하거나 다른 직원을 슈퍼비전하거나 평가를 진행하는 등 '감독·관리·개발' 성격의 업무를 의미합니다. 1,000시간 중 최소 600시간이 이런 역할이어야 합니다."
        />
        <FAQItem
          q="슈퍼바이저는 누구에게 받을 수 있나요?"
          a="QBA 자격 보유자(또는 LBA, ABA 영역의 LP 등) 슈퍼바이저에게 받아야 합니다. 슈퍼바이저는 본인 자격이 active 상태여야 하며, 본인 자격증 보드의 윤리 강령을 준수해야 합니다."
        />
        <FAQItem
          q="이 시스템에 입력한 데이터가 공식 인증에 그대로 쓰이나요?"
          a="아니요. 본 시스템은 본인 추적 보조 도구이며, 공식 인증은 QABA 온라인 시스템을 통해 슈퍼바이저가 별도로 검증·서명해야 합니다."
        />
        <FAQItem
          q="시험에 떨어지면 다시 응시할 수 있나요?"
          a="네, QABA 정책상 30일 후 재응시 가능합니다. 1년 내 최대 4회까지 응시할 수 있으며, 3·4회 사이에도 30일 간격이 필요합니다."
        />
        <FAQItem
          q="데이터가 사라지면 어떻게 하나요?"
          a="이 시스템은 브라우저에 데이터를 저장합니다. 정기적으로 상단 '💾 백업' 버튼을 눌러 JSON 파일을 보관하세요. 다른 기기 사용 시 '📂 복원'으로 불러올 수 있습니다."
        />
      </Section>

      <Section title="🏢 검단ABA언어행동연구소">
        <div style={{ padding: 20, background: 'linear-gradient(135deg, #FDF7F9 0%, #FAD5DA 100%)', borderRadius: 12 }}>
          <h3 style={{ margin: '0 0 12px 0', color: C.pinkDeep, fontSize: 17 }}>전문 ABA 서비스 제공 기관</h3>
          <p style={{ margin: 0, fontSize: 13, color: C.grayHead, lineHeight: 1.7 }}>
            검단ABA언어행동연구소는 ABA 전문 임상 서비스와 자격 준비생 멘토링을 제공합니다.
          </p>
          <ul style={{ margin: '12px 0 0 0', paddingLeft: 20, fontSize: 13, color: C.grayHead, lineHeight: 1.7 }}>
            <li>ABA 임상 서비스 (개별·그룹)</li>
            <li>QBA·QASP-S 자격 준비 멘토링</li>
            <li>슈퍼비전 제공</li>
            <li>부모교육 및 훈련</li>
            <li>전문가 양성 프로그램</li>
          </ul>
        </div>
      </Section>

      <Section title="🔗 공식 사이트 및 참고 자료">
        <div style={{ display: 'grid', gap: 8 }}>
          <LinkRow url="https://qababoard.com" label="QABA 공식 사이트" />
          <LinkRow url="https://qababoard.com/pages/qualified-behavior-analyst-credential/" label="QBA 자격 요건 안내 (공식)" />
          <LinkRow url="https://qababoard.com/pages/qualified-autism-services-practitioner-supervisor/" label="QASP-S 자격 요건 안내 (공식)" />
        </div>
      </Section>

      <div style={{ padding: 16, background: '#FFF8E7', borderRadius: 8, border: `1px solid ${C.pinkGold}` }}>
        <p style={{ margin: 0, fontSize: 12, color: '#7A5538', lineHeight: 1.7 }}>
          📌 본 자료는 자격 준비를 보조하기 위한 도구이며, 자격 인증을 보장하지 않습니다. 시험 요건·일정·응시료 등은 QABA 공식 사이트에서 직접 확인하세요.
        </p>
      </div>
    </div>
  );
}

function PrepStep({ num, title, desc }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: 14, background: C.pinkPale, borderRadius: 8, alignItems: 'flex-start' }}>
      <div style={{
        flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
        background: C.pinkDeep, color: C.white,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700
      }}>{num}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.plumDark, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: C.grayHead, lineHeight: 1.6 }}>{desc}</div>
      </div>
    </div>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8, border: `1px solid ${C.pinkLight}`, borderRadius: 8, overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)}
        style={{ width: '100%', padding: '12px 16px', background: open ? C.pinkPale : C.white, border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'inherit' }}>
        <span style={{ fontSize: 13, color: C.plumDark, fontWeight: 600 }}>Q. {q}</span>
        <span style={{ fontSize: 14, color: C.pinkDeep, transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', marginLeft: 12 }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: '12px 16px', background: C.pinkPale, borderTop: `1px solid ${C.pinkLight}`, fontSize: 13, color: C.grayHead, lineHeight: 1.7 }}>
          A. {a}
        </div>
      )}
    </div>
  );
}

function SimpleInfoRow({ label, value }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 16, padding: '10px 12px', borderBottom: `1px solid ${C.pinkSoft}` }}>
      <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13, color: C.plumDark }}>{value}</span>
    </div>
  );
}

function LinkRow({ url, label }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
       style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, background: C.pinkPale, borderRadius: 8, textDecoration: 'none', color: C.plumDark, transition: 'background 0.15s' }}
       onMouseEnter={e => e.currentTarget.style.background = C.pinkLight}
       onMouseLeave={e => e.currentTarget.style.background = C.pinkPale}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 12, color: C.pinkDeep }}>↗</span>
    </a>
  );
}

// ============================================
// SvTimePicker - 슈퍼비전 시간 빠른 선택
// ============================================
function SvTimePicker({ label, value, onChange }) {
  const presets = [
    { label: '30분', value: 0.5 },
    { label: '1시간', value: 1 },
    { label: '1.5시간', value: 1.5 },
    { label: '2시간', value: 2 },
  ];
  const numValue = Number(value) || 0;
  const isCustom = numValue > 0 && !presets.some(p => p.value === numValue);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: C.grayText, fontWeight: 600, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {presets.map(p => {
          const isSelected = numValue === p.value;
          return (
            <button
              key={p.value}
              onClick={() => onChange(isSelected ? '' : p.value)}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600,
                border: `1.5px solid ${isSelected ? C.pinkDeep : '#E0D5D8'}`,
                borderRadius: 8,
                background: isSelected ? C.pinkDeep : C.white,
                color: isSelected ? C.white : C.grayText,
                cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit'
              }}
            >
              {p.label}
            </button>
          );
        })}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
          <span style={{ fontSize: 12, color: C.grayText }}>또는</span>
          <input
            type="number" step="0.25" min="0"
            value={isCustom ? value : ''}
            onChange={e => onChange(e.target.value)}
            placeholder="직접 입력"
            style={{ ...logInputStyle, width: 100, padding: '7px 10px' }}
          />
          <span style={{ fontSize: 12, color: C.grayText }}>hr</span>
        </div>
      </div>
      {numValue > 0 && (
        <div style={{ fontSize: 11, color: C.plumDark, marginTop: 6, fontWeight: 500 }}>
          ✓ {fmt(numValue)} hr 기록됨
        </div>
      )}
    </div>
  );
}

const Field = ({ label, children, flex = '0 1 auto' }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex, minWidth: 120 }}>
    <span style={{ fontSize: 11, color: C.grayText, fontWeight: 600 }}>{label}</span>
    {children}
  </label>
);

const EmptyState = ({ msg, sub }) => (
  <div style={{ background: C.pinkPale, borderRadius: 12, padding: '60px 24px', textAlign: 'center', color: C.grayText }}>
    <p>{msg}</p>
    {sub && <p style={{ fontSize: 13, fontStyle: 'italic', marginTop: 8 }}>{sub}</p>}
  </div>
);

const rowStyle = { display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'flex-end' };
const logCardStyle = { background: C.white, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderLeft: `3px solid ${C.pinkLight}` };
const logInputStyle = { padding: '9px 12px', fontSize: 14, border: '1px solid #E0D5D8', borderRadius: 6, background: C.inputBg, fontFamily: 'inherit', outline: 'none' };
const addBtnStyle = { padding: '10px 20px', fontSize: 14, fontWeight: 600, color: C.white, background: C.pinkDeep, border: 'none', borderRadius: 8, cursor: 'pointer', boxShadow: '0 2px 4px rgba(216,136,150,0.3)' };
const delBtnStyle = { padding: '8px 12px', background: '#FFF0F0', border: '1px solid #FFD0D0', color: C.dangerRed, borderRadius: 6, cursor: 'pointer', fontSize: 16 };

// ============================================
// 📖 GUIDE MODAL
// ============================================
function GuideModal({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, maxWidth: 700, maxHeight: '85vh', width: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.pinkLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, color: C.pinkDeep, fontSize: 20 }}>📖 사용 안내</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, color: C.grayText, cursor: 'pointer', padding: '4px 8px' }}>✕</button>
        </div>
        <div style={{ padding: 24, overflowY: 'auto', lineHeight: 1.7, color: C.grayHead }}>
          <h3 style={{ color: C.plumDark }}>📌 시작하기</h3>
          <ol>
            <li>상단 우측에서 응시할 시험 선택 (QBA 또는 QASP-S)</li>
            <li>대시보드 상단 사용자 정보 입력 (이름·슈퍼바이저)</li>
            <li>"필드워크" 탭에서 매 회기마다 입력</li>
            <li>"슈퍼비전" 탭에서 슈퍼비전 받은 날마다 입력</li>
            <li>대시보드에서 진행률·페이스·5% 충족도 확인</li>
          </ol>

          <h3 style={{ color: C.plumDark }}>🎓 자격 기준 (QABA 공식)</h3>
          <ul>
            <li><strong>QBA</strong>: 필드워크 2,000시간 + 슈퍼비전 5%</li>
            <li><strong>QASP-S</strong>: 필드워크 1,000시간 (최소 600시간 슈퍼바이저 역할) + 슈퍼비전 5%</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>💡 슈퍼비전 5% 규정</h3>
          <p>매월 제공한 서비스 시간의 <strong>5%</strong>를 슈퍼비전 받아야 합니다.
          예: 한 달에 100시간 일했다면 5시간 슈퍼비전 필요.</p>

          <h3 style={{ color: C.plumDark }}>👨‍💼 QASP-S 역할 구분</h3>
          <p>QASP-S는 1,000시간 중 <strong>최소 600시간</strong>이 슈퍼바이저 또는 프로그램 개발 역할이어야 합니다.
          매 회기마다 역할을 선택해주세요.</p>

          <h3 style={{ color: C.plumDark }}>📊 대시보드 차트</h3>
          <ul>
            <li><strong>전체 진행률</strong>: 필드워크 누적 목표 대비 %</li>
            <li><strong>월별 추이</strong>: 막대(월별) + 추세선(누적)</li>
            <li><strong>슈퍼비전 5% 비교</strong>: 필요량 vs 실제 받은 양</li>
            <li><strong>역할별 분포 (QASP-S)</strong>: 슈퍼바이저 vs 직접 서비스</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>💾 데이터 백업·복원</h3>
          <p>상단 <strong>💾 백업</strong>으로 JSON 파일 다운로드, <strong>📂 복원</strong>으로 불러올 수 있습니다. 정기적으로 백업하세요.</p>

          <h3 style={{ color: C.plumDark }}>⚠️ 주의사항</h3>
          <ul>
            <li>본 자료는 자격 준비 보조용이며, QABA 공식 가이드를 우선하세요</li>
            <li>모든 데이터는 현재 브라우저에 저장됩니다</li>
            <li>브라우저 데이터 삭제 시 기록도 함께 삭제됩니다</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
