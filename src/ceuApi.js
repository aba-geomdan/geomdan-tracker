// ============================================================
// 연수시간(CEU) 탭 — 서버 연결
//   geomdan-ceu 앱의 supabase.js 를 트래커 안으로 옮긴 것.
//   로그인은 트래커 로그인을 그대로 씀 (따로 로그인하지 않음, 로그인 표를 새로 받는 일도 트래커가 맡음).
//   데이터: ceu_data (owner_id = 내 고유번호, 서버 규칙으로 본인 것만)
//   이수증 사진: ceu-receipts 보관함 (비공개, 본인 폴더만)
// ============================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY, getValidAccessToken, getSessionUserId } from './supabase.js';

const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH = `${SUPABASE_URL}/auth/v1`;
const BUCKET = 'ceu-receipts';
export const CEU_RELAY_URL = `${SUPABASE_URL}/functions/v1/ceu-relay`;
export const CEU_ANON_KEY = SUPABASE_ANON_KEY;

// 이수증 AI 인식(ceu-relay)에 실어 보낼 내 로그인 표
export async function getLoginToken() {
  return await getValidAccessToken();
}

async function authedFetch(url, opts = {}) {
  const t = await getValidAccessToken();
  if (!t) return new Response('{"message":"로그인이 필요합니다"}', { status: 401 });
  return fetch(url, {
    ...opts,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// 내 데이터 읽기 → data(JSON) 반환, 없으면 null.  읽기 자체가 실패하면 { error }
export async function loadMyData() {
  const uid = getSessionUserId();
  if (!uid) return { error: '로그인이 필요합니다.' };
  const r = await authedFetch(`${REST}/ceu_data?owner_id=eq.${uid}&select=data`, { method: 'GET' });
  if (!r.ok) return { error: '불러오기 실패 (' + r.status + ')' };
  const rows = await r.json();
  return rows.length ? rows[0].data : null;
}

// 내 데이터 저장 (있으면 덮어쓰기)
export async function saveMyData(data) {
  const uid = getSessionUserId();
  if (!uid) return { error: '로그인이 필요합니다.' };
  const r = await authedFetch(`${REST}/ceu_data`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ owner_id: uid, data, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    const t = await r.text();
    return { error: '저장 실패: ' + t };
  }
  return { ok: true };
}

// 내 보유자격을 계정 정보에도 저장 (선택, 실패해도 그만)
export async function updateMyCerts(certs) {
  const t = await getValidAccessToken();
  if (!t) return;
  try {
    await fetch(`${AUTH}/user`, {
      method: 'PUT',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { my_certs: certs } }),
    });
  } catch (e) {}
}

// base64(data 부분) → 업로드. 성공 시 저장 경로(path) 반환
export async function uploadReceipt(base64, mediaType) {
  const uid = getSessionUserId();
  const t = await getValidAccessToken();
  if (!uid || !t) return { error: '로그인이 필요합니다.' };
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = (mediaType && mediaType.includes('png')) ? 'png' : 'jpg';
    const path = `${uid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, 'Content-Type': mediaType || 'image/jpeg' },
      body: bytes,
    });
    if (!r.ok) { const e = await r.text(); return { error: '사진 저장 실패: ' + e }; }
    return { path };
  } catch (e) {
    return { error: '사진 처리 오류: ' + e.message };
  }
}

// 저장 경로 → 열람용 임시 주소 (비공개 보관함)
export async function getReceiptUrl(path, expiresSec = 3600) {
  if (!path) return { error: '경로 없음' };
  const t = await getValidAccessToken();
  if (!t) return { error: '로그인이 필요합니다.' };
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresSec }),
    });
    if (!r.ok) { const e = await r.text(); return { error: 'URL 생성 실패: ' + e }; }
    const data = await r.json();
    return { url: `${SUPABASE_URL}/storage/v1${data.signedURL}` };
  } catch (e) {
    return { error: 'URL 오류: ' + e.message };
  }
}

export async function deleteReceipt(path) {
  if (!path) return { ok: true };
  const t = await getValidAccessToken();
  if (!t) return { error: '로그인이 필요합니다.' };
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}` },
    });
    if (!r.ok) { const e = await r.text(); return { error: '삭제 실패: ' + e }; }
    return { ok: true };
  } catch (e) {
    return { error: '삭제 오류: ' + e.message };
  }
}

// ============================================================
// [한 번만] 예전 CEU 앱(센터 서버)에서 기록·이수증 사진 가져오기
//   - 예전 앱의 이메일·비밀번호로 그 순간만 로그인해서 내 기록을 읽고, 사진을 새 보관함으로 복사함
//   - 예전 기록은 지우지 않음 (원본 그대로 남음). 비밀번호는 저장하지 않음
// ============================================================
const OLD_URL = 'https://vdubgrxwijydwfabwpnk.supabase.co';
const OLD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkdWJncnh3aWp5ZHdmYWJ3cG5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MDk1ODgsImV4cCI6MjA5NzE4NTU4OH0.nqNO3vany3M6fzmG5BG6QVdvi8BW2UbhTDhxNnwvA88';

// 기록 안의 사진 경로(receiptPath, extraReceiptPaths)를 모두 찾거나 바꿈
function walkPaths(node, fn) {
  if (Array.isArray(node)) return node.map((x) => walkPaths(x, fn));
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (k === 'receiptPath' && typeof v === 'string') out[k] = fn(v);
    else if (k === 'extraReceiptPaths' && Array.isArray(v)) out[k] = v.map((p) => (typeof p === 'string' ? fn(p) : p));
    else out[k] = walkPaths(v, fn);
  }
  return out;
}

// onStep(글): 진행 상황 알림.  돌려주는 값: { data, photos, photoFail } 또는 { error }
export async function importFromOldCeu(email, password, onStep) {
  const step = (t) => { try { onStep && onStep(t); } catch (e) {} };
  const newUid = getSessionUserId();
  const newToken = await getValidAccessToken();
  if (!newUid || !newToken) return { error: '트래커 로그인이 끝났습니다. 다시 로그인해 주세요.' };

  // 1) 예전 앱 로그인
  step('예전 CEU 앱에 로그인하는 중…');
  let old;
  try {
    const r = await fetch(`${OLD_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: OLD_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email || '').trim(), password }),
    });
    old = await r.json();
    if (!r.ok || !old.access_token) return { error: '예전 CEU 앱 이메일 또는 비밀번호가 맞지 않습니다.' };
  } catch (e) { return { error: '예전 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }; }
  const oldToken = old.access_token;
  const oldUid = old.user && old.user.id;
  const endOld = () => { try { fetch(`${OLD_URL}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: OLD_KEY, Authorization: `Bearer ${oldToken}` } }).catch(() => {}); } catch (e) {} };

  try {
    // 2) 예전 기록 읽기
    step('예전 기록을 읽는 중…');
    const r = await fetch(`${OLD_URL}/rest/v1/ceu_data?owner_id=eq.${oldUid}&select=data`, { headers: { apikey: OLD_KEY, Authorization: `Bearer ${oldToken}` } });
    if (!r.ok) return { error: '예전 기록을 읽지 못했습니다 (' + r.status + ').' };
    const rows = await r.json();
    if (!rows.length || !rows[0].data) return { error: '예전 CEU 앱에 저장된 기록이 없습니다.' };
    const oldData = rows[0].data;

    // 3) 사진 옮기기
    const paths = [];
    walkPaths(oldData, (p) => { if (p && !paths.includes(p)) paths.push(p); return p; });
    const map = {};
    let fail = 0;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      step(`이수증 사진 옮기는 중… (${i + 1} / ${paths.length})`);
      try {
        const s = await fetch(`${OLD_URL}/storage/v1/object/sign/ceu-receipts/${p}`, {
          method: 'POST', headers: { apikey: OLD_KEY, Authorization: `Bearer ${oldToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 600 }),
        });
        if (!s.ok) throw new Error('sign');
        const sj = await s.json();
        const img = await fetch(`${OLD_URL}/storage/v1${sj.signedURL}`);
        if (!img.ok) throw new Error('down');
        const blob = await img.blob();
        const name = p.split('/').pop();
        const np = `${newUid}/${name}`;
        const tok = await getValidAccessToken();
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${np}`, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}`, 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' },
          body: blob,
        });
        if (!up.ok) throw new Error('up');
        map[p] = np;
      } catch (e) { fail++; }
    }
    const moved = walkPaths(oldData, (p) => map[p] || p);
    return { data: moved, photos: paths.length - fail, photoFail: fail };
  } finally {
    endOld();
  }
}
