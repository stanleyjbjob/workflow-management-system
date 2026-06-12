/** 案件詳情 REST 查詢/酬載組裝測試（issue 8.12 #47，純函式）。 */
import { describe, expect, it } from 'vitest';
import { caseListQuery, returnCaseBody } from './api';

describe('caseListQuery', () => {
  it('無條件回空字串', () => {
    expect(caseListQuery()).toBe('');
    expect(caseListQuery({ flowType: null, status: null, assigneeId: null })).toBe('');
  });

  it('帶條件 AND 疊加', () => {
    expect(caseListQuery({ flowType: 'SALES', status: 'IN_PROGRESS' })).toBe('?flowType=SALES&status=IN_PROGRESS');
    expect(caseListQuery({ assigneeId: 'u1' })).toBe('?assigneeId=u1');
  });
});

describe('returnCaseBody', () => {
  it('必帶 target 與 reason；assigneeId 未指定時不出現', () => {
    expect(returnCaseBody({ targetStepDefinitionId: 'sd1', reason: '資料有誤' })).toEqual({
      targetStepDefinitionId: 'sd1',
      reason: '資料有誤',
    });
  });

  it('assigneeId 明確指定（含 null）才帶上', () => {
    expect(returnCaseBody({ targetStepDefinitionId: 'sd1', reason: 'r', assigneeId: null })).toEqual({
      targetStepDefinitionId: 'sd1',
      reason: 'r',
      assigneeId: null,
    });
  });
});
