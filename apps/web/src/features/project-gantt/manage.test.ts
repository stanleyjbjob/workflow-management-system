/**
 * 專案維護表單純邏輯測試（issue 8.10 #45）：驗證規則鏡像後端引擎。
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_EXCLUSION_FORM,
  EMPTY_MOUNT_FORM,
  EMPTY_PROJECT_FORM,
  allowedStatusTargets,
  validateExclusionForm,
  validateMountForm,
  validateProjectForm,
} from './manage';

describe('allowedStatusTargets（鏡像 PROJECT_TRANSITIONS）', () => {
  it('ACTIVE → ON_HOLD / COMPLETED / CANCELLED', () => {
    expect(allowedStatusTargets('ACTIVE')).toEqual(['ON_HOLD', 'COMPLETED', 'CANCELLED']);
  });
  it('ON_HOLD → ACTIVE / COMPLETED / CANCELLED', () => {
    expect(allowedStatusTargets('ON_HOLD')).toEqual(['ACTIVE', 'COMPLETED', 'CANCELLED']);
  });
  it('終態無出邊', () => {
    expect(allowedStatusTargets('COMPLETED')).toEqual([]);
    expect(allowedStatusTargets('CANCELLED')).toEqual([]);
  });
});

describe('validateProjectForm', () => {
  const valid = { name: '專案A', client: '客戶B', ownerId: 'u1', planStart: '2026-01-01', planEnd: '2026-06-30' };

  it('合法輸入 → payload（trim 後）', () => {
    const r = validateProjectForm({ ...valid, name: ' 專案A ' });
    expect(r).toEqual({ ok: true, payload: { ...valid, name: '專案A' } });
  });
  it('空表單 → 全欄位錯誤', () => {
    const r = validateProjectForm(EMPTY_PROJECT_FORM);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
  it('planEnd 早於 planStart → 錯誤', () => {
    const r = validateProjectForm({ ...valid, planEnd: '2025-12-31' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('計畫結束日不可早於開始日');
  });
  it('非法日期 → 錯誤', () => {
    const r = validateProjectForm({ ...valid, planStart: '2026/01/01' });
    expect(r.ok).toBe(false);
  });
});

describe('validateMountForm', () => {
  const dates = { planStart: '2026-02-01', planEnd: '2026-03-31', progress: '' };

  it('有 caseId 時 flowType / name 可留空（由案件帶出）', () => {
    const r = validateMountForm({ ...EMPTY_MOUNT_FORM, ...dates, caseId: 'case-1' });
    expect(r).toEqual({
      ok: true,
      payload: { caseId: 'case-1', flowType: null, name: null, planStart: '2026-02-01', planEnd: '2026-03-31', progress: null },
    });
  });
  it('無 caseId 時 flowType 與 name 必填', () => {
    const r = validateMountForm({ ...EMPTY_MOUNT_FORM, ...dates });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain('未指定案件時，流程型別必填');
      expect(r.errors).toContain('未指定案件時，流程名稱必填');
    }
  });
  it('progress 超界 → 錯誤；合法值四捨五入', () => {
    const bad = validateMountForm({ ...EMPTY_MOUNT_FORM, ...dates, caseId: 'c', progress: '120' });
    expect(bad.ok).toBe(false);
    const good = validateMountForm({ ...EMPTY_MOUNT_FORM, ...dates, caseId: 'c', progress: '66.6' });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.payload.progress).toBe(67);
  });
  it('end 早於 start → 錯誤', () => {
    const r = validateMountForm({ ...EMPTY_MOUNT_FORM, caseId: 'c', planStart: '2026-03-01', planEnd: '2026-02-01', progress: '' });
    expect(r.ok).toBe(false);
  });
});

describe('validateExclusionForm', () => {
  it('合法輸入（source 可空 → null）', () => {
    const r = validateExclusionForm({ fromDate: '2026-05-01', toDate: '2026-05-03', reason: ' 客戶歲修 ', source: '' });
    expect(r).toEqual({
      ok: true,
      payload: { fromDate: '2026-05-01', toDate: '2026-05-03', reason: '客戶歲修', source: null },
    });
  });
  it('迄日早於起日 / 原因空白 → 錯誤', () => {
    const r = validateExclusionForm({ ...EMPTY_EXCLUSION_FORM, fromDate: '2026-05-03', toDate: '2026-05-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain('迄日不可早於起日');
      expect(r.errors).toContain('原因必填');
    }
  });
  it('帶 source', () => {
    const r = validateExclusionForm({ fromDate: '2026-05-01', toDate: '2026-05-01', reason: 'x', source: 'CUSTOMER' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.source).toBe('CUSTOMER');
  });
});
