// ============================================
// Supabase 클라이언트 설정
// ============================================
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vdubgrxwijydwfabwpnk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bp4Fza--AQ9Kjw3n-60XjQ__oXq1DeR';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// 테이블 이름 상수 (tracker_ prefix로 다른 시스템과 분리)
export const TABLES = {
  USERS: 'tracker_users',
  SUPERVISEES: 'tracker_supervisees',
  FIELDWORK_LOGS: 'tracker_fieldwork_logs',
  SUPERVISION_LOGS: 'tracker_supervision_logs'
};

// ============================================
// 인증 (로그인)
// ============================================
export const authLogin = async (userId, password) => {
  const { data, error } = await supabase
    .from(TABLES.USERS)
    .select('*')
    .eq('user_id', userId)
    .eq('password', password)
    .single();
  
  if (error || !data) {
    return { success: false, error: '아이디 또는 비밀번호가 일치하지 않습니다' };
  }
  
  // 만료일 체크
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { success: false, error: '라이센스가 만료되었습니다. 검단ABA에 문의해주세요' };
  }
  
  return { success: true, user: data };
};

// ============================================
// 슈퍼바이지 CRUD
// ============================================
export const fetchSupervisees = async (userId) => {
  const { data, error } = await supabase
    .from(TABLES.SUPERVISEES)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  
  if (error) {
    console.error('fetchSupervisees error:', error);
    return [];
  }
  return data || [];
};

export const createSupervisee = async (userId, supervisee) => {
  const { data, error } = await supabase
    .from(TABLES.SUPERVISEES)
    .insert({
      user_id: userId,
      name: supervisee.name,
      exam_type: supervisee.examType || supervisee.exam_type || 'QASP-S',
      main_supervisor: supervisee.mainSupervisor || supervisee.main_supervisor || '',
      supervisors: supervisee.supervisors || [],
      start_date: supervisee.startDate || supervisee.start_date || null
    })
    .select()
    .single();
  
  if (error) {
    console.error('createSupervisee error:', error);
    return null;
  }
  return data;
};

export const updateSupervisee = async (id, changes) => {
  const dbChanges = {};
  if ('name' in changes) dbChanges.name = changes.name;
  if ('examType' in changes) dbChanges.exam_type = changes.examType;
  if ('exam_type' in changes) dbChanges.exam_type = changes.exam_type;
  if ('mainSupervisor' in changes) dbChanges.main_supervisor = changes.mainSupervisor;
  if ('main_supervisor' in changes) dbChanges.main_supervisor = changes.main_supervisor;
  if ('supervisors' in changes) dbChanges.supervisors = changes.supervisors;
  if ('startDate' in changes) dbChanges.start_date = changes.startDate || null;
  if ('start_date' in changes) dbChanges.start_date = changes.start_date || null;
  dbChanges.updated_at = new Date().toISOString();
  
  const { error } = await supabase
    .from(TABLES.SUPERVISEES)
    .update(dbChanges)
    .eq('id', id);
  
  if (error) console.error('updateSupervisee error:', error);
  return !error;
};

export const deleteSupervisee = async (id) => {
  const { error } = await supabase
    .from(TABLES.SUPERVISEES)
    .delete()
    .eq('id', id);
  
  if (error) console.error('deleteSupervisee error:', error);
  return !error;
};

// ============================================
// 필드워크 로그 CRUD
// ============================================
export const fetchFieldworkLogs = async (superviseeId) => {
  const { data, error } = await supabase
    .from(TABLES.FIELDWORK_LOGS)
    .select('*')
    .eq('supervisee_id', superviseeId)
    .order('date', { ascending: false });
  
  if (error) {
    console.error('fetchFieldworkLogs error:', error);
    return [];
  }
  // DB 컬럼 → 앱 사용 형식으로 변환
  return (data || []).map(d => ({
    id: d.id,
    date: d.date,
    startTime: d.start_time,
    endTime: d.end_time,
    direct: d.direct,
    supervisor: d.supervisor,
    activities: d.activities || [],
    customActivities: d.custom_activities || []
  }));
};

export const createFieldworkLog = async (superviseeId, log) => {
  const { data, error } = await supabase
    .from(TABLES.FIELDWORK_LOGS)
    .insert({
      supervisee_id: superviseeId,
      date: log.date || null,
      start_time: log.startTime || '',
      end_time: log.endTime || '',
      direct: Number(log.direct) || 0,
      supervisor: log.supervisor || '',
      activities: log.activities || [],
      custom_activities: log.customActivities || []
    })
    .select()
    .single();
  
  if (error) {
    console.error('createFieldworkLog error:', error);
    return null;
  }
  return {
    id: data.id,
    date: data.date,
    startTime: data.start_time,
    endTime: data.end_time,
    direct: data.direct,
    supervisor: data.supervisor,
    activities: data.activities || [],
    customActivities: data.custom_activities || []
  };
};

export const updateFieldworkLog = async (id, changes) => {
  const dbChanges = {};
  if ('date' in changes) dbChanges.date = changes.date || null;
  if ('startTime' in changes) dbChanges.start_time = changes.startTime;
  if ('endTime' in changes) dbChanges.end_time = changes.endTime;
  if ('direct' in changes) dbChanges.direct = Number(changes.direct) || 0;
  if ('supervisor' in changes) dbChanges.supervisor = changes.supervisor;
  if ('activities' in changes) dbChanges.activities = changes.activities;
  if ('customActivities' in changes) dbChanges.custom_activities = changes.customActivities;
  
  const { error } = await supabase
    .from(TABLES.FIELDWORK_LOGS)
    .update(dbChanges)
    .eq('id', id);
  
  if (error) console.error('updateFieldworkLog error:', error);
  return !error;
};

export const deleteFieldworkLog = async (id) => {
  const { error } = await supabase
    .from(TABLES.FIELDWORK_LOGS)
    .delete()
    .eq('id', id);
  
  if (error) console.error('deleteFieldworkLog error:', error);
  return !error;
};

// ============================================
// 슈퍼비전 로그 CRUD
// ============================================
export const fetchSupervisionLogs = async (superviseeId) => {
  const { data, error } = await supabase
    .from(TABLES.SUPERVISION_LOGS)
    .select('*')
    .eq('supervisee_id', superviseeId)
    .order('date', { ascending: false });
  
  if (error) {
    console.error('fetchSupervisionLogs error:', error);
    return [];
  }
  return (data || []).map(d => ({
    id: d.id,
    date: d.date,
    hours: d.hours,
    type: d.type,
    supervisor: d.supervisor,
    notes: d.notes
  }));
};

export const createSupervisionLog = async (superviseeId, log) => {
  const { data, error } = await supabase
    .from(TABLES.SUPERVISION_LOGS)
    .insert({
      supervisee_id: superviseeId,
      date: log.date || null,
      hours: Number(log.hours) || 0,
      type: log.type || 'individual',
      supervisor: log.supervisor || '',
      notes: log.notes || ''
    })
    .select()
    .single();
  
  if (error) {
    console.error('createSupervisionLog error:', error);
    return null;
  }
  return {
    id: data.id,
    date: data.date,
    hours: data.hours,
    type: data.type,
    supervisor: data.supervisor,
    notes: data.notes
  };
};

export const updateSupervisionLog = async (id, changes) => {
  const dbChanges = {};
  if ('date' in changes) dbChanges.date = changes.date || null;
  if ('hours' in changes) dbChanges.hours = Number(changes.hours) || 0;
  if ('type' in changes) dbChanges.type = changes.type;
  if ('supervisor' in changes) dbChanges.supervisor = changes.supervisor;
  if ('notes' in changes) dbChanges.notes = changes.notes;
  
  const { error } = await supabase
    .from(TABLES.SUPERVISION_LOGS)
    .update(dbChanges)
    .eq('id', id);
  
  if (error) console.error('updateSupervisionLog error:', error);
  return !error;
};

export const deleteSupervisionLog = async (id) => {
  const { error } = await supabase
    .from(TABLES.SUPERVISION_LOGS)
    .delete()
    .eq('id', id);
  
  if (error) console.error('deleteSupervisionLog error:', error);
  return !error;
};

// ============================================
// 활성 슈퍼바이지 ID (localStorage)
// ============================================
export const getActiveSuperviseeId = (userId) => {
  try {
    return localStorage.getItem(`tracker_active_sv_${userId}`);
  } catch (e) {
    return null;
  }
};

export const setActiveSuperviseeId = (userId, superviseeId) => {
  try {
    if (superviseeId) {
      localStorage.setItem(`tracker_active_sv_${userId}`, superviseeId);
    } else {
      localStorage.removeItem(`tracker_active_sv_${userId}`);
    }
  } catch (e) {}
};
