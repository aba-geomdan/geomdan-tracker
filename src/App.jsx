aimport React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  authLogin,
  fetchSupervisees, createSupervisee, updateSupervisee, deleteSupervisee,
  fetchFieldworkLogs, createFieldworkLog, updateFieldworkLog, deleteFieldworkLog,
  fetchSupervisionLogs, createSupervisionLog, updateSupervisionLog, deleteSupervisionLog,
  getActiveSuperviseeId, setActiveSuperviseeId,
  fetchAllUsers, createUser, updateUser, deleteUser, fetchUserStats, toggleUserActive
} from './supabase';

// ============================================
// QABA 공식 규정 기준 데이터
// ============================================
const EXAM_DATA = {
  'QBA': {
    total: 2000,            // 필드워크 총 시간
    directMax: 800,         // Direct 최대 800시간
    indirectMin: 1200,      // Indirect 최소 1,200시간 (oversight/supervision 역할)
    svPercent: 5            // 슈퍼비전: 서비스의 5%
  },
  'QASP-S': {
    total: 1000,            // 필드워크 총 시간
    directMax: 400,         // Direct 최대 400시간 (40%)
    indirectMin: 600,       // Indirect 최소 600시간 (슈퍼바이저/프로그램 개발 역할)
    svPercent: 5            // 슈퍼비전: 서비스의 5%
  }
};

const DIRECT_ACTIVITIES = [
  '직접 회기', '그룹 회기', '평가', '부모교육 (아동 동석)'
];

const INDIRECT_ACTIVITIES = [
  '데이터 분석', '회기 계획', '보고서 작성',
  '자료 제작', '사례 회의', '자기학습', '부모상담'
];

const C = {
  pinkDeep: '#D88896', pinkMid: '#E8A8B0', pinkLight: '#FAD5DA',
  pinkSoft: '#FCEEF1', pinkPale: '#FDF7F9', plumDark: '#8B6975',
  pinkGold: '#F0C8A8', goldDeep: '#D4A574',
  goodGreen: '#7BAE7E', warnYellow: '#D4A85F', dangerRed: '#C53030',
  inputBg: '#FFFCEB', grayText: '#707070', grayHead: '#555555',
  bg: '#FAF7F8', white: '#FFFFFF'
};

// ============================================
// 날짜 헬퍼
// ============================================
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
  // 🔒 로그인된 사용자 정보 (Supabase에서 받은 user 객체)
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true); // 초기 인증 체크 중

  // 로그인 상태 복원 (페이지 새로고침해도 유지)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('geomdan_tracker_user_data');
      if (saved) {
        const user = JSON.parse(saved);
        if (user && user.id && user.user_id) {
          setLoggedInUser(user);
        }
      }
    } catch (e) {}
    setAuthChecking(false);
  }, []);

  const isAuthenticated = !!loggedInUser;

  const handleLogin = async (user) => {
    try { localStorage.setItem('geomdan_tracker_user_data', JSON.stringify(user)); } catch (e) {}
    setLoggedInUser(user);
  };

  // ============ 예쁜 모달 시스템 ============
  const [modalDialog, setModalDialog] = useState(null); // { type, title, message, onConfirm, onCancel }
  
  // 전역 헬퍼 등록 (window.appConfirm / window.appAlert)
  useEffect(() => {
    window.appConfirm = (message, title = '확인') => {
      return new Promise((resolve) => {
        setModalDialog({
          type: 'confirm',
          title,
          message,
          onConfirm: () => { setModalDialog(null); resolve(true); },
          onCancel: () => { setModalDialog(null); resolve(false); }
        });
      });
    };
    window.appAlert = (message, title = '알림') => {
      return new Promise((resolve) => {
        setModalDialog({
          type: 'alert',
          title,
          message,
          onConfirm: () => { setModalDialog(null); resolve(true); }
        });
      });
    };
    return () => {
      delete window.appConfirm;
      delete window.appAlert;
    };
  }, []);

  const handleLogout = async () => {
    const ok = await window.appConfirm('로그아웃하시겠습니까?\n클라우드에 저장된 데이터는 그대로 유지됩니다.', '로그아웃');
    if (ok) {
      try {
        localStorage.removeItem('geomdan_tracker_user_data');
        localStorage.removeItem('geomdan_tracker_user');
        localStorage.removeItem('geomdan_tracker_auth');
      } catch (e) {}
      setLoggedInUser(null);
      setSupervisees([]);
      setActiveSuperviseeIdState(null);
    }
  };

  // 슈퍼바이지 목록 (Supabase에서 fetch)
  const [supervisees, setSupervisees] = useState([]);
  const [activeSuperviseeIdState, setActiveSuperviseeIdState] = useState(null);
  const [loading, setLoading] = useState(false);

  const [tab, setTab] = useState('dashboard');
  const [adminViewMode, setAdminViewMode] = useState('admin'); // 'admin' | 'user-preview' (관리자가 일반 사용자 화면 미리보기)
  const [showGuide, setShowGuide] = useState(false);
  const [showManageSv, setShowManageSv] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // 로그인 시 슈퍼바이지 목록 + 각 슈퍼바이지의 로그 fetch
  const reloadAllData = async (userId, userName, userRole) => {
    setLoading(true);
    try {
      const supList = await fetchSupervisees(userId);
      
      // 🌟 일반 사용자(user)인데 슈퍼바이지가 없으면 자동 생성 (1계정=1자격 정책)
      if (supList.length === 0 && userRole !== 'admin') {
        const created = await createSupervisee(userId, {
          name: userName || '내 자격',
          examType: 'QASP-S'
        });
        if (created) {
          supList.push(created);
        }
      }
      
      // 각 슈퍼바이지마다 필드워크/슈퍼비전 로그 fetch
      const enriched = await Promise.all(supList.map(async (sv) => {
        const [fwLogs, svLogs] = await Promise.all([
          fetchFieldworkLogs(sv.id),
          fetchSupervisionLogs(sv.id)
        ]);
        return {
          id: sv.id,
          name: sv.name,
          examType: sv.exam_type,
          mainSupervisor: sv.main_supervisor || '',
          supervisors: sv.supervisors || [],
          startDate: sv.start_date || '',
          fieldworkLogs: fwLogs,
          supervisionLogs: svLogs
        };
      }));
      setSupervisees(enriched);

      // 활성 슈퍼바이지 ID 복원
      const savedActive = getActiveSuperviseeId(userId);
      const validActive = enriched.find(s => s.id === savedActive);
      const activeId = validActive ? savedActive : (enriched[0]?.id || null);
      setActiveSuperviseeIdState(activeId);
      if (activeId !== savedActive) {
        setActiveSuperviseeId(userId, activeId);
      }
    } catch (err) {
      console.error('reloadAllData error:', err);
      showToast('데이터 로딩 실패: ' + err.message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  // 로그인 후 자동 데이터 로딩
  useEffect(() => {
    if (loggedInUser?.id) {
      reloadAllData(loggedInUser.id, loggedInUser.name, loggedInUser.role);
    }
  }, [loggedInUser?.id]);

  // 활성 슈퍼바이지 가져오기
  const activeSupervisee = useMemo(() => {
    if (!supervisees || supervisees.length === 0) return null;
    return supervisees.find(s => s.id === activeSuperviseeIdState) || supervisees[0];
  }, [supervisees, activeSuperviseeIdState]);

  // 데이터 호환용 객체 (기존 컴포넌트가 data.supervisees 등 참조)
  const data = useMemo(() => ({
    mode: 'self',
    supervisees,
    activeSuperviseeId: activeSuperviseeIdState
  }), [supervisees, activeSuperviseeIdState]);

  const exam = activeSupervisee ? EXAM_DATA[activeSupervisee.examType] : EXAM_DATA['QASP-S'];

  // 활성 슈퍼바이지 변경
  const update = (c) => {
    if ('activeSuperviseeId' in c) {
      setActiveSuperviseeIdState(c.activeSuperviseeId);
      setActiveSuperviseeId(loggedInUser?.id, c.activeSuperviseeId);
    }
  };

  // 활성 슈퍼바이지의 필드워크/슈퍼비전 로그 갱신 (낙관적 업데이트 + Supabase 동기화)
  const updateActive = async (c) => {
    if (!activeSupervisee) return;

    // 필드 변경 (이름/시험은 아니고 로그 변경)
    if ('fieldworkLogs' in c || 'supervisionLogs' in c) {
      // 로컬 즉시 반영 (낙관적 업데이트)
      setSupervisees(prev => prev.map(s =>
        s.id === activeSupervisee.id ? { ...s, ...c } : s
      ));

      // Supabase 동기화는 각 CRUD 헬퍼 함수가 처리
      // 여기서는 sub-항목별 동기화가 필요한 경우 추가 작업
      return;
    }

    // 슈퍼바이지 메타데이터 변경 (이름, 시험종류, 메인슈퍼바이저 등)
    const dbChanges = {};
    if ('name' in c) dbChanges.name = c.name;
    if ('examType' in c) dbChanges.examType = c.examType;
    if ('mainSupervisor' in c) dbChanges.mainSupervisor = c.mainSupervisor;
    if ('supervisors' in c) dbChanges.supervisors = c.supervisors;
    if ('startDate' in c) dbChanges.startDate = c.startDate;

    if (Object.keys(dbChanges).length > 0) {
      setSupervisees(prev => prev.map(s =>
        s.id === activeSupervisee.id ? { ...s, ...c } : s
      ));
      await updateSupervisee(activeSupervisee.id, dbChanges);
    }
  };

  // 슈퍼바이지 추가 (Supabase)
  const addSupervisee = async (name, examType = 'QASP-S') => {
    if (!loggedInUser?.id) return null;
    const created = await createSupervisee(loggedInUser.id, {
      name: name.trim() || '(이름 없음)',
      examType
    });
    if (!created) {
      showToast('슈퍼바이지 추가 실패', 'danger');
      return null;
    }
    const newSv = {
      id: created.id,
      name: created.name,
      examType: created.exam_type,
      mainSupervisor: created.main_supervisor || '',
      supervisors: created.supervisors || [],
      startDate: created.start_date || '',
      fieldworkLogs: [],
      supervisionLogs: []
    };
    setSupervisees(prev => [...prev, newSv]);
    // 첫 슈퍼바이지면 자동 활성화
    if (!activeSuperviseeIdState) {
      setActiveSuperviseeIdState(newSv.id);
      setActiveSuperviseeId(loggedInUser.id, newSv.id);
    }
    return newSv.id;
  };

  const removeSupervisee = async (id) => {
    const ok = await deleteSupervisee(id);
    if (!ok) {
      showToast('삭제 실패', 'danger');
      return;
    }
    setSupervisees(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSuperviseeIdState === id) {
        const newActive = filtered[0]?.id || null;
        setActiveSuperviseeIdState(newActive);
        setActiveSuperviseeId(loggedInUser?.id, newActive);
      }
      return filtered;
    });
  };

  const renameSupervisee = async (id, newName) => {
    const trimmed = (newName || '').trim() || '(이름 없음)';
    setSupervisees(prev => prev.map(s => s.id === id ? { ...s, name: trimmed } : s));
    await updateSupervisee(id, { name: trimmed });
  };

  const changeSuperviseeExam = async (id, newExamType) => {
    if (!EXAM_DATA[newExamType]) return;
    setSupervisees(prev => prev.map(s => s.id === id ? { ...s, examType: newExamType } : s));
    await updateSupervisee(id, { examType: newExamType });
  };

  // 백업 다운로드 (활성 슈퍼바이지의 데이터만)
  const exportData = () => {
    const exportPayload = {
      version: 'cloud-v1',
      exportedAt: new Date().toISOString(),
      user: { id: loggedInUser?.id, user_id: loggedInUser?.user_id, name: loggedInUser?.name },
      supervisees: supervisees,
      activeSuperviseeId: activeSuperviseeIdState
    };
    const json = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `검단ABA_백업_${todayYMD()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('백업 파일이 다운로드되었습니다', 'good');
  };

  // 엑셀 보고서 내보내기 (QABA 제출용 - 활성 슈퍼바이지 기준)
  const exportExcel = () => {
    if (!activeSupervisee) {
      showToast('먼저 슈퍼바이지를 추가하세요', 'danger');
      return;
    }
    const wb = XLSX.utils.book_new();
    const examTotal = exam.total;
    const examDirectMax = exam.directMax;
    const examIndirectMin = exam.indirectMin;
    const svRequired = stats.svRequired;
    const supervisee = activeSupervisee.name || '(미입력)';
    const mainSv = activeSupervisee.mainSupervisor || '(미입력)';
    const today = todayYMD();

    // 달성률 표시 헬퍼 (100% 초과는 100%+ 로 표시)
    const pctStr = (current, target) => {
      if (target <= 0) return '-';
      const p = (current / target) * 100;
      return p >= 100 ? '100%+' : `${p.toFixed(1)}%`;
    };

    // ============ Sheet 1: Fieldwork Log ============
    const fwSheet = [];
    fwSheet.push(['검단ABA 자격시간 트래커 - FIELDWORK LOG (필드워크 기록지)']);
    fwSheet.push([]);
    fwSheet.push(['Supervisee (슈퍼바이지)', supervisee, '', 'Supervisor (메인 슈퍼바이저)', mainSv]);
    fwSheet.push(['시험 유형', activeSupervisee.examType, '', '보고서 작성일', today]);
    fwSheet.push([]);

    // 누적 요약
    fwSheet.push(['📊 누적 요약', '현재', '목표', '달성률']);
    fwSheet.push([
      'Total Fieldwork',
      Math.round(stats.fwTotal * 10) / 10,
      examTotal,
      pctStr(stats.fwTotal, examTotal)
    ]);
    fwSheet.push([
      'Direct (직접)',
      Math.round(stats.directTotal * 10) / 10,
      `최대 ${examDirectMax}`,
      pctStr(stats.directTotal, examDirectMax)
    ]);
    fwSheet.push([
      'Indirect (간접)',
      Math.round(stats.indirectTotal * 10) / 10,
      `최소 ${examIndirectMin}`,
      pctStr(stats.indirectTotal, examIndirectMin)
    ]);
    fwSheet.push([]);
    fwSheet.push(['ℹ️ QABA 규정 안내: 월 최소 20시간 ~ 최대 140시간 인정 · 매월 슈퍼비전 5% 필수']);
    fwSheet.push([]);

    // 로그 테이블 헤더
    fwSheet.push([
      'Supervisor (슈퍼바이저)',
      'Date (날짜)',
      'Start Time (시작)',
      'End Time (종료)',
      'Fieldwork Time (총)',
      'Direct (직접)',
      'Indirect (간접)',
      'Notes (활동 내용)'
    ]);

    // 로그 데이터 (날짜순 정렬)
    const sortedFw = [...activeSupervisee.fieldworkLogs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    sortedFw.forEach(log => {
      const hrs = timeToHours(log.startTime, log.endTime);
      const rawDirect = Number(log.direct) || 0;
      const direct = Math.min(rawDirect, hrs);
      const indirect = Math.max(0, hrs - direct);
      const activities = [
        ...(log.activities || []),
        ...(log.customActivities || [])
      ].join(', ');
      fwSheet.push([
        log.supervisor || '',
        log.date || '',
        log.startTime || '',
        log.endTime || '',
        hrs > 0 ? Math.round(hrs * 100) / 100 : '',
        direct > 0 ? Math.round(direct * 100) / 100 : '',
        indirect > 0 ? Math.round(indirect * 100) / 100 : '',
        activities
      ]);
    });

    if (sortedFw.length === 0) {
      fwSheet.push(['', '', '', '', '', '', '', '(아직 입력된 회기가 없습니다)']);
    }

    const ws1 = XLSX.utils.aoa_to_sheet(fwSheet);
    // 컬럼 너비 설정 (한글 헤더 + 상단 정보 행 고려해서 넉넉하게)
    ws1['!cols'] = [
      { wch: 26, customWidth: true }, // A: Supervisor (슈퍼바이저)
      { wch: 14, customWidth: true }, // B: Date / 또는 "민다솔" 값
      { wch: 20, customWidth: true }, // C: Start Time
      { wch: 30, customWidth: true }, // D: End Time / 또는 "Supervisor (메인 슈퍼바이저)" 라벨
      { wch: 22, customWidth: true }, // E: Fieldwork Time
      { wch: 16, customWidth: true }, // F: Direct
      { wch: 18, customWidth: true }, // G: Indirect
      { wch: 65, customWidth: true }  // H: Notes
    ];
    // 병합 (제목 행)
    ws1['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }, // 제목
      { s: { r: 9, c: 0 }, e: { r: 9, c: 7 } }  // 규정 안내
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Fieldwork Log');

    // ============ Sheet 2: Supervision Log ============
    const svSheet = [];
    svSheet.push(['검단ABA 자격시간 트래커 - SUPERVISION LOG (슈퍼비전 기록지)']);
    svSheet.push([]);
    svSheet.push(['Supervisee (슈퍼바이지)', supervisee, '', 'Supervisor (메인 슈퍼바이저)', mainSv]);
    svSheet.push(['시험 유형', activeSupervisee.examType, '', '보고서 작성일', today]);
    svSheet.push([]);

    const svRequired_total = activeSupervisee.examType === 'QBA' ? 100 : 50; // 시험 총 슈퍼비전 목표 (고정)
    svSheet.push(['📊 누적 요약', '입력 시간', '인정 시간', '시험 총 목표', '달성률 (인정)']);
    svSheet.push([
      'Total Supervision',
      Math.round(stats.svTotal * 10) / 10,
      Math.round(stats.svAccepted * 10) / 10,
      svRequired_total,
      pctStr(stats.svAccepted, svRequired_total)
    ]);
    svSheet.push([
      'Individual (개별)',
      Math.round(stats.svIndividual * 10) / 10,
      Math.round(stats.svIndividual * 10) / 10,
      '-',
      '100% 인정'
    ]);
    svSheet.push([
      'Group (그룹)',
      Math.round(stats.svGroup * 10) / 10,
      Math.round(stats.svGroupAccepted * 10) / 10,
      '월별 그달 개별 ≤',
      stats.svGroupExcluded > 0 ? `⚠ ${fmt(stats.svGroupExcluded)}hr 초과 (인정 안 됨)` : '✓ 전부 인정'
    ]);
    svSheet.push([]);
    svSheet.push(['ℹ️ QABA 규정 안내: 매월 필드워크 시간의 5% 슈퍼비전 필수 · 그룹 슈퍼비전은 그 달의 개별 시간만큼만 인정 (전체의 50%까지)']);
    svSheet.push([]);

    svSheet.push([
      'Date (날짜)',
      'Type (유형)',
      'Supervisor (슈퍼바이저)',
      'Hours (시간)',
      'Notes (메모)'
    ]);

    const sortedSv = [...activeSupervisee.supervisionLogs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    sortedSv.forEach(log => {
      svSheet.push([
        log.date || '',
        log.type === 'group' ? '👥 그룹' : '👤 개별',
        log.supervisor || '',
        Number(log.hours) || '',
        log.notes || ''
      ]);
    });

    if (sortedSv.length === 0) {
      svSheet.push(['', '', '', '', '(아직 입력된 슈퍼비전이 없습니다)']);
    }

    const ws2 = XLSX.utils.aoa_to_sheet(svSheet);
    // Supervision Log 5개 컬럼 (상단 헤더 라벨 고려)
    ws2['!cols'] = [
      { wch: 26, customWidth: true }, // A: Date / 또는 "Supervisee (슈퍼바이지)" 라벨
      { wch: 16, customWidth: true }, // B: Type / 또는 "민다솔" 값
      { wch: 26, customWidth: true }, // C: Supervisor / 또는 "Supervisor (메인 슈퍼바이저)" 라벨
      { wch: 30, customWidth: true }, // D: Hours / 또는 "보고서 작성일" 영역
      { wch: 60, customWidth: true }  // E: Notes
    ];
    ws2['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
      { s: { r: 9, c: 0 }, e: { r: 9, c: 4 } }
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Supervision Log');

    // ============ Sheet 3: By Supervisor (슈퍼바이저별 요약) ============
    const bsMap = {};
    activeSupervisee.fieldworkLogs.forEach(l => {
      if (!l.supervisor) return;
      const hrs = timeToHours(l.startTime, l.endTime);
      const direct = Math.min(Number(l.direct) || 0, hrs);
      const indirect = Math.max(0, hrs - direct);
      if (!bsMap[l.supervisor]) bsMap[l.supervisor] = { fw: 0, sv: 0, svGroup: 0, svIndividual: 0, direct: 0, indirect: 0, fwCount: 0, svCount: 0 };
      bsMap[l.supervisor].fw += hrs;
      bsMap[l.supervisor].direct += direct;
      bsMap[l.supervisor].indirect += indirect;
      bsMap[l.supervisor].fwCount += 1;
    });
    activeSupervisee.supervisionLogs.forEach(l => {
      if (!l.supervisor) return;
      if (!bsMap[l.supervisor]) bsMap[l.supervisor] = { fw: 0, sv: 0, svGroup: 0, svIndividual: 0, direct: 0, indirect: 0, fwCount: 0, svCount: 0 };
      const h = Number(l.hours) || 0;
      bsMap[l.supervisor].sv += h;
      if (l.type === 'group') bsMap[l.supervisor].svGroup += h;
      else bsMap[l.supervisor].svIndividual += h;
      bsMap[l.supervisor].svCount += 1;
    });

    const bsSheet = [];
    bsSheet.push(['검단ABA 자격시간 트래커 - 슈퍼바이저별 현황']);
    bsSheet.push([]);
    bsSheet.push(['보고서 작성일', today]);
    bsSheet.push([]);
    bsSheet.push([
      'Supervisor (슈퍼바이저)',
      'Fieldwork (필드워크)',
      'Direct (직접)',
      'Indirect (간접)',
      'SV 개별',
      'SV 그룹',
      'SV 합계',
      'Total (총)',
      'FW 회기수',
      'SV 회기수'
    ]);

    const supList = Object.entries(bsMap).sort((a, b) => (b[1].fw + b[1].sv) - (a[1].fw + a[1].sv));
    supList.forEach(([name, s]) => {
      bsSheet.push([
        name,
        Math.round(s.fw * 10) / 10,
        Math.round(s.direct * 10) / 10,
        Math.round(s.indirect * 10) / 10,
        Math.round(s.svIndividual * 10) / 10,
        Math.round(s.svGroup * 10) / 10,
        Math.round(s.sv * 10) / 10,
        Math.round((s.fw + s.sv) * 10) / 10,
        s.fwCount,
        s.svCount
      ]);
    });

    if (supList.length === 0) {
      bsSheet.push(['', '', '', '', '', '', '', '', '', '(슈퍼바이저별 데이터가 없습니다)']);
    }

    const ws3 = XLSX.utils.aoa_to_sheet(bsSheet);
    ws3['!cols'] = [
      { wch: 26, customWidth: true }, // A: Supervisor (헤더 23)
      { wch: 24, customWidth: true }, // B: Fieldwork (헤더 20)
      { wch: 16, customWidth: true }, // C: Direct (헤더 13)
      { wch: 20, customWidth: true }, // D: Indirect (헤더 15)
      { wch: 14, customWidth: true }, // E: SV 개별
      { wch: 14, customWidth: true }, // F: SV 그룹
      { wch: 14, customWidth: true }, // G: SV 합계
      { wch: 14, customWidth: true }, // H: Total
      { wch: 16, customWidth: true }, // I: FW 회기수
      { wch: 16, customWidth: true }  // J: SV 회기수
    ];
    ws3['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }
    ];
    XLSX.utils.book_append_sheet(wb, ws3, 'By Supervisor');

    // ============ Sheet 4: Monthly Summary (월별 요약) ============
    const msSheet = [];
    msSheet.push(['검단ABA 자격시간 트래커 - 월별 요약']);
    msSheet.push([]);
    msSheet.push(['Supervisee', supervisee, '', '시험 유형', activeSupervisee.examType]);
    msSheet.push(['보고서 작성일', today]);
    msSheet.push([]);
    msSheet.push(['ℹ️ QABA 규정: 월별 필드워크 시간의 5%를 그 달 안에 슈퍼비전 받아야 합니다 · 월 최소 20시간 ~ 최대 140시간']);
    msSheet.push([]);
    msSheet.push([
      'Year-Month (년-월)',
      'Fieldwork (필드워크)',
      'Direct (직접)',
      'Indirect (간접)',
      'SV 개별',
      'SV 그룹',
      'SV 입력 합계',
      'SV 인정 합계',
      '5% 필요',
      '충족 여부 (인정 기준)',
      '월 한도 (20-140hr)'
    ]);

    // monthlySummary는 최신월 먼저 정렬됨, 엑셀은 오래된순이 자연
    const monthlyAsc = [...stats.monthlySummary].reverse();
    monthlyAsc.forEach(m => {
      const rangeCheck = m.fw === 0 ? '-' : (m.fw < 20 ? '⚠ 20hr 미만' : (m.fw > 140 ? '⚠ 140hr 초과' : '✓'));
      let fulfillment = m.status === 'empty' ? '-' :
                        m.status === 'good' ? '✓ 충족' :
                        `⚠ ${Math.round(-m.diff * 10) / 10}hr 부족`;
      // 그룹 초과 표시 추가
      if (m.svGroupExcluded > 0) {
        fulfillment += ` (그룹 ${Math.round(m.svGroupExcluded * 10) / 10}hr 초과)`;
      }
      msSheet.push([
        m.ym,
        Math.round(m.fw * 10) / 10,
        Math.round(m.direct * 10) / 10,
        Math.round(m.indirect * 10) / 10,
        Math.round((m.svIndividual || 0) * 10) / 10,
        Math.round((m.svGroup || 0) * 10) / 10,
        Math.round(m.sv * 10) / 10,
        Math.round((m.svAccepted || 0) * 10) / 10,
        Math.round(m.need * 10) / 10,
        fulfillment,
        rangeCheck
      ]);
    });

    if (monthlyAsc.length === 0) {
      msSheet.push(['', '', '', '', '', '', '', '', '', '', '(아직 데이터가 없습니다)']);
    }

    const ws4 = XLSX.utils.aoa_to_sheet(msSheet);
    ws4['!cols'] = [
      { wch: 22, customWidth: true }, // A: Year-Month (헤더 "Year-Month (년-월)" = 18)
      { wch: 24, customWidth: true }, // B: Fieldwork (헤더 "Fieldwork (필드워크)" = 20)
      { wch: 16, customWidth: true }, // C: Direct (헤더 "Direct (직접)" = 13)
      { wch: 20, customWidth: true }, // D: Indirect (헤더 "Indirect (간접)" = 15)
      { wch: 14, customWidth: true }, // E: SV 개별 (헤더 "SV 개별" = 7)
      { wch: 14, customWidth: true }, // F: SV 그룹
      { wch: 18, customWidth: true }, // G: SV 입력 합계 (헤더 "SV 입력 합계" = 12)
      { wch: 18, customWidth: true }, // H: SV 인정 합계
      { wch: 14, customWidth: true }, // I: 5% 필요
      { wch: 26, customWidth: true }, // J: 충족 여부 (인정 기준) - 헤더 23 + 데이터 길어질 수 있음
      { wch: 24, customWidth: true }  // K: 월 한도
    ];
    ws4['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 10 } }
    ];
    XLSX.utils.book_append_sheet(wb, ws4, 'Monthly Summary');

    // ============ 다운로드 ============
    const safeName = (supervisee && supervisee !== '(미입력)' ? supervisee.replace(/[^가-힣a-zA-Z0-9]/g, '') : '검단ABA');
    const filename = `${safeName}_${activeSupervisee.examType}_보고서_${today}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast('엑셀 보고서가 다운로드되었습니다', 'good');
  };

  const importData = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        // 신구 백업 모두 지원
        const isCloud = imported.version === 'cloud-v1' && Array.isArray(imported.supervisees);
        const isMulti = !isCloud && Array.isArray(imported.supervisees);
        const isLegacy = Array.isArray(imported.fieldworkLogs) && Array.isArray(imported.supervisionLogs);
        if (!isCloud && !isMulti && !isLegacy) {
          showToast('올바른 백업 파일이 아닙니다', 'danger');
          return;
        }
        if (!await window.appConfirm('이 백업 파일의 내용을 클라우드에 추가할까요?\n(기존 데이터에 추가됩니다. 중복 방지를 위해 백업 전 클라우드 데이터를 정리하세요)')) {
          return;
        }

        // 마이그레이션 (레거시 → 신규 구조)
        let svList = [];
        if (isCloud || isMulti) {
          svList = imported.supervisees;
        } else if (isLegacy) {
          svList = [{
            name: imported.superviseeName || '(이름 없음)',
            examType: imported.examType || 'QASP-S',
            mainSupervisor: imported.mainSupervisor || '',
            supervisors: imported.supervisors || [],
            startDate: imported.startDate || '',
            fieldworkLogs: imported.fieldworkLogs,
            supervisionLogs: imported.supervisionLogs
          }];
        }

        setLoading(true);
        let importedCount = 0;
        for (const sv of svList) {
          // 1. 슈퍼바이지 생성
          const created = await createSupervisee(loggedInUser.id, {
            name: sv.name,
            examType: sv.examType || sv.exam_type || 'QASP-S',
            mainSupervisor: sv.mainSupervisor || sv.main_supervisor || '',
            supervisors: sv.supervisors || [],
            startDate: sv.startDate || sv.start_date || ''
          });
          if (!created) continue;

          // 2. 필드워크 로그 일괄 추가
          for (const log of (sv.fieldworkLogs || [])) {
            await createFieldworkLog(created.id, {
              date: log.date,
              startTime: log.startTime || log.start_time,
              endTime: log.endTime || log.end_time,
              direct: log.direct,
              supervisor: log.supervisor,
              activities: log.activities || [],
              customActivities: log.customActivities || log.custom_activities || []
            });
          }

          // 3. 슈퍼비전 로그 일괄 추가
          for (const log of (sv.supervisionLogs || [])) {
            await createSupervisionLog(created.id, {
              date: log.date,
              hours: log.hours,
              type: log.type,
              supervisor: log.supervisor,
              notes: log.notes
            });
          }
          importedCount++;
        }

        showToast(`✅ ${importedCount}명의 슈퍼바이지 데이터가 복원되었습니다`, 'good');
        await reloadAllData(loggedInUser.id, loggedInUser.name, loggedInUser.role);
      } catch (err) {
        console.error('importData error:', err);
        showToast('파일을 읽을 수 없습니다: ' + err.message, 'danger');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // 통계 계산 (활성 슈퍼바이지 기준)
  const stats = useMemo(() => {
    // 활성 슈퍼바이지 없으면 빈 통계
    if (!activeSupervisee) {
      return {
        fwTotal: 0, directTotal: 0, indirectTotal: 0,
        svTotal: 0, svRequired: 0, svGroup: 0, svIndividual: 0, svGroupPct: 0, svGroupOver: false,
        svAccepted: 0, svGroupAccepted: 0, svGroupExcluded: 0,
        weeklyPace: 0, remaining: 0, estCompletion: '-',
        monthsShort: [], monthlySummary: []
      };
    }

    const fieldworkLogs = activeSupervisee.fieldworkLogs || [];
    const supervisionLogs = activeSupervisee.supervisionLogs || [];

    // 필드워크 누적
    let fwTotal = 0;
    let directTotal = 0;
    let indirectTotal = 0;

    fieldworkLogs.forEach(l => {
      const hrs = timeToHours(l.startTime, l.endTime);
      const direct = Math.min(Number(l.direct) || 0, hrs);
      const indirect = Math.max(0, hrs - direct);
      fwTotal += hrs;
      directTotal += direct;
      indirectTotal += indirect;
    });

    // 슈퍼비전 (그룹/개별 분리)
    let svTotal = 0;
    let svGroup = 0;
    let svIndividual = 0;
    supervisionLogs.forEach(l => {
      const h = Number(l.hours) || 0;
      svTotal += h;
      if (l.type === 'group') svGroup += h;
      else svIndividual += h;
    });

    // 슈퍼비전 5% 요구 (전체 필드워크 기준)
    const svRequired = fwTotal * (exam.svPercent / 100);
    // 그룹 슈퍼비전 비율 (총 슈퍼비전 대비) - 참고용
    const svGroupPct = svTotal > 0 ? (svGroup / svTotal) * 100 : 0;

    // 월별 데이터 (그룹/개별 분리 + 월별 인정 시간)
    // ⚠ QABA 규정: 그룹 50% 한도는 월별 단위 적용
    const monthMap = {};
    fieldworkLogs.forEach(l => {
      if (!l.date) return;
      const ym = l.date.substring(0, 7);
      const hrs = timeToHours(l.startTime, l.endTime);
      const direct = Math.min(Number(l.direct) || 0, hrs);
      const indirect = Math.max(0, hrs - direct);
      if (!monthMap[ym]) monthMap[ym] = { ym, fw: 0, sv: 0, svAccepted: 0, svGroup: 0, svIndividual: 0, svGroupExcluded: 0, direct: 0, indirect: 0 };
      monthMap[ym].fw += hrs;
      monthMap[ym].direct += direct;
      monthMap[ym].indirect += indirect;
    });
    supervisionLogs.forEach(l => {
      if (!l.date) return;
      const ym = l.date.substring(0, 7);
      if (!monthMap[ym]) monthMap[ym] = { ym, fw: 0, sv: 0, svAccepted: 0, svGroup: 0, svIndividual: 0, svGroupExcluded: 0, direct: 0, indirect: 0 };
      const h = Number(l.hours) || 0;
      monthMap[ym].sv += h;
      if (l.type === 'group') monthMap[ym].svGroup += h;
      else monthMap[ym].svIndividual += h;
    });
    // 월별 인정 시간 계산 (그룹은 그 달의 개별 시간만큼만)
    Object.values(monthMap).forEach(m => {
      const monthGroupAccepted = Math.min(m.svGroup, m.svIndividual);
      m.svGroupExcluded = m.svGroup - monthGroupAccepted;
      m.svAccepted = m.svIndividual + monthGroupAccepted;
    });
    const monthlyArr = Object.values(monthMap).sort((a, b) => a.ym.localeCompare(b.ym));

    // ⭐ 전체 인정 시간 = 월별 인정 시간의 합 (정확한 QABA 규정)
    const svAccepted = monthlyArr.reduce((s, m) => s + m.svAccepted, 0);
    const svGroupAccepted = monthlyArr.reduce((s, m) => s + (m.svGroup - m.svGroupExcluded), 0);
    const svGroupExcluded = monthlyArr.reduce((s, m) => s + m.svGroupExcluded, 0);
    const svGroupOver = svGroupExcluded > 0; // 어느 달이든 초과한 경우

    // 페이스 - 최근 4주 페이스로 계산 (더 정확한 트렌드 반영)
    const now = new Date();
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

    // 최근 4주 동안의 필드워크
    const recentFw = fieldworkLogs.reduce((s, l) => {
      if (!l.date) return s;
      const logDate = parseLocalDate(l.date);
      if (logDate >= fourWeeksAgo && logDate <= now) {
        return s + timeToHours(l.startTime, l.endTime);
      }
      return s;
    }, 0);

    // 최근 4주 페이스 (실제 데이터 있는 주 수로 나눔)
    // 첫 회기가 4주 안에 있으면 그 기간만큼만, 아니면 4주 전체
    const dates = fieldworkLogs.map(l => l.date).filter(Boolean).sort();
    let recentWeeks = 4;
    if (dates.length > 0) {
      const firstDate = parseLocalDate(dates[0]);
      if (firstDate > fourWeeksAgo) {
        recentWeeks = Math.max(1, Math.ceil((now - firstDate) / (7 * 24 * 60 * 60 * 1000)));
      }
    }
    const weeklyPace = recentFw / recentWeeks;
    const remaining = Math.max(0, exam.total - fwTotal);

    let estCompletion = '-';
    if (weeklyPace > 0 && remaining > 0) {
      const weeksRemaining = remaining / weeklyPace;
      // QABA 누적 기간 7년 = 365주 기준
      if (weeksRemaining <= 365) {
        const target = new Date(Date.now() + weeksRemaining * 7 * 24 * 60 * 60 * 1000);
        estCompletion = dateToYMD(target);
      } else {
        estCompletion = '🐢 페이스 부족 (7년 초과)';
      }
    } else if (remaining === 0) {
      estCompletion = '✅ 달성!';
    } else if (recentFw === 0 && fwTotal > 0) {
      estCompletion = '⏸ 최근 4주 기록 없음';
    }

    const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 월별 5% 미충족 분석 (지난달 까지만, 인정 시간 기준)
    const monthsShort = monthlyArr.filter(m => {
      if (m.ym >= thisYM) return false; // 이번 달은 진행 중이라 제외
      if (m.fw === 0) return false; // 필드워크 없으면 슈퍼비전 의무도 없음
      const needed = m.fw * (exam.svPercent / 100);
      return m.svAccepted < needed - 0.01;
    }).map(m => ({
      ym: m.ym,
      fw: m.fw,
      sv: m.svAccepted, // 인정 시간 기준
      svInput: m.sv, // 입력된 총 시간
      svGroupExcluded: m.svGroupExcluded,
      needed: Math.round(m.fw * (exam.svPercent / 100) * 10) / 10,
      shortage: Math.round((m.fw * (exam.svPercent / 100) - m.svAccepted) * 10) / 10
    }));

    // 월별 요약 (대시보드/엑셀에 표시용 - 최신월 먼저, 인정 시간 기준)
    const monthlySummary = monthlyArr.map(m => {
      const need = m.fw * (exam.svPercent / 100);
      const diff = m.svAccepted - need;
      return {
        ym: m.ym,
        fw: m.fw,
        sv: m.sv, // 입력된 총
        svAccepted: m.svAccepted, // 인정
        svGroup: m.svGroup,
        svIndividual: m.svIndividual,
        svGroupExcluded: m.svGroupExcluded,
        direct: m.direct,
        indirect: m.indirect,
        need: Math.round(need * 10) / 10,
        diff: Math.round(diff * 10) / 10,
        status: m.fw === 0 ? 'empty' : (diff >= -0.1 ? 'good' : 'short')
      };
    }).reverse(); // 최신월이 위에

    return {
      fwTotal, directTotal, indirectTotal,
      svTotal, svRequired, svGroup, svIndividual, svGroupPct, svGroupOver,
      svAccepted, svGroupAccepted, svGroupExcluded,
      weeklyPace, remaining, estCompletion,
      monthsShort,
      monthlySummary
    };
  }, [activeSupervisee, exam]);

  // 🔄 초기 인증 체크 중 로딩 화면
  if (authChecking) {
    return (
      <div style={{ fontFamily: '"Pretendard", "맑은 고딕", sans-serif', background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 32 }}>🔄</div>
        <div style={{ fontSize: 13, color: C.grayText }}>잠시만 기다려주세요...</div>
      </div>
    );
  }

  // 🔒 인증 안 됐으면 로그인 화면 표시
  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // 🔄 데이터 로딩 중 (로그인 직후)
  if (loading && supervisees.length === 0) {
    return (
      <div style={{ fontFamily: '"Pretendard", "맑은 고딕", sans-serif', background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 32 }}>☁️</div>
        <div style={{ fontSize: 14, color: C.plumDark, fontWeight: 600 }}>클라우드에서 데이터를 불러오는 중...</div>
        <div style={{ fontSize: 11, color: C.grayText }}>잠시만 기다려주세요</div>
      </div>
    );
  }

  // 🔐 관리자 페이지 (admin 역할이고 admin 모드일 때)
  if (loggedInUser?.role === 'admin' && adminViewMode === 'admin') {
    return (
      <>
        <AdminPage
          currentUser={loggedInUser}
          onLogout={handleLogout}
          onSwitchToUserMode={() => setAdminViewMode('user-preview')}
        />
        {modalDialog && <AppDialog {...modalDialog} />}
        {toast && <Toast {...toast} />}
      </>
    );
  }

  return (
    <div style={{ fontFamily: '"Pretendard", "맑은 고딕", -apple-system, sans-serif', background: C.bg, minHeight: '100vh', color: C.grayText }}>
      <header style={{ background: C.white, borderBottom: `1px solid ${C.pinkLight}`, padding: '24px 0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="검단ABA"
                 style={{ width: 56, height: 56, objectFit: 'contain', flexShrink: 0 }} />
            <div>
              <h1 style={{ margin: 0, fontSize: 24, color: C.pinkDeep, fontWeight: 700, letterSpacing: '-0.02em' }}>검단ABA 자격시간 트래커</h1>
              <p style={{ margin: '6px 0 0 0', fontSize: 13, color: C.plumDark }}>QBA · QASP-S 자격 준비 보조</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* 슈퍼바이지 드롭다운/관리는 관리자만 (일반 사용자는 본인 1명 고정) */}
            {loggedInUser?.role === 'admin' && data.supervisees && data.supervisees.length > 0 && (
              <>
                <select value={data.activeSuperviseeId || ''}
                        onChange={e => update({ activeSuperviseeId: e.target.value })}
                        title="현재 보고 있는 슈퍼바이지"
                        style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: C.plumDark, background: C.pinkSoft, border: `1.5px solid ${C.pinkLight}`, borderRadius: 8, cursor: 'pointer', outline: 'none', maxWidth: 180 }}>
                  {data.supervisees.map(sv => (
                    <option key={sv.id} value={sv.id}>👤 {sv.name} ({sv.examType})</option>
                  ))}
                </select>
                <button onClick={() => setShowManageSv(true)} title="슈퍼바이지 추가·삭제·이름 변경"
                        style={headerBtnStyle}>👥</button>
              </>
            )}
            {loggedInUser?.role === 'admin' && data.supervisees && data.supervisees.length === 0 && (
              <button onClick={() => setShowManageSv(true)}
                      style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: C.white, background: C.pinkDeep, border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                + 첫 슈퍼바이지 추가
              </button>
            )}
            {activeSupervisee && (
              <select value={activeSupervisee.examType} onChange={async (e) => {
                const newExam = e.target.value;
                const hasData = (activeSupervisee.fieldworkLogs || []).length > 0 || (activeSupervisee.supervisionLogs || []).length > 0;
                if (!hasData || await window.appConfirm(`시험을 ${newExam}로 변경하시겠습니까?\n\n• 기존 입력 데이터는 그대로 유지됩니다\n• 자격 기준(총 시간, Direct/Indirect 한도 등)만 바뀝니다`)) {
                  changeSuperviseeExam(activeSupervisee.id, newExam);
                }
              }}
                      style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: C.pinkDeep, background: C.inputBg, border: `1.5px solid ${C.pinkGold}`, borderRadius: 8, cursor: 'pointer', outline: 'none' }}>
                <option value="QBA">QBA · 2,000hr</option>
                <option value="QASP-S">QASP-S · 1,000hr</option>
              </select>
            )}
            <button onClick={exportExcel} title="QABA 제출용 엑셀 보고서 다운로드 (.xlsx)"
                    style={headerBtnStyle} disabled={!activeSupervisee}>📊</button>
            <button onClick={exportData} title="전체 데이터 JSON 백업 다운로드 (복원 가능)"
                    style={headerBtnStyle}>💾</button>
            <button onClick={() => fileInputRef.current?.click()} title="백업 파일을 불러와서 복원"
                    style={headerBtnStyle}>📂</button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={importData} style={{ display: 'none' }} />
            <button onClick={() => setShowGuide(true)} title="사용 안내 보기"
                    style={headerBtnStyle}>📖</button>
            {/* 관리자가 미리보기 모드일 때 돌아가기 버튼 */}
            {loggedInUser?.role === 'admin' && (
              <button onClick={() => setAdminViewMode('admin')} 
                      title="관리자 페이지로 돌아가기"
                      style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: C.white, background: C.goldDeep, border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                🔐 관리자 페이지
              </button>
            )}
            <button onClick={handleLogout} 
                    title={`로그아웃 (현재: ${loggedInUser?.name || loggedInUser?.user_id})`}
                    style={{ ...headerBtnStyle, display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', fontSize: 12 }}>
              🔒 <span style={{ fontSize: 11, color: C.plumDark }}>{loggedInUser?.name || loggedInUser?.user_id}</span>
            </button>
          </div>
        </div>
      </header>

      <nav style={{ background: C.white, borderBottom: `1px solid ${C.pinkLight}`, display: 'flex', maxWidth: 1200, margin: '0 auto', padding: '0 24px', gap: 4, overflowX: 'auto' }}>
        {[
          { id: 'dashboard', l: '📊 대시보드' },
          ...(loggedInUser?.role === 'admin' && data.supervisees && data.supervisees.length >= 2 ? [{ id: 'overview', l: '👥 전체 현황' }] : []),
          { id: 'fieldwork', l: '📋 필드워크' },
          { id: 'supervision', l: '🎓 슈퍼비전' },
          { id: 'info', l: '📚 시험 정보' }
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ padding: '14px 22px', fontSize: 14, color: tab === t.id ? C.pinkDeep : C.grayText, background: 'transparent', border: 'none',
                           borderBottom: tab === t.id ? `2.5px solid ${C.pinkDeep}` : '2.5px solid transparent',
                           cursor: 'pointer', fontWeight: tab === t.id ? 600 : 500, whiteSpace: 'nowrap', transition: 'all 0.15s' }}>{t.l}</button>
        ))}
      </nav>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* 슈퍼바이저 자동완성 목록 (활성 슈퍼바이지 기준) */}
        <datalist id="supervisor-list">
          {(() => {
            if (!activeSupervisee) return null;
            const set = new Set();
            if (activeSupervisee.mainSupervisor) set.add(activeSupervisee.mainSupervisor);
            (activeSupervisee.supervisors || []).forEach(s => set.add(s));
            (activeSupervisee.fieldworkLogs || []).forEach(l => { if (l.supervisor) set.add(l.supervisor); });
            (activeSupervisee.supervisionLogs || []).forEach(l => { if (l.supervisor) set.add(l.supervisor); });
            return Array.from(set).map(s => <option key={s} value={s} />);
          })()}
        </datalist>

        {!activeSupervisee ? (
          <EmptyStateNoSupervisee onAdd={() => setShowManageSv(true)} />
        ) : (
          <>
            {tab === 'dashboard' && <Dashboard activeSupervisee={activeSupervisee} stats={stats} exam={exam} updateActive={updateActive} />}
            {tab === 'overview' && <OverviewTab supervisees={data.supervisees} onSelect={(id) => { update({ activeSuperviseeId: id }); setTab('dashboard'); }} />}
            {tab === 'fieldwork' && <FieldworkLog activeSupervisee={activeSupervisee} exam={exam} updateActive={updateActive} />}
            {tab === 'supervision' && <SupervisionLog activeSupervisee={activeSupervisee} updateActive={updateActive} />}
            {tab === 'info' && <ExamInfoTab currentExam={activeSupervisee.examType} />}
          </>
        )}
      </main>

      <footer style={{ background: C.pinkPale, padding: '28px 24px', textAlign: 'center', borderTop: `1px solid ${C.pinkLight}`, marginTop: 40 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.plumDark, marginBottom: 6 }}>© 검단ABA언어행동연구소 · All Rights Reserved</div>
        <div style={{ fontSize: 11, color: '#8B3A3A', marginBottom: 4 }}>본 자료는 검단ABA언어행동연구소의 지적재산입니다. 무단 복제·배포·재판매·온라인 게시를 엄격히 금지합니다.</div>
        <div style={{ fontSize: 10, color: C.grayText, fontStyle: 'italic' }}>위반 시 저작권법에 따라 민·형사상 책임을 묻습니다.</div>
      </footer>

      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
      {showManageSv && (
        <ManageSuperviseesModal
          supervisees={data.supervisees || []}
          activeId={data.activeSuperviseeId}
          onAdd={addSupervisee}
          onRemove={removeSupervisee}
          onRename={renameSupervisee}
          onChangeExam={changeSuperviseeExam}
          onSelect={(id) => update({ activeSuperviseeId: id })}
          onClose={() => setShowManageSv(false)}
        />
      )}
      {toast && <Toast {...toast} />}
      {modalDialog && <AppDialog {...modalDialog} />}
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

// ============================================
// 🎨 AppDialog - 예쁜 confirm/alert 모달
// ============================================
function AppDialog({ type, title, message, onConfirm, onCancel }) {
  const isConfirm = type === 'confirm';
  
  // ESC 키로 닫기
  useEffect(() => {
    const handler = async (e) => {
      if (e.key === 'Escape') {
        if (isConfirm && onCancel) onCancel();
        else if (!isConfirm && onConfirm) onConfirm();
      } else if (e.key === 'Enter') {
        if (onConfirm) onConfirm();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isConfirm, onConfirm, onCancel]);
  
  return (
    <div 
      onClick={async () => { if (isConfirm && onCancel) onCancel(); }}
      style={{ 
        position: 'fixed', inset: 0, 
        background: 'rgba(0,0,0,0.5)', 
        display: 'flex', alignItems: 'center', justifyContent: 'center', 
        zIndex: 3000, padding: 20,
        animation: 'fadeIn 0.15s ease-out'
      }}>
      <div 
        onClick={e => e.stopPropagation()} 
        style={{ 
          background: C.white, borderRadius: 14, 
          maxWidth: 420, width: '100%', 
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
          overflow: 'hidden',
          animation: 'slideUp 0.2s ease-out'
        }}>
        {/* 상단: 제목 영역 */}
        <div style={{ 
          padding: '20px 24px 14px 24px', 
          borderBottom: `1px solid ${C.pinkLight}`,
          background: `linear-gradient(135deg, ${C.pinkSoft} 0%, ${C.pinkPale} 100%)`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>{isConfirm ? '❓' : '💬'}</span>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.pinkDeep }}>
              {title}
            </h3>
          </div>
        </div>
        
        {/* 본문 */}
        <div style={{ 
          padding: '20px 24px', 
          fontSize: 14, 
          color: C.grayHead, 
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          maxHeight: '60vh',
          overflowY: 'auto'
        }}>
          {message}
        </div>
        
        {/* 버튼 영역 */}
        <div style={{ 
          padding: '14px 24px 18px 24px', 
          display: 'flex', 
          gap: 8, 
          justifyContent: 'flex-end',
          borderTop: `1px solid ${C.pinkSoft}`,
          background: C.pinkPale
        }}>
          {isConfirm && (
            <button onClick={onCancel}
                    style={{ 
                      padding: '10px 20px', fontSize: 13, fontWeight: 600, 
                      color: C.grayHead, background: C.white, 
                      border: `1px solid #E0D5D8`, borderRadius: 8, 
                      cursor: 'pointer', fontFamily: 'inherit',
                      minWidth: 80
                    }}>
              취소
            </button>
          )}
          <button onClick={onConfirm}
                  autoFocus
                  style={{ 
                    padding: '10px 22px', fontSize: 13, fontWeight: 700, 
                    color: C.white, background: C.pinkDeep, 
                    border: 'none', borderRadius: 8, 
                    cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: '0 2px 6px rgba(216,136,150,0.25)',
                    minWidth: 80
                  }}>
            {isConfirm ? '확인' : '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// 🎉 환영/시작 안내 카드
// ============================================
function WelcomeCard({ examType, superviseeName }) {
  const isQASP = examType === 'QASP-S';
  return (
    <div style={{
      background: `linear-gradient(135deg, ${C.pinkSoft} 0%, ${C.pinkPale} 100%)`,
      border: `1px solid ${C.pinkLight}`,
      borderRadius: 16,
      padding: 28
    }}>
      <h2 style={{ margin: '0 0 12px 0', color: C.pinkDeep, fontSize: 22, fontWeight: 700 }}>
        🎉 환영합니다{superviseeName ? `, ${superviseeName}님!` : '!'}
      </h2>
      <p style={{ margin: '0 0 20px 0', fontSize: 14, color: C.plumDark, lineHeight: 1.7 }}>
        자격 준비, 한 걸음씩 함께 가요. <strong>{examType}</strong> 자격 취득까지 이 트래커가 도와드릴게요.<br/>
        <span style={{ fontSize: 13, color: C.grayText }}>아래 3단계로 시작해보세요 ✨</span>
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <StartStep num="1" title="시험 종류 확인하기" desc="우측 상단에서 본인의 시험을 선택해주세요 (QBA / QASP-S 변경 가능)" />
        <StartStep num="2" title="슈퍼바이저 정보 적기" desc="아래 메인 슈퍼바이저 이름을 입력하면 자동완성에 도움이 돼요" />
        <StartStep num="3" title="매일 기록하기" desc="📋 필드워크 · 🎓 슈퍼비전 탭에서 시간을 입력하면 자동으로 진행률이 계산돼요" />
      </div>
      <div style={{ marginTop: 16, padding: 14, background: C.white, borderRadius: 8, fontSize: 12, color: C.grayHead, lineHeight: 1.7 }}>
        <div style={{ fontWeight: 700, color: C.plumDark, marginBottom: 4 }}>📚 {examType} 자격 요건 한눈에</div>
        ✅ 필드워크 <strong>{isQASP ? '1,000' : '2,000'}시간</strong>
        {isQASP
          ? ' (이 중 슈퍼바이저 역할 600hr+)'
          : ' (Direct 800hr 이하 / Indirect 1,200hr 이상)'}<br/>
        ✅ 매월 슈퍼비전 <strong>5%</strong> 필수 · 총 <strong>{isQASP ? '50' : '100'}시간</strong>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: C.grayText, fontStyle: 'italic', textAlign: 'right' }}>
        🛟 도움이 필요하면 우측 상단 <strong>📖</strong> 버튼을 눌러주세요
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
            padding: '8px 12px', background: C.white, borderRadius: 6, fontSize: 12, flexWrap: 'wrap', gap: 4
          }}>
            <span style={{ color: C.plumDark, fontWeight: 600 }}>{m.ym}</span>
            <span style={{ color: C.grayText }}>
              필드워크 {fmt(m.fw)}hr · 슈퍼비전 인정 <strong>{fmt(m.sv)}</strong>/{fmt(m.needed)}hr
              {m.svGroupExcluded > 0 && <span style={{ color: C.dangerRed, fontSize: 11 }}> (그룹 {fmt(m.svGroupExcluded)}hr 초과)</span>}
              <strong style={{ color: C.dangerRed, marginLeft: 4 }}> · {fmt(m.shortage)}hr 부족</strong>
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: '#8A6D2A', fontStyle: 'italic' }}>
        💡 슈퍼비전은 매월 단위로 5%를 충족해야 합니다. <strong>그룹 슈퍼비전은 그 달의 개별 시간만큼만 인정</strong>되므로, 그룹이 많은 달은 부족할 수 있어요.
      </div>
    </div>
  );
}

// ============================================
// 📊 DASHBOARD
// ============================================
function Dashboard({ activeSupervisee, stats, exam, updateActive }) {
  const data = activeSupervisee; // 내부에선 data로 사용 (기존 코드 호환)
  const update = updateActive;
  const hasNoData = data.fieldworkLogs.length === 0 && data.supervisionLogs.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. 빈 상태 환영 카드 */}
      {hasNoData && <WelcomeCard examType={data.examType} superviseeName={data.name} />}

      {/* 2. 월별 5% 미충족 경고 */}
      {stats.monthsShort && stats.monthsShort.length > 0 && (
        <MonthlyShortAlert monthsShort={stats.monthsShort} />
      )}

      {/* 3. 사용자 정보 (컴팩트) */}
      <CompactUserInfo data={data} update={update} />

      {/* 한눈에 보기 */}
      <Section title="🎯 한눈에 보기">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <BigProgressBar
            icon="📋"
            label="필드워크"
            current={stats.fwTotal}
            target={exam.total}
            color={C.pinkDeep}
            bgColor={C.pinkSoft}
            unit="hr"
            extraInfo={stats.fwTotal > 0 ? (
              data.examType === 'QASP-S' ? [
                { label: '1:1 직접 케어 (최대)', value: stats.directTotal, max: exam.directMax, color: C.goldDeep, isMax: true },
                { label: '슈퍼바이저 역할 (최소)', value: stats.indirectTotal, min: exam.indirectMin, color: C.goodGreen }
              ] : [
                { label: 'Direct 직접 (최대)', value: stats.directTotal, max: exam.directMax, color: C.goldDeep, isMax: true },
                { label: 'Indirect 간접 (최소)', value: stats.indirectTotal, min: exam.indirectMin, color: C.goodGreen }
              ]
            ) : null}
          />
          <BigProgressBar
            icon="🎓"
            label="슈퍼비전 (누적 인정 시간)"
            sublabel={`${exam === EXAM_DATA['QBA'] ? 'QBA' : 'QASP-S'} 최종 필요 슈퍼비전: ${fmt(exam.total * exam.svPercent / 100)}hr (필드워크 ${exam.total}hr × 5%)`}
            current={stats.svAccepted}
            target={exam.total * exam.svPercent / 100}
            color={C.plumDark}
            bgColor={C.pinkSoft}
            unit="hr"
            isPercent={true}
            note={stats.svGroupExcluded > 0 ? `⚠ 그룹 ${fmt(stats.svGroupExcluded)}hr은 월별 한도 초과로 인정 안 됨 (입력 ${fmt(stats.svTotal)}hr → 인정 ${fmt(stats.svAccepted)}hr) · 자세한 월별 충족 여부는 아래 월별 요약 참고` : (stats.svTotal > 0 ? `💡 QABA는 매월 단위로 5% 충족을 평가합니다. 위 진행률은 누적 참고용이며, 월별 미충족 여부는 아래 표에서 확인하세요` : null)}
            extraInfo={stats.svTotal > 0 ? [
              { label: '👤 개별 (Individual)', value: stats.svIndividual, color: C.goldDeep, plain: true, hint: `전체 입력의 ${(100 - stats.svGroupPct).toFixed(0)}%` },
              { label: '👥 그룹 (Group, 월별 50%)', value: stats.svGroup, color: stats.svGroupOver ? C.dangerRed : C.plumDark, plain: true, hint: stats.svGroupOver ? `⚠ 인정 ${fmt(stats.svGroupAccepted)}hr만 (${fmt(stats.svGroupExcluded)}hr 초과)` : `전체의 ${stats.svGroupPct.toFixed(0)}%` }
            ] : null}
          />
        </div>

        {/* 페이스 + 시작일 (하단 작게) */}
        <div style={{ marginTop: 20, padding: 14, background: C.pinkPale, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600 }}>📅 시작일</span>
            <input type="date" value={data.startDate || ''} onChange={e => update({ startDate: e.target.value })}
                   style={{ ...inputStyle, width: 'auto', padding: '6px 10px', fontSize: 12 }} />
          </div>
          {stats.fwTotal > 0 ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="최근 4주 동안의 주당 평균 필드워크 시간">
                <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600 }}>⚡ 최근 페이스</span>
                <strong style={{ fontSize: 14, color: C.plumDark }}>{fmt(stats.weeklyPace)} hr/주</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="현재 페이스를 유지했을 때 목표 달성 예상일">
                <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600 }}>🎯 예상 완료</span>
                <strong style={{ fontSize: 14, color: C.plumDark }}>{stats.estCompletion}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600 }}>⏳ 남은 시간</span>
                <strong style={{ fontSize: 14, color: C.plumDark }}>{fmtI(stats.remaining)} hr</strong>
              </div>
            </>
          ) : (
            <span style={{ fontSize: 12, color: C.grayText, fontStyle: 'italic' }}>
              필드워크 기록을 추가하면 주당 페이스·예상 완료일이 자동 계산됩니다
            </span>
          )}
        </div>
      </Section>

      {/* 월별 요약 */}
      {stats.monthlySummary.length > 0 && (
        <Section title="📅 월별 요약">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.pinkLight}` }}>
                  <th style={thStyle}>월</th>
                  <th style={thStyle}>필드워크</th>
                  <th style={thStyle}>직접</th>
                  <th style={thStyle}>간접</th>
                  <th style={thStyle}>SV 입력 / 인정</th>
                  <th style={thStyle}>5% 필요</th>
                  <th style={thStyle}>충족 여부</th>
                </tr>
              </thead>
              <tbody>
                {stats.monthlySummary.map((m, i) => (
                  <tr key={m.ym} style={{ borderBottom: `1px solid ${C.pinkSoft}` }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: C.plumDark }}>{m.ym}</td>
                    <td style={tdStyle}>{fmt(m.fw)} hr</td>
                    <td style={{ ...tdStyle, color: C.goldDeep }}>{fmt(m.direct)}</td>
                    <td style={{ ...tdStyle, color: C.goodGreen }}>{fmt(m.indirect)}</td>
                    <td style={tdStyle}>
                      <strong style={{ color: C.plumDark }}>{fmt(m.svAccepted)}</strong>
                      {m.svGroupExcluded > 0 ? (
                        <span style={{ fontSize: 11, color: C.dangerRed, marginLeft: 4 }}>
                          (입력 {fmt(m.sv)}, 그룹 {fmt(m.svGroupExcluded)} 초과)
                        </span>
                      ) : (
                        m.sv !== m.svAccepted && <span style={{ fontSize: 11, color: C.grayText, marginLeft: 4 }}>({fmt(m.sv)})</span>
                      )}
                    </td>
                    <td style={tdStyle}>{fmt(m.need)} hr</td>
                    <td style={tdStyle}>
                      {m.status === 'good' ? (
                        <span style={{ color: C.goodGreen, fontWeight: 600 }}>✓ 충족</span>
                      ) : m.status === 'short' ? (
                        <span style={{ color: C.warnYellow, fontWeight: 600 }}>⚠ {fmt(-m.diff)}hr 부족</span>
                      ) : (
                        <span style={{ color: C.grayText }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: '12px 0 0 0', fontSize: 11, color: C.grayText, fontStyle: 'italic' }}>
            💡 QABA 규정: 월별 필드워크 시간의 5%를 그 달 안에 슈퍼비전 받아야 합니다 · 그룹 슈퍼비전은 그 달의 개별 시간만큼만 인정 (50% 한도) · 월 최소 20시간 ~ 최대 140시간
          </p>
        </Section>
      )}

      {/* 슈퍼바이저별 미니 요약 - 2명 이상일 때만 */}
      <SupervisorMiniSummary data={data} />
    </div>
  );
}

// SupervisorMiniSummary - 슈퍼바이저 2명 이상일 때만 대시보드에 표시
function SupervisorMiniSummary({ data }) {
  const bySup = useMemo(() => {
    const m = {};
    data.fieldworkLogs.forEach(l => {
      if (!l.supervisor) return;
      const hrs = timeToHours(l.startTime, l.endTime);
      if (!m[l.supervisor]) m[l.supervisor] = { supervisor: l.supervisor, fw: 0, sv: 0 };
      m[l.supervisor].fw += hrs;
    });
    data.supervisionLogs.forEach(l => {
      if (!l.supervisor) return;
      if (!m[l.supervisor]) m[l.supervisor] = { supervisor: l.supervisor, fw: 0, sv: 0 };
      m[l.supervisor].sv += Number(l.hours) || 0;
    });
    return Object.values(m).sort((a, b) => (b.fw + b.sv) - (a.fw + a.sv));
  }, [data.fieldworkLogs, data.supervisionLogs]);

  // 2명 이상일 때만 표시 (1명이면 의미 없음)
  if (bySup.length < 2) return null;

  const allTotal = bySup.reduce((s, x) => s + x.fw + x.sv, 0);

  return (
    <Section title="📂 슈퍼바이저별 (2명 이상)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bySup.map((s, i) => {
          const total = s.fw + s.sv;
          const sharePct = allTotal > 0 ? (total / allTotal) * 100 : 0;
          return (
            <div key={i} style={{
              padding: 14, background: C.pinkPale, borderRadius: 10,
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'
            }}>
              <div style={{ minWidth: 100, fontWeight: 700, color: C.plumDark }}>
                👤 {s.supervisor}
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ height: 8, background: C.white, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${sharePct}%`,
                    background: `linear-gradient(90deg, ${C.pinkDeep} 0%, ${C.pinkMid} 100%)`,
                    borderRadius: 4,
                    transition: 'width 0.5s'
                  }} />
                </div>
              </div>
              <div style={{ fontSize: 13, color: C.grayText, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ color: C.pinkDeep }}><strong>{fmt(s.fw)}</strong> 필드</span>
                <span style={{ color: C.plumDark }}><strong>{fmt(s.sv)}</strong> 슈퍼비전</span>
                <span style={{ fontSize: 12, color: C.grayText }}>({sharePct.toFixed(0)}%)</span>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// 테이블 셀 스타일
const thStyle = {
  padding: '10px 8px', textAlign: 'left', fontSize: 12, fontWeight: 700,
  color: C.plumDark, whiteSpace: 'nowrap'
};
const tdStyle = {
  padding: '10px 8px', fontSize: 13, color: C.grayHead
};

// BigProgressBar - 듀얼 프로그레스 바 (대시보드 핵심)
function BigProgressBar({ icon, label, sublabel, current, target, color, bgColor, unit = 'hr', isPercent, note, extraInfo }) {
  const pct = target > 0 ? (current / target) * 100 : 0;
  const displayPct = Math.min(100, pct);

  // 상태 메시지
  let statusText = '';
  let statusColor = color;
  if (target === 0 && note) {
    statusText = note;
    statusColor = C.grayText;
  } else if (isPercent) {
    // 슈퍼비전 5% 케이스
    const diff = current - target;
    if (target === 0) {
      statusText = '아직 없음';
      statusColor = C.grayText;
    } else if (diff < -0.1) {
      // 부족
      statusText = `${fmt(-diff)}hr 부족 ⚠`;
      statusColor = C.warnYellow;
    } else if (diff >= -0.1 && diff <= 0.1) {
      // 정확히 5% (오차 0.1hr=6분 이내)
      statusText = '✓ 적정';
      statusColor = C.goodGreen;
    } else {
      // 여유 (5% 초과 달성)
      statusText = `+${fmt(diff)}hr 여유 ✓`;
      statusColor = C.goodGreen;
    }
  } else {
    const remain = target - current;
    if (remain <= 0) {
      statusText = '🎉 달성!';
      statusColor = C.goodGreen;
    } else {
      statusText = `${fmtI(remain)}hr 남음`;
      statusColor = C.grayText;
    }
  }

  return (
    <div style={{
      background: C.white,
      border: `2px solid ${bgColor}`,
      borderRadius: 16,
      padding: 20
    }}>
      {/* 헤더: 아이콘 + 라벨 + 퍼센트 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>{icon}</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.plumDark }}>{label}</div>
            {sublabel && (
              <div style={{ fontSize: 10, color: C.grayText, marginTop: 2, fontStyle: 'italic' }}>{sublabel}</div>
            )}
            <div style={{ fontSize: 12, color: C.grayText, marginTop: 4 }}>
              <strong style={{ color: color, fontSize: 22 }}>{fmt(current)}</strong>
              <span style={{ fontSize: 13, color: C.grayText }}> / {target > 0 ? fmt(target) : '—'} {unit}</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: color, letterSpacing: '-0.02em', lineHeight: 1 }}>
            {target > 0 ? (pct >= 100 ? '100%+' : `${pct.toFixed(1)}%`) : '—'}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: statusColor, marginTop: 4 }}>
            {statusText}
          </div>
        </div>
      </div>

      {/* 큰 프로그레스 바 */}
      <div style={{
        height: 24,
        background: bgColor,
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative'
      }}>
        <div style={{
          height: '100%',
          width: `${displayPct}%`,
          background: `linear-gradient(90deg, ${color} 0%, ${color}dd 100%)`,
          borderRadius: 12,
          transition: 'width 0.5s ease',
          position: 'relative'
        }}>
          {/* 광택 효과 */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            height: '50%',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 100%)',
            borderRadius: '12px 12px 0 0'
          }} />
        </div>
      </div>

      {/* 그룹 초과 등 경고 메시지 (note가 있고 target > 0일 때) */}
      {note && target > 0 && (
        <div style={{
          marginTop: 12, padding: '10px 12px',
          background: '#FFF4D6', borderRadius: 8,
          fontSize: 12, color: '#7A5538', lineHeight: 1.5,
          border: `1px solid ${C.pinkGold}`
        }}>
          {note}
        </div>
      )}

      {/* 추가 정보 (Direct/Indirect) */}
      {extraInfo && (
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {extraInfo.map((info, i) => {
            // plain 모드: 한도 바 없이 단순 표시
            if (info.plain) {
              return (
                <div key={i} style={{
                  padding: '10px 12px',
                  background: C.pinkPale,
                  borderRadius: 8,
                  borderLeft: `3px solid ${info.color}`
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: C.grayText, fontWeight: 600 }}>{info.label}</span>
                    {info.hint && (
                      <span style={{ fontSize: 11, color: info.color, fontWeight: 600 }}>{info.hint}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <strong style={{ fontSize: 17, color: info.color }}>{fmt(info.value)}</strong>
                    <span style={{ fontSize: 11, color: C.grayText }}>hr</span>
                  </div>
                </div>
              );
            }

            // 기본: 한도 바 모드
            const limit = info.isMax ? info.max : info.min;
            const subPct = limit > 0 ? (info.value / limit) * 100 : 0;
            const subDisplayPct = Math.min(100, subPct);
            const isOverMax = info.isMax && subPct > 100;
            const statusColor = isOverMax ? C.dangerRed : C.grayText;

            return (
              <div key={i} style={{
                padding: '10px 12px',
                background: C.pinkPale,
                borderRadius: 8,
                borderLeft: `3px solid ${info.color}`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.grayText, fontWeight: 600 }}>{info.label}</span>
                  <span style={{ fontSize: 11, color: statusColor, fontWeight: 600 }}>
                    {subPct.toFixed(0)}%
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                  <strong style={{ fontSize: 17, color: info.color }}>{fmt(info.value)}</strong>
                  <span style={{ fontSize: 11, color: C.grayText }}>/ {fmtI(limit)}hr</span>
                </div>
                <div style={{ height: 6, background: C.white, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${subDisplayPct}%`,
                    background: isOverMax ? C.dangerRed : info.color,
                    borderRadius: 3,
                    transition: 'width 0.4s'
                  }} />
                </div>
                {isOverMax && (
                  <div style={{ fontSize: 10, color: C.dangerRed, marginTop: 6, fontWeight: 600 }}>
                    ⚠ 최대 한도 초과 ({fmt(info.value - limit)}hr 초과)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// CompactUserInfo - 한 줄짜리 사용자 정보 + 슈퍼바이저 관리 토글
function CompactUserInfo({ data, update }) {
  const [showSupervisors, setShowSupervisors] = useState(false);
  const supervisors = data.supervisors || [];
  const [newName, setNewName] = useState('');

  const addSupervisor = async () => {
    const name = newName.trim();
    if (!name) return;
    if (supervisors.includes(name)) {
      await window.appAlert('이미 추가된 슈퍼바이저입니다.');
      return;
    }
    if (name === data.mainSupervisor) {
      await window.appAlert('메인 슈퍼바이저와 같습니다.');
      return;
    }
    update({ supervisors: [...supervisors, name] });
    setNewName('');
  };

  const removeSupervisor = async (name) => {
    if (await window.appConfirm(`'${name}' 슈퍼바이저를 목록에서 제거할까요?\n(이미 입력된 기록은 유지됩니다)`)) {
      update({ supervisors: supervisors.filter(s => s !== name) });
    }
  };

  return (
    <div style={{ background: C.white, borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px' }}>
          <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600, whiteSpace: 'nowrap' }}>👤 슈퍼바이지 이름</span>
          <input type="text" value={data.name || ''} onChange={e => update({ name: e.target.value })}
                 style={{ ...inputStyle, padding: '7px 10px', fontSize: 13 }} placeholder="자격 준비자" />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px' }}>
          <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600, whiteSpace: 'nowrap' }}>🎓 메인 슈퍼바이저</span>
          <input type="text" value={data.mainSupervisor || ''} onChange={e => update({ mainSupervisor: e.target.value })}
                 style={{ ...inputStyle, padding: '7px 10px', fontSize: 13 }} placeholder="주 슈퍼바이저" />
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
            여러 슈퍼바이저와 일하는 경우 추가하세요. 회기 입력 시 빠르게 선택할 수 있어요.
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

// 접을 수 있는 섹션 (defaultOpen 기본 false)
function CollapsibleSection({ title, children, defaultOpen = false, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={{ background: C.white, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', padding: '18px 24px', background: 'none', border: 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left'
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.plumDark, letterSpacing: '-0.01em' }}>{title}</h2>
          {badge && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
              background: C.pinkDeep, color: C.white, letterSpacing: '0.05em'
            }}>{badge}</span>
          )}
        </div>
        <span style={{
          fontSize: 14, color: C.grayText,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s'
        }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: '0 24px 24px 24px' }}>
          {children}
        </div>
      )}
    </section>
  );
}

const inputStyle = {
  padding: '9px 12px', fontSize: 14, border: `1px solid #E0D5D8`, borderRadius: 6,
  background: C.white, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none'
};

// ============================================
// 📋 FIELDWORK LOG
// ============================================
function FieldworkLog({ activeSupervisee, exam, updateActive }) {
  const data = activeSupervisee;
  const update = updateActive;
  const [sortBy, setSortBy] = useState('desc');
  const [recentlyAddedId, setRecentlyAddedId] = useState(null);
  const [quickMode, setQuickMode] = useState(false);

  // 이전 활동·시간·슈퍼바이저 기억 (가장 최근 회기 기준)
  const lastLog = useMemo(() => {
    if (data.fieldworkLogs.length === 0) return null;
    return [...data.fieldworkLogs].sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      if (d !== 0) return -d;
      return (b.id || 0) - (a.id || 0);
    })[0];
  }, [data.fieldworkLogs]);

  // 빈 회기 추가 (펼친 상태로)
  const add = async () => {
    const newLogData = {
      supervisor: data.mainSupervisor || '',
      date: todayYMD(),
      startTime: '',
      endTime: '',
      direct: 0,
      activities: [],
      customActivities: []
    };
    const created = await createFieldworkLog(data.id, newLogData);
    if (created) {
      update({ fieldworkLogs: [created, ...data.fieldworkLogs] });
      setRecentlyAddedId(created.id);
    }
  };

  // 이전 회기 복사 (날짜는 다음 날, 나머지는 그대로)
  const copyLast = async () => {
    if (!lastLog) return;
    // 날짜 +1
    let nextDate = todayYMD();
    if (lastLog.date) {
      const d = parseLocalDate(lastLog.date);
      d.setDate(d.getDate() + 1);
      nextDate = dateToYMD(d);
    }
    const newLogData = {
      supervisor: lastLog.supervisor || '',
      date: nextDate,
      startTime: lastLog.startTime || '',
      endTime: lastLog.endTime || '',
      direct: lastLog.direct || 0,
      activities: lastLog.activities || [],
      customActivities: lastLog.customActivities || []
    };
    const created = await createFieldworkLog(data.id, newLogData);
    if (created) {
      update({ fieldworkLogs: [created, ...data.fieldworkLogs] });
      setRecentlyAddedId(created.id);
    }
  };

  // 빠른 입력 - 한 줄로 추가
  const quickAdd = async (quickLog) => {
    const newLogData = {
      supervisor: quickLog.supervisor || data.mainSupervisor || '',
      date: quickLog.date || todayYMD(),
      startTime: quickLog.startTime || '',
      endTime: quickLog.endTime || '',
      direct: quickLog.direct || 0,
      activities: [],
      customActivities: []
    };
    const created = await createFieldworkLog(data.id, newLogData);
    if (created) {
      update({ fieldworkLogs: [created, ...data.fieldworkLogs] });
      setRecentlyAddedId(created.id);
    }
  };

  const upd = async (id, c) => {
    // 낙관적 업데이트
    update({ fieldworkLogs: data.fieldworkLogs.map(l => l.id === id ? { ...l, ...c } : l) });
    await updateFieldworkLog(id, c);
  };
  const del = async (id) => {
    if (!await window.appConfirm('이 기록을 삭제할까요?')) return;
    update({ fieldworkLogs: data.fieldworkLogs.filter(l => l.id !== id) });
    await deleteFieldworkLog(id);
  };

  const sortedLogs = useMemo(() => {
    return [...data.fieldworkLogs].sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      return sortBy === 'desc' ? -d : d;
    });
  }, [data.fieldworkLogs, sortBy]);

  // 월별로 그룹화
  const groupedByMonth = useMemo(() => {
    const groups = {};
    sortedLogs.forEach(log => {
      const ym = (log.date || '').substring(0, 7) || '미입력';
      if (!groups[ym]) {
        groups[ym] = { ym, logs: [], fw: 0, direct: 0, indirect: 0, sv: 0, svGroup: 0, svIndividual: 0, svAccepted: 0 };
      }
      const hrs = timeToHours(log.startTime, log.endTime);
      const direct = Math.min(Number(log.direct) || 0, hrs);
      groups[ym].logs.push(log);
      groups[ym].fw += hrs;
      groups[ym].direct += direct;
      groups[ym].indirect += Math.max(0, hrs - direct);
    });
    // 슈퍼비전 시간도 월별 매핑 (5% 충족 표시용, 인정 시간 계산)
    data.supervisionLogs.forEach(log => {
      const ym = (log.date || '').substring(0, 7);
      if (groups[ym]) {
        const h = Number(log.hours) || 0;
        groups[ym].sv += h;
        if (log.type === 'group') groups[ym].svGroup += h;
        else groups[ym].svIndividual += h;
      }
    });
    // 그룹별 인정 시간 계산
    Object.values(groups).forEach(g => {
      g.svAccepted = g.svIndividual + Math.min(g.svGroup, g.svIndividual);
    });
    return Object.values(groups).sort((a, b) => sortBy === 'desc' ? b.ym.localeCompare(a.ym) : a.ym.localeCompare(b.ym));
  }, [sortedLogs, data.supervisionLogs, sortBy]);

  return (
    <div>
      <InfoBanner>
        💡 <strong>처음이세요? 이렇게 시작해보세요</strong><br/>
        ① <strong>"+ 새 회기"</strong> 버튼을 눌러 카드를 추가하고<br/>
        ② 날짜, 시작/종료 시간을 입력해주세요 (<strong>빠른 버튼 +30분, +1시간</strong>으로 더 편하게!)<br/>
        ③ <strong>Direct(직접 치료)</strong> 시간만 입력하면 나머지는 자동으로 <strong>Indirect(간접 업무)</strong>로 계산돼요<br/>
        <span style={{ fontSize: 11, color: C.grayText, fontStyle: 'italic' }}>📌 매일 끝나고 바로 기록하면 잊지 않아요!</span>
      </InfoBanner>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.plumDark }}>📋 필드워크 기록</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: C.grayText }}>총 {data.fieldworkLogs.length}건</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  style={{ padding: '8px 12px', fontSize: 13, border: `1px solid ${C.pinkLight}`, borderRadius: 6, background: C.white, color: C.plumDark, cursor: 'pointer' }}>
            <option value="desc">최신순 ↓</option>
            <option value="asc">오래된순 ↑</option>
          </select>
          {lastLog && (
            <button onClick={copyLast} title="가장 최근 회기와 똑같이 복사 (날짜는 +1일)"
                    style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: C.plumDark, background: C.pinkPale, border: `1px solid ${C.pinkLight}`, borderRadius: 8, cursor: 'pointer' }}>
              📋 지난 회기 복사
            </button>
          )}
          <button onClick={add} style={addBtnStyle}>+ 새 회기</button>
        </div>
      </div>

      {/* 빠른 입력 토글 */}
      <div style={{ marginBottom: 16 }}>
        <button onClick={() => setQuickMode(!quickMode)}
                style={{
                  padding: '8px 14px', fontSize: 13, fontWeight: 500,
                  background: quickMode ? C.pinkDeep : C.pinkSoft,
                  color: quickMode ? C.white : C.plumDark,
                  border: `1px solid ${C.pinkLight}`, borderRadius: 6, cursor: 'pointer'
                }}>
          ⚡ 빠른 입력 {quickMode ? 'ON' : 'OFF'}
        </button>
        <span style={{ marginLeft: 10, fontSize: 11, color: C.grayText, fontStyle: 'italic' }}>
          한 줄로 빠르게 입력 (상세 편집은 카드 펼침)
        </span>
      </div>

      {quickMode && <QuickAddRow onAdd={quickAdd} mainSupervisor={data.mainSupervisor} />}

      {sortedLogs.length === 0 ? <EmptyState msg='아직 입력된 회기가 없습니다.' sub='"새 회기" 버튼을 눌러 시작하세요.' /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groupedByMonth.map(group => (
            <MonthGroup
              key={group.ym}
              group={group}
              exam={exam}
              recentlyAddedId={recentlyAddedId}
              onUpdate={upd}
              onDelete={del}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// MonthGroup - 월별 그룹 (접기/펼치기)
function MonthGroup({ group, exam, recentlyAddedId, onUpdate, onDelete }) {
  // 최근 추가된 항목 있는 그룹은 자동 펼침
  const hasRecent = group.logs.some(l => l.id === recentlyAddedId);
  const [open, setOpen] = useState(hasRecent);

  // 자동 펼침 (recentlyAddedId 변경 시)
  useEffect(() => {
    if (hasRecent) setOpen(true);
  }, [hasRecent]);

  // 5% 충족 여부 (인정 시간 기준)
  const need = group.fw * (exam.svPercent / 100);
  const svAccepted = group.svAccepted !== undefined ? group.svAccepted : group.sv;
  const diff = svAccepted - need;
  const groupExcluded = group.svGroup > group.svIndividual ? (group.svGroup - group.svIndividual) : 0;
  let statusBadge;
  if (group.fw === 0) {
    statusBadge = null;
  } else if (diff >= -0.1) {
    statusBadge = <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10, background: '#E8F5E9', color: C.goodGreen }}>✓ 5% 충족</span>;
  } else {
    statusBadge = <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10, background: '#FFF4D6', color: C.warnYellow }}>⚠ 슈퍼비전 {fmt(-diff)}hr 부족</span>;
  }
  // 그룹 초과 배지 (그달에 그룹이 개별보다 많으면)
  const groupExcessBadge = groupExcluded > 0 ? (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10, background: '#FFE5E5', color: C.dangerRed }}>
      ⚠ 그룹 {fmt(groupExcluded)}hr 초과
    </span>
  ) : null;

  // ym 표시 (예: 2026-06 → 2026년 6월)
  const ymDisplay = group.ym === '미입력' ? '날짜 미입력' : (() => {
    const [y, m] = group.ym.split('-');
    return `${y}년 ${parseInt(m)}월`;
  })();

  return (
    <div style={{
      background: C.white,
      borderRadius: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      overflow: 'hidden',
      border: `1px solid ${C.pinkLight}`
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', padding: '14px 18px', background: open ? C.pinkPale : C.white,
          border: 'none', borderBottom: open ? `1px solid ${C.pinkLight}` : 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          transition: 'background 0.15s'
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.plumDark }}>📅 {ymDisplay}</span>
          <span style={{ fontSize: 12, color: C.grayText }}>
            {group.logs.length}회기 · <strong style={{ color: C.pinkDeep }}>{fmt(group.fw)}hr</strong>
          </span>
          {statusBadge}
          {groupExcessBadge}
        </div>
        <span style={{
          fontSize: 14, color: C.grayText,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s'
        }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {group.logs.map(log => (
            <FieldworkItem
              key={log.id}
              log={log}
              onUpdate={c => onUpdate(log.id, c)}
              onDelete={() => onDelete(log.id)}
              defaultExpanded={log.id === recentlyAddedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// QuickAddRow - 한 줄 빠른 입력
function QuickAddRow({ onAdd, mainSupervisor }) {
  const [date, setDate] = useState(todayYMD());
  const [supervisor, setSupervisor] = useState(mainSupervisor || '');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [direct, setDirect] = useState('');

  const totalHours = timeToHours(startTime, endTime);

  const timeOptions = useMemo(() => {
    const opts = [];
    for (let h = 6; h <= 22; h++) {
      for (let m = 0; m < 60; m += 30) {
        opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return opts;
  }, []);

  const renderOption = (t) => {
    const [h, m] = t.split(':').map(Number);
    const period = h < 12 ? '오전' : '오후';
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${period} ${displayH}:${String(m).padStart(2, '0')}`;
  };

  const handleSubmit = async () => {
    if (!startTime || !endTime) {
      await window.appAlert('시작/종료 시간을 선택하세요');
      return;
    }
    if (totalHours <= 0) {
      await window.appAlert('종료 시간이 시작 시간보다 늦어야 합니다');
      return;
    }
    onAdd({ date, supervisor, startTime, endTime, direct });
    // 초기화 (날짜·슈퍼바이저는 유지 - 같은 날 여러 회기 빠르게)
    setStartTime('');
    setEndTime('');
    setDirect('');
  };

  return (
    <div style={{
      background: C.pinkPale, border: `1px dashed ${C.pinkLight}`, borderRadius: 10,
      padding: 14, marginBottom: 16
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ minWidth: 140 }}>
          <div style={{ fontSize: 10, color: C.grayText, fontWeight: 600, marginBottom: 4 }}>📅 날짜</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
                 style={{ ...logInputStyle, padding: '6px 8px', fontSize: 12 }} />
        </div>
        <div style={{ minWidth: 100 }}>
          <div style={{ fontSize: 10, color: C.grayText, fontWeight: 600, marginBottom: 4 }}>🎓 슈퍼바이저</div>
          <input type="text" value={supervisor} onChange={e => setSupervisor(e.target.value)}
                 list="supervisor-list"
                 placeholder="이름"
                 style={{ ...logInputStyle, padding: '6px 8px', fontSize: 12 }} />
        </div>
        <div style={{ minWidth: 100 }}>
          <div style={{ fontSize: 10, color: C.grayText, fontWeight: 600, marginBottom: 4 }}>⏰ 시작</div>
          <select value={startTime} onChange={e => setStartTime(e.target.value)}
                  style={{ ...logInputStyle, padding: '6px 8px', fontSize: 12, cursor: 'pointer' }}>
            <option value="">선택</option>
            {timeOptions.map(t => <option key={t} value={t}>{renderOption(t)}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 100 }}>
          <div style={{ fontSize: 10, color: C.grayText, fontWeight: 600, marginBottom: 4 }}>⏰ 종료</div>
          <select value={endTime} onChange={e => setEndTime(e.target.value)}
                  disabled={!startTime}
                  style={{ ...logInputStyle, padding: '6px 8px', fontSize: 12, cursor: startTime ? 'pointer' : 'not-allowed',
                           ...(!startTime && { background: '#F5F5F5', color: C.grayText }) }}>
            <option value="">선택</option>
            {timeOptions.filter(t => !startTime || t > startTime).map(t => <option key={t} value={t}>{renderOption(t)}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 80 }}>
          <div style={{ fontSize: 10, color: C.grayText, fontWeight: 600, marginBottom: 4 }}>📍 Direct</div>
          <input type="number" step="0.25" min="0" max={totalHours || undefined}
                 value={direct} onChange={e => setDirect(e.target.value)}
                 disabled={totalHours === 0}
                 placeholder={totalHours === 0 ? '-' : 'hr'}
                 style={{ ...logInputStyle, padding: '6px 8px', fontSize: 12, width: 70,
                          ...(totalHours === 0 && { background: '#F5F5F5', color: C.grayText }) }} />
        </div>
        {totalHours > 0 && (
          <div style={{
            background: C.white, padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, color: C.pinkDeep
          }}>
            {fmt(totalHours)}hr
          </div>
        )}
        <button onClick={handleSubmit}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600,
                  background: C.pinkDeep, color: C.white, border: 'none', borderRadius: 6,
                  cursor: 'pointer', whiteSpace: 'nowrap'
                }}>
          + 추가
        </button>
      </div>
      <p style={{ margin: '8px 0 0 0', fontSize: 10, color: C.grayText, fontStyle: 'italic' }}>
        💡 추가하면 날짜·슈퍼바이저는 유지되고, 시간만 비워집니다 (같은 날 여러 회기 빠르게 추가)
      </p>
    </div>
  );
}

const InfoBanner = ({ children }) => (
  <div style={{ background: '#FFF8E7', border: `1px solid ${C.pinkGold}`, borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#7A5538', lineHeight: 1.6 }}>
    {children}
  </div>
);

// TimeRangePicker - 시작 시간 + 종료 시간 (빠른 버튼 보조)
function TimeRangePicker({ startTime, endTime, onChange }) {
  // 시간 옵션 (오전 6시 ~ 밤 10시 30분, 30분 단위)
  const timeOptions = useMemo(() => {
    const opts = [];
    for (let h = 6; h <= 22; h++) {
      for (let m = 0; m < 60; m += 30) {
        const hh = String(h).padStart(2, '0');
        const mm = String(m).padStart(2, '0');
        opts.push(`${hh}:${mm}`);
      }
    }
    return opts;
  }, []);

  // 현재 지속 시간 계산
  const currentDuration = timeToHours(startTime, endTime);

  // 시작 시간 + 지속시간 → 종료 시간
  const calcEndTime = (start, durationHours) => {
    if (!start || !durationHours) return '';
    const [sh, sm] = start.split(':').map(Number);
    const totalMin = sh * 60 + sm + Math.round(durationHours * 60);
    const eh = Math.floor(totalMin / 60);
    const em = totalMin % 60;
    if (eh > 23) return '';
    return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
  };

  // 빠른 버튼으로 종료 시간 자동 채우기
  const handleQuickEnd = async (hours) => {
    if (!startTime) {
      await window.appAlert('먼저 시작 시간을 선택하세요');
      return;
    }
    const newEnd = calcEndTime(startTime, hours);
    if (!newEnd) {
      await window.appAlert('하루를 넘기는 시간은 입력할 수 없습니다');
      return;
    }
    onChange({ endTime: newEnd });
  };

  const quickButtons = [
    { label: '+30분', value: 0.5 },
    { label: '+1시간', value: 1 },
    { label: '+2시간', value: 2 },
    { label: '+3시간', value: 3 },
    { label: '+4시간', value: 4 }
  ];

  // 한글 시간 표시 함수 (드롭다운 옵션용)
  const renderOption = (t) => {
    const [h, m] = t.split(':').map(Number);
    const period = h < 12 ? '오전' : '오후';
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${period} ${displayH}:${String(m).padStart(2, '0')}`;
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {/* 시작 + 종료 시간 한 줄 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
        <div style={{ flex: '1 1 140px' }}>
          <div style={{ fontSize: 11, color: C.grayText, fontWeight: 600, marginBottom: 6 }}>⏰ 시작</div>
          <select value={startTime || ''} onChange={e => onChange({ startTime: e.target.value })}
                  style={{ ...logInputStyle, fontSize: 14, padding: '10px 12px', cursor: 'pointer', width: '100%' }}>
            <option value="">선택</option>
            {timeOptions.map(t => <option key={t} value={t}>{renderOption(t)}</option>)}
          </select>
        </div>
        <span style={{ fontSize: 16, color: C.grayText, paddingBottom: 10 }}>~</span>
        <div style={{ flex: '1 1 140px' }}>
          <div style={{ fontSize: 11, color: C.grayText, fontWeight: 600, marginBottom: 6 }}>⏰ 종료</div>
          <select value={endTime || ''} onChange={e => onChange({ endTime: e.target.value })}
                  disabled={!startTime}
                  style={{ ...logInputStyle, fontSize: 14, padding: '10px 12px', cursor: startTime ? 'pointer' : 'not-allowed', width: '100%',
                           ...(!startTime && { background: '#F5F5F5', color: C.grayText }) }}>
            <option value="">{startTime ? '선택' : '먼저 시작 시간 선택'}</option>
            {timeOptions.filter(t => !startTime || t > startTime).map(t => <option key={t} value={t}>{renderOption(t)}</option>)}
          </select>
        </div>
        {currentDuration > 0 && (
          <div style={{ background: C.pinkPale, padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 700, color: C.pinkDeep, whiteSpace: 'nowrap' }}>
            = {fmt(currentDuration)} hr
          </div>
        )}
      </div>

      {/* 빠른 종료 버튼 (시작 선택 후 보조) */}
      {startTime && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: C.grayText }}>⚡ 빠르게:</span>
          {quickButtons.map(b => (
            <button
              key={b.value}
              onClick={() => handleQuickEnd(b.value)}
              style={{
                padding: '4px 10px', fontSize: 12, fontWeight: 500,
                border: `1px solid #E0D5D8`,
                borderRadius: 6,
                background: C.white,
                color: C.plumDark,
                cursor: 'pointer', fontFamily: 'inherit'
              }}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldworkItem({ log, onUpdate, onDelete, defaultExpanded }) {
  const ft = timeToHours(log.startTime, log.endTime);
  const rawDirect = Number(log.direct) || 0;
  const directOver = rawDirect > ft && ft > 0;
  const direct = directOver ? rawDirect : Math.min(rawDirect, ft);
  const indirect = Math.max(0, ft - direct);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [customOpen, setCustomOpen] = useState(false);

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
  const formatKrTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const period = h < 12 ? '오전' : '오후';
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${period} ${displayH}:${String(m).padStart(2, '0')}`;
  };
  const timeLabel = (log.startTime && log.endTime) ? `${formatKrTime(log.startTime)}~${formatKrTime(log.endTime)}` : '시간 미입력';

  // 요약 헤더용 날짜 - 월별 그룹 안에 있으니 일자만 표시
  const dayOnly = (() => {
    if (!log.date) return '날짜 미입력';
    const parts = log.date.split('-');
    if (parts.length === 3) {
      return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    }
    return log.date;
  })();

  return (
    <div style={logCardStyle}>
      {/* 요약 헤더 (항상 보임) - 간결하게 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
           onClick={() => setExpanded(!expanded)}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.plumDark, minWidth: 50 }}>
            {dayOnly}
          </div>
          <div style={{ fontSize: 12, color: C.grayText }}>
            {timeLabel} <strong style={{ color: C.pinkDeep }}>({fmt(ft)}hr)</strong>
          </div>
          {ft > 0 && (
            <div style={{ fontSize: 11, color: C.grayText, display: 'flex', gap: 6 }}>
              <span style={{ color: C.goldDeep, fontWeight: 600 }}>직접 {fmt(direct)}</span>
              <span style={{ color: C.goodGreen, fontWeight: 600 }}>간접 {fmt(indirect)}</span>
            </div>
          )}
          {log.supervisor && (
            <div style={{ fontSize: 11, color: C.grayText }}>· {log.supervisor}</div>
          )}
        </div>
        <button onClick={async (e) => { e.stopPropagation(); onDelete(); }} style={delBtnStyle}>🗑</button>
        <div style={{ fontSize: 13, color: C.grayText, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</div>
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
          <TimeRangePicker
            startTime={log.startTime}
            endTime={log.endTime}
            onChange={(times) => onUpdate(times)}
          />

          {/* Direct / Indirect 시간 분배 */}
          <div style={rowStyle}>
            <Field label={<>📍 Direct (직접) <span style={{ color: C.grayText, fontWeight: 400, fontSize: 10 }}>클라이언트와 1:1</span></>}>
              <input
                type="number" step="0.25" min="0" max={ft || undefined}
                value={log.direct ?? ''}
                onChange={e => onUpdate({ direct: e.target.value })}
                disabled={ft === 0}
                style={{ ...logInputStyle,
                         ...(ft === 0 && { background: '#F5F5F5', color: C.grayText, cursor: 'not-allowed' }),
                         ...(directOver && { borderColor: C.dangerRed, background: '#FFF0F0' }) }}
                placeholder={ft === 0 ? '먼저 시작/종료 시간 선택' : '예: 2.5'}
              />
            </Field>
            <Field label={<>📝 Indirect (간접) <span style={{ color: C.grayText, fontWeight: 400, fontSize: 10 }}>자동 계산</span></>}>
              <div style={{ ...logInputStyle, background: '#F5F5F5', color: C.goodGreen, fontWeight: 700, minWidth: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
                {fmt(indirect)} hr
              </div>
            </Field>
          </div>
          {directOver && (
            <div style={{ color: C.dangerRed, fontSize: 12, marginTop: -8, marginBottom: 12 }}>
              ⚠️ Direct가 총 시간({fmt(ft)}hr)을 초과했어요. Direct는 총 시간 이하여야 합니다.
            </div>
          )}

          {/* 활동 유형 - 한 줄 (작은 칩 + 기타 토글) */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: C.grayText, fontWeight: 600, marginBottom: 6 }}>
              활동 유형 <span style={{ fontWeight: 400, fontStyle: 'italic' }}>(선택사항 · 여러 개 가능)</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {[...DIRECT_ACTIVITIES, ...INDIRECT_ACTIVITIES].map(activity => {
                const isSelected = selectedActivities.includes(activity);
                return (
                  <button key={activity} onClick={() => toggleActivity(activity)}
                    style={{
                      padding: '4px 9px', fontSize: 11, fontWeight: 500,
                      border: `1px solid ${isSelected ? C.pinkDeep : '#E0D5D8'}`,
                      borderRadius: 12,
                      background: isSelected ? C.pinkDeep : C.white,
                      color: isSelected ? C.white : C.grayText,
                      cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit'
                    }}>
                    {isSelected ? '✓ ' : ''}{activity}
                  </button>
                );
              })}
              {/* 기타 칩 - 누르면 CustomActivityInput 펼침 */}
              {(() => {
                const hasCustom = (log.customActivities || []).length > 0;
                const isOpen = customOpen || hasCustom;
                return (
                  <button onClick={() => setCustomOpen(!isOpen)}
                    style={{
                      padding: '4px 9px', fontSize: 11, fontWeight: 500,
                      border: `1px solid ${isOpen ? C.plumDark : '#E0D5D8'}`,
                      borderRadius: 12,
                      background: isOpen ? C.plumDark : C.white,
                      color: isOpen ? C.white : C.grayText,
                      cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit'
                    }}>
                    ✏️ 기타{hasCustom ? ` (${log.customActivities.length})` : ''}
                  </button>
                );
              })()}
            </div>

            {/* 사용자 추가 활동 - "기타" 누르거나 이미 있을 때만 펼침 */}
            {(customOpen || (log.customActivities || []).length > 0) && (
              <CustomActivityInput
                customActivities={log.customActivities || []}
                onChange={(list) => onUpdate({ customActivities: list })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 사용자 자유 입력 활동 컴포넌트
function CustomActivityInput({ customActivities, onChange }) {
  const [newAct, setNewAct] = useState('');

  const add = async () => {
    const v = newAct.trim();
    if (!v) return;
    if (customActivities.includes(v)) return;
    onChange([...customActivities, v]);
    setNewAct('');
  };

  const remove = async (act) => {
    onChange(customActivities.filter(a => a !== act));
  };

  return (
    <div>
      <div style={{ fontSize: 10, color: C.plumDark, fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
        ✏️ 내가 만든 활동
      </div>
      {customActivities.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {customActivities.map(act => (
            <div key={act} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 8px 6px 12px', background: C.pinkSoft,
              border: `1.5px solid ${C.pinkLight}`, borderRadius: 16,
              fontSize: 13, color: C.plumDark, fontWeight: 500
            }}>
              <span>{act}</span>
              <button onClick={() => remove(act)}
                      style={{ background: 'none', border: 'none', color: C.grayText, cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={newAct}
          onChange={e => setNewAct(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="활동명 입력 후 Enter"
          style={{ ...logInputStyle, padding: '7px 10px', fontSize: 13, flex: 1 }}
        />
        <button onClick={add}
                style={{ padding: '7px 14px', background: C.pinkDeep, color: C.white, border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          + 추가
        </button>
      </div>
    </div>
  );
}

// ============================================
// 🎓 SUPERVISION LOG
// ============================================
function SupervisionLog({ activeSupervisee, updateActive }) {
  const data = activeSupervisee;
  const update = updateActive;
  const [sortBy, setSortBy] = useState('desc');
  const [recentlyAddedId, setRecentlyAddedId] = useState(null);
  const [quickMode, setQuickMode] = useState(false);

  // 이전 슈퍼비전 기억
  const lastLog = useMemo(() => {
    if (data.supervisionLogs.length === 0) return null;
    return [...data.supervisionLogs].sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      if (d !== 0) return -d;
      return (b.id || 0) - (a.id || 0);
    })[0];
  }, [data.supervisionLogs]);

  const add = async () => {
    const newLogData = { date: todayYMD(), hours: 0, type: 'individual', supervisor: data.mainSupervisor || '', notes: '' };
    const created = await createSupervisionLog(data.id, newLogData);
    if (created) {
      update({ supervisionLogs: [created, ...data.supervisionLogs] });
      setRecentlyAddedId(created.id);
    }
  };

  // 이전 슈퍼비전 복사 (날짜 +7일 - 주1회가 일반적)
  const copyLast = async () => {
    if (!lastLog) return;
    let nextDate = todayYMD();
    if (lastLog.date) {
      const d = parseLocalDate(lastLog.date);
      d.setDate(d.getDate() + 7);
      nextDate = dateToYMD(d);
    }
    const newLogData = {
      date: nextDate,
      hours: lastLog.hours || 0,
      type: lastLog.type || 'individual',
      supervisor: lastLog.supervisor || '',
      notes: ''
    };
    const created = await createSupervisionLog(data.id, newLogData);
    if (created) {
      update({ supervisionLogs: [created, ...data.supervisionLogs] });
      setRecentlyAddedId(created.id);
    }
  };

  const quickAdd = async (quickLog) => {
    const newLogData = {
      date: quickLog.date || todayYMD(),
      hours: quickLog.hours || 0,
      type: quickLog.type || 'individual',
      supervisor: quickLog.supervisor || data.mainSupervisor || '',
      notes: ''
    };
    const created = await createSupervisionLog(data.id, newLogData);
    if (created) {
      update({ supervisionLogs: [created, ...data.supervisionLogs] });
      setRecentlyAddedId(created.id);
    }
  };

  const upd = async (id, c) => {
    update({ supervisionLogs: data.supervisionLogs.map(l => l.id === id ? { ...l, ...c } : l) });
    await updateSupervisionLog(id, c);
  };
  const del = async (id) => {
    if (!await window.appConfirm('이 기록을 삭제할까요?')) return;
    update({ supervisionLogs: data.supervisionLogs.filter(l => l.id !== id) });
    await deleteSupervisionLog(id);
  };

  const sortedLogs = useMemo(() => {
    return [...data.supervisionLogs].sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      return sortBy === 'desc' ? -d : d;
    });
  }, [data.supervisionLogs, sortBy]);

  // 월별로 그룹화 (그룹/개별 분리 포함)
  const groupedByMonth = useMemo(() => {
    const groups = {};
    sortedLogs.forEach(log => {
      const ym = (log.date || '').substring(0, 7) || '미입력';
      if (!groups[ym]) {
        groups[ym] = { ym, logs: [], total: 0, groupTotal: 0, individualTotal: 0 };
      }
      const h = Number(log.hours) || 0;
      groups[ym].logs.push(log);
      groups[ym].total += h;
      if (log.type === 'group') groups[ym].groupTotal += h;
      else groups[ym].individualTotal += h;
    });
    return Object.values(groups).sort((a, b) => sortBy === 'desc' ? b.ym.localeCompare(a.ym) : a.ym.localeCompare(b.ym));
  }, [sortedLogs, sortBy]);

  return (
    <div>
      <InfoBanner>
        💡 <strong>슈퍼비전 시간 기록하기</strong><br/>
        ① <strong>"+ 새 슈퍼비전"</strong> 버튼을 누르고<br/>
        ② 날짜, 받은 시간, 슈퍼바이저 이름을 입력<br/>
        ③ <strong>👤 개별</strong>(1:1로 받음) 또는 <strong>👥 그룹</strong>(여러 명이 함께)을 꼭 선택해주세요<br/>
        <span style={{ fontSize: 11, color: '#8B3A3A', fontStyle: 'italic' }}>⚠️ QABA 규정: <strong>매월 필드워크 시간의 5%</strong>를 슈퍼비전 받아야 해요!</span><br/>
        <span style={{ fontSize: 11, color: '#8B3A3A', fontStyle: 'italic' }}>⚠️ 그룹 슈퍼비전은 <strong>그 달의 개별 시간만큼만 인정</strong>됩니다 (즉 그룹만 받으면 인정 안 됨)</span>
      </InfoBanner>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.plumDark }}>🎓 슈퍼비전 기록</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: C.grayText }}>총 {data.supervisionLogs.length}건</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  style={{ padding: '8px 12px', fontSize: 13, border: `1px solid ${C.pinkLight}`, borderRadius: 6, background: C.white, color: C.plumDark, cursor: 'pointer' }}>
            <option value="desc">최신순 ↓</option>
            <option value="asc">오래된순 ↑</option>
          </select>
          {lastLog && (
            <button onClick={copyLast} title="가장 최근 슈퍼비전과 똑같이 복사 (날짜는 +7일, 메모는 빈 값)"
                    style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: C.plumDark, background: C.pinkPale, border: `1px solid ${C.pinkLight}`, borderRadius: 8, cursor: 'pointer' }}>
              📋 지난 슈퍼비전 복사
            </button>
          )}
          <button onClick={add} style={addBtnStyle}>+ 새 슈퍼비전</button>
        </div>
      </div>

      {/* 빠른 입력 토글 */}
      <div style={{ marginBottom: 16 }}>
        <button onClick={() => setQuickMode(!quickMode)}
                style={{
                  padding: '8px 14px', fontSize: 13, fontWeight: 500,
                  background: quickMode ? C.pinkDeep : C.pinkSoft,
                  color: quickMode ? C.white : C.plumDark,
                  border: `1px solid ${C.pinkLight}`, borderRadius: 6, cursor: 'pointer'
                }}>
          ⚡ 빠른 입력 {quickMode ? 'ON' : 'OFF'}
        </button>
        <span style={{ marginLeft: 10, fontSize: 11, color: C.grayText, fontStyle: 'italic' }}>
          한 줄로 빠르게 입력 (메모는 카드 펼쳐서 추가)
        </span>
      </div>

      {quickMode && <QuickAddSvRow onAdd={quickAdd} mainSupervisor={data.mainSupervisor} />}

      {sortedLogs.length === 0 ? <EmptyState msg='아직 입력된 슈퍼비전이 없습니다.' sub='"새 슈퍼비전" 버튼을 눌러 시작하세요.' /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groupedByMonth.map(group => (
            <SvMonthGroup
              key={group.ym}
              group={group}
              recentlyAddedId={recentlyAddedId}
              onUpdate={upd}
              onDelete={del}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 슈퍼비전 월별 그룹
function SvMonthGroup({ group, recentlyAddedId, onUpdate, onDelete }) {
  const hasRecent = group.logs.some(l => l.id === recentlyAddedId);
  const [open, setOpen] = useState(hasRecent);

  useEffect(() => {
    if (hasRecent) setOpen(true);
  }, [hasRecent]);

  const ymDisplay = group.ym === '미입력' ? '날짜 미입력' : (() => {
    const [y, m] = group.ym.split('-');
    return `${y}년 ${parseInt(m)}월`;
  })();

  return (
    <div style={{
      background: C.white,
      borderRadius: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      overflow: 'hidden',
      border: `1px solid ${C.pinkLight}`
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', padding: '14px 18px', background: open ? C.pinkPale : C.white,
          border: 'none', borderBottom: open ? `1px solid ${C.pinkLight}` : 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          transition: 'background 0.15s'
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.plumDark }}>📅 {ymDisplay}</span>
          <span style={{ fontSize: 12, color: C.grayText }}>
            {group.logs.length}회 · <strong style={{ color: C.plumDark }}>{fmt(group.total)}hr</strong>
          </span>
          {group.total > 0 && (
            <span style={{ fontSize: 11, color: C.grayText, display: 'flex', gap: 6 }}>
              <span style={{ color: C.goldDeep, fontWeight: 600 }}>개별 {fmt(group.individualTotal)}</span>
              <span style={{ color: C.plumDark, fontWeight: 600 }}>그룹 {fmt(group.groupTotal)}</span>
            </span>
          )}
          {group.groupTotal > group.individualTotal && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10, background: '#FFE5E5', color: C.dangerRed }}>
              ⚠ 그룹 {fmt(group.groupTotal - group.individualTotal)}hr 초과
            </span>
          )}
        </div>
        <span style={{
          fontSize: 14, color: C.grayText,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s'
        }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {group.logs.map(log => (
            <SupervisionItem
              key={log.id}
              log={log}
              onUpdate={(c) => onUpdate(log.id, c)}
              onDelete={() => onDelete(log.id)}
              defaultExpanded={log.id === recentlyAddedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// QuickAddSvRow - 슈퍼비전 한 줄 빠른 입력
function QuickAddSvRow({ onAdd, mainSupervisor }) {
  const [date, setDate] = useState(todayYMD());
  const [supervisor, setSupervisor] = useState(mainSupervisor || '');
  const [hours, setHours] = useState('');
  const [type, setType] = useState('individual');

  const presets = [0.5, 1, 1.5, 2, 3];

  const handleSubmit = async () => {
    const h = Number(hours);
    if (!h || h <= 0) {
      await window.appAlert('시간을 입력하세요');
      return;
    }
    onAdd({ date, supervisor, hours: h, type });
    setHours(''); // 날짜·슈퍼바이저·type 유지
  };

  return (
    <div style={{
      background: C.pinkPale, border: `1px dashed ${C.pinkLight}`, borderRadius: 10,
      padding: 14, marginBottom: 16
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ minWidth: 140 }}>
          <div style={{ fontSize: 10, color: C.grayText, fontWeight: 600, marginBottom: 4 }}>📅 날짜</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
                 style={{ ...logInputStyle, padding: '6px 8px', fontSize: 12 }} />
        </div>
        <div style={{ minWidth: 120 }}>
          <div style={{ fontSize: 10, color: C.grayText, fontWeight: 600, marginBottom: 4 }}>🎓 슈퍼바이저</div>
          <input type="text" value={supervisor} onChange={e => setSupervisor(e.target.value)}
                 list="supervisor-list"
                 placeholder="이름"
                 style={{ ...logInputStyle, padding: '6px 8px', fontSize: 12 }} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.grayText, fontWeight: 600, marginBottom: 4 }}>유형</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setType('individual')}
              style={{
                padding: '6px 10px', fontSize: 11, fontWeight: 600,
                border: `1.5px solid ${type === 'individual' ? C.goldDeep : '#E0D5D8'}`,
                borderRadius: 5,
                background: type === 'individual' ? C.goldDeep : C.white,
                color: type === 'individual' ? C.white : C.grayText,
                cursor: 'pointer', fontFamily: 'inherit'
              }}>
              👤 개별
            </button>
            <button onClick={() => setType('group')}
              style={{
                padding: '6px 10px', fontSize: 11, fontWeight: 600,
                border: `1.5px solid ${type === 'group' ? C.plumDark : '#E0D5D8'}`,
                borderRadius: 5,
                background: type === 'group' ? C.plumDark : C.white,
                color: type === 'group' ? C.white : C.grayText,
                cursor: 'pointer', fontFamily: 'inherit'
              }}>
              👥 그룹
            </button>
          </div>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontSize: 10, color: C.grayText, fontWeight: 600, marginBottom: 4 }}>⏱ 시간 (hr)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {presets.map(p => (
              <button key={p} onClick={() => setHours(String(p))}
                style={{
                  padding: '5px 10px', fontSize: 11, fontWeight: 600,
                  border: `1px solid ${Number(hours) === p ? C.plumDark : '#E0D5D8'}`,
                  borderRadius: 5,
                  background: Number(hours) === p ? C.plumDark : C.white,
                  color: Number(hours) === p ? C.white : C.grayText,
                  cursor: 'pointer', fontFamily: 'inherit'
                }}>
                {p}
              </button>
            ))}
            <input type="number" step="0.25" min="0"
                   value={hours} onChange={e => setHours(e.target.value)}
                   placeholder="직접"
                   style={{ ...logInputStyle, padding: '6px 8px', fontSize: 12, width: 70 }} />
          </div>
        </div>
        <button onClick={handleSubmit}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600,
                  background: C.pinkDeep, color: C.white, border: 'none', borderRadius: 6,
                  cursor: 'pointer', whiteSpace: 'nowrap'
                }}>
          + 추가
        </button>
      </div>
      <p style={{ margin: '8px 0 0 0', fontSize: 10, color: C.grayText, fontStyle: 'italic' }}>
        💡 추가하면 날짜·슈퍼바이저·유형은 유지되고, 시간만 비워집니다
      </p>
    </div>
  );
}

function SupervisionItem({ log, onUpdate, onDelete, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hrs = Number(log.hours) || 0;
  const isGroup = log.type === 'group';

  // 요약 헤더용 날짜 (월별 그룹 안이라 일자만)
  const dayOnly = (() => {
    if (!log.date) return '날짜 미입력';
    const parts = log.date.split('-');
    if (parts.length === 3) return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    return log.date;
  })();

  return (
    <div style={logCardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
           onClick={() => setExpanded(!expanded)}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.plumDark, minWidth: 50 }}>
            {dayOnly}
          </div>
          <div style={{ fontSize: 12, color: C.grayText }}>
            <strong style={{ color: C.plumDark }}>{fmt(hrs)} hr</strong>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
            background: isGroup ? '#E8E0F0' : '#FFE9AB',
            color: isGroup ? C.plumDark : '#B8860B'
          }}>
            {isGroup ? '👥 그룹' : '👤 개별'}
          </span>
          {log.supervisor && (
            <div style={{ fontSize: 11, color: C.grayText }}>· {log.supervisor}</div>
          )}
          {log.notes && (
            <div style={{ fontSize: 11, color: C.grayText, fontStyle: 'italic', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              📝 {log.notes}
            </div>
          )}
        </div>
        <button onClick={async (e) => { e.stopPropagation(); onDelete(); }} style={delBtnStyle}>🗑</button>
        <div style={{ fontSize: 13, color: C.grayText, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</div>
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

          {/* 그룹/개별 선택 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.grayText, fontWeight: 600, marginBottom: 6 }}>
              슈퍼비전 유형
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onUpdate({ type: 'individual' })}
                style={{
                  flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 600,
                  border: `1.5px solid ${!isGroup ? C.goldDeep : '#E0D5D8'}`,
                  borderRadius: 8,
                  background: !isGroup ? C.goldDeep : C.white,
                  color: !isGroup ? C.white : C.grayText,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s'
                }}>
                {!isGroup ? '✓ ' : ''}👤 개별 (Individual)
              </button>
              <button onClick={() => onUpdate({ type: 'group' })}
                style={{
                  flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 600,
                  border: `1.5px solid ${isGroup ? C.plumDark : '#E0D5D8'}`,
                  borderRadius: 8,
                  background: isGroup ? C.plumDark : C.white,
                  color: isGroup ? C.white : C.grayText,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s'
                }}>
                {isGroup ? '✓ ' : ''}👥 그룹 (Group)
              </button>
            </div>
            <p style={{ margin: '6px 0 0 0', fontSize: 10, color: C.grayText, fontStyle: 'italic' }}>
              💡 QABA 규정: 그룹 슈퍼비전은 <strong>그 달의 개별 시간만큼만 인정</strong>됩니다 (전체의 50%까지)
            </p>
          </div>

          <SvTimePicker
            label="슈퍼비전 시간"
            value={log.hours}
            onChange={(v) => onUpdate({ hours: v })}
          />

          <div style={rowStyle}>
            <Field label="메모" flex={1}>
              <textarea value={log.notes || ''} onChange={e => onUpdate({ notes: e.target.value })} style={{ ...logInputStyle, minHeight: 50, fontFamily: 'inherit' }} placeholder="이번 슈퍼비전에서 논의한 내용·받은 피드백 등 (선택사항)" />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================
// 📚 EXAM INFO TAB (정확한 공식 규정)
// ============================================
function ExamInfoTab({ currentExam }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.plumDark }}>📚 시험 정보</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 13, color: C.grayText }}>QABA(Qualified Applied Behavior Analysis Credentialing Board) 자격 안내</p>
      </div>

      <InfoBanner>
        ⚠️ <strong>본 정보는 참고용입니다.</strong> 정확한 최신 요건은 반드시 QABA 공식 사이트에서 확인하세요. 시험 요건은 변경될 수 있습니다.
      </InfoBanner>

      {/* 자격 준비 단계 (접힘) */}
      <CollapsibleSection title="🗺️ 자격 준비 단계 한눈에 보기 (7단계)">
        <div style={{ display: 'grid', gap: 12 }}>
          <PrepStep num="1" title="자격 선택" desc="본인 학력에 맞는 자격 선택 (석사 이상 → QBA, 학사 → QASP-S)" />
          <PrepStep num="2" title="코스워크 이수" desc="QABA 승인 교육기관에서 코스워크 수강 (QBA 270시간 · QASP-S 188시간)" />
          <PrepStep num="3" title="슈퍼바이저 매칭" desc="QBA의 경우 QBA를 1년 이상 보유한 슈퍼바이저, QASP-S의 경우 QBA(즉시 가능) 또는 석사급 ABA 관련 자격 보유자. 슈퍼비전 합의서 작성 후 시작" />
          <PrepStep num="4" title="필드워크 시작" desc="첫 코스워크 수업일 이후부터 시간 누적 가능. 월 20~140시간만 인정" />
          <PrepStep num="5" title="요건 충족" desc="필드워크 총 시간 + 매월 슈퍼비전 5% + 코스워크 + 추천서 + 배경 조회" />
          <PrepStep num="6" title="시험 응시" desc="QABA 공식 사이트에서 응시료 결제 후 시험 신청 (QBA $350 · QASP-S $300)" />
          <PrepStep num="7" title="자격 유지" desc="2년마다 CEU 이수 (QBA 32개 · QASP-S 20개) + 윤리 강령 동의 + 갱신 신청" />
        </div>
      </CollapsibleSection>

      {/* QBA - 자기 시험이면 자동 펼침 */}
      <CollapsibleSection
        title="🎓 QBA (Qualified Behavior Analyst)"
        defaultOpen={currentExam === 'QBA'}
        badge={currentExam === 'QBA' ? '내 시험' : null}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SimpleInfoRow label="대상" value="마스터급 행동분석가" />
          <SimpleInfoRow label="학력" value="석사 학위 이상 (관련 분야)" />
          <SimpleInfoRow label="코스워크" value="270시간 (18 학점) - 윤리 20hr, 자폐 핵심지식 20hr, 슈퍼비전 20hr 포함" />
          <SimpleInfoRow label="필드워크" value="총 2,000시간 (2026년 1월 1일 이후 시작자 기준)" />
          <SimpleInfoRow label="└ Direct" value="최대 800시간 (전체의 40% 이하) - 직접 치료·교육 시간" />
          <SimpleInfoRow label="└ Indirect" value="최소 1,200시간 (전체의 60% 이상) - 감독·계획·평가 등 간접 업무" />
          <SimpleInfoRow label="월별 시간 제한" value="최소 20시간 ~ 최대 140시간 (활발한 ABA 실무 필요)" />
          <SimpleInfoRow label="누적 기간" value="7년 이내" />
          <SimpleInfoRow label="슈퍼비전" value="매월 그 달 필드워크 시간의 5% · 총 100시간 (2,000hr × 5%)" />
          <SimpleInfoRow label="└ 그룹 슈퍼비전" value="개별 슈퍼비전 기간 동안 최대 50%까지 가능" />
          <SimpleInfoRow label="시험" value="125문항 (100 채점+25 시범), 3시간" />
          <SimpleInfoRow label="응시료" value="$350 USD (재시험 $225)" />
          <SimpleInfoRow label="재시험" value="30일 후 가능, 1년 4회 제한" />
          <SimpleInfoRow label="갱신" value="2년마다 32 CEU" />
        </div>
        <div style={{ marginTop: 12, padding: 10, background: '#FFF8E7', borderRadius: 6, fontSize: 11, color: '#7A5538', lineHeight: 1.6 }}>
          💡 <strong>경과조치</strong>: 2026년 1월 1일 이전 시작자는 1,500시간으로 인정. 단 시작일로부터 3년 내(2029년 1월 1일까지) 완료 필요.
        </div>
      </CollapsibleSection>

      {/* QASP-S - 자기 시험이면 자동 펼침 */}
      <CollapsibleSection
        title="🎓 QASP-S (Qualified Autism Service Practitioner - Supervisor)"
        defaultOpen={currentExam === 'QASP-S'}
        badge={currentExam === 'QASP-S' ? '내 시험' : null}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SimpleInfoRow label="대상" value="중간급 자폐 서비스 실무자 및 슈퍼바이저" />
          <SimpleInfoRow label="나이" value="만 18세 이상" />
          <SimpleInfoRow label="학력" value="학사 학위 이상 (관련 분야)" />
          <SimpleInfoRow label="코스워크" value="총 188시간 (180시간 ABA·윤리·자폐 + 별도 슈퍼비전 8시간)" />
          <SimpleInfoRow label="└ 세부" value="윤리 20hr 이상, 자폐 핵심지식 15hr 이상 포함" />
          <SimpleInfoRow label="필드워크" value="총 1,000시간" />
          <SimpleInfoRow label="└ 슈퍼바이저 역할" value="최소 600시간 (평가·데이터 검토·직원 교육·옹호 등 감독·관리·개발 업무)" />
          <SimpleInfoRow label="└ 1:1 직접 케어" value="최대 400시간 (직접 치료 가능, 400시간 초과 인정 X)" />
          <SimpleInfoRow label="월별 시간 제한" value="최소 20시간 ~ 최대 140시간 (활발한 ABA 실무 필요)" />
          <SimpleInfoRow label="누적 기간" value="7년 이내" />
          <SimpleInfoRow label="슈퍼비전" value="매월 5% (30일 주기) · 총 50시간 (1,000hr × 5%) · 실시간 화상 가능, 최소 1회는 대면 또는 실시간 1시간 필수" />
          <SimpleInfoRow label="└ 그룹 슈퍼비전" value="개별 슈퍼비전 기간 동안 최대 50%까지 가능" />
          <SimpleInfoRow label="시험" value="125문항 (100 채점+25 시범), 3시간, 합격 72%" />
          <SimpleInfoRow label="응시료" value="$300 USD" />
          <SimpleInfoRow label="재시험" value="30일 후 가능, 1년 4회 제한" />
          <SimpleInfoRow label="갱신" value="2년마다 20 CEU" />
        </div>
      </CollapsibleSection>

      {/* FAQ (접힘) */}
      <CollapsibleSection title="❓ 자주 묻는 질문 (FAQ)">
        <FAQItem
          q="필드워크 시간을 슈퍼바이저에게 어떻게 보고하나요?"
          a="대시보드 하단의 '슈퍼바이저별' 요약(슈퍼바이저 2명 이상일 때 자동 표시)에서 누적 시간을 확인할 수 있고, 우측 상단 '📊 엑셀 내보내기'로 QABA 제출용 보고서를 받을 수 있습니다. 필요시 백업(JSON)도 함께 전달하세요. 공식 인증은 QABA 온라인 시스템에서 슈퍼바이저가 직접 진행해야 합니다."
        />
        <FAQItem
          q="슈퍼비전 5%는 매월마다 채워야 하나요?"
          a="네, QABA 공식 규정상 슈퍼비전은 매월 단위로 5%를 충족해야 합니다. 이미 지난 달의 부족분은 다음 달에 보충하기 어려울 수 있으니, 미리 슈퍼바이저와 일정을 잡는 것이 좋습니다."
        />
        <FAQItem
          q="개별 슈퍼비전과 그룹 슈퍼비전의 차이는?"
          a={`개별 슈퍼비전은 슈퍼바이저와 1:1로 진행하는 것이고, 그룹 슈퍼비전은 여러 슈퍼바이지가 한 슈퍼바이저로부터 동시에 받는 것입니다.

QABA 규정상 그룹 슈퍼비전은 그 달의 개별 시간만큼만 인정됩니다(전체의 50%까지). 예를 들어 6월에 개별 1시간 + 그룹 3시간을 받으면, 그 달의 인정 시간은 1+1=2시간이고 그룹 2시간은 초과로 인정되지 않습니다. 

개별 시간은 한도 없이 100% 인정되므로, 개별 슈퍼비전을 충분히 받는 것이 중요합니다.`}
        />
        <FAQItem
          q="QASP-S에서 '슈퍼바이저 역할 600시간'이란 무엇인가요?"
          a="단순히 클라이언트와 1:1 작업하는 시간이 아니라, 프로그램을 설계하거나 다른 직원을 슈퍼비전하거나 평가를 진행하는 등 '감독·관리·개발' 성격의 업무를 의미합니다. 1,000시간 중 최소 600시간이 이런 역할이어야 합니다."
        />
        <FAQItem
          q="슈퍼바이저는 누구에게 받을 수 있나요?"
          a={`자격에 따라 다릅니다.

[QBA 추구 시] QBA 자격을 최소 1년 이상 보유한 사람, 또는 다른 공인 인증기관(예: BACB의 BCBA 등)에서 1년 이상 자격을 받은 행동분석가에게 받아야 합니다.

[QASP-S 추구 시] QBA 자격자(시험 통과 즉시 슈퍼비전 가능), 또는 석사급 이상의 ABA 관련 자격 보유자(예: BCBA)에게 받을 수 있습니다.

슈퍼바이저는 자격이 유효한 상태(만료되지 않음)여야 하며, 본인 자격증 보드의 윤리 강령을 준수해야 합니다. 슈퍼비전 시작 전 슈퍼비전 합의서(contract agreement) 작성이 필수입니다.`}
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
          a="이 시스템은 클라우드(Supabase)에 자동으로 저장됩니다. 브라우저를 닫거나 캐시를 지워도 데이터는 안전하게 보존되며, 다른 기기에서 로그인해도 동일한 데이터를 볼 수 있습니다. 그래도 걱정되시면 가끔 상단 '💾 백업' 버튼으로 JSON 파일을 받아두세요. 비밀번호 분실 시 검단ABA에 문의해주세요."
        />
        <FAQItem
          q="여러 기기(휴대폰·집·직장)에서 같이 쓸 수 있나요?"
          a="네! 클라우드 시스템이라 어디서든 같은 아이디로 로그인하면 동일한 데이터를 볼 수 있어요. 출근 길에 휴대폰으로 입력하고, 집에서 PC로 확인하셔도 됩니다. 보안을 위해 공용 PC에서는 사용 후 반드시 로그아웃해주세요."
        />
        <FAQItem
          q="비밀번호를 잊어버렸어요"
          a="검단ABA(관리자)에게 카톡이나 전화로 연락주세요. 관리자가 비밀번호를 새로 발급해드립니다. 보안상 본인 확인 후 처리되므로 시간이 약간 걸릴 수 있어요."
        />
        <FAQItem
          q="라이센스가 만료되면 어떻게 되나요?"
          a="라이센스 만료 시 로그인이 차단됩니다. 단, 그동안 입력한 데이터는 클라우드에 그대로 보존되니 안심하세요. 갱신을 원하시면 검단ABA에 문의해주세요. 재결제 후 즉시 다시 사용 가능합니다."
        />
      </CollapsibleSection>

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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${C.pinkSoft}` }}>
      <span style={{ fontSize: 12, color: C.grayText, fontWeight: 600, minWidth: 120, flex: '0 0 120px' }}>{label}</span>
      <span style={{ fontSize: 13, color: C.plumDark, flex: '1 1 200px' }}>{value}</span>
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
// 🔒 사용자 계정은 Supabase의 tracker_users 테이블에서 관리
// ============================================
// 관리자(admin)는 사이트 내 관리자 페이지에서 사용자를 추가/삭제할 수 있어요
// 형식: { user_id: '아이디', password: '비밀번호', name: '표시 이름', role: 'admin' | 'user', expires_at: '만료일' }

// ============================================
// 🔐 ADMIN PAGE (관리자 페이지 - 사용자 관리)
// ============================================
function AdminPage({ currentUser, onLogout, onSwitchToUserMode }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [search, setSearch] = useState('');
  const [statsCache, setStatsCache] = useState({}); // user.id -> stats

  const loadUsers = async () => {
    setLoading(true);
    const list = await fetchAllUsers();
    setUsers(list);
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, []);

  // 통계 자동 로드 (백그라운드)
  useEffect(() => {
    users.forEach(async (u) => {
      if (u.role !== 'user') return;
      if (statsCache[u.id]) return;
      const s = await fetchUserStats(u.id);
      setStatsCache(prev => ({ ...prev, [u.id]: s }));
    });
  }, [users]);

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.trim().toLowerCase();
    return users.filter(u => 
      u.user_id.toLowerCase().includes(q) || 
      (u.name || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  // 만료 임박/만료 상태 계산
  const getExpiryStatus = (expiresAt) => {
    if (!expiresAt) return { status: 'none', label: '무제한', color: C.grayText };
    const exp = new Date(expiresAt);
    const now = new Date();
    const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { status: 'expired', label: `만료 (${-diffDays}일 지남)`, color: C.dangerRed };
    if (diffDays < 30) return { status: 'warning', label: `${diffDays}일 남음`, color: C.warnYellow };
    return { status: 'ok', label: `${expiresAt} (${diffDays}일 남음)`, color: C.goodGreen };
  };

  return (
    <div style={{ fontFamily: '"Pretendard", "맑은 고딕", sans-serif', background: C.bg, minHeight: '100vh' }}>
      {/* 헤더 */}
      <header style={{ background: C.white, borderBottom: `1px solid ${C.pinkLight}`, padding: '20px 0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="검단ABA"
                 style={{ width: 48, height: 48, objectFit: 'contain' }} />
            <div>
              <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.pinkDeep }}>
                🔐 관리자 페이지
              </h1>
              <p style={{ margin: '4px 0 0 0', fontSize: 12, color: C.plumDark }}>
                검단ABA 자격시간 트래커 · 사용자 관리
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={onSwitchToUserMode}
                    title="일반 사용자 화면 미리보기"
                    style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: C.plumDark, background: C.pinkSoft, border: `1px solid ${C.pinkLight}`, borderRadius: 6, cursor: 'pointer' }}>
              👤 사용자 화면 보기
            </button>
            <button onClick={onLogout}
                    title="로그아웃"
                    style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: C.plumDark, background: C.pinkSoft, border: `1px solid ${C.pinkLight}`, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              🔒 {currentUser?.name || currentUser?.user_id}
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* 요약 카드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <SummaryBox label="전체 사용자" value={users.length} color={C.plumDark} icon="👥" />
          <SummaryBox label="활성 사용자" value={users.filter(u => u.is_active !== false).length} color={C.goodGreen} icon="✅" />
          <SummaryBox label="비활성 (차단됨)" value={users.filter(u => u.is_active === false).length} color={C.dangerRed} icon="🚫" />
          <SummaryBox label="만료 임박 (30일 이내)" value={users.filter(u => {
            if (!u.expires_at || u.is_active === false) return false;
            const exp = new Date(u.expires_at);
            const diff = (exp - new Date()) / (1000 * 60 * 60 * 24);
            return diff >= 0 && diff < 30;
          }).length} color={C.warnYellow} icon="⏰" />
          <SummaryBox label="관리자" value={users.filter(u => u.role === 'admin').length} color={C.goldDeep} icon="🔐" />
        </div>

        {/* 📊 사용자별 진행률 비교 */}
        <ProgressComparisonSection users={users.filter(u => u.role === 'user')} statsCache={statsCache} />

        {/* 검색 + 추가 버튼 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 아이디 또는 이름으로 검색..."
            style={{ flex: '1 1 240px', maxWidth: 360, padding: '10px 14px', fontSize: 13, border: '1px solid #E0D5D8', borderRadius: 8, background: C.white, fontFamily: 'inherit', outline: 'none' }}
          />
          <button onClick={() => setShowAddModal(true)}
                  style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700, color: C.white, background: C.pinkDeep, border: 'none', borderRadius: 8, cursor: 'pointer', boxShadow: '0 2px 6px rgba(216,136,150,0.25)' }}>
            + 새 사용자 추가
          </button>
        </div>

        {/* 사용자 목록 */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: C.grayText }}>🔄 사용자 목록 로딩 중...</div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: C.grayText, background: C.white, borderRadius: 12 }}>
            {search ? '검색 결과가 없습니다' : '아직 사용자가 없습니다'}
          </div>
        ) : (
          <div style={{ background: C.white, borderRadius: 12, padding: 6, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.pinkPale, color: C.plumDark }}>
                  <th style={thStyleAdm}>이름</th>
                  <th style={thStyleAdm}>아이디</th>
                  <th style={thStyleAdm}>상태</th>
                  <th style={thStyleAdm}>권한</th>
                  <th style={thStyleAdm}>만료일</th>
                  <th style={thStyleAdm}>슈퍼바이지/기록</th>
                  <th style={thStyleAdm}>생성일</th>
                  <th style={thStyleAdm}>관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => {
                  const expStatus = getExpiryStatus(u.expires_at);
                  const stats = statsCache[u.id];
                  const isCurrentUser = u.id === currentUser?.id;
                  const isActive = u.is_active !== false; // null이나 undefined도 true 취급
                  return (
                    <tr key={u.id} style={{ borderBottom: `1px solid ${C.pinkLight}`, opacity: isActive ? 1 : 0.55 }}>
                      <td style={tdStyleAdm}>
                        <strong style={{ color: C.plumDark }}>{u.name}</strong>
                        {isCurrentUser && <span style={{ fontSize: 10, marginLeft: 6, padding: '2px 6px', background: C.pinkDeep, color: C.white, borderRadius: 8 }}>나</span>}
                      </td>
                      <td style={tdStyleAdm}><code style={{ fontSize: 12 }}>{u.user_id}</code></td>
                      <td style={tdStyleAdm}>
                        {isActive
                          ? <span style={{ fontSize: 11, padding: '3px 8px', background: '#E8F5E9', color: C.goodGreen, borderRadius: 10, fontWeight: 600 }}>✅ 활성</span>
                          : <span style={{ fontSize: 11, padding: '3px 8px', background: '#FFE5E5', color: C.dangerRed, borderRadius: 10, fontWeight: 600 }}>🚫 차단</span>}
                      </td>
                      <td style={tdStyleAdm}>
                        {u.role === 'admin'
                          ? <span style={{ fontSize: 11, padding: '3px 8px', background: '#FFF4E6', color: C.goldDeep, borderRadius: 10, fontWeight: 600 }}>관리자</span>
                          : <span style={{ fontSize: 11, padding: '3px 8px', background: C.pinkSoft, color: C.plumDark, borderRadius: 10, fontWeight: 600 }}>사용자</span>}
                      </td>
                      <td style={{ ...tdStyleAdm, color: expStatus.color, fontWeight: expStatus.status === 'expired' ? 700 : 500 }}>
                        {expStatus.label}
                      </td>
                      <td style={tdStyleAdm}>
                        {stats ? (
                          <span style={{ fontSize: 11, color: C.grayText }}>
                            슈퍼바이지 {stats.superviseeCount}명 · FW {stats.fieldworkCount} · SV {stats.supervisionCount}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: '#CCC' }}>로딩...</span>
                        )}
                      </td>
                      <td style={{ ...tdStyleAdm, fontSize: 11, color: C.grayText }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}
                      </td>
                      <td style={tdStyleAdm}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {!isCurrentUser && (
                            isActive ? (
                              <button onClick={async () => {
                                if (await window.appConfirm(`'${u.name}' 계정을 차단하시겠습니까?\n\n• 차단 즉시 로그인이 불가능해집니다\n• 데이터는 보존되며, 언제든 다시 활성화할 수 있습니다`)) {
                                  const ok = await toggleUserActive(u.id, false);
                                  if (ok) loadUsers();
                                  else await window.appAlert('차단 실패');
                                }
                              }}
                                      title="로그인 차단 (데이터는 보존)"
                                      style={{ padding: '5px 10px', background: '#FFE5E5', color: C.dangerRed, border: '1px solid #FFD0D0', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                                🚫 차단
                              </button>
                            ) : (
                              <button onClick={async () => {
                                const ok = await toggleUserActive(u.id, true);
                                if (ok) loadUsers();
                                else await window.appAlert('활성화 실패');
                              }}
                                      title="다시 활성화"
                                      style={{ padding: '5px 10px', background: '#E8F5E9', color: C.goodGreen, border: '1px solid #C8E6C9', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                                ✅ 활성화
                              </button>
                            )
                          )}
                          <button onClick={() => setEditingUser(u)}
                                  style={{ padding: '5px 10px', background: C.pinkSoft, color: C.plumDark, border: `1px solid ${C.pinkLight}`, borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                            ✏️ 수정
                          </button>
                          {!isCurrentUser && (
                            <button onClick={async () => {
                              if (await window.appConfirm(`'${u.name}' (${u.user_id}) 사용자를 영구 삭제하시겠습니까?\n\n⚠️ 이 사용자의 모든 슈퍼바이지·필드워크·슈퍼비전 기록이 영구 삭제됩니다.\n\n💡 데이터는 보존하고 로그인만 막으려면 '🚫 차단'을 사용하세요.`)) {
                                const ok = await deleteUser(u.id);
                                if (ok) loadUsers();
                                else await window.appAlert('삭제 실패');
                              }
                            }}
                                    style={{ padding: '5px 10px', background: '#FFF0F0', color: C.dangerRed, border: '1px solid #FFD0D0', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                              🗑 삭제
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <footer style={{ background: C.pinkPale, padding: '20px 24px', textAlign: 'center', borderTop: `1px solid ${C.pinkLight}`, marginTop: 40 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.plumDark }}>© 검단ABA언어행동연구소 · All Rights Reserved</div>
      </footer>

      {/* 추가 모달 */}
      {showAddModal && (
        <UserFormModal
          mode="add"
          onClose={() => setShowAddModal(false)}
          onSave={async (form) => {
            const result = await createUser(form);
            if (result.success) {
              await loadUsers();
              setShowAddModal(false);
              await window.appAlert(`✅ 사용자가 추가되었습니다.\n\n아이디: ${form.user_id}\n비밀번호: ${form.password}\n\n📋 카톡 발송용:\n검단ABA 자격시간 트래커 계정 안내\n🔗 https://aba-geomdan.github.io/geomdan-tracker/\n👤 아이디: ${form.user_id}\n🔑 비밀번호: ${form.password}${form.expires_at ? `\n📅 유효기간: ${form.expires_at}까지` : ''}`);
            } else {
              await window.appAlert('추가 실패: ' + (result.error || '오류'));
            }
          }}
        />
      )}

      {/* 수정 모달 */}
      {editingUser && (
        <UserFormModal
          mode="edit"
          initial={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={async (form) => {
            const changes = { ...form };
            // 비밀번호가 빈 값이면 변경 안 함
            if (!changes.password) delete changes.password;
            const result = await updateUser(editingUser.id, changes);
            if (result.success) {
              await loadUsers();
              setEditingUser(null);
              await window.appAlert('✅ 사용자 정보가 수정되었습니다');
            } else {
              await window.appAlert('수정 실패: ' + (result.error || '오류'));
            }
          }}
        />
      )}
    </div>
  );
}

const thStyleAdm = { padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 700, borderBottom: `2px solid ${C.pinkLight}` };
const tdStyleAdm = { padding: '12px', fontSize: 13, color: C.grayHead, verticalAlign: 'middle' };

function SummaryBox({ label, value, color, icon }) {
  return (
    <div style={{ background: C.white, borderRadius: 10, padding: 16, border: `1px solid ${C.pinkLight}` }}>
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 11, color: C.grayText, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// 📊 사용자별 진행률 비교 (관리자 페이지 전용)
function ProgressComparisonSection({ users, statsCache }) {
  const [collapsed, setCollapsed] = useState(false);
  const [sortBy, setSortBy] = useState('progress'); // 'progress' | 'name' | 'fwHours'
  
  // 통계가 로딩된 사용자만 추리고 정렬
  const usersWithStats = useMemo(() => {
    return users.map(u => ({
      ...u,
      stats: statsCache[u.id] || null
    })).filter(u => u.stats);
  }, [users, statsCache]);
  
  const sorted = useMemo(() => {
    const arr = [...usersWithStats];
    if (sortBy === 'progress') arr.sort((a, b) => (b.stats.progress || 0) - (a.stats.progress || 0));
    else if (sortBy === 'name') arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sortBy === 'fwHours') arr.sort((a, b) => (b.stats.totalFwHours || 0) - (a.stats.totalFwHours || 0));
    return arr;
  }, [usersWithStats, sortBy]);
  
  // 전체 평균 통계
  const totals = useMemo(() => {
    if (usersWithStats.length === 0) return null;
    const totalFw = usersWithStats.reduce((s, u) => s + (u.stats.totalFwHours || 0), 0);
    const totalSv = usersWithStats.reduce((s, u) => s + (u.stats.totalSvHours || 0), 0);
    const avgProgress = usersWithStats.reduce((s, u) => s + (u.stats.progress || 0), 0) / usersWithStats.length;
    const completed = usersWithStats.filter(u => (u.stats.progress || 0) >= 100).length;
    return { totalFw, totalSv, avgProgress, completed };
  }, [usersWithStats]);
  
  if (users.length === 0) return null;
  
  return (
    <div style={{ background: C.white, borderRadius: 12, padding: 20, marginBottom: 20, border: `1px solid ${C.pinkLight}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.plumDark, display: 'flex', alignItems: 'center', gap: 6 }}>
          📊 사용자별 진행률 비교
          <span style={{ fontSize: 11, fontWeight: 400, color: C.grayText }}>({usersWithStats.length}명)</span>
        </h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  style={{ padding: '5px 10px', fontSize: 11, border: '1px solid #E0D5D8', borderRadius: 5, background: C.white, color: C.plumDark, cursor: 'pointer', outline: 'none' }}>
            <option value="progress">진행률 높은 순</option>
            <option value="fwHours">필드워크 시간 순</option>
            <option value="name">이름 가나다순</option>
          </select>
          <button onClick={() => setCollapsed(!collapsed)}
                  style={{ padding: '5px 10px', fontSize: 11, background: C.pinkSoft, color: C.plumDark, border: `1px solid ${C.pinkLight}`, borderRadius: 5, cursor: 'pointer' }}>
            {collapsed ? '▼ 펼치기' : '▲ 접기'}
          </button>
        </div>
      </div>
      
      {/* 전체 요약 */}
      {totals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16, padding: 12, background: C.pinkPale, borderRadius: 8 }}>
          <div style={{ fontSize: 12 }}>
            <div style={{ color: C.grayText, marginBottom: 2 }}>전체 필드워크 시간</div>
            <strong style={{ color: C.pinkDeep, fontSize: 16 }}>{totals.totalFw.toFixed(1)} hr</strong>
          </div>
          <div style={{ fontSize: 12 }}>
            <div style={{ color: C.grayText, marginBottom: 2 }}>전체 슈퍼비전 시간</div>
            <strong style={{ color: C.plumDark, fontSize: 16 }}>{totals.totalSv.toFixed(1)} hr</strong>
          </div>
          <div style={{ fontSize: 12 }}>
            <div style={{ color: C.grayText, marginBottom: 2 }}>평균 진행률</div>
            <strong style={{ color: C.goldDeep, fontSize: 16 }}>{totals.avgProgress.toFixed(1)}%</strong>
          </div>
          <div style={{ fontSize: 12 }}>
            <div style={{ color: C.grayText, marginBottom: 2 }}>완료한 사용자</div>
            <strong style={{ color: C.goodGreen, fontSize: 16 }}>{totals.completed}명</strong>
          </div>
        </div>
      )}
      
      {/* 진행률 막대그래프 */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: C.grayText, fontSize: 13 }}>
              아직 통계 로딩 중이거나 일반 사용자가 없습니다
            </div>
          ) : sorted.map(u => {
            const s = u.stats;
            const isComplete = s.progress >= 100;
            const isInactive = u.is_active === false;
            const barColor = isComplete ? C.goodGreen : (s.progress >= 50 ? C.pinkDeep : C.pinkMid);
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', opacity: isInactive ? 0.5 : 1 }}>
                <div style={{ flex: '0 0 120px', minWidth: 100 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.plumDark }}>
                    👤 {u.name}
                    {isInactive && <span style={{ fontSize: 9, marginLeft: 4, color: C.dangerRed }}>🚫</span>}
                  </div>
                  <div style={{ fontSize: 10, color: C.grayText }}>{s.examType}</div>
                </div>
                <div style={{ flex: '1 1 200px', minWidth: 160 }}>
                  <div style={{ height: 18, background: C.pinkSoft, borderRadius: 9, overflow: 'hidden', position: 'relative' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, s.progress)}%`,
                      background: barColor,
                      borderRadius: 9,
                      transition: 'width 0.6s ease',
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6
                    }}>
                      {s.progress >= 30 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: C.white }}>
                          {s.progress >= 100 ? '100%+' : s.progress.toFixed(1) + '%'}
                        </span>
                      )}
                    </div>
                    {s.progress < 30 && (
                      <span style={{ position: 'absolute', left: `${Math.max(2, s.progress + 2)}%`, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, color: C.plumDark }}>
                        {s.progress.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ flex: '0 0 auto', fontSize: 11, color: C.grayText, whiteSpace: 'nowrap' }}>
                  FW <strong style={{ color: C.pinkDeep }}>{s.totalFwHours.toFixed(0)}</strong>/{s.target}hr ·
                  SV <strong style={{ color: C.plumDark }}>{s.totalSvHours.toFixed(0)}</strong>hr
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 사용자 추가/수정 모달
function UserFormModal({ mode, initial, onClose, onSave }) {
  const [form, setForm] = useState({
    user_id: initial?.user_id || '',
    password: '',
    name: initial?.name || '',
    role: initial?.role || 'user',
    expires_at: initial?.expires_at ? initial.expires_at.substring(0, 10) : ''
  });

  const isEdit = mode === 'edit';

  // 1년 후 만료일 자동 채우기 헬퍼
  const setExpiryFromNow = (months) => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    setForm(p => ({ ...p, expires_at: d.toISOString().substring(0, 10) }));
  };

  const handleSubmit = async () => {
    if (!form.user_id.trim()) { await window.appAlert('아이디를 입력하세요'); return; }
    if (!form.name.trim()) { await window.appAlert('이름을 입력하세요'); return; }
    if (!isEdit && !form.password.trim()) { await window.appAlert('비밀번호를 입력하세요'); return; }
    
    const payload = {
      user_id: form.user_id.trim(),
      name: form.name.trim(),
      role: form.role,
      expires_at: form.expires_at || null
    };
    if (form.password.trim()) payload.password = form.password.trim();
    onSave(payload);
  };

  // 랜덤 비밀번호 생성
  const generatePassword = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setForm(p => ({ ...p, password: pw }));
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, maxWidth: 480, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.pinkLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, color: C.pinkDeep, fontSize: 18 }}>
            {isEdit ? '✏️ 사용자 정보 수정' : '➕ 새 사용자 추가'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: C.grayText, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <AdminField label="이름" required>
            <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                   placeholder="예: 민다솔" style={modalInputStyle} />
          </AdminField>

          <AdminField label="아이디" required hint={isEdit ? '아이디는 수정 가능하지만 로그인에 영향을 줍니다' : '영문/숫자 권장, 한글 가능'}>
            <input type="text" value={form.user_id} onChange={e => setForm(p => ({ ...p, user_id: e.target.value }))}
                   placeholder="예: mindasol" style={modalInputStyle} />
          </AdminField>

          <AdminField label={isEdit ? '비밀번호 (변경 시에만 입력)' : '비밀번호'} required={!isEdit}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="text" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                     placeholder={isEdit ? '비워두면 변경 안 됨' : '예: mds2026'} style={{ ...modalInputStyle, flex: 1 }} />
              <button onClick={generatePassword}
                      style={{ padding: '8px 12px', background: C.pinkSoft, color: C.plumDark, border: `1px solid ${C.pinkLight}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                🎲 랜덤
              </button>
            </div>
          </AdminField>

          <AdminField label="권한">
            <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                    style={modalInputStyle}>
              <option value="user">👤 일반 사용자 (슈퍼바이지)</option>
              <option value="admin">🔐 관리자</option>
            </select>
          </AdminField>

          <AdminField label="만료일" hint="비워두면 무제한 사용 가능">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={form.expires_at} onChange={e => setForm(p => ({ ...p, expires_at: e.target.value }))}
                     style={{ ...modalInputStyle, flex: '1 1 140px' }} />
              <button onClick={() => setExpiryFromNow(1)}
                      style={chipBtnStyle}>+1개월</button>
              <button onClick={() => setExpiryFromNow(6)}
                      style={chipBtnStyle}>+6개월</button>
              <button onClick={() => setExpiryFromNow(12)}
                      style={chipBtnStyle}>+1년</button>
              <button onClick={() => setForm(p => ({ ...p, expires_at: '' }))}
                      style={chipBtnStyle}>무제한</button>
            </div>
          </AdminField>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={onClose}
                    style={{ flex: 1, padding: '11px', fontSize: 13, fontWeight: 600, color: C.grayText, background: C.white, border: `1px solid ${C.pinkLight}`, borderRadius: 8, cursor: 'pointer' }}>
              취소
            </button>
            <button onClick={handleSubmit}
                    style={{ flex: 2, padding: '11px', fontSize: 13, fontWeight: 700, color: C.white, background: C.pinkDeep, border: 'none', borderRadius: 8, cursor: 'pointer', boxShadow: '0 2px 6px rgba(216,136,150,0.25)' }}>
              {isEdit ? '✅ 수정 저장' : '➕ 사용자 추가'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminField({ label, required, hint, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.grayHead, marginBottom: 5 }}>
        {label} {required && <span style={{ color: C.dangerRed }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ marginTop: 4, fontSize: 10, color: C.grayText, fontStyle: 'italic' }}>{hint}</div>}
    </div>
  );
}

const modalInputStyle = { width: '100%', padding: '9px 12px', fontSize: 13, border: '1px solid #E0D5D8', borderRadius: 6, background: C.inputBg, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
const chipBtnStyle = { padding: '7px 10px', fontSize: 11, fontWeight: 600, color: C.plumDark, background: C.pinkSoft, border: `1px solid ${C.pinkLight}`, borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' };

// ============================================
// 🔒 LOGIN SCREEN (아이디 + 비밀번호 로그인 화면)
// ============================================
function LoginScreen({ onLogin }) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  // 🔒 잠금 상태 (localStorage에서 복원)
  const [attempts, setAttempts] = useState(() => {
    try { return parseInt(localStorage.getItem('geomdan_login_attempts') || '0', 10); }
    catch (e) { return 0; }
  });
  const [lockUntil, setLockUntil] = useState(() => {
    try {
      const v = localStorage.getItem('geomdan_login_lock_until');
      return v ? parseInt(v, 10) : 0;
    } catch (e) { return 0; }
  });
  const [now, setNow] = useState(Date.now());

  const MAX_ATTEMPTS = 5;
  const LOCK_DURATION = 30 * 60 * 1000; // 30분
  const isLocked = lockUntil > now;
  const remainingMs = Math.max(0, lockUntil - now);
  const remainingMin = Math.floor(remainingMs / 60000);
  const remainingSec = Math.floor((remainingMs % 60000) / 1000);

  // 잠금 시간 카운트다운 (1초마다 업데이트)
  useEffect(() => {
    if (!isLocked) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockUntil) {
        // 잠금 해제
        try {
          localStorage.removeItem('geomdan_login_lock_until');
          localStorage.removeItem('geomdan_login_attempts');
        } catch (e) {}
        setLockUntil(0);
        setAttempts(0);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isLocked, lockUntil]);

  const [loggingIn, setLoggingIn] = useState(false);

  const handleSubmit = async () => {
    if (isLocked) return; // 잠금 중엔 무시
    if (loggingIn) return; // 중복 클릭 방지
    if (!userId.trim() || !password.trim()) {
      setError('아이디와 비밀번호를 모두 입력해주세요');
      return;
    }

    setLoggingIn(true);
    const result = await authLogin(userId.trim(), password);
    setLoggingIn(false);

    if (result.success) {
      // 성공 - 카운터 초기화
      try {
        localStorage.removeItem('geomdan_login_attempts');
        localStorage.removeItem('geomdan_login_lock_until');
      } catch (e) {}
      onLogin(result.user);
    } else {
      // 만료/비활성은 ID/PW는 맞은 거니까 시도 횟수에 카운트 안 함
      const isAuthError = result.error?.includes('아이디') || result.error?.includes('비밀번호');
      
      if (!isAuthError) {
        // 만료/차단 메시지는 그대로 표시
        setError(result.error);
        setPassword('');
        return;
      }
      
      // 진짜 ID/PW 틀린 경우만 카운트
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      try { localStorage.setItem('geomdan_login_attempts', String(newAttempts)); } catch (e) {}

      if (newAttempts >= MAX_ATTEMPTS) {
        // 5회 실패 - 30분 잠금
        const until = Date.now() + LOCK_DURATION;
        setLockUntil(until);
        try { localStorage.setItem('geomdan_login_lock_until', String(until)); } catch (e) {}
        setError(`보안을 위해 30분간 로그인이 제한됩니다`);
      } else {
        setError(`${result.error} (${newAttempts}/${MAX_ATTEMPTS}회 실패)`);
      }
      setPassword('');
    }
  };

  const handleKeyDown = async (e) => {
    if (e.key === 'Enter') handleSubmit();
  };

  const inputStyleLogin = (hasError) => ({
    width: '100%',
    padding: '13px 16px',
    fontSize: 14,
    border: `1.5px solid ${hasError ? C.dangerRed : '#E0D5D8'}`,
    borderRadius: 8,
    background: C.inputBg,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s'
  });

  return (
    <div style={{
      fontFamily: '"Pretendard", "맑은 고딕", -apple-system, sans-serif',
      background: `linear-gradient(135deg, ${C.pinkSoft} 0%, ${C.pinkPale} 50%, ${C.bg} 100%)`,
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20
    }}>
      {/* 로고 + 타이틀 */}
      <div style={{ marginBottom: 28, textAlign: 'center' }}>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="검단ABA"
             style={{ width: 80, height: 80, objectFit: 'contain', marginBottom: 12 }} />
        <h1 style={{ margin: '0 0 4px 0', fontSize: 22, fontWeight: 700, color: C.pinkDeep, letterSpacing: '-0.5px' }}>
          검단ABA 자격시간 트래커
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: C.grayText }}>
          QABA QBA·QASP-S 슈퍼비전 시간 관리 시스템
        </p>
      </div>

      {/* 로그인 카드 */}
      <div style={{
        background: C.white,
        borderRadius: 16,
        padding: 32,
        maxWidth: 400,
        width: '100%',
        boxShadow: '0 4px 24px rgba(216,136,150,0.15)',
        border: `1px solid ${C.pinkLight}`
      }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 32, marginBottom: 6 }}>🔒</div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: 17, fontWeight: 700, color: C.plumDark }}>
            로그인
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: C.grayText, lineHeight: 1.5 }}>
            검단ABA에서 발급받은 계정 정보를 입력해주세요
          </p>
        </div>

        {/* 아이디 */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.grayHead, marginBottom: 5 }}>
            아이디
          </label>
          <input
            type="text"
            value={userId}
            onChange={async (e) => { setUserId(e.target.value); setError(''); }}
            onKeyDown={handleKeyDown}
            placeholder="아이디 입력"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            name={`uid_${Math.random()}`}
            disabled={isLocked}
            style={{ ...inputStyleLogin(error), opacity: isLocked ? 0.5 : 1, cursor: isLocked ? 'not-allowed' : 'text' }}
          />
        </div>

        {/* 비밀번호 */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.grayHead, marginBottom: 5 }}>
            비밀번호
          </label>
          <input
            type="password"
            value={password}
            onChange={async (e) => { setPassword(e.target.value); setError(''); }}
            onKeyDown={handleKeyDown}
            placeholder="비밀번호 입력"
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            name={`pw_${Math.random()}`}
            disabled={isLocked}
            style={{ ...inputStyleLogin(error), opacity: isLocked ? 0.5 : 1, cursor: isLocked ? 'not-allowed' : 'text' }}
          />
        </div>

        {/* 잠금 상태 - 카운트다운 */}
        {isLocked && (
          <div style={{ marginBottom: 12, padding: 14, background: '#FFE5E5', border: `2px solid ${C.dangerRed}`, borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🚫</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.dangerRed, marginBottom: 4 }}>
              로그인이 일시 차단되었습니다
            </div>
            <div style={{ fontSize: 11, color: C.grayHead, marginBottom: 8, lineHeight: 1.5 }}>
              보안을 위해 5회 연속 실패 시 30분간 잠금됩니다
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.plumDark, fontFamily: 'monospace' }}>
              {String(remainingMin).padStart(2, '0')}:{String(remainingSec).padStart(2, '0')}
            </div>
            <div style={{ fontSize: 10, color: C.grayText, marginTop: 4 }}>
              남은 시간 (분:초)
            </div>
          </div>
        )}

        {/* 에러 메시지 (잠금 아닐 때만) */}
        {error && !isLocked && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#FFF0F0', border: '1px solid #FFD0D0', borderRadius: 6, fontSize: 12, color: C.dangerRed, lineHeight: 1.5 }}>
            ⚠ {error}
            {attempts >= 3 && (
              <div style={{ marginTop: 4, fontSize: 11, color: C.grayText }}>
                💡 비밀번호 분실 시 검단ABA에 문의해주세요
              </div>
            )}
          </div>
        )}

        {/* 로그인 버튼 */}
        <button onClick={handleSubmit}
                disabled={!userId || !password || isLocked || loggingIn}
                style={{
                  width: '100%',
                  padding: '13px 16px',
                  fontSize: 14,
                  fontWeight: 700,
                  color: C.white,
                  background: (userId && password && !isLocked && !loggingIn) ? C.pinkDeep : '#D0C5C8',
                  border: 'none',
                  borderRadius: 8,
                  cursor: (userId && password && !isLocked && !loggingIn) ? 'pointer' : 'not-allowed',
                  transition: 'background 0.15s',
                  boxShadow: (userId && password && !isLocked && !loggingIn) ? '0 2px 6px rgba(216,136,150,0.25)' : 'none'
                }}>
          {isLocked ? '🔒 로그인 차단됨' : (loggingIn ? '🔄 로그인 중...' : '로그인')}
        </button>

        <div style={{ marginTop: 18, padding: 12, background: C.pinkPale, borderRadius: 8, fontSize: 11, color: C.grayHead, lineHeight: 1.6 }}>
          💡 <strong>이용 안내</strong><br/>
          본 시스템은 <strong>검단ABA언어행동연구소</strong>의 라이센스 사용자 전용입니다. 
          미허가 사용은 금지되며, 계정 공유·유출 시 라이센스가 취소될 수 있습니다.
        </div>
      </div>

      {/* 푸터 */}
      <div style={{ marginTop: 28, textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.plumDark, marginBottom: 4 }}>
          © 검단ABA언어행동연구소 · All Rights Reserved
        </div>
        <div style={{ fontSize: 10, color: C.grayText, fontStyle: 'italic' }}>
          무단 복제·배포·재판매 금지 · 저작권법에 의해 보호됨
        </div>
      </div>
    </div>
  );
}

// ============================================
// 빈 상태 - 슈퍼바이지 없을 때
// ============================================
function EmptyStateNoSupervisee({ onAdd }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${C.pinkSoft} 0%, ${C.pinkPale} 100%)`,
      border: `2px dashed ${C.pinkLight}`,
      borderRadius: 16,
      padding: 60,
      textAlign: 'center'
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>👤</div>
      <h2 style={{ margin: '0 0 12px 0', color: C.pinkDeep, fontSize: 22, fontWeight: 700 }}>
        시작하려면 슈퍼바이지를 추가하세요
      </h2>
      <p style={{ margin: '0 0 24px 0', fontSize: 14, color: C.plumDark, lineHeight: 1.7, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
        본인이 자격 준비자라면 본인 이름을, 슈퍼바이저라면 슈퍼비전하는 자격 준비자(들)을 추가할 수 있어요.
        <br/>한 계정에서 여러 슈퍼바이지를 관리할 수 있습니다.
      </p>
      <button onClick={onAdd}
              style={{ padding: '14px 28px', fontSize: 15, fontWeight: 700, color: C.white, background: C.pinkDeep, border: 'none', borderRadius: 8, cursor: 'pointer', boxShadow: '0 2px 8px rgba(216,136,150,0.3)' }}>
        + 첫 슈퍼바이지 추가
      </button>
    </div>
  );
}

// ============================================
// 슈퍼바이지 관리 모달 (추가/삭제/이름변경/시험변경)
// ============================================
function ManageSuperviseesModal({ supervisees, activeId, onAdd, onRemove, onRename, onChangeExam, onSelect, onClose }) {
  const [newName, setNewName] = useState('');
  const [newExam, setNewExam] = useState('QASP-S');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) {
      await window.appAlert('이름을 입력하세요');
      return;
    }
    if (supervisees.some(s => s.name === name)) {
      if (!await window.appConfirm(`'${name}' 이름의 슈퍼바이지가 이미 있어요. 그래도 추가할까요?`)) return;
    }
    const id = await onAdd(name, newExam);
    setNewName('');
    // 새로 추가한 슈퍼바이지로 자동 전환
    if (id) onSelect(id);
  };

  const handleRemove = async (id, name) => {
    const sv = supervisees.find(s => s.id === id);
    const hasData = sv && ((sv.fieldworkLogs || []).length > 0 || (sv.supervisionLogs || []).length > 0);
    const msg = hasData
      ? `'${name}'의 모든 필드워크·슈퍼비전 기록이 영구 삭제됩니다.\n\n정말 삭제하시겠어요?`
      : `'${name}' 슈퍼바이지를 삭제할까요?`;
    if (await window.appConfirm(msg)) {
      onRemove(id);
    }
  };

  const startEdit = (sv) => {
    setEditingId(sv.id);
    setEditName(sv.name);
  };

  const saveEdit = async () => {
    if (editingId && editName.trim()) {
      onRename(editingId, editName);
      setEditingId(null);
      setEditName('');
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, maxWidth: 600, maxHeight: '85vh', width: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.pinkLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, color: C.pinkDeep, fontSize: 20 }}>👥 슈퍼바이지 관리</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, color: C.grayText, cursor: 'pointer', padding: '4px 8px' }}>✕</button>
        </div>
        <div style={{ padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 새 슈퍼바이지 추가 */}
          <div style={{ padding: 14, background: C.pinkPale, borderRadius: 10, border: `1px dashed ${C.pinkLight}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.plumDark, marginBottom: 8 }}>➕ 새 슈퍼바이지 추가</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="이름 입력 후 Enter"
                style={{ flex: '1 1 180px', padding: '8px 12px', fontSize: 13, border: '1px solid #E0D5D8', borderRadius: 6, background: C.inputBg, fontFamily: 'inherit', outline: 'none' }}
              />
              <select value={newExam} onChange={e => setNewExam(e.target.value)}
                      style={{ padding: '8px 12px', fontSize: 13, border: '1px solid #E0D5D8', borderRadius: 6, background: C.white, color: C.plumDark, cursor: 'pointer' }}>
                <option value="QBA">QBA</option>
                <option value="QASP-S">QASP-S</option>
              </select>
              <button onClick={handleAdd}
                      style={{ padding: '8px 16px', background: C.pinkDeep, color: C.white, border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                + 추가
              </button>
            </div>
          </div>

          {/* 현재 슈퍼바이지 목록 */}
          {supervisees.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.grayText, fontSize: 13 }}>
              아직 추가된 슈퍼바이지가 없어요. 위에서 추가해보세요.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.plumDark, marginBottom: 8 }}>
                현재 슈퍼바이지 ({supervisees.length}명)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {supervisees.map(sv => {
                  const isActive = sv.id === activeId;
                  const fwCount = (sv.fieldworkLogs || []).length;
                  const svCount = (sv.supervisionLogs || []).length;
                  const isEditing = editingId === sv.id;
                  return (
                    <div key={sv.id} style={{
                      padding: 12,
                      background: isActive ? C.pinkSoft : C.white,
                      border: `1.5px solid ${isActive ? C.pinkDeep : C.pinkLight}`,
                      borderRadius: 10,
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'
                    }}>
                      {isEditing ? (
                        <>
                          <input
                            type="text" value={editName} onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveEdit()}
                            autoFocus
                            style={{ flex: '1 1 150px', padding: '6px 10px', fontSize: 13, border: '1px solid #E0D5D8', borderRadius: 5, background: C.inputBg, fontFamily: 'inherit', outline: 'none' }}
                          />
                          <button onClick={saveEdit}
                                  style={{ padding: '6px 12px', background: C.goodGreen, color: C.white, border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>저장</button>
                          <button onClick={() => setEditingId(null)}
                                  style={{ padding: '6px 12px', background: C.white, color: C.grayText, border: '1px solid #E0D5D8', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>취소</button>
                        </>
                      ) : (
                        <>
                          <div style={{ flex: 1, minWidth: 100 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: C.plumDark }}>
                              👤 {sv.name}
                              {isActive && <span style={{ fontSize: 10, marginLeft: 6, padding: '2px 6px', background: C.pinkDeep, color: C.white, borderRadius: 8 }}>활성</span>}
                            </div>
                            <div style={{ fontSize: 11, color: C.grayText, marginTop: 2 }}>
                              <select value={sv.examType} onChange={e => onChangeExam(sv.id, e.target.value)}
                                      style={{ padding: '2px 6px', fontSize: 11, border: '1px solid #E0D5D8', borderRadius: 4, background: C.white, color: C.plumDark, cursor: 'pointer', marginRight: 6 }}>
                                <option value="QBA">QBA</option>
                                <option value="QASP-S">QASP-S</option>
                              </select>
                              · 필드워크 {fwCount}건 · 슈퍼비전 {svCount}건
                            </div>
                          </div>
                          {!isActive && (
                            <button onClick={() => onSelect(sv.id)}
                                    style={{ padding: '6px 12px', background: C.pinkSoft, color: C.plumDark, border: `1px solid ${C.pinkLight}`, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                              전환
                            </button>
                          )}
                          <button onClick={() => startEdit(sv)} title="이름 변경"
                                  style={{ padding: '6px 10px', background: C.white, color: C.plumDark, border: '1px solid #E0D5D8', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>
                            ✏️
                          </button>
                          <button onClick={() => handleRemove(sv.id, sv.name)} title="삭제"
                                  style={{ padding: '6px 10px', background: '#FFF0F0', color: C.dangerRed, border: '1px solid #FFD0D0', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>
                            🗑
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ padding: 12, background: '#FFF8E7', border: `1px solid ${C.pinkGold}`, borderRadius: 8, fontSize: 12, color: '#7A5538', lineHeight: 1.6 }}>
            💡 <strong>슈퍼바이저 모드</strong>: 한 슈퍼바이저가 여러 자격 준비자를 동시에 관리할 수 있어요. 
            상단 드롭다운으로 슈퍼바이지를 전환하면, 각자의 필드워크·슈퍼비전 기록을 따로 관리합니다.
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// 전체 슈퍼바이지 현황 (overview 탭)
// ============================================
function OverviewTab({ supervisees, onSelect }) {
  // 각 슈퍼바이지 통계 계산
  const summaries = useMemo(() => {
    return supervisees.map(sv => {
      const exam = EXAM_DATA[sv.examType] || EXAM_DATA['QASP-S'];
      let fwTotal = 0, directTotal = 0, indirectTotal = 0;
      (sv.fieldworkLogs || []).forEach(l => {
        const hrs = timeToHours(l.startTime, l.endTime);
        const direct = Math.min(Number(l.direct) || 0, hrs);
        fwTotal += hrs;
        directTotal += direct;
        indirectTotal += Math.max(0, hrs - direct);
      });

      // 월별 인정 시간
      const monthMap = {};
      (sv.fieldworkLogs || []).forEach(l => {
        if (!l.date) return;
        const ym = l.date.substring(0, 7);
        const hrs = timeToHours(l.startTime, l.endTime);
        if (!monthMap[ym]) monthMap[ym] = { ym, fw: 0, svGroup: 0, svIndividual: 0, svAccepted: 0 };
        monthMap[ym].fw += hrs;
      });
      (sv.supervisionLogs || []).forEach(l => {
        if (!l.date) return;
        const ym = l.date.substring(0, 7);
        if (!monthMap[ym]) monthMap[ym] = { ym, fw: 0, svGroup: 0, svIndividual: 0, svAccepted: 0 };
        const h = Number(l.hours) || 0;
        if (l.type === 'group') monthMap[ym].svGroup += h;
        else monthMap[ym].svIndividual += h;
      });
      Object.values(monthMap).forEach(m => {
        m.svAccepted = m.svIndividual + Math.min(m.svGroup, m.svIndividual);
      });

      const svAccepted = Object.values(monthMap).reduce((s, m) => s + m.svAccepted, 0);
      const svRequired = exam.total * (exam.svPercent / 100); // QBA 100hr / QASP-S 50hr 고정

      // 이번 달 직전까지의 미충족 월
      const now = new Date();
      const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthsShort = Object.values(monthMap).filter(m => {
        if (m.ym >= thisYM) return false;
        if (m.fw === 0) return false;
        return m.svAccepted < m.fw * (exam.svPercent / 100) - 0.01;
      }).length;

      // 최근 4주 페이스
      const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
      const recentFw = (sv.fieldworkLogs || []).reduce((s, l) => {
        if (!l.date) return s;
        const d = parseLocalDate(l.date);
        if (d >= fourWeeksAgo && d <= now) return s + timeToHours(l.startTime, l.endTime);
        return s;
      }, 0);

      return {
        sv, exam, fwTotal, directTotal, indirectTotal,
        svAccepted, svRequired, monthsShort, recentFw,
        progress: exam.total > 0 ? (fwTotal / exam.total) * 100 : 0
      };
    }).sort((a, b) => b.progress - a.progress);
  }, [supervisees]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.plumDark }}>👥 전체 슈퍼바이지 현황</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 13, color: C.grayText }}>
          총 {supervisees.length}명 · 진행률 높은 순
        </p>
      </div>

      <InfoBanner>
        💡 각 카드의 <strong>전환</strong> 버튼이나 슈퍼바이지 이름을 누르면 해당 슈퍼바이지의 상세 대시보드로 이동합니다.
      </InfoBanner>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {summaries.map(s => {
          const svPct = s.svRequired > 0 ? (s.svAccepted / s.svRequired) * 100 : 0;
          const hasWarning = s.monthsShort > 0 || s.recentFw === 0;
          const isComplete = s.progress >= 100;
          return (
            <div key={s.sv.id} style={{
              background: C.white,
              borderRadius: 12,
              padding: 18,
              border: `2px solid ${isComplete ? C.goodGreen : hasWarning ? C.warnYellow : C.pinkLight}`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              cursor: 'pointer',
              transition: 'transform 0.15s, box-shadow 0.15s'
            }}
            onClick={() => onSelect(s.sv.id)}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.plumDark }}>👤 {s.sv.name}</div>
                  <div style={{ fontSize: 11, color: C.grayText, marginTop: 2 }}>
                    {s.sv.examType} · {s.sv.mainSupervisor || '슈퍼바이저 미지정'}
                  </div>
                </div>
                {isComplete && <span style={{ fontSize: 18 }}>🎉</span>}
                {hasWarning && !isComplete && <span style={{ fontSize: 18 }}>⚠️</span>}
              </div>

              {/* 필드워크 진행률 */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.grayText, fontWeight: 600 }}>📋 필드워크</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.pinkDeep }}>
                    {s.progress >= 100 ? '100%+' : `${s.progress.toFixed(1)}%`}
                  </span>
                </div>
                <div style={{ height: 8, background: C.pinkSoft, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, s.progress)}%`,
                    background: `linear-gradient(90deg, ${C.pinkDeep} 0%, ${C.pinkMid} 100%)`,
                    borderRadius: 4, transition: 'width 0.4s'
                  }} />
                </div>
                <div style={{ fontSize: 11, color: C.grayText, marginTop: 4 }}>
                  {fmt(s.fwTotal)} / {s.exam.total} hr
                  <span style={{ marginLeft: 8, color: C.goldDeep }}>직접 {fmt(s.directTotal)}</span>
                  <span style={{ marginLeft: 6, color: C.goodGreen }}>간접 {fmt(s.indirectTotal)}</span>
                </div>
              </div>

              {/* 슈퍼비전 진행률 */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.grayText, fontWeight: 600 }}>🎓 슈퍼비전 (인정)</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.plumDark }}>
                    {svPct >= 100 ? '100%+' : `${svPct.toFixed(0)}%`}
                  </span>
                </div>
                <div style={{ height: 6, background: C.pinkSoft, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, svPct)}%`,
                    background: C.plumDark,
                    borderRadius: 3, transition: 'width 0.4s'
                  }} />
                </div>
                <div style={{ fontSize: 11, color: C.grayText, marginTop: 4 }}>
                  {fmt(s.svAccepted)} / {fmt(s.svRequired)} hr
                </div>
              </div>

              {/* 상태 배지 */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {s.monthsShort > 0 && (
                  <span style={{ fontSize: 11, padding: '3px 8px', background: '#FFF4D6', color: C.warnYellow, borderRadius: 10, fontWeight: 600 }}>
                    ⚠ 5% 미충족 {s.monthsShort}개월
                  </span>
                )}
                {s.recentFw === 0 && s.fwTotal > 0 && (
                  <span style={{ fontSize: 11, padding: '3px 8px', background: '#FFE5E5', color: C.dangerRed, borderRadius: 10, fontWeight: 600 }}>
                    ⏸ 최근 4주 기록 없음
                  </span>
                )}
                {s.recentFw > 0 && (
                  <span style={{ fontSize: 11, padding: '3px 8px', background: '#E8F5E9', color: C.goodGreen, borderRadius: 10, fontWeight: 600 }}>
                    📈 최근 4주 {fmt(s.recentFw)}hr
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

          <div style={{ background: C.pinkPale, padding: 14, borderRadius: 10, marginBottom: 20 }}>
            <strong style={{ color: C.pinkDeep, fontSize: 14 }}>👋 환영합니다!</strong>
            <p style={{ margin: '6px 0 0 0', fontSize: 13 }}>
              이 트래커는 <strong>QABA (QBA·QASP-S) 자격 준비</strong>를 도와드려요.<br/>
              매일 기록만 잘 해두면 자동으로 진행률·5% 충족 여부를 계산해드립니다.
            </p>
          </div>

          <h3 style={{ color: C.plumDark }}>📌 시작하기 (3단계)</h3>
          <ol>
            <li><strong>시험 종류 선택</strong> - 우측 상단에서 본인의 시험 선택 (QBA / QASP-S)</li>
            <li><strong>슈퍼바이저 정보 입력</strong> - 대시보드 상단에서 메인 슈퍼바이저 이름 입력 (이후 자동완성됨)</li>
            <li><strong>매일 기록</strong> - 📋 필드워크 · 🎓 슈퍼비전 탭에서 시간 입력</li>
          </ol>
          <p style={{ fontSize: 12, color: C.grayText, fontStyle: 'italic' }}>
            💡 회기 끝나고 바로 기록하는 습관이 가장 정확해요!
          </p>

          <h3 style={{ color: C.plumDark }}>🎓 자격 기준 (QABA 공식)</h3>
          <ul>
            <li><strong>QBA</strong>: 필드워크 총 <strong>2,000시간</strong> (Direct 최대 800hr · Indirect 최소 1,200hr) + 슈퍼비전 100시간</li>
            <li><strong>QASP-S</strong>: 필드워크 총 <strong>1,000시간</strong> (슈퍼바이저 역할 최소 600hr · 1:1 직접 케어 최대 400hr) + 슈퍼비전 50시간</li>
            <li>둘 다 매월 슈퍼비전 5% 필수 · 누적 기간 7년 이내</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>💡 슈퍼비전 5% 규정 (매우 중요!)</h3>
          <p>QABA 공식 규정: <strong>매월 그 달의 필드워크 시간의 5%</strong>를 슈퍼비전 받아야 해요.</p>
          <p style={{ fontSize: 12, fontStyle: 'italic', color: C.grayText }}>
          예) 6월에 100시간 일했다면 → 6월 안에 슈퍼비전 5시간 받아야 함<br/>
          ⚠️ 지난 달 부족분은 다음 달에 채워도 인정 안 돼요!
          </p>

          <h3 style={{ color: C.plumDark }}>👤 개별 vs 👥 그룹 슈퍼비전</h3>
          <p>
          <strong>개별 (Individual)</strong>: 슈퍼바이저와 1:1로 받는 슈퍼비전 → 한도 없이 100% 인정<br/>
          <strong>그룹 (Group)</strong>: 여러 명이 함께 받는 슈퍼비전 → <strong>그 달의 개별 시간만큼만 인정</strong> (전체의 50% 한도)<br/>
          → <strong>그룹만 받으면 인정 안 됨!</strong> 꼭 개별 슈퍼비전을 충분히 받아주세요.</p>
          <p style={{ fontSize: 12, fontStyle: 'italic', color: C.grayText, padding: 10, background: C.pinkPale, borderRadius: 6 }}>
          📌 예시: 한 달에 개별 1hr + 그룹 3hr 받았다면<br/>
          → 인정 시간 = 개별 1hr + 그룹 min(3,1)=1hr = <strong>총 2hr</strong><br/>
          → 그룹 2hr은 초과로 인정 안 됨
          </p>

          <h3 style={{ color: C.plumDark }}>📍 Direct vs Indirect</h3>
          <p><strong>Direct (직접)</strong>: 클라이언트와 직접 만나는 시간 (직접 회기, 평가 등)<br/>
          <strong>Indirect (간접)</strong>: 분석·계획·보고서·자료 준비 등 간접 업무 시간<br/>
          회기 카드에서 <strong>Direct 시간만 입력</strong>하면 나머지는 자동으로 Indirect로 분류돼요.</p>

          <h3 style={{ color: C.plumDark }}>📊 대시보드 보는 법</h3>
          <ul>
            <li><strong>한눈에 보기</strong>: 큰 진행률 바 2개 (필드워크 / 슈퍼비전)</li>
            <li><strong>월별 5% 미충족 알림</strong>: 지난 달 슈퍼비전이 부족하면 빨간색 알림</li>
            <li><strong>📅 월별 요약 표</strong>: 매월 필드워크·SV(개별/그룹/인정)·5% 충족 여부를 한 줄에 표시</li>
            <li><strong>최근 페이스</strong>: 최근 4주 데이터로 예상 완료일 계산</li>
            <li><strong>슈퍼바이저별 요약</strong>: 슈퍼바이저가 2명 이상이면 누구에게 얼마나 받았는지 표시</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>⚡ 빠르게 입력하기</h3>
          <ul>
            <li><strong>⚡ 빠른 입력 모드</strong>: 필드워크·슈퍼비전 탭에서 한 줄로 빠르게 추가</li>
            <li><strong>📋 지난 회기 복사</strong>: 최근 기록과 동일한 정보로 새 카드 생성 (날짜만 다음 날로 변경)</li>
            <li><strong>슈퍼바이저 자동완성</strong>: 한 번 입력한 이름은 다음부터 자동 제시</li>
            <li><strong>+30분, +1시간 버튼</strong>: 시작 시간 선택 후 빠르게 종료 시간 설정</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>📊 QABA 제출용 보고서</h3>
          <p>우측 상단 <strong>📊 엑셀 내보내기</strong> 버튼을 누르면 QABA 제출용 보고서를 다운로드할 수 있어요.<br/>
          포함 내용: 필드워크 전체 기록 · 슈퍼비전 전체 기록 · 슈퍼바이저별 요약 · 월별 요약</p>
          <p style={{ fontSize: 12, color: C.grayText, fontStyle: 'italic' }}>
            ※ 슈퍼바이저나 자격증 신청 시 활용하세요. 공식 인증은 QABA 온라인 시스템에서 슈퍼바이저가 직접 진행해야 합니다.
          </p>

          <h3 style={{ color: C.plumDark }}>☁️ 데이터 안전성</h3>
          <ul>
            <li>모든 데이터는 <strong>클라우드(Supabase)</strong>에 자동 저장됩니다</li>
            <li>다른 기기(집/직장 PC, 휴대폰)에서 로그인해도 <strong>같은 데이터</strong>가 보여요</li>
            <li>브라우저를 닫거나 캐시를 지워도 데이터는 안전합니다</li>
            <li>걱정되시면 가끔 <strong>💾 백업</strong> 버튼으로 JSON 파일을 받아두세요</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>🔒 보안 안내</h3>
          <ul>
            <li>본 시스템은 <strong>검단ABA 라이센스 사용자 전용</strong>입니다</li>
            <li>계정 정보를 다른 사람과 공유하지 마세요</li>
            <li>공용 PC에서 사용 후 반드시 우측 상단 <strong>🔒 로그아웃</strong> 클릭</li>
            <li>비밀번호 분실 또는 만료 시 검단ABA에 문의해주세요</li>
          </ul>

          <h3 style={{ color: C.plumDark }}>⚠️ 주의사항</h3>
          <ul>
            <li>본 자료는 자격 준비 <strong>보조 도구</strong>이며, QABA 공식 가이드를 우선하세요</li>
            <li>QABA 규정 변경 시 시스템에 반영되기까지 시간이 걸릴 수 있습니다</li>
            <li>오류·개선 요청은 검단ABA로 연락주세요</li>
          </ul>

          <div style={{ marginTop: 24, padding: 14, background: C.pinkPale, borderRadius: 10, textAlign: 'center', fontSize: 12, color: C.plumDark }}>
            💌 <strong>도움이 필요하면 언제든 검단ABA에 문의해주세요</strong><br/>
            <span style={{ fontSize: 11, color: C.grayText }}>© 검단ABA언어행동연구소 · All Rights Reserved</span>
          </div>
        </div>
      </div>
    </div>
  );
}
