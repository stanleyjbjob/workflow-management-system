import { CaseStatus } from '@prisma/client';
import { SalesDocKind, planWin, type SalesDoc } from './sales-engine';
import {
  SALES_HANDOFF_FORM_CODE,
  SalesHandoffError,
  deserializeHandoff,
  serializeHandoff,
} from './sales-handoff';

describe('成案移交持久化序列化（§4.6 成案產出自動帶往導入）', () => {
  function wonDocs(): SalesDoc[] {
    return [
      { kind: SalesDocKind.QUOTE, refId: 'q1', name: '報價單v1', version: 1 },
      { kind: SalesDocKind.QUOTE, refId: 'q2', name: '報價單v2(定版)', version: 2, isFinal: true },
      { kind: SalesDocKind.CUSTOM_REQUIREMENT, refId: 'c1', name: '客製需求', version: 1 },
    ];
  }

  it('表單代碼常數穩定', () => {
    expect(SALES_HANDOFF_FORM_CODE).toBe('SALES_HANDOFF');
  });

  it('serialize → deserialize round-trip 保留移交內容（含 JSON 來回）', () => {
    const handoff = planWin(wonDocs());
    const restored = deserializeHandoff(
      JSON.parse(JSON.stringify(serializeHandoff(handoff))),
    );
    expect(restored.caseStatus).toBe(CaseStatus.COMPLETED);
    expect(restored.finalQuote.refId).toBe('q2');
    expect(restored.finalQuote.version).toBe(2);
    expect(restored.customRequirement?.refId).toBe('c1');
    expect(restored.carriedDocRefIds).toEqual(['q2', 'c1']);
  });

  it('無客製需求時 customRequirement 為 null 且仍可還原', () => {
    const handoff = planWin([
      { kind: SalesDocKind.QUOTE, refId: 'q2', name: '報價單', version: 1, isFinal: true },
    ]);
    const restored = deserializeHandoff(serializeHandoff(handoff));
    expect(restored.customRequirement).toBeNull();
    expect(restored.carriedDocRefIds).toEqual(['q2']);
  });

  it('毀損資料（缺定版報價單欄位）→ handoff_corrupt', () => {
    try {
      deserializeHandoff({
        caseStatus: CaseStatus.COMPLETED,
        finalQuote: null,
        carriedDocRefIds: [],
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as SalesHandoffError).code).toBe('handoff_corrupt');
    }
  });

  it('非物件 → handoff_corrupt', () => {
    try {
      deserializeHandoff(null);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as SalesHandoffError).code).toBe('handoff_corrupt');
    }
  });

  it('客製需求欄位毀損 → handoff_corrupt', () => {
    try {
      deserializeHandoff({
        finalQuote: { kind: SalesDocKind.QUOTE, refId: 'q', name: 'n', version: 1 },
        customRequirement: { kind: 'X' },
        carriedDocRefIds: [],
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as SalesHandoffError).code).toBe('handoff_corrupt');
    }
  });
});
