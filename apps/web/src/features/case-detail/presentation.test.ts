/** 案件詳情 呈現對映層測試（issue 8.12 #47）。 */
import { describe, expect, it } from 'vitest';
import type { CaseDetail, CaseStep, CaseStepForm } from './api';
import {
  activeStepIndex,
  attachmentMeta,
  canAdvance,
  canFill,
  canSign,
  caseMeta,
  caseOptionLabel,
  caseTags,
  dateOnly,
  flowLabel,
  returnTargets,
  stepActive,
  stepDone,
  stepRoleLabel,
  stepStatusPill,
  unmetRequiredFormNames,
} from './presentation';

function form(over: Partial<CaseStepForm> = {}): CaseStepForm {
  return {
    formId: 'f1',
    code: 'QUOTE',
    name: '報價單',
    isRequired: true,
    isSignable: false,
    status: 'MISSING',
    satisfied: false,
    submissionId: null,
    submittedAt: null,
    approvedAt: null,
    ...over,
  };
}

function step(over: Partial<CaseStep> = {}): CaseStep {
  return {
    stepInstanceId: 'si1',
    stepDefinitionId: 'sd1',
    order: 1,
    name: '建立商機',
    description: null,
    responsibleRoleId: 'SALES',
    responsibleRoleName: '業務',
    assignee: null,
    status: 'PENDING',
    dueDate: null,
    startedAt: null,
    completedAt: null,
    note: null,
    forms: [],
    ...over,
  };
}

function detail(over: Partial<CaseDetail> = {}): CaseDetail {
  return {
    id: 'c1',
    code: 'CASE-001',
    title: '宏全 ERP 商機',
    flowType: 'SALES',
    status: 'IN_PROGRESS',
    clientName: '宏全國際',
    saleMode: 'PURCHASE',
    failureReason: null,
    workflow: { id: 'w1', name: '銷售流程', version: 1 },
    assignee: { id: 'u1', displayName: 'David' },
    createdBy: null,
    currentStepInstanceId: 'si2',
    steps: [
      step({ stepInstanceId: 'si1', stepDefinitionId: 'sd1', order: 1, status: 'COMPLETED' }),
      step({ stepInstanceId: 'si2', stepDefinitionId: 'sd2', order: 2, status: 'IN_PROGRESS' }),
      step({ stepInstanceId: 'si3', stepDefinitionId: 'sd3', order: 3, status: 'PENDING' }),
    ],
    attachments: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...over,
  };
}

describe('標籤與 meta', () => {
  it('flowLabel 對映四大流程', () => {
    expect(flowLabel('SALES')).toBe('銷售流程');
    expect(flowLabel('CUSTOMIZATION')).toBe('客製化流程');
  });

  it('caseTags 帶狀態/流程/銷售模式', () => {
    const tags = caseTags(detail());
    expect(tags).toContainEqual(['進行中', 'p-blue']);
    expect(tags).toContainEqual(['銷售流程', 'p-purple']);
    expect(tags).toContainEqual(['買斷制', 'p-grey']);
  });

  it('caseMeta 組編號/客戶/負責人；缺值略過', () => {
    expect(caseMeta(detail())).toBe('案件編號：CASE-001　·　客戶：宏全國際　·　負責人：David');
    expect(caseMeta(detail({ clientName: null, assignee: null }))).toBe('案件編號：CASE-001');
  });

  it('caseOptionLabel 含編號/標題/狀態', () => {
    expect(caseOptionLabel({ code: 'CASE-001', title: 'T', status: 'COMPLETED' })).toBe('CASE-001｜T（已完成）');
  });

  it('dateOnly 取日期部分', () => {
    expect(dateOnly('2026-06-03T12:00:00.000Z')).toBe('2026-06-03');
    expect(dateOnly(null)).toBeNull();
  });
});

describe('步驟判定', () => {
  it('stepDone：COMPLETED/SKIPPED 視為已過', () => {
    expect(stepDone(step({ status: 'COMPLETED' }))).toBe(true);
    expect(stepDone(step({ status: 'SKIPPED' }))).toBe(true);
    expect(stepDone(step({ status: 'IN_PROGRESS' }))).toBe(false);
  });

  it('stepActive 以 currentStepInstanceId 為準', () => {
    const d = detail();
    expect(stepActive(d.steps[1], d)).toBe(true);
    expect(stepActive(d.steps[0], d)).toBe(false);
  });

  it('activeStepIndex：找到當前步驟；無 current 時退回第一個未完成', () => {
    expect(activeStepIndex(detail())).toBe(1);
    const d = detail({ currentStepInstanceId: null });
    expect(activeStepIndex(d)).toBe(1); // si2 為第一個未完成
    const done = detail({
      currentStepInstanceId: null,
      steps: [step({ status: 'COMPLETED' }), step({ stepInstanceId: 'si2', status: 'COMPLETED' })],
    });
    expect(activeStepIndex(done)).toBe(0);
  });

  it('stepStatusPill：done→綠、RETURNED→紅、active→藍、其他→灰', () => {
    expect(stepStatusPill(step({ status: 'COMPLETED' }), false)).toEqual(['已完成', 'p-green']);
    expect(stepStatusPill(step({ status: 'RETURNED' }), false)).toEqual(['被退回', 'p-red']);
    expect(stepStatusPill(step({ status: 'PENDING' }), true)).toEqual(['進行中', 'p-blue']);
    expect(stepStatusPill(step({ status: 'PENDING' }), false)).toEqual(['未開始', 'p-grey']);
  });

  it('stepRoleLabel 優先角色名', () => {
    expect(stepRoleLabel(step())).toBe('業務');
    expect(stepRoleLabel(step({ responsibleRoleName: null }))).toBe('SALES');
    expect(stepRoleLabel(step({ responsibleRoleName: null, responsibleRoleId: null }))).toBe('未指定');
  });
});

describe('推進/退回判定', () => {
  it('canAdvance：進行中且有當前步驟', () => {
    expect(canAdvance(detail())).toBe(true);
    expect(canAdvance(detail({ status: 'COMPLETED' }))).toBe(false);
    expect(canAdvance(detail({ currentStepInstanceId: null }))).toBe(false);
  });

  it('returnTargets：回當前步驟之前的步驟', () => {
    const targets = returnTargets(detail());
    expect(targets.map((s) => s.stepDefinitionId)).toEqual(['sd1']);
    expect(returnTargets(detail({ currentStepInstanceId: 'si1' }))).toEqual([]);
    expect(returnTargets(detail({ currentStepInstanceId: null }))).toEqual([]);
  });

  it('unmetRequiredFormNames 僅列必填未達成', () => {
    const s = step({
      forms: [
        form({ name: 'A', isRequired: true, satisfied: false }),
        form({ name: 'B', isRequired: true, satisfied: true }),
        form({ name: 'C', isRequired: false, satisfied: false }),
      ],
    });
    expect(unmetRequiredFormNames(s)).toEqual(['A']);
  });
});

describe('表單/附件', () => {
  it('canSign：可簽核＋已送出＋有 submission', () => {
    expect(canSign(form({ isSignable: true, status: 'SUBMITTED', submissionId: 's1' }))).toBe(true);
    expect(canSign(form({ isSignable: false, status: 'SUBMITTED', submissionId: 's1' }))).toBe(false);
    expect(canSign(form({ isSignable: true, status: 'APPROVED', submissionId: 's1' }))).toBe(false);
    expect(canSign(form({ isSignable: true, status: 'MISSING', submissionId: null }))).toBe(false);
  });

  it('canFill：已簽核不可再填', () => {
    expect(canFill(form({ status: 'MISSING' }))).toBe(true);
    expect(canFill(form({ status: 'REJECTED' }))).toBe(true);
    expect(canFill(form({ status: 'APPROVED' }))).toBe(false);
  });

  it('attachmentMeta 組版本/大小/日期', () => {
    expect(attachmentMeta({ version: 2, sizeBytes: 2048, createdAt: '2026-06-02T00:00:00.000Z' })).toBe('v2 · 2.0 KB · 2026-06-02');
    expect(attachmentMeta({ version: 1, sizeBytes: null, createdAt: '2026-06-02T00:00:00.000Z' })).toBe('2026-06-02');
  });
});
