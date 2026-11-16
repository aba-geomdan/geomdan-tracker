// ============================================================
// Supabase 데이터 계층 (A방식: Supabase Auth 기반)
// ------------------------------------------------------------
// - 로그인: Supabase Auth (email/password). tracker의 user_id "아이디"는
//   내부에서 "아이디@geomdan.local" 이메일로 변환해 사용.
// - 데이터: tracker-data Edge Function 호출 (JWT access_token 실어서).
//   Edge Function이 토큰의 uid로 owner_uid를 필터하므로 클라가 userId를 넘겨도 무시됨.
// - 계정 관리: admin-users Edge Function (create/delete/update_password/set_active/list).
// - 하드코딩 비번 없음. 세션은 sessionStorage.
// ============================================================

// 2026-11-15 트래커 전용 서버로 옮김 (센터 서버와 완전히 분리 — 계정·기록이 서로 섞이지 않음)
export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://emylattgfqezmvkdpxzp.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Win7wosrPbT4sJDisYdDQw_y9RrhlNn';

const EMAIL_DOMAIN = 'geomdan.local';
const FN_DATA = `${SUPABASE_URL}/functions/v1/tracker-data`;
const FN_ADMIN = `${SUPABASE_URL}/functions/v1/admin-users`;

// user_id "아이디" ↔ 이메일 변환
function idToEmail(userId) {
  const v = String(userId || '').trim().toLowerCase();
  if (v.includes('@')) return v; // 이미 이메일이면 그대로
  return `${v}@${EMAIL_DOMAIN}`;
}
function emailToId(email) {
  const v = String(email || '');
  return v.endsWith(`@${EMAIL_DOMAIN}`) ? v.slice(0, -(`@${EMAIL_DOMAIN}`).length) : v;
}

// ── 세션 관리 (sessionStorage) ─────────────────────────────
const AUTH_SESSION_KEY = 'sb-tracker-session';

function getStoredSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.expires_at && s.expires_at * 1000 < Date.now() + 5 * 60 * 1000) return null;
    return s;
  } catch (e) { return null; }
}
// 지금 로그인한 사람의 고유번호 (연수시간 탭에서 씀)
export function getSessionUserId() {
  try { const s = JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY) || 'null'); return s?.user?.id || null; } catch (e) { return null; }
}
function saveSession(session) {
  try {
    if (session) sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(AUTH_SESSION_KEY);
  } catch (e) {}
}
async function refreshSession(refreshToken) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.access_token) { saveSession(data); return data; }
    return null;
  } catch (e) { return null; }
}
export async function getValidAccessToken() {
  const session = getStoredSession();
  if (session?.access_token) return session.access_token;
  const raw = (() => { try { return sessionStorage.getItem(AUTH_SESSION_KEY); } catch (e) { return null; } })();
  if (raw) {
    try {
      const old = JSON.parse(raw);
      if (old.refresh_token) {
        const refreshed = await refreshSession(old.refresh_token);
        if (refreshed?.access_token) return refreshed.access_token;
      }
    } catch (e) {}
  }
  return null;
}
async function authHeaders() {
  const token = await getValidAccessToken();
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
}

// ── 데이터 Edge Function 호출 (인증 토큰 실음) ─────────────
async function callData(action, params = {}) {
  const headers = await authHeaders();
  const res = await fetch(FN_DATA, {
    method: 'POST', headers, body: JSON.stringify({ action, params }),
  });
  let out;
  try { out = await res.json(); } catch (_) { throw new Error('서버 응답을 읽지 못했습니다'); }
  if (!res.ok || out.error) throw new Error(out.error || '서버 오류');
  return out.data;
}

// ── 관리자 Edge Function 호출 ──────────────────────────────
async function callAdmin(payload) {
  const headers = await authHeaders();
  const res = await fetch(FN_ADMIN, {
    method: 'POST', headers, body: JSON.stringify(payload),
  });
  let out;
  try { out = await res.json(); } catch (_) { return { error: '서버 응답 오류' }; }
  return { ...out, _ok: res.ok };
}

// 호환용 placeholder (App.jsx가 import 하지만 직접 호출 안 함)
export const supabase = null;
export const TABLES = {
  USERS: 'tracker_users',
  SUPERVISEES: 'tracker_supervisees',
  FIELDWORK_LOGS: 'tracker_fieldwork_logs',
  SUPERVISION_LOGS: 'tracker_supervision_logs',
};

// ── 인증 ───────────────────────────────────────────────────
// App.jsx는 authLogin(userId, password) → { success, user:{ id, user_id, name, role } } 를 기대
export const authLogin = async (userId, password) => {
  try {
    const email = idToEmail(userId);
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) {
      return { success: false, error: '아이디 또는 비밀번호가 일치하지 않습니다' };
    }
    const meta = data.user?.user_metadata || {};
    const appMeta = data.user?.app_metadata || {};
    const role = appMeta.role || meta.role || 'user';
    // 정지 계정 차단 (is_active === false 만 차단, 없으면 활성 간주)
    if ((appMeta.is_active ?? meta.is_active) === false) {
      saveSession(null);
      return { success: false, error: '계정이 비활성화되었습니다. 검단ABA에 문의해주세요' };
    }
    // 만료 확인 (본인이 못 고치는 app_metadata 를 먼저 봄, 관리자는 만료 없음)
    const expAt = appMeta.expires_at || meta.expires_at;
    if (role !== 'admin' && expAt && String(expAt).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
      saveSession(null);
      return { success: false, error: '라이센스가 만료되었습니다. 검단ABA에 문의해주세요' };
    }
    saveSession(data);
    return {
      success: true,
      user: {
        id: data.user.id,                                  // uid
        user_id: meta.user_id || emailToId(data.user.email), // 원래 아이디
        name: meta.display_name || meta.name || emailToId(data.user.email),
        role: role === 'admin' ? 'admin' : 'user',
        expires_at: expAt || null,
        // 연수시간(CEU) 탭: 관리자는 늘 보이고, 다른 사람은 관리자가 켜 준 경우에만
        ceu: role === 'admin' || appMeta.ceu === true,
      },
    };
  } catch (e) {
    return { success: false, error: '서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요' };
  }
};

export const authLogout = async () => {
  try {
    const token = await getValidAccessToken();
    if (token) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
      });
    }
  } catch (e) {}
  saveSession(null);
};

// ── 슈퍼바이지 CRUD ────────────────────────────────────────
export const fetchSupervisees = async (userId) => {
  try { return await callData('fetchSupervisees', {}); }
  catch (e) { console.error('fetchSupervisees error:', e); return []; }
};
export const createSupervisee = async (userId, supervisee) => {
  try { return await callData('createSupervisee', { supervisee }); }
  catch (e) { console.error('createSupervisee error:', e); return null; }
};
// (관리자) 다른 사람 계정에 기록장 만들어 주기 — 새 사용자 추가할 때
export const createSuperviseeFor = async (targetUid, supervisee) => {
  try { return await callData('createSupervisee', { supervisee, targetUid }); }
  catch (e) { console.error('createSuperviseeFor error:', e); return null; }
};
// (관리자) 모든 사람의 기록장 목록
export const fetchAllSupervisees = async () => {
  try { return await callData('fetchAllSupervisees', {}); }
  catch (e) { console.error('fetchAllSupervisees error:', e); return []; }
};
export const updateSupervisee = async (id, changes) => {
  try { await callData('updateSupervisee', { id, changes }); return true; }
  catch (e) { console.error('updateSupervisee error:', e); return false; }
};
export const deleteSupervisee = async (id) => {
  try { await callData('deleteSupervisee', { id }); return true; }
  catch (e) { console.error('deleteSupervisee error:', e); return false; }
};

// ── 필드워크 로그 CRUD ─────────────────────────────────────
export const fetchFieldworkLogs = async (superviseeId) => {
  try { return await callData('fetchFieldworkLogs', { superviseeId }); }
  catch (e) { console.error('fetchFieldworkLogs error:', e); return []; }
};
export const createFieldworkLog = async (superviseeId, log) => {
  try { return await callData('createFieldworkLog', { superviseeId, log }); }
  catch (e) { console.error('createFieldworkLog error:', e); return null; }
};
export const updateFieldworkLog = async (id, changes) => {
  try { await callData('updateFieldworkLog', { id, changes }); return true; }
  catch (e) { console.error('updateFieldworkLog error:', e); return false; }
};
export const deleteFieldworkLog = async (id) => {
  try { await callData('deleteFieldworkLog', { id }); return true; }
  catch (e) { console.error('deleteFieldworkLog error:', e); return false; }
};

// ── 슈퍼비전 로그 CRUD ─────────────────────────────────────
export const fetchSupervisionLogs = async (superviseeId) => {
  try { return await callData('fetchSupervisionLogs', { superviseeId }); }
  catch (e) { console.error('fetchSupervisionLogs error:', e); return []; }
};
export const createSupervisionLog = async (superviseeId, log) => {
  try { return await callData('createSupervisionLog', { superviseeId, log }); }
  catch (e) { console.error('createSupervisionLog error:', e); return null; }
};
export const updateSupervisionLog = async (id, changes) => {
  try { await callData('updateSupervisionLog', { id, changes }); return true; }
  catch (e) { console.error('updateSupervisionLog error:', e); return false; }
};
export const deleteSupervisionLog = async (id) => {
  try { await callData('deleteSupervisionLog', { id }); return true; }
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

// ── 관리자: 사용자 관리 (admin-users Edge Function) ────────
// list → App.jsx가 기대하는 형태 { id, user_id, name, role, is_active, expires_at }로 매핑
export const fetchAllUsers = async () => {
  try {
    const out = await callAdmin({ action: 'list' });
    if (!out._ok) return [];
    return (out.users || []).map((u) => ({
      id: u.id,
      user_id: u.user_id || emailToId(u.email),
      name: u.display_name || emailToId(u.email),
      role: u.role === 'admin' ? 'admin' : 'user',
      is_active: u.is_active !== false,
      expires_at: u.expires_at || null,
      ceu: u.ceu === true,
      created_at: u.created_at,
    }));
  } catch (e) { console.error('fetchAllUsers error:', e); return []; }
};

// form: { user_id, password, name, role, expires_at }
export const createUser = async (userData) => {
  try {
    const u = userData;
    const out = await callAdmin({
      action: 'create',
      email: idToEmail(u.user_id),
      password: u.password,
      display_name: u.name || u.user_id,
      // 아래 메타는 admin-users create가 무시할 수 있음 → updateUser 없이도
      // authLogin에서 fallback 처리되므로 안전. (admin-users가 metadata 확장 지원 시 반영)
      user_id: String(u.user_id || '').trim().toLowerCase(),
      role: u.role === 'admin' ? 'admin' : 'user',
      expires_at: u.expires_at || null,
      ceu: u.ceu === true,
    });
    if (!out._ok || out.error) return { success: false, error: out.error || '계정 생성 실패' };
    return { success: true, user: out.user };
  } catch (e) { console.error('createUser error:', e); return { success: false, error: e.message }; }
};

// changes: { password?, name?, role?, expires_at?, user_id? }  (id = uid)
export const updateUser = async (id, changes) => {
  try {
    // 비밀번호 변경 (있을 때만)
    if (changes.password) {
      const out = await callAdmin({ action: 'update_password', user_id: id, password: changes.password });
      if (!out._ok || out.error) return { success: false, error: out.error || '비밀번호 변경 실패' };
    }
    // 메타(이름/역할/유효기간/아이디) 변경
    const metaPayload = { action: 'update_meta', user_id: id };
    let hasMeta = false;
    if ('name' in changes) { metaPayload.display_name = changes.name; hasMeta = true; }
    if ('role' in changes) { metaPayload.role = changes.role === 'admin' ? 'admin' : 'user'; hasMeta = true; }
    if ('expires_at' in changes) { metaPayload.expires_at = changes.expires_at || null; hasMeta = true; }
    if ('user_id' in changes) { metaPayload.user_login_id = String(changes.user_id || '').trim().toLowerCase(); hasMeta = true; }
    if (hasMeta) {
      const out = await callAdmin(metaPayload);
      if (!out._ok || out.error) return { success: false, error: out.error || '정보 수정 실패' };
    }
    return { success: true };
  } catch (e) { console.error('updateUser error:', e); return { success: false, error: e.message }; }
};

export const toggleUserActive = async (id, isActive) => {
  try {
    const out = await callAdmin({ action: 'set_active', user_id: id, is_active: isActive });
    return !!out._ok;
  } catch (e) { console.error('toggleUserActive error:', e); return false; }
};

// 연수시간(CEU) 탭 보이기/숨기기 (관리자만)
export const setUserCeu = async (id, on) => {
  try {
    const out = await callAdmin({ action: 'set_ceu', user_id: id, ceu: !!on });
    return !!out._ok && !out.error;
  } catch (e) { console.error('setUserCeu error:', e); return false; }
};

export const deleteUser = async (id) => {
  try {
    const out = await callAdmin({ action: 'delete', user_id: id });
    return !!out._ok;
  } catch (e) { console.error('deleteUser error:', e); return false; }
};

export const fetchUserStats = async (userId) => {
  // 관리자 페이지에서 사람마다 그 사람 숫자를 보이게 (예전에는 모두 내 숫자가 나왔음)
  try { return await callData('fetchUserStats', userId ? { targetUid: userId } : {}); }
  catch (e) {
    console.error('fetchUserStats error:', e);
    return { superviseeCount: 0, fieldworkCount: 0, supervisionCount: 0, supervisees: [],
             totalFwHours: 0, totalSvHours: 0, progress: 0, examType: null, target: 0 };
  }
};

// ── 월별 서식 (Pre-QBA Monthly Supervision Log) ───────────
export const fetchMonthlyLogs = async (superviseeId) => {
  try { return await callData('fetchMonthlyLogs', { superviseeId }); }
  catch (e) { console.error('fetchMonthlyLogs error:', e); return []; }
};
export const saveMonthlyLog = async (superviseeId, log) => {
  try { return await callData('saveMonthlyLog', { superviseeId, log }); }
  catch (e) { console.error('saveMonthlyLog error:', e); return { error: e.message }; }
};
export const deleteMonthlyLog = async (id) => {
  try { await callData('deleteMonthlyLog', { id }); return true; }
  catch (e) { console.error('deleteMonthlyLog error:', e); return false; }
};

// 서식 파일을 AI로 읽기 (qaba-log-read). PDF·사진은 파일 그대로, Word는 글자로 바꿔서 보냄
const callQabaLogRead = async (payload) => {
  try {
    const t = await getValidAccessToken();
    if (!t) return { error: '로그인 시간이 끝났습니다. 다시 로그인해 주세요.' };
    const r = await fetch(`${SUPABASE_URL}/functions/v1/qaba-log-read`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let out = null;
    try { out = await r.json(); } catch (e) {}
    if (!r.ok || !out || out.error) return { error: (out && out.error) || ('서식을 읽지 못했어요 (' + r.status + ')') };
    return { result: out.result };
  } catch (e) { return { error: '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' }; }
};
export const readMonthlyForm = (base64, mediaType) => callQabaLogRead({ file: { media_type: mediaType, data: base64 } });
export const readMonthlyFormText = (text) => callQabaLogRead({ text });

// 서식 원본 보관 (monthly-logs 보관함, 기록장 주인 폴더)
export const uploadMonthlyFile = async (ownerUid, superviseeId, month, file) => {
  try {
    const t = await getValidAccessToken();
    if (!t) return { error: '로그인이 필요합니다.' };
    const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop().toLowerCase() : (file.type.includes('pdf') ? 'pdf' : 'jpg');
    const path = `${ownerUid}/${superviseeId}/${month}_${Date.now()}.${ext}`;
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/monthly-logs/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!r.ok) return { error: '원본 저장 실패: ' + (await r.text()).slice(0, 200) };
    return { path };
  } catch (e) { return { error: '원본 저장 오류: ' + e.message }; }
};
export const getMonthlyFileUrl = async (path) => {
  try {
    const t = await getValidAccessToken();
    if (!t || !path) return { error: '열 수 없습니다' };
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/monthly-logs/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 }),
    });
    if (!r.ok) return { error: '원본을 열지 못했습니다' };
    const d = await r.json();
    return { url: `${SUPABASE_URL}/storage/v1${d.signedURL}` };
  } catch (e) { return { error: '원본 열기 오류' }; }
};
