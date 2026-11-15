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
