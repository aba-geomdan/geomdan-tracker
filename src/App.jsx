import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Area, AreaChart,
  PieChart, Pie, Cell, RadialBarChart, RadialBar
} from 'recharts';

const EXAM_DATA = {
  'QBA': { total: 2000, directMax: 800, indirectMin: 1200, svTotal: 100, groupMax: 50, indivMin: 50 },
  'QASP-S': { total: 1000, directMax: 400, indirectMin: 600, svTotal: 50, groupMax: 25, indivMin: 25 }
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
  groupBlue: '#A8B8D4', indivPurple: '#B49DC4',
  inputBg: '#FFFCEB', grayText: '#707070', grayHead: '#555555',
  bg: '#FAF7F8', white: '#FFFFFF'
};

const STORAGE_KEY = 'geomdan_aba_qualification_data';

const loadData = () => {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s);
  } catch (e) {}
  return { examType: 'QASP-S', superviseeName: '', mainSupervisor: '', startDate: '', fieldworkLogs: [], supervisionLogs: [] };
};

// ✅ FIX #1: 타임존 안전한 날짜 처리
// "YYYY-MM-DD" → 로컬 시간 자정 (UTC 변환 X)
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

  // ✅ FIX #5: JSON 백업/복원
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

  const stats = useMemo(() => {
    const totalDirect = data.fieldworkLogs.reduce((s, l) => s + (Number(l.direct) || 0), 0);
    const totalIndirect = data.fieldworkLogs.reduce((s, l) => {
      const ft = timeToHours(l.startTime, l.endTime);
      return s + Math.max(0, ft - (Number(l.direct) || 0));
    }, 0);
    const totalFW = totalDirect + totalIndirect;
    const totalGroup = data.supervisionLogs.reduce((s, l) => s + (Number(l.group) || 0), 0);
    const totalIndiv = data.supervisionLogs.reduce((s, l) => s + (Number(l.individual) || 0), 0);
    const totalSV = totalGroup + totalIndiv;

    const monthMap = {};
    data.fieldworkLogs.forEach(l => {
      if (!l.date) return;
      const ym = l.date.substring(0, 7);
      const ft = timeToHours(l.startTime, l.endTime);
      const d = Number(l.direct) || 0;
      if (!monthMap[ym]) monthMap[ym] = { ym, direct: 0, indirect: 0, group: 0, individual: 0 };
      monthMap[ym].direct += d;
      monthMap[ym].indirect += Math.max(0, ft - d);
    });
    data.supervisionLogs.forEach(l => {
      if (!l.date) return;
      const ym = l.date.substring(0, 7);
      if (!monthMap[ym]) monthMap[ym] = { ym, direct: 0, indirect: 0, group: 0, individual: 0 };
      monthMap[ym].group += Number(l.group) || 0;
      monthMap[ym].individual += Number(l.individual) || 0;
    });
    // ✅ FIX #2: 그룹/개별 분리 표시
    const monthlyData = Object.values(monthMap).sort((a, b) => a.ym.localeCompare(b.ym))
      .map(m => ({
        ...m,
        Direct: Math.round(m.direct * 10) / 10,
        Indirect: Math.round(m.indirect * 10) / 10,
        그룹: Math.round(m.group * 10) / 10,
        개별: Math.round(m.individual * 10) / 10,
        필드워크: Math.round((m.direct + m.indirect) * 10) / 10,
        슈퍼비전: Math.round((m.group + m.individual) * 10) / 10,
        누적: 0
      }));
    let cum = 0;
    monthlyData.forEach(m => { cum += m.필드워크; m.누적 = Math.round(cum * 10) / 10; });

    // ✅ FIX #1: 타임존 안전한 날짜 계산
    const dates = data.fieldworkLogs.map(l => l.date).filter(Boolean).sort();
    const startDate = data.startDate || (dates[0] || '');
    let weeksElapsed = 0;
    if (startDate) {
      const start = parseLocalDate(startDate);
      const now = new Date();
      const diffMs = now - start;
      weeksElapsed = Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
    }
    const weeklyPace = weeksElapsed > 0 ? totalFW / weeksElapsed : 0;
    const remaining = Math.max(0, exam.total - totalFW);

    // ✅ FIX #9: 비현실적 예상일 처리
    let estCompletion = '-';
    if (weeklyPace > 0 && startDate && remaining > 0) {
      const weeksRemaining = remaining / weeklyPace;
      if (weeksRemaining <= 520) { // 10년 이하만 예상일 표시
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
    const thisMonth = monthMap[thisYM] || { direct: 0, indirect: 0 };
    const thisMonthFW = thisMonth.direct + thisMonth.indirect;

    return { totalDirect, totalIndirect, totalFW, totalGroup, totalIndiv, totalSV,
             monthlyData, weeklyPace, remaining, estCompletion, thisMonthFW };
  }, [data, exam]);

  const warnings = useMemo(() => {
    const w = [];
    const dd = exam.directMax - stats.totalDirect;
    w.push(dd > 0 ? { type: 'Direct', status: 'good', msg: `${fmtI(dd)}hr 여유`, guide: `${fmtI(exam.directMax)}hr 이하 유지` }
           : dd === 0 ? { type: 'Direct', status: 'warn', msg: '한도 도달', guide: `${fmtI(exam.directMax)}hr 이하 유지` }
           : { type: 'Direct', status: 'danger', msg: `${fmtI(-dd)}hr 초과`, guide: `${fmtI(exam.directMax)}hr 이하 유지` });

    const gd = exam.groupMax - stats.totalGroup;
    w.push(gd > 0 ? { type: 'Group 슈퍼비전', status: 'good', msg: `${fmtI(gd)}hr 여유`, guide: `${fmtI(exam.groupMax)}hr 이하 유지` }
           : gd === 0 ? { type: 'Group 슈퍼비전', status: 'warn', msg: '한도 도달', guide: `${fmtI(exam.groupMax)}hr 이하 유지` }
           : { type: 'Group 슈퍼비전', status: 'danger', msg: `${fmtI(-gd)}hr 초과`, guide: `${fmtI(exam.groupMax)}hr 이하 유지` });

    const id = exam.indirectMin - stats.totalIndirect;
    w.push(id <= 0 ? { type: 'Indirect', status: 'good', msg: id < 0 ? `+${fmtI(-id)}hr 초과달성` : '충족!', guide: `${fmtI(exam.indirectMin)}hr 이상 채우기` }
           : { type: 'Indirect', status: 'warn', msg: `${fmtI(id)}hr 더 필요`, guide: `${fmtI(exam.indirectMin)}hr 이상 채우기` });

    const ind = exam.indivMin - stats.totalIndiv;
    w.push(ind <= 0 ? { type: 'Individual 슈퍼비전', status: 'good', msg: ind < 0 ? `+${fmtI(-ind)}hr 초과달성` : '충족!', guide: `${fmtI(exam.indivMin)}hr 이상 채우기` }
           : { type: 'Individual 슈퍼비전', status: 'warn', msg: `${fmtI(ind)}hr 더 필요`, guide: `${fmtI(exam.indivMin)}hr 이상 채우기` });
    return w;
  }, [stats, exam]);

  return (
    <div style={{ fontFamily: '"Pretendard", "맑은 고딕", -apple-system, sans-serif', background: C.bg, minHeight: '100vh', color: C.grayText }}>
      <header style={{ background: C.white, borderBottom: `1px solid ${C.pinkLight}`, padding: '24px 0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, color: C.pinkDeep, fontWeight: 700, letterSpacing: '-0.02em' }}>검단ABA 자격시간 추적</h1>
            <p style={{ margin: '6px 0 0 0', fontSize: 13, color: C.plumDark }}>BCBA · QBA · QASP-S 자격 준비 보조</p>
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
                    style={{ padding: '10px 14px', fontSize: 13, background: C.pinkSoft, color: C.plumDark, border: `1px solid ${C.pinkLight}`, borderRadius: 8, cursor: 'pointer', fontWeight: 500 }}>💾 백업</button>
            <button onClick={() => fileInputRef.current?.click()} title="백업 파일 복원"
                    style={{ padding: '10px 14px', fontSize: 13, background: C.pinkSoft, color: C.plumDark, border: `1px solid ${C.pinkLight}`, borderRadius: 8, cursor: 'pointer', fontWeight: 500 }}>📂 복원</button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={importData} style={{ display: 'none' }} />
            <button onClick={() => setShowGuide(true)}
                    style={{ padding: '10px 14px', fontSize: 13, background: C.pinkSoft, color: C.plumDark, border: `1px solid ${C.pinkLight}`, borderRadius: 8, cursor: 'pointer', fontWeight: 500 }}>📖 안내</button>
          </div>
        </div>
      </header>

      <nav style={{ background: C.white, borderBottom: `1px solid ${C.pinkLight}`, display: 'flex', maxWidth: 1200, margin: '0 auto', padding: '0 24px', gap: 4, overflowX: 'auto' }}>
        {[{ id: 'dashboard', l: '📊 대시보드' }, { id: 'fieldwork', l: '📋 필드워크' }, { id: 'supervision', l: '🎓 슈퍼비전' }, { id: 'analysis', l: '📂 슈퍼바이저별' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ padding: '14px 22px', fontSize: 14, color: tab === t.id ? C.pinkDeep : C.grayText, background: 'transparent', border: 'none',
                           borderBottom: tab === t.id ? `2.5px solid ${C.pinkDeep}` : '2.5px solid transparent',
                           cursor: 'pointer', fontWeight: tab === t.id ? 600 : 500, whiteSpace: 'nowrap', transition: 'all 0.15s' }}>{t.l}</button>
        ))}
      </nav>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {tab === 'dashboard' && <Dashboard data={data} stats={stats} exam={exam} warnings={warnings} update={update} />}
        {tab === 'fieldwork' && <FieldworkLog data={data} update={update} />}
        {tab === 'supervision' && <SupervisionLog data={data} update={update} />}
        {tab === 'analysis' && <BySupervisor data={data} />}
      </main>

      <footer style={{ background: C.pinkPale, padding: '28px 24px', textAlign: 'center', borderTop: `1px solid ${C.pinkLight}`, marginTop: 40 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.plumDark, marginBottom: 6 }}>© 2026 검단ABA언어행동연구소 · All Rights Reserved</div>
        <div style={{ fontSize: 11, color: '#8B3A3A', marginBottom: 4 }}>본 자료는 검단ABA언어행동연구소의 지적재산입니다. 무단 복제·배포·재판매·온라인 게시를 엄격히 금지합니다.</div>
        <div style={{ fontSize: 10, color: C.grayText, fontStyle: 'italic' }}>위반 시 저작권법에 따라 민·형사상 책임을 묻습니다.</div>
      </footer>

      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
      {toast && <Toast {...toast} />}
    </div>
  );
}

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

function Dashboard({ data, stats, exam, warnings, update }) {
  const ratioData = [
    { name: 'Direct', value: stats.totalDirect, color: C.goldDeep },
    { name: 'Indirect', value: stats.totalIndirect, color: C.pinkDeep }
  ];
  const progressData = [{
    name: 'progress',
    value: Math.min(100, (stats.totalFW / exam.total) * 100),
    fill: C.pinkDeep
  }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <KpiCard label="Total Fieldwork" value={fmt(stats.totalFW)} target={exam.total} color={C.pinkDeep} />
        <KpiCard label="Direct" value={fmt(stats.totalDirect)} target={exam.directMax} color={C.goldDeep} sub="최대" isMax />
        <KpiCard label="Indirect" value={fmt(stats.totalIndirect)} target={exam.indirectMin} color={C.goodGreen} sub="최소" />
        <KpiCard label="Total Supervision" value={fmt(stats.totalSV)} target={exam.svTotal} color={C.plumDark} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        <Section title="🎯 전체 진행률">
          <div style={{ position: 'relative', height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="65%" outerRadius="95%" data={progressData} startAngle={90} endAngle={-270}>
                <RadialBar dataKey="value" cornerRadius={10} fill={C.pinkDeep} background={{ fill: C.pinkSoft }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: C.pinkDeep, letterSpacing: '-0.02em' }}>{((stats.totalFW / exam.total) * 100).toFixed(1)}%</div>
              <div style={{ fontSize: 12, color: C.grayText, marginTop: 4 }}>{fmt(stats.totalFW)} / {fmtI(exam.total)} hr</div>
            </div>
          </div>
        </Section>

        <Section title="🧩 Direct vs Indirect">
          {stats.totalFW > 0 ? (
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ratioData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                       innerRadius={60} outerRadius={90} paddingAngle={2}
                       label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                       labelLine={false}>
                    {ratioData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${fmt(v)} hr`} contentStyle={tooltipStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 13, paddingTop: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart msg="필드워크 입력 후 표시됩니다" />}
        </Section>
      </div>

      <Section title="💡 인사이트">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Insight icon="⏳" label="남은 시간" value={`${fmtI(stats.remaining)} hr`} sub="필드워크 목표까지" />
          <Insight icon="📅" label="이번 달" value={`${fmt(stats.thisMonthFW)} hr`} sub="이번달 필드워크" />
          <Insight icon="⚡" label="주당 페이스" value={`${fmt(stats.weeklyPace)} hr/주`} sub="평균 페이스" />
          <Insight icon="🎯" label="예상 완료" value={stats.estCompletion} sub="현재 페이스 기준" />
        </div>
      </Section>

      <Section title="📊 자격 기준 충족도">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {warnings.map((w, i) => <WarnCard key={i} {...w} />)}
        </div>
      </Section>

      <Section title="📅 진행 페이스">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div style={paceCellStyle}>
            <div style={paceLabelStyle}>시작일</div>
            <input type="date" value={data.startDate || ''} onChange={e => update({ startDate: e.target.value })} style={inputStyle} />
            <div style={paceHintStyle}>비우면 첫 회기 자동</div>
          </div>
          <div style={paceCellStyle}>
            <div style={paceLabelStyle}>현재 페이스</div>
            <div style={paceValueStyle}>{fmt(stats.weeklyPace)} hr/주</div>
          </div>
          <div style={paceCellStyle}>
            <div style={paceLabelStyle}>예상 완료일</div>
            <div style={paceValueStyle}>{stats.estCompletion}</div>
          </div>
        </div>
      </Section>

      <Section title="📈 월별 필드워크·슈퍼비전 추이 (누적 추세선)">
        {stats.monthlyData.length > 0 ? (
          <div style={{ height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={stats.monthlyData} margin={{ top: 20, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.pinkLight} vertical={false} />
                <XAxis dataKey="ym" tick={{ fontSize: 12, fill: C.grayText }} axisLine={{ stroke: C.pinkLight }} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 12, fill: C.grayText }} axisLine={false} tickLine={false}
                       label={{ value: '월별(hr)', angle: -90, position: 'insideLeft', style: { fill: C.grayText, fontSize: 11 } }} />
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

      <Section title="📊 Direct·Indirect 월별 (필드워크 세부)">
        {stats.monthlyData.length > 0 ? (
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.monthlyData} margin={{ top: 20, right: 24, left: 0, bottom: 8 }}>
                <defs>
                  <linearGradient id="colorDirect" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.goldDeep} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={C.goldDeep} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="colorIndirect" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.goodGreen} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={C.goodGreen} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.pinkLight} vertical={false} />
                <XAxis dataKey="ym" tick={{ fontSize: 12, fill: C.grayText }} axisLine={{ stroke: C.pinkLight }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: C.grayText }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${fmt(v)} hr`, n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Area type="monotone" dataKey="Direct" name="Direct" stroke={C.goldDeep} strokeWidth={2} fill="url(#colorDirect)" />
                <Area type="monotone" dataKey="Indirect" name="Indirect" stroke={C.goodGreen} strokeWidth={2} fill="url(#colorIndirect)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart msg="필드워크 입력 후 표시됩니다" />}
      </Section>

      <Section title="🎓 그룹·개별 슈퍼비전 월별 (슈퍼비전 세부)">
        {stats.monthlyData.some(m => m.그룹 + m.개별 > 0) ? (
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.monthlyData} margin={{ top: 20, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.pinkLight} vertical={false} />
                <XAxis dataKey="ym" tick={{ fontSize: 12, fill: C.grayText }} axisLine={{ stroke: C.pinkLight }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: C.grayText }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${fmt(v)} hr`, n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Bar dataKey="그룹" fill={C.groupBlue} radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="개별" fill={C.indivPurple} radius={[4, 4, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart msg="슈퍼비전 입력 후 표시됩니다" />}
      </Section>

      <Section title="👤 사용자 정보">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: C.grayText, fontWeight: 600 }}>슈퍼바이지(본인) 이름</span>
            <input type="text" value={data.superviseeName || ''} onChange={e => update({ superviseeName: e.target.value })} style={inputStyle} placeholder="예: 강경희" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: C.grayText, fontWeight: 600 }}>메인 슈퍼바이저</span>
            <input type="text" value={data.mainSupervisor || ''} onChange={e => update({ mainSupervisor: e.target.value })} style={inputStyle} placeholder="예: 민다혜" />
          </label>
        </div>
      </Section>
    </div>
  );
}

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

const paceCellStyle = { background: C.pinkPale, borderRadius: 8, padding: 16 };
const paceLabelStyle = { fontSize: 12, color: C.grayText, fontWeight: 600, marginBottom: 8 };
const paceValueStyle = { fontSize: 18, fontWeight: 700, color: C.plumDark };
const paceHintStyle = { fontSize: 10, color: C.grayText, fontStyle: 'italic', marginTop: 4 };

// ✅ FIX #3: Indirect 초과달성 표시
function KpiCard({ label, value, target, color, sub, isMax }) {
  const val = parseFloat(value);
  const pct = target > 0 ? (val / target) * 100 : 0;
  const displayPct = Math.min(100, pct);
  const isOverAchieved = !isMax && pct > 100;
  const isOverLimit = isMax && pct > 100;

  return (
    <div style={{ background: C.white, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: C.grayText, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label} {sub && <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10, color: C.plumDark }}>({sub})</span>}
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, margin: '10px 0', color, letterSpacing: '-0.02em' }}>
        {value}<span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>hr</span>
      </div>
      <div style={{ height: 5, background: '#F0EAEC', borderRadius: 3, overflow: 'hidden', margin: '10px 0' }}>
        <div style={{ height: '100%', borderRadius: 3, transition: 'width 0.4s', width: `${displayPct}%`,
                      background: isOverLimit ? C.dangerRed : color }} />
      </div>
      <div style={{ fontSize: 11, color: C.grayText }}>
        목표 {fmtI(target)}hr · <strong style={{color: isOverLimit ? C.dangerRed : C.plumDark}}>
          {pct.toFixed(1)}%{isOverAchieved && ' ⭐'}
        </strong>
      </div>
    </div>
  );
}

const Insight = ({ icon, label, value, sub }) => (
  <div style={{ background: C.pinkPale, borderRadius: 8, padding: 16, textAlign: 'center' }}>
    <div style={{ fontSize: 22 }}>{icon}</div>
    <div style={{ fontSize: 11, color: C.grayText, marginTop: 6, fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 19, fontWeight: 700, color: C.pinkDeep, margin: '4px 0', letterSpacing: '-0.01em' }}>{value}</div>
    <div style={{ fontSize: 10, color: C.grayText }}>{sub}</div>
  </div>
);

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

function FieldworkLog({ data, update }) {
  // ✅ FIX #6: 정렬 옵션
  const [sortBy, setSortBy] = useState('desc'); // 'desc' 최신순, 'asc' 오래된순

  const add = () => {
    const newLog = { id: Date.now(), supervisor: data.mainSupervisor || '', date: todayYMD(), startTime: '', endTime: '', direct: '', activity: '', notes: '' };
    update({ fieldworkLogs: [newLog, ...data.fieldworkLogs] });
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
        💡 <strong>입력 시 주의</strong>: <strong>Direct</strong>는 아이와 직접 만나는 시간만, <strong>나머지(자동 Indirect)</strong>는 분석·계획·보고서 등.<br/>
        슈퍼비전 받는 시간은 여기에 입력하지 말고 <strong>'슈퍼비전' 탭</strong>에 입력하세요.
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
          {sortedLogs.map(log => <FieldworkItem key={log.id} log={log} onUpdate={c => upd(log.id, c)} onDelete={() => del(log.id)} />)}
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

function FieldworkItem({ log, onUpdate, onDelete }) {
  const ft = timeToHours(log.startTime, log.endTime);
  const direct = Number(log.direct) || 0;
  const indirect = Math.max(0, ft - direct);
  // ✅ Direct 초과 입력 경고
  const directOverFt = direct > ft && ft > 0;

  return (
    <div style={logCardStyle}>
      <div style={rowStyle}>
        <input type="date" value={log.date || ''} onChange={e => onUpdate({ date: e.target.value })} style={logInputStyle} />
        <input type="text" value={log.supervisor || ''} onChange={e => onUpdate({ supervisor: e.target.value })} style={{ ...logInputStyle, flex: 1 }} placeholder="슈퍼바이저" />
        <button onClick={onDelete} style={delBtnStyle}>🗑</button>
      </div>
      <div style={rowStyle}>
        <Field label="시작"><input type="time" value={log.startTime || ''} onChange={e => onUpdate({ startTime: e.target.value })} style={logInputStyle} /></Field>
        <Field label="종료"><input type="time" value={log.endTime || ''} onChange={e => onUpdate({ endTime: e.target.value })} style={logInputStyle} /></Field>
        <Field label="총 시간(자동)"><div style={{ ...logInputStyle, background: '#F5F5F5', color: C.plumDark, fontWeight: 600, minWidth: 80, display: 'flex', alignItems: 'center' }}>{fmt(ft)} hr</div></Field>
      </div>
      <div style={rowStyle}>
        <Field label="Direct (직접 회기, 입력)">
          <input type="number" step="0.01" min="0" max={ft || undefined} value={log.direct || ''} onChange={e => onUpdate({ direct: e.target.value })}
                 style={{...logInputStyle, ...(directOverFt && {borderColor: C.dangerRed, background: '#FFF0F0'})}} placeholder="0" />
        </Field>
        <Field label="Indirect (자동)"><div style={{ ...logInputStyle, background: '#F5F5F5', color: C.plumDark, fontWeight: 600, minWidth: 80, display: 'flex', alignItems: 'center' }}>{fmt(indirect)} hr</div></Field>
      </div>
      {directOverFt && (
        <div style={{ color: C.dangerRed, fontSize: 12, marginTop: -8, marginBottom: 12 }}>
          ⚠️ Direct가 총 시간({fmt(ft)}hr)을 초과합니다
        </div>
      )}
      <div style={rowStyle}>
        <Field label="활동 유형 (여러 개는 콤마로 구분)" flex={1}>
          <input type="text" value={log.activity || ''} onChange={e => onUpdate({ activity: e.target.value })} list="activity-types" style={logInputStyle} placeholder="직접 회기, 평가..." />
          <datalist id="activity-types">{ACTIVITY_TYPES.map(t => <option key={t} value={t} />)}</datalist>
        </Field>
      </div>
      <div style={rowStyle}>
        <Field label="메모 (선택)" flex={1}>
          <textarea value={log.notes || ''} onChange={e => onUpdate({ notes: e.target.value })} style={{ ...logInputStyle, minHeight: 50, fontFamily: 'inherit' }} placeholder="활동 내용·특이사항" />
        </Field>
      </div>
    </div>
  );
}

function SupervisionLog({ data, update }) {
  const [sortBy, setSortBy] = useState('desc');

  const add = () => {
    const newLog = { id: Date.now(), date: todayYMD(), group: '', individual: '', supervisor: data.mainSupervisor || '', notes: '' };
    update({ supervisionLogs: [newLog, ...data.supervisionLogs] });
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
        💡 <strong>입력 시 주의</strong>: 한 세션은 보통 <strong>그룹 또는 개별 중 하나</strong>예요. 둘 다 입력하면 둘 다 합산됩니다.<br/>
        시간은 <strong>슈퍼비전 받은 시간만</strong> (필드워크 시간 따로 입력 X).
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
          {sortedLogs.map(log => {
            const group = Number(log.group) || 0;
            const indiv = Number(log.individual) || 0;
            const bothEntered = group > 0 && indiv > 0;
            return (
              <div key={log.id} style={logCardStyle}>
                <div style={rowStyle}>
                  <input type="date" value={log.date || ''} onChange={e => upd(log.id, { date: e.target.value })} style={logInputStyle} />
                  <input type="text" value={log.supervisor || ''} onChange={e => upd(log.id, { supervisor: e.target.value })} style={{ ...logInputStyle, flex: 1 }} placeholder="슈퍼바이저" />
                  <button onClick={() => del(log.id)} style={delBtnStyle}>🗑</button>
                </div>
                <div style={rowStyle}>
                  <Field label="그룹 (hr)"><input type="number" step="0.01" min="0" value={log.group || ''} onChange={e => upd(log.id, { group: e.target.value })} style={logInputStyle} placeholder="0" /></Field>
                  <Field label="개별 (hr)"><input type="number" step="0.01" min="0" value={log.individual || ''} onChange={e => upd(log.id, { individual: e.target.value })} style={logInputStyle} placeholder="0" /></Field>
                </div>
                {bothEntered && (
                  <div style={{ color: C.warnYellow, fontSize: 12, marginTop: -8, marginBottom: 12 }}>
                    ⚠️ 그룹·개별 둘 다 입력됨. 한 세션이라면 하나만 입력하세요.
                  </div>
                )}
                <div style={rowStyle}>
                  <Field label="메모 (선택)" flex={1}>
                    <textarea value={log.notes || ''} onChange={e => upd(log.id, { notes: e.target.value })} style={{ ...logInputStyle, minHeight: 50, fontFamily: 'inherit' }} placeholder="논의 내용·피드백 등" />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BySupervisor({ data }) {
  const bySup = useMemo(() => {
    const m = {};
    data.fieldworkLogs.forEach(l => {
      if (!l.supervisor) return;
      const ft = timeToHours(l.startTime, l.endTime);
      const d = Number(l.direct) || 0;
      if (!m[l.supervisor]) m[l.supervisor] = { supervisor: l.supervisor, direct: 0, indirect: 0, count: 0 };
      m[l.supervisor].direct += d;
      m[l.supervisor].indirect += Math.max(0, ft - d);
      m[l.supervisor].count += 1;
    });
    return Object.values(m).sort((a, b) => (b.direct + b.indirect) - (a.direct + a.indirect));
  }, [data.fieldworkLogs]);

  const chartData = bySup.map(s => ({
    name: s.supervisor,
    Direct: Math.round(s.direct * 10) / 10,
    Indirect: Math.round(s.indirect * 10) / 10
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
                  <Bar dataKey="Direct" stackId="a" fill={C.goldDeep} />
                  <Bar dataKey="Indirect" stackId="a" fill={C.pinkDeep} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {bySup.map((s, i) => (
              <div key={i} style={{ background: C.white, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderLeft: `3px solid ${C.pinkDeep}` }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.plumDark, marginBottom: 12 }}>👤 {s.supervisor}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: C.grayText }}>
                  <div><strong style={{ fontSize: 18, color: C.pinkDeep }}>{fmt(s.direct + s.indirect)}</strong> hr 총</div>
                  <div>Direct {fmt(s.direct)} · Indirect {fmt(s.indirect)}</div>
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
            <li>대시보드 하단 사용자 정보 입력 (이름·슈퍼바이저)</li>
            <li>"필드워크" 탭에서 매 회기마다 입력</li>
            <li>"슈퍼비전" 탭에서 슈퍼비전 받은 날마다 입력</li>
            <li>대시보드에서 진행률·페이스·한도 확인</li>
          </ol>

          <h3 style={{ color: C.plumDark }}>🎓 시험 기준</h3>
          <ul>
            <li><strong>QBA</strong>: Direct 800hr (최대) + Indirect 1,200hr (최소) = 총 2,000hr · 슈퍼비전 100hr (그룹 50hr 이하, 개별 50hr 이상)</li>
            <li><strong>QASP-S</strong>: Direct 400hr (최대) + Indirect 600hr (최소) = 총 1,000hr · 슈퍼비전 50hr (그룹 25hr 이하, 개별 25hr 이상)</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>💡 Direct vs Indirect</h3>
          <ul>
            <li><strong>Direct</strong>: 현장에서 아이와 직접 만나는 시간. <em>최대 한도</em>가 있어 초과해도 더 인정 안 됨</li>
            <li><strong>Indirect</strong>: 분석·보고서·계획 등 사무 시간. <em>최소 요구</em>량 이상 채워야 자격 인정</li>
            <li>→ 한 회기에 둘 다 있으면 Direct만 입력, 나머지는 자동 Indirect</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>🎓 슈퍼비전 (Group vs Individual)</h3>
          <ul>
            <li><strong>Group</strong>: 여러 슈퍼바이지가 함께 받는 슈퍼비전 (<em>최대 한도</em>)</li>
            <li><strong>Individual</strong>: 1:1 슈퍼비전 (<em>최소 요구</em>)</li>
            <li>→ 한 세션은 보통 둘 중 하나만</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>📊 대시보드 차트</h3>
          <ul>
            <li><strong>전체 진행률</strong>: 목표 대비 현재 위치 (라디얼)</li>
            <li><strong>Direct vs Indirect</strong>: 두 시간의 비율 (도넛)</li>
            <li><strong>월별 필드워크·슈퍼비전 추이</strong>: 막대 + 누적 추세선</li>
            <li><strong>Direct·Indirect 월별</strong>: 영역 차트로 흐름</li>
            <li><strong>그룹·개별 슈퍼비전 월별</strong>: 한도 위반 조기 발견</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>💾 데이터 백업·복원</h3>
          <p>상단 <strong>💾 백업</strong>으로 JSON 파일 다운로드, <strong>📂 복원</strong>으로 불러올 수 있습니다. 정기적으로 백업하세요.</p>

          <h3 style={{ color: C.plumDark }}>⚠️ 주의사항</h3>
          <ul>
            <li>본 자료는 자격 준비 보조용이며, 공식 기관 가이드를 우선하세요</li>
            <li>모든 데이터는 현재 브라우저에 저장됩니다</li>
            <li>브라우저 데이터 삭제 시 기록도 함께 삭제됩니다</li>
            <li>다른 기기에서 보려면 백업 파일로 복원하세요</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
