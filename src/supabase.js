// ============================================================
// Supabase 데이터 계층 (Edge Function 경유)
// - tracker_* 테이블에 직접 접근하지 않고 tracker-data Edge Function 호출
// - service_role 키는 서버에만 있어 브라우저에 노출되지 않음
// - 비밀번호는 서버에서 PBKDF2 해시 처리 (로그인 시 평문→해시 자동 전환)
// ============================================================

const SUPABASE_URL = 'https://vdubgrxwijydwfabwpnk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bp4Fza--AQ9Kjw3n-60XjQ__oXq1DeR';
const FN_URL = `${SUPABASE_URL}/functions/v1/tracker-data`;

async function callFn(action, params = {}) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, params }),
  });
  let out;
  try { out = await res.json(); } catch (_) { throw new Error('서버 응답을 읽지 못했습니다'); }
  if (!res.ok || out.error) throw new Error(out.error || '서버 오류');
  return out.data;
}

// 호환용: App.jsx가 `supabase`를 import하지만 직접 호출하지는 않음.
// SDK를 더 이상 쓰지 않으므로 빈 placeholder를 내보내 import 오류를 방지.
export const supabase = null;

// 테이블 이름 상수 (호환용 — 외부에서 참조할 수 있어 유지)
export const TABLES = {
  USERS: 'tracker_users',
  SUPERVISEES: 'tracker_supervisees',
  FIELDWORK_LOGS: 'tracker_fieldwork_logs',
  SUPERVISION_LOGS: 'tracker_supervision_logs',
};

// ── 인증 ───────────────────────────────────────────────────
export const authLogin = async (userId, password) => {
  try {
    return await callFn('authLogin', { userId, password });
  } catch (e) {
    return { success: false, error: '서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요' };
  }
};

// ── 슈퍼바이지 CRUD ────────────────────────────────────────
export const fetchSupervisees = async (userId) => {
  try { return await callFn('fetchSupervisees', { userId }); }
  catch (e) { console.error('fetchSupervisees error:', e); return []; }
};

export const createSupervisee = async (userId, supervisee) => {
  try { return await callFn('createSupervisee', { userId, supervisee }); }
  catch (e) { console.error('createSupervisee error:', e); return null; }
};

export const updateSupervisee = async (id, changes) => {
  try { await callFn('updateSupervisee', { id, changes }); return true; }
  catch (e) { console.error('updateSupervisee error:', e); return false; }
};

export const deleteSupervisee = async (id) => {
  try { await callFn('deleteSupervisee', { id }); return true; }
  catch (e) { console.error('deleteSupervisee error:', e); return false; }
};

// ── 필드워크 로그 CRUD ─────────────────────────────────────
export const fetchFieldworkLogs = async (superviseeId) => {
  try { return await callFn('fetchFieldworkLogs', { superviseeId }); }
  catch (e) { console.error('fetchFieldworkLogs error:', e); return []; }
};

export const createFieldworkLog = async (superviseeId, log) => {
  try { return await callFn('createFieldworkLog', { superviseeId, log }); }
  catch (e) { console.error('createFieldworkLog error:', e); return null; }
};

export const updateFieldworkLog = async (id, changes) => {
  try { await callFn('updateFieldworkLog', { id, changes }); return true; }
  catch (e) { console.error('updateFieldworkLog error:', e); return false; }
};

export const deleteFieldworkLog = async (id) => {
  try { await callFn('deleteFieldworkLog', { id }); return true; }
  catch (e) { console.error('deleteFieldworkLog error:', e); return false; }
};

// ── 슈퍼비전 로그 CRUD ─────────────────────────────────────
export const fetchSupervisionLogs = async (superviseeId) => {
  try { return await callFn('fetchSupervisionLogs', { superviseeId }); }
  catch (e) { console.error('fetchSupervisionLogs error:', e); return []; }
};

export const createSupervisionLog = async (superviseeId, log) => {
  try { return await callFn('createSupervisionLog', { superviseeId, log }); }
  catch (e) { console.error('createSupervisionLog error:', e); return null; }
};

export const updateSupervisionLog = async (id, changes) => {
  try { await callFn('updateSupervisionLog', { id, changes }); return true; }
  catch (e) { console.error('updateSupervisionLog error:', e); return false; }
};

export const deleteSupervisionLog = async (id) => {
  try { await callFn('deleteSupervisionLog', { id }); return true; }
  catch (e) { console.error('deleteSupervisionLog error:', e); return false; }
};

// ── 활성 슈퍼바이지 ID (localStorage — 기기 로컬 유지) ─────
export const getActiveSuperviseeId = (userId) => {
  try { return localStorage.getItem(`tracker_active_sv_${userId}`); }
  catch (e) { return null; }
};

export const setActiveSuperviseeId = (userId, superviseeId) => {
  try {
    if (superviseeId) localStorage.setItem(`tracker_active_sv_${userId}`, superviseeId);
    else localStorage.removeItem(`tracker_active_sv_${userId}`);
  } catch (e) {}
};

// ── 관리자: 사용자 관리 ────────────────────────────────────
export const fetchAllUsers = async () => {
  try { return await callFn('fetchAllUsers', {}); }
  catch (e) { console.error('fetchAllUsers error:', e); return []; }
};

export const createUser = async (userData) => {
  try { return await callFn('createUser', { userData }); }
  catch (e) { console.error('createUser error:', e); return { success: false, error: e.message }; }
};

export const updateUser = async (id, changes) => {
  try { return await callFn('updateUser', { id, changes }); }
  catch (e) { console.error('updateUser error:', e); return { success: false, error: e.message }; }
};

export const toggleUserActive = async (id, isActive) => {
  try { await callFn('toggleUserActive', { id, isActive }); return true; }
  catch (e) { console.error('toggleUserActive error:', e); return false; }
};

export const deleteUser = async (id) => {
  try { await callFn('deleteUser', { id }); return true; }
  catch (e) { console.error('deleteUser error:', e); return false; }
};

export const fetchUserStats = async (userId) => {
  try { return await callFn('fetchUserStats', { userId }); }
  catch (e) {
    console.error('fetchUserStats error:', e);
    return { superviseeCount: 0, fieldworkCount: 0, supervisionCount: 0, supervisees: [],
             totalFwHours: 0, totalSvHours: 0, progress: 0, examType: null, target: 0 };
  }
};
