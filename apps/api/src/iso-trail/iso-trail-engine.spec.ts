/**
 * ISO 27001 文件化軌跡引擎單元測試（issue 6.2 / §11）。
 *
 * 以 jest 風格撰寫（describe/it/expect）。沙箱環境另以等價自製 harness 執行驗證；
 * 真實 monorepo 以 jest + ts-jest 執行。涵蓋：分類對應、版本、簽核軌跡、留存期限、
 * 查閱過濾、缺口清單、彙總統計、匯出（扁平列 + CSV）。
 */
import {
  AUDIT_EXPORT_COLUMNS,
  DEFAULT_ISO_ASPECT_MAP,
  SAMPLE_RETENTION_POLICY,
  attachmentToRecord,
  buildAuditExport,
  buildSigningTrail,
  buildTrail,
  classifyFormByCode,
  computeRetentionUntil,
  filterTrail,
  formSubmissionToRecord,
  isRetentionExpired,
  loginToRecord,
  pendingSignatures,
  projectRecordToRecord,
  resolveAspect,
  signStatusOf,
  summarizeTrail,
  toAuditExportRows,
  toCsv,
  toIsoDate,
  IsoTrailEngineError,
  type FormSubmissionTraceInput,
  type TraceabilityRecord,
} from './iso-trail-engine';

const D = (s: string) => new Date(s);

function baseSub(over: Partial<FormSubmissionTraceInput> = {}): FormSubmissionTraceInput {
  return {
    id: 'sub1',
    formCode: 'GENERIC',
    formName: '一般表單',
    version: 1,
    isSignable: false,
    status: 'DRAFT',
    createdAt: D('2026-01-01T00:00:00Z'),
    ...over,
  };
}

describe('classifyFormByCode', () => {
  it('依關鍵字（中/英、code/name）歸類', () => {
    expect(classifyFormByCode('DELEGATION_AUTH', '委任權限表')).toBe('DELEGATION_AUTH');
    expect(classifyFormByCode('PERSONNEL_FORM')).toBe('PERSONNEL');
    expect(classifyFormByCode('CR-001', '需求變更單')).toBe('CHANGE_REQUEST');
    expect(classifyFormByCode('X', '複測報告')).toBe('TEST_DOC');
    expect(classifyFormByCode('ENV_ACCEPTANCE', '環境驗收表')).toBe('ENV_CHECKLIST');
    expect(classifyFormByCode('KICKOFF', '啟動會議記錄')).toBe('MEETING_MINUTES');
    expect(classifyFormByCode('X', '失敗原因')).toBe('FAILURE_RECORD');
  });
  it('不分大小寫', () => {
    expect(classifyFormByCode('delegation')).toBe('DELEGATION_AUTH');
  });
  it('無命中回 OTHER', () => {
    expect(classifyFormByCode('ZZZ', '無關')).toBe('OTHER');
  });
  it('可由呼叫端覆寫對照', () => {
    const patterns = [{ kind: 'PERSONNEL' as const, keywords: ['foo'] }];
    expect(classifyFormByCode('委任', '', patterns)).toBe('OTHER');
    expect(classifyFormByCode('foo', '', patterns)).toBe('PERSONNEL');
  });
});

describe('resolveAspect', () => {
  it('回對應面向與簽核需求', () => {
    expect(resolveAspect('DELEGATION_AUTH').requiresSignature).toBe(true);
    expect(resolveAspect('CHANGE_REQUEST').requiresSignature).toBe(true);
    expect(resolveAspect('LOGIN_AUDIT').annexHint).toBe('A.5');
    expect(resolveAspect('PERSONNEL').requiresSignature).toBe(false);
  });
});

describe('toIsoDate / assertDate', () => {
  it('UTC 日期格式化', () => {
    expect(toIsoDate(D('2026-03-05T23:59:59Z'))).toBe('2026-03-05');
  });
  it('非法日期丟錯', () => {
    expect(() => toIsoDate(new Date('nope'))).toThrow(IsoTrailEngineError);
  });
});

describe('computeRetentionUntil', () => {
  it('無政策回 null', () => {
    expect(computeRetentionUntil(D('2026-01-01T00:00:00Z'), 'DELEGATION_AUTH')).toBeNull();
  });
  it('政策內 null（永久）回 null', () => {
    expect(computeRetentionUntil(D('2026-01-01T00:00:00Z'), 'WORK_TEMPLATE', SAMPLE_RETENTION_POLICY)).toBeNull();
  });
  it('依年數推導到期日', () => {
    const r = computeRetentionUntil(D('2026-01-01T00:00:00Z'), 'DELEGATION_AUTH', SAMPLE_RETENTION_POLICY);
    expect(r).not.toBeNull();
    expect(toIsoDate(r as Date)).toBe('2033-01-01');
  });
  it('種類不在政策內回 null', () => {
    expect(computeRetentionUntil(D('2026-01-01T00:00:00Z'), 'OTHER', { DELEGATION_AUTH: 7 })).toBeNull();
  });
});

describe('buildSigningTrail / signStatusOf', () => {
  it('DRAFT 僅有 CREATED', () => {
    const ev = buildSigningTrail(baseSub({ status: 'DRAFT' }));
    expect(ev.map((e) => e.action)).toEqual(['CREATED']);
    expect(signStatusOf(baseSub({ status: 'DRAFT' }))).toBe('DRAFT');
  });
  it('SUBMITTED 有 CREATED+SUBMITTED 並帶送出者', () => {
    const ev = buildSigningTrail(
      baseSub({ status: 'SUBMITTED', submittedById: 'u1', submittedAt: D('2026-01-02T00:00:00Z') }),
    );
    expect(ev.map((e) => e.action)).toEqual(['CREATED', 'SUBMITTED']);
    expect(ev[1].actorId).toBe('u1');
  });
  it('APPROVED 有三事件且依時間排序、帶核可者', () => {
    const ev = buildSigningTrail(
      baseSub({
        status: 'APPROVED',
        submittedById: 'u1',
        submittedAt: D('2026-01-02T00:00:00Z'),
        approvedById: 'mgr',
        approvedAt: D('2026-01-03T00:00:00Z'),
      }),
    );
    expect(ev.map((e) => e.action)).toEqual(['CREATED', 'SUBMITTED', 'APPROVED']);
    expect(ev[2].actorId).toBe('mgr');
  });
  it('REJECTED 第三事件為 REJECTED', () => {
    const ev = buildSigningTrail(
      baseSub({ status: 'REJECTED', submittedAt: D('2026-01-02T00:00:00Z'), approvedAt: D('2026-01-03T00:00:00Z') }),
    );
    expect(ev[ev.length - 1].action).toBe('REJECTED');
  });
});

describe('formSubmissionToRecord', () => {
  it('簽核類表單 requiresSignature=true、已核可 signedOff=true、版本帶出', () => {
    const r = formSubmissionToRecord(
      baseSub({
        id: 's',
        formCode: 'DELEGATION',
        formName: '委任權限表',
        version: 3,
        isSignable: true,
        status: 'APPROVED',
        submittedAt: D('2026-01-02T00:00:00Z'),
        approvedAt: D('2026-01-03T00:00:00Z'),
        caseId: 'c1',
      }),
    );
    expect(r.requiresSignature).toBe(true);
    expect(r.signedOff).toBe(true);
    expect(r.version).toBe(3);
    expect(r.documentKind).toBe('DELEGATION_AUTH');
    expect(r.occurredAt.toISOString()).toBe('2026-01-03T00:00:00.000Z');
    expect(r.caseId).toBe('c1');
  });
  it('非簽核但對映面向需簽核者，仍要求簽核（CHANGE_REQUEST）', () => {
    const r = formSubmissionToRecord(baseSub({ formCode: 'CR', formName: '需求變更單', isSignable: false }));
    expect(r.requiresSignature).toBe(true);
    expect(r.signedOff).toBe(false);
  });
  it('可由呼叫端直接指定 documentKind', () => {
    const r = formSubmissionToRecord(baseSub({ documentKind: 'PERSONNEL' }));
    expect(r.documentKind).toBe('PERSONNEL');
  });
  it('帶入留存政策推導 retentionUntil', () => {
    const r = formSubmissionToRecord(baseSub({ formCode: 'DELEGATION', isSignable: true }), {
      retentionPolicy: SAMPLE_RETENTION_POLICY,
    });
    expect(r.retentionUntil).not.toBeNull();
  });
});

describe('attachmentToRecord / loginToRecord / projectRecordToRecord', () => {
  it('附件帶版本與上傳事件', () => {
    const r = attachmentToRecord({
      id: 'a1',
      name: '報價單.pdf',
      type: 'FILE',
      version: 2,
      uploadedById: 'u9',
      createdAt: D('2026-02-01T00:00:00Z'),
      caseId: 'c2',
    });
    expect(r.recordType).toBe('ATTACHMENT');
    expect(r.version).toBe(2);
    expect(r.events[0].action).toBe('UPLOADED');
    expect(r.actorId).toBe('u9');
  });
  it('登入紀錄對應 A.5', () => {
    const r = loginToRecord({
      id: 'l1',
      userId: 'u1',
      email: 'a@b.com',
      eventType: 'LOGIN_SUCCESS',
      success: true,
      at: D('2026-02-02T08:00:00Z'),
    });
    expect(r.recordType).toBe('LOGIN');
    expect(r.annexHint).toBe('A.5');
    expect(r.events[0].action).toBe('LOGIN');
  });
  it('專案排除日 → EXCLUSION，進度 → PROJECT_PROGRESS', () => {
    const ex = projectRecordToRecord({ id: 'e1', projectId: 'p1', subtype: 'EXCLUSION', title: '客戶凍結', at: D('2026-03-01T00:00:00Z') });
    expect(ex.recordType).toBe('EXCLUSION');
    expect(ex.projectId).toBe('p1');
    const pr = projectRecordToRecord({ id: 'pr1', projectId: 'p1', subtype: 'PROGRESS', title: '導入 60%', at: D('2026-03-02T00:00:00Z') });
    expect(pr.recordType).toBe('PROJECT_PROGRESS');
  });
});

describe('buildTrail', () => {
  it('合併各來源並依時間新到舊排序', () => {
    const trail = buildTrail({
      formSubmissions: [baseSub({ id: 'f', createdAt: D('2026-01-05T00:00:00Z') })],
      attachments: [{ id: 'a', name: 'x', type: 'LINK', version: 1, createdAt: D('2026-01-10T00:00:00Z') }],
      logins: [{ id: 'l', eventType: 'LOGIN_SUCCESS', success: true, at: D('2026-01-08T00:00:00Z') }],
    });
    expect(trail.map((r) => r.recordId)).toEqual(['a', 'l', 'f']);
  });
  it('空輸入回空陣列', () => {
    expect(buildTrail({})).toEqual([]);
  });
});

describe('filterTrail', () => {
  const records = buildTrail({
    formSubmissions: [
      baseSub({ id: 'f1', formCode: 'DELEGATION', isSignable: true, status: 'APPROVED', approvedAt: D('2026-01-03T00:00:00Z'), caseId: 'c1' }),
      baseSub({ id: 'f2', formCode: 'CR', formName: '需求變更單', status: 'SUBMITTED', submittedAt: D('2026-01-04T00:00:00Z'), caseId: 'c2' }),
    ],
    logins: [{ id: 'l1', userId: 'u1', eventType: 'LOGIN_SUCCESS', success: true, at: D('2026-01-02T00:00:00Z') }],
  });
  it('依 recordType 過濾', () => {
    expect(filterTrail(records, { recordTypes: ['LOGIN'] }).map((r) => r.recordId)).toEqual(['l1']);
  });
  it('依 caseId 過濾', () => {
    expect(filterTrail(records, { caseId: 'c1' }).map((r) => r.recordId)).toEqual(['f1']);
  });
  it('依日期區間過濾', () => {
    const out = filterTrail(records, { from: D('2026-01-03T00:00:00Z'), to: D('2026-01-04T00:00:00Z') });
    expect(out.map((r) => r.recordId).sort()).toEqual(['f1', 'f2']);
  });
  it('requiresSignatureOnly + signedOff', () => {
    expect(filterTrail(records, { requiresSignatureOnly: true, signedOff: false }).map((r) => r.recordId)).toEqual(['f2']);
    expect(filterTrail(records, { requiresSignatureOnly: true, signedOff: true }).map((r) => r.recordId)).toEqual(['f1']);
  });
});

describe('pendingSignatures / summarizeTrail', () => {
  const records = buildTrail({
    formSubmissions: [
      baseSub({ id: 'f1', formCode: 'DELEGATION', isSignable: true, status: 'APPROVED', approvedAt: D('2026-01-03T00:00:00Z') }),
      baseSub({ id: 'f2', formCode: 'CR', formName: '需求變更單', status: 'SUBMITTED', submittedAt: D('2026-01-04T00:00:00Z') }),
      baseSub({ id: 'f3', formCode: 'PERSONNEL', formName: '人員資料表', status: 'SUBMITTED', submittedAt: D('2026-01-05T00:00:00Z') }),
    ],
  });
  it('pendingSignatures 僅列要求簽核但未完成', () => {
    expect(pendingSignatures(records).map((r) => r.recordId)).toEqual(['f2']);
  });
  it('summarizeTrail 統計簽核/缺口', () => {
    const s = summarizeTrail(records, D('2026-06-01T00:00:00Z'));
    expect(s.total).toBe(3);
    expect(s.signableCount).toBe(2);
    expect(s.signedCount).toBe(1);
    expect(s.pendingSignatureCount).toBe(1);
    expect(s.expiredRetentionCount).toBe(0);
  });
});

describe('isRetentionExpired', () => {
  it('null 留存一律未到期', () => {
    const r = formSubmissionToRecord(baseSub({ id: 'x' }));
    expect(isRetentionExpired(r, D('2099-01-01T00:00:00Z'))).toBe(false);
  });
  it('超過到期日為 true', () => {
    const r = formSubmissionToRecord(baseSub({ id: 'x', formCode: 'LOGINX', documentKind: 'LOGIN_AUDIT', createdAt: D('2026-01-01T00:00:00Z') }), {
      retentionPolicy: { LOGIN_AUDIT: 1 },
    });
    expect(isRetentionExpired(r, D('2027-06-01T00:00:00Z'))).toBe(true);
    expect(isRetentionExpired(r, D('2026-06-01T00:00:00Z'))).toBe(false);
  });
});

describe('export', () => {
  const records: TraceabilityRecord[] = buildTrail({
    formSubmissions: [
      baseSub({ id: 'f1', formCode: 'DELEGATION', formName: '委任權限表', isSignable: true, status: 'APPROVED', submittedById: 'u1', submittedAt: D('2026-01-02T00:00:00Z'), approvedById: 'mgr', approvedAt: D('2026-01-03T00:00:00Z'), caseId: 'c1' }),
    ],
  });
  it('toAuditExportRows 攝平欄位與軌跡字串', () => {
    const rows = toAuditExportRows(records);
    expect(rows.length).toBe(1);
    expect(rows[0].documentKind).toBe('DELEGATION_AUTH');
    expect(rows[0].signedOff).toBe(true);
    expect(rows[0].trail).toContain('APPROVED by mgr');
  });
  it('toCsv 含表頭與所有欄位', () => {
    const csv = toCsv(toAuditExportRows(records));
    const lines = csv.split('\n');
    expect(lines[0]).toBe(AUDIT_EXPORT_COLUMNS.join(','));
    expect(lines.length).toBe(2);
  });
  it('toCsv 轉義含逗號/引號的欄位', () => {
    const r = toAuditExportRows(
      buildTrail({ formSubmissions: [baseSub({ id: 'q', formName: 'a,b "c"' })] }),
    );
    const csv = toCsv(r);
    expect(csv).toContain('"a,b ""c"""');
  });
  it('buildAuditExport 含彙總與缺口清單', () => {
    const exp = buildAuditExport(records, D('2026-06-01T00:00:00Z'));
    expect(exp.summary.total).toBe(1);
    expect(exp.pendingSignatureIds).toEqual([]);
    expect(typeof exp.generatedAt).toBe('string');
  });
});

describe('DEFAULT_ISO_ASPECT_MAP 覆蓋 §11.2', () => {
  it('每個文件種類皆有對映', () => {
    const kinds = Object.keys(DEFAULT_ISO_ASPECT_MAP);
    expect(kinds).toContain('DELEGATION_AUTH');
    expect(kinds).toContain('LOGIN_AUDIT');
    expect(kinds).toContain('PROJECT_RECORD');
  });
});
