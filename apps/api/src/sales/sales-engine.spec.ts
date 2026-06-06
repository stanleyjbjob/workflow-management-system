import { CaseStatus, SaleMode } from '@prisma/client';
import {
  ALL_LEAD_SOURCES,
  KNOWN_PRODUCTS,
  LeadSource,
  SalesDocKind,
  SalesEngineError,
  SalesRecordKind,
  assertValidOpportunity,
  filterRecordsByKind,
  finalQuote,
  isKnownProduct,
  latestDoc,
  materializeSalesRecord,
  normalizeOpportunity,
  planLoss,
  planWin,
  sortRecordsChronological,
  summarizeFailureReasons,
  validateFailure,
  validateOpportunity,
  validateSalesRecord,
  type OpportunityInput,
  type SalesDoc,
  type SalesRecord,
} from './sales-engine';

function validOpportunity(over: Partial<OpportunityInput> = {}): OpportunityInput {
  return {
    title: '宏達電人事系統導入',
    clientName: '宏達電',
    leadSources: [LeadSource.MARKETING],
    products: ['人事系統'],
    saleMode: SaleMode.PURCHASE,
    ...over,
  };
}

describe('常數與輔助', () => {
  it('涵蓋五種客戶來源（§4.2）', () => {
    expect(ALL_LEAD_SOURCES).toHaveLength(5);
    expect(ALL_LEAD_SOURCES).toEqual(
      expect.arrayContaining([
        LeadSource.MARKETING,
        LeadSource.CUSTOMER_REFERRAL,
        LeadSource.SELF_DEVELOPED,
        LeadSource.LEGACY_UPGRADE,
        LeadSource.INTERNAL_REFERRAL,
      ]),
    );
  });

  it('isKnownProduct 對已知產品為 true、未知為 false（§4.3）', () => {
    expect(KNOWN_PRODUCTS.length).toBeGreaterThan(0);
    expect(isKnownProduct('人事系統')).toBe(true);
    expect(isKnownProduct('不存在的產品')).toBe(false);
  });
});

describe('商機驗證 validateOpportunity（§4.5 步驟1）', () => {
  it('合法輸入無錯誤', () => {
    expect(validateOpportunity(validOpportunity())).toEqual([]);
  });

  it('缺標題 → title_required', () => {
    expect(validateOpportunity(validOpportunity({ title: '  ' }))).toContain('title_required');
  });

  it('缺客戶 → client_required', () => {
    expect(validateOpportunity(validOpportunity({ clientName: '' }))).toContain('client_required');
  });

  it('無來源 → lead_source_required', () => {
    expect(validateOpportunity(validOpportunity({ leadSources: [] }))).toContain(
      'lead_source_required',
    );
  });

  it('非法來源值 → invalid_lead_source', () => {
    const bad = validOpportunity({ leadSources: ['NOPE' as unknown as LeadSource] });
    expect(validateOpportunity(bad)).toContain('invalid_lead_source');
  });

  it('重複來源 → duplicate_lead_source', () => {
    const dup = validOpportunity({ leadSources: [LeadSource.MARKETING, LeadSource.MARKETING] });
    expect(validateOpportunity(dup)).toContain('duplicate_lead_source');
  });

  it('多選來源合法', () => {
    const multi = validOpportunity({
      leadSources: [LeadSource.MARKETING, LeadSource.INTERNAL_REFERRAL],
    });
    expect(validateOpportunity(multi)).toEqual([]);
  });

  it('無產品 → product_required', () => {
    expect(validateOpportunity(validOpportunity({ products: ['  '] }))).toContain(
      'product_required',
    );
  });

  it('銷售模式非法 → sale_mode_required', () => {
    const bad = validOpportunity({ saleMode: 'WEIRD' as unknown as SaleMode });
    expect(validateOpportunity(bad)).toContain('sale_mode_required');
  });

  it('assertValidOpportunity 對非法輸入丟出 SalesEngineError', () => {
    expect(() => assertValidOpportunity(validOpportunity({ title: '' }))).toThrow(SalesEngineError);
  });
});

describe('normalizeOpportunity', () => {
  it('去重來源、trim、去空產品', () => {
    const n = normalizeOpportunity(
      validOpportunity({
        title: '  案A  ',
        clientName: '  客戶A ',
        leadSources: [LeadSource.MARKETING, LeadSource.SELF_DEVELOPED],
        products: [' 人事系統 ', '人事系統', '  '],
      } as OpportunityInput),
    );
    expect(n.title).toBe('案A');
    expect(n.clientName).toBe('客戶A');
    expect(n.leadSources).toEqual([LeadSource.MARKETING, LeadSource.SELF_DEVELOPED]);
    expect(n.products).toEqual(['人事系統']);
    expect(n.saleMode).toBe(SaleMode.PURCHASE);
  });

  it('訂閱制保留', () => {
    const n = normalizeOpportunity(validOpportunity({ saleMode: SaleMode.SUBSCRIPTION }));
    expect(n.saleMode).toBe(SaleMode.SUBSCRIPTION);
  });
});

describe('拜訪 / 會議紀錄（append-only，§4.5 步驟2 / §4.6）', () => {
  it('合法紀錄通過驗證', () => {
    expect(
      validateSalesRecord({ kind: SalesRecordKind.VISIT, summary: '初次拜訪' }),
    ).toEqual([]);
  });

  it('缺摘要 → record_summary_required', () => {
    expect(validateSalesRecord({ kind: SalesRecordKind.DEMO, summary: '' })).toContain(
      'record_summary_required',
    );
  });

  it('非法類型 → record_invalid_kind', () => {
    expect(
      validateSalesRecord({ kind: 'X' as unknown as SalesRecordKind, summary: 'a' }),
    ).toContain('record_invalid_kind');
  });

  it('materialize 產生不可變紀錄（凍結，無法竄改）', () => {
    const rec = materializeSalesRecord({
      kind: SalesRecordKind.MEETING,
      summary: ' 啟動討論 ',
      attendees: ['業務A', '客戶B'],
      detail: ' 詳細 ',
    });
    expect(rec.summary).toBe('啟動討論');
    expect(rec.detail).toBe('詳細');
    expect(rec.attendees).toEqual(['業務A', '客戶B']);
    expect(Object.isFrozen(rec)).toBe(true);
    expect(() => {
      (rec as { summary: string }).summary = 'tampered';
    }).toThrow();
  });

  it('未提供 occurredAt 時以 now 帶入', () => {
    const now = new Date('2026-06-06T00:00:00Z');
    const rec = materializeSalesRecord({ kind: SalesRecordKind.VISIT, summary: 'x' }, now);
    expect(rec.occurredAt).toEqual(now);
  });

  it('可重複新增多筆並依時間排序、依類型篩選', () => {
    const records: SalesRecord[] = [
      materializeSalesRecord({
        kind: SalesRecordKind.VISIT,
        summary: '第二次',
        occurredAt: new Date('2026-02-02'),
      }),
      materializeSalesRecord({
        kind: SalesRecordKind.DEMO,
        summary: 'Demo',
        occurredAt: new Date('2026-03-01'),
      }),
      materializeSalesRecord({
        kind: SalesRecordKind.VISIT,
        summary: '第一次',
        occurredAt: new Date('2026-01-01'),
      }),
    ];
    const sorted = sortRecordsChronological(records);
    expect(sorted.map((r) => r.summary)).toEqual(['第一次', '第二次', 'Demo']);
    expect(filterRecordsByKind(records, SalesRecordKind.VISIT)).toHaveLength(2);
    // 原陣列不被改動
    expect(records[0].summary).toBe('第二次');
  });
});

describe('銷售產出文件 / 成案移交（§4.5 步驟3~5a / §4.6）', () => {
  const docs: SalesDoc[] = [
    { kind: SalesDocKind.QUOTE, refId: 'q1', name: '報價v1', version: 1 },
    { kind: SalesDocKind.QUOTE, refId: 'q2', name: '報價v2(定版)', version: 2, isFinal: true },
    { kind: SalesDocKind.CUSTOM_REQUIREMENT, refId: 'c1', name: '客製v1', version: 1 },
    { kind: SalesDocKind.CUSTOM_REQUIREMENT, refId: 'c2', name: '客製v2', version: 2 },
  ];

  it('latestDoc 取各類最新版', () => {
    expect(latestDoc(docs, SalesDocKind.QUOTE)?.refId).toBe('q2');
    expect(latestDoc(docs, SalesDocKind.CUSTOM_REQUIREMENT)?.refId).toBe('c2');
  });

  it('finalQuote 取定版報價單', () => {
    expect(finalQuote(docs)?.refId).toBe('q2');
  });

  it('planWin 帶出定版報價單 + 最新客製需求並轉 COMPLETED', () => {
    const h = planWin(docs);
    expect(h.caseStatus).toBe(CaseStatus.COMPLETED);
    expect(h.finalQuote.refId).toBe('q2');
    expect(h.customRequirement?.refId).toBe('c2');
    expect(h.carriedDocRefIds).toEqual(['q2', 'c2']);
  });

  it('無客製需求時 planWin 僅帶報價單', () => {
    const onlyQuote: SalesDoc[] = [
      { kind: SalesDocKind.QUOTE, refId: 'q9', name: 'q', version: 1, isFinal: true },
    ];
    const h = planWin(onlyQuote);
    expect(h.customRequirement).toBeNull();
    expect(h.carriedDocRefIds).toEqual(['q9']);
  });

  it('無定版報價單 → planWin 拋 no_final_quote', () => {
    const noFinal: SalesDoc[] = [
      { kind: SalesDocKind.QUOTE, refId: 'q1', name: 'q', version: 1 },
    ];
    expect(() => planWin(noFinal)).toThrow(SalesEngineError);
    try {
      planWin(noFinal);
    } catch (e) {
      expect((e as SalesEngineError).code).toBe('no_final_quote');
    }
  });
});

describe('失敗結案與統計（§4.5 步驟5b / §4.6 / §12-2）', () => {
  it('合法失敗輸入通過', () => {
    expect(validateFailure({ category: 'PRICE', reason: '預算不足' })).toEqual([]);
  });

  it('缺分類 → failure_category_required', () => {
    expect(validateFailure({ category: ' ', reason: 'x' })).toContain('failure_category_required');
  });

  it('缺原因 → failure_reason_required', () => {
    expect(validateFailure({ category: 'PRICE', reason: '' })).toContain('failure_reason_required');
  });

  it('planLoss 轉 FAILED 並留存分類與原因', () => {
    const now = new Date('2026-06-06T00:00:00Z');
    const f = planLoss({ category: 'COMPETITOR', reason: '被競品搶單' }, now);
    expect(f.caseStatus).toBe(CaseStatus.FAILED);
    expect(f.category).toBe('COMPETITOR');
    expect(f.reason).toBe('被競品搶單');
    expect(f.occurredAt).toEqual(now);
  });

  it('summarizeFailureReasons 依分類彙總筆數', () => {
    const stats = summarizeFailureReasons([
      { category: 'PRICE' },
      { category: 'PRICE' },
      { category: 'COMPETITOR' },
      { category: 'TIMING' },
      { category: 'COMPETITOR' },
    ]);
    expect(stats).toEqual({ PRICE: 2, COMPETITOR: 2, TIMING: 1 });
  });
});
