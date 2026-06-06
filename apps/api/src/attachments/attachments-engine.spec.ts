import {
  AttachmentsEngineError,
  EngineAttachment,
  assertValidAttachmentInput,
  attachmentHistory,
  distinctAttachmentNames,
  isM365Link,
  latestAttachments,
  latestVersionByName,
  linkProvider,
  nextVersion,
  permissionModelOf,
  planCreateAttachment,
  resolveDownload,
  resolveTarget,
  sameTarget,
  sourceTypeOf,
  validateAttachmentInput,
} from './attachments-engine';

const CASE = 'case-1';

function att(
  name: string,
  version: number,
  opts: Partial<EngineAttachment> = {},
): EngineAttachment {
  const hasLink = 'linkUrl' in opts && !!opts.linkUrl;
  return {
    id: opts.id ?? `${name}-v${version}`,
    name,
    type: opts.type,
    caseId: 'caseId' in opts ? (opts.caseId ?? null) : CASE,
    stepInstanceId: opts.stepInstanceId ?? null,
    formSubmissionId: opts.formSubmissionId ?? null,
    fileUrl:
      'fileUrl' in opts
        ? (opts.fileUrl ?? null)
        : hasLink
          ? null
          : 'https://files/' + name + '-v' + version + '.pdf',
    linkUrl: 'linkUrl' in opts ? (opts.linkUrl ?? null) : null,
    mimeType: opts.mimeType ?? 'application/pdf',
    sizeBytes: opts.sizeBytes ?? 1024,
    version,
    uploadedById: opts.uploadedById ?? 'user-1',
    createdAt: opts.createdAt ?? new Date(2026, 0, version),
  };
}

describe('resolveTarget', () => {
  it('案件目標', () => {
    expect(resolveTarget({ caseId: 'c1' })).toEqual({ kind: 'CASE', id: 'c1' });
  });
  it('步驟實例目標', () => {
    expect(resolveTarget({ stepInstanceId: 's1' })).toEqual({
      kind: 'STEP_INSTANCE',
      id: 's1',
    });
  });
  it('表單提交目標', () => {
    expect(resolveTarget({ formSubmissionId: 'f1' })).toEqual({
      kind: 'FORM_SUBMISSION',
      id: 'f1',
    });
  });
  it('未提供目標 → missing_target', () => {
    expect(() => resolveTarget({})).toThrow(AttachmentsEngineError);
    try {
      resolveTarget({});
    } catch (e) {
      expect((e as AttachmentsEngineError).code).toBe('missing_target');
    }
  });
  it('多個目標 → multiple_targets', () => {
    try {
      resolveTarget({ caseId: 'c', stepInstanceId: 's' });
    } catch (e) {
      expect((e as AttachmentsEngineError).code).toBe('multiple_targets');
    }
  });
});

describe('sameTarget', () => {
  it('相同目標', () => {
    expect(sameTarget({ caseId: 'c' }, { caseId: 'c' })).toBe(true);
  });
  it('不同目標', () => {
    expect(sameTarget({ caseId: 'c' }, { stepInstanceId: 'c' })).toBe(false);
  });
});

describe('linkProvider / isM365Link', () => {
  it('SharePoint 連結', () => {
    expect(linkProvider('https://contoso.sharepoint.com/sites/x/a.docx')).toBe(
      'SHAREPOINT',
    );
  });
  it('OneDrive for Business（-my.sharepoint.com）', () => {
    expect(
      linkProvider('https://contoso-my.sharepoint.com/personal/u/a.xlsx'),
    ).toBe('ONEDRIVE');
  });
  it('OneDrive 短連結 1drv.ms', () => {
    expect(linkProvider('https://1drv.ms/x/s!abc')).toBe('ONEDRIVE');
  });
  it('onedrive.live.com', () => {
    expect(linkProvider('https://onedrive.live.com/?id=abc')).toBe('ONEDRIVE');
  });
  it('其他連結 → OTHER', () => {
    expect(linkProvider('https://example.com/a.pdf')).toBe('OTHER');
  });
  it('非法 URL → OTHER', () => {
    expect(linkProvider('not a url')).toBe('OTHER');
  });
  it('isM365Link 對 SharePoint/OneDrive 為 true、其他為 false', () => {
    expect(isM365Link('https://contoso.sharepoint.com/x')).toBe(true);
    expect(isM365Link('https://example.com/x')).toBe(false);
  });
});

describe('sourceTypeOf / permissionModelOf', () => {
  it('有 fileUrl → FILE / SYSTEM', () => {
    expect(sourceTypeOf({ fileUrl: 'f', linkUrl: null })).toBe('FILE');
    expect(permissionModelOf({ fileUrl: 'f', linkUrl: null })).toBe('SYSTEM');
  });
  it('SharePoint 連結 → LINK / M365_INHERITED', () => {
    const a = { fileUrl: null, linkUrl: 'https://x.sharepoint.com/y' };
    expect(sourceTypeOf(a)).toBe('LINK');
    expect(permissionModelOf(a)).toBe('M365_INHERITED');
  });
  it('其他連結 → EXTERNAL', () => {
    expect(permissionModelOf({ fileUrl: null, linkUrl: 'https://ex.com/y' })).toBe(
      'EXTERNAL',
    );
  });
});

describe('validateAttachmentInput', () => {
  it('name 為空 → missing_name', () => {
    expect(
      validateAttachmentInput({ caseId: CASE, name: '  ', fileUrl: 'u' }),
    ).toContain('missing_name');
  });
  it('未提供任何來源 → missing_source', () => {
    expect(validateAttachmentInput({ caseId: CASE, name: '附件' })).toContain(
      'missing_source',
    );
  });
  it('同時提供檔案與連結 → both_sources', () => {
    expect(
      validateAttachmentInput({
        caseId: CASE,
        name: 'x',
        fileUrl: 'f',
        linkUrl: 'l',
      }),
    ).toContain('both_sources');
  });
  it('未提供目標 → missing_target', () => {
    expect(validateAttachmentInput({ name: 'x', fileUrl: 'f' })).toContain(
      'missing_target',
    );
  });
  it('多個目標 → multiple_targets', () => {
    expect(
      validateAttachmentInput({
        caseId: 'c',
        stepInstanceId: 's',
        name: 'x',
        fileUrl: 'f',
      }),
    ).toContain('multiple_targets');
  });
  it('負數 sizeBytes → invalid_size', () => {
    expect(
      validateAttachmentInput({ caseId: CASE, name: 'x', fileUrl: 'f', sizeBytes: -1 }),
    ).toContain('invalid_size');
  });
  it('合法（檔案）→ 空陣列', () => {
    expect(
      validateAttachmentInput({ caseId: CASE, name: 'x', fileUrl: 'f', sizeBytes: 10 }),
    ).toEqual([]);
  });
  it('合法（連結）→ 空陣列', () => {
    expect(
      validateAttachmentInput({ stepInstanceId: 's', name: 'x', linkUrl: 'l' }),
    ).toEqual([]);
  });
  it('assertValidAttachmentInput 不合法時丟出 AttachmentsEngineError', () => {
    expect(() => assertValidAttachmentInput({ caseId: CASE, name: '' })).toThrow(
      AttachmentsEngineError,
    );
  });
});

describe('nextVersion', () => {
  it('無同名附件 → 1', () => {
    expect(nextVersion([], { caseId: CASE }, '合約')).toBe(1);
  });
  it('同目標同名最大版本 +1', () => {
    const existing = [att('合約', 1), att('合約', 2), att('報價', 5)];
    expect(nextVersion(existing, { caseId: CASE }, '合約')).toBe(3);
  });
  it('不同目標不互相影響', () => {
    const existing = [att('合約', 9, { caseId: 'other' })];
    expect(nextVersion(existing, { caseId: CASE }, '合約')).toBe(1);
  });
  it('name 去空白後比對', () => {
    const existing = [att('合約', 4)];
    expect(nextVersion(existing, { caseId: CASE }, '  合約 ')).toBe(5);
  });
});

describe('planCreateAttachment', () => {
  it('首版為 1，檔案來源 linkUrl 清為 null，type=FILE', () => {
    const plan = planCreateAttachment([], {
      caseId: CASE,
      name: '合約',
      fileUrl: ' https://f/c.pdf ',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      uploadedById: ' user-9 ',
    });
    expect(plan.version).toBe(1);
    expect(plan.sourceType).toBe('FILE');
    expect(plan.type).toBe('FILE');
    expect(plan.fileUrl).toBe('https://f/c.pdf');
    expect(plan.linkUrl).toBeNull();
    expect(plan.kind).toBe('CASE');
    expect(plan.id).toBe(CASE);
    expect(plan.permissionModel).toBe('SYSTEM');
    expect(plan.uploadedById).toBe('user-9');
    expect(plan.sizeBytes).toBe(2048);
  });
  it('SharePoint 連結 → LINK / M365_INHERITED / provider=SHAREPOINT', () => {
    const plan = planCreateAttachment([], {
      stepInstanceId: 's1',
      name: '規格書',
      linkUrl: 'https://contoso.sharepoint.com/sites/p/spec.docx',
    });
    expect(plan.sourceType).toBe('LINK');
    expect(plan.linkUrl).toBe('https://contoso.sharepoint.com/sites/p/spec.docx');
    expect(plan.fileUrl).toBeNull();
    expect(plan.provider).toBe('SHAREPOINT');
    expect(plan.permissionModel).toBe('M365_INHERITED');
    expect(plan.kind).toBe('STEP_INSTANCE');
  });
  it('同名再上傳 → 版本遞增', () => {
    const existing = [att('合約', 1), att('合約', 2)];
    const plan = planCreateAttachment(existing, {
      caseId: CASE,
      name: '合約',
      fileUrl: 'f',
    });
    expect(plan.version).toBe(3);
  });
  it('不合法輸入丟出錯誤', () => {
    expect(() =>
      planCreateAttachment([], { caseId: CASE, name: 'X' }),
    ).toThrow(AttachmentsEngineError);
  });
  it('採用傳入的 now 作為 createdAt', () => {
    const now = new Date(2026, 5, 6);
    const plan = planCreateAttachment(
      [],
      { caseId: CASE, name: 'X', fileUrl: 'f' },
      now,
    );
    expect(plan.createdAt).toBe(now);
  });
});

describe('latestVersionByName / latestAttachments', () => {
  const data = [att('合約', 1), att('合約', 3), att('合約', 2), att('報價', 1)];
  it('每名稱取最大版本', () => {
    const map = latestVersionByName(data);
    expect(map.get('合約')?.version).toBe(3);
    expect(map.get('報價')?.version).toBe(1);
  });
  it('latestAttachments 每名稱一筆且依名稱排序', () => {
    const list = latestAttachments(data);
    expect(list.map((a) => a.name)).toEqual(['合約', '報價']);
    expect(list.find((a) => a.name === '合約')?.version).toBe(3);
  });
  it('同版本時取 createdAt 較新者', () => {
    const a = att('X', 2, { id: 'old', createdAt: new Date(2026, 0, 1) });
    const b = att('X', 2, { id: 'new', createdAt: new Date(2026, 0, 9) });
    expect(latestVersionByName([a, b]).get('X')?.id).toBe('new');
  });
});

describe('attachmentHistory', () => {
  it('依版本由新到舊', () => {
    const data = [att('合約', 1), att('合約', 3), att('合約', 2), att('其他', 1)];
    expect(attachmentHistory(data, '合約').map((a) => a.version)).toEqual([3, 2, 1]);
  });
  it('無該名稱 → 空陣列', () => {
    expect(attachmentHistory([att('合約', 1)], '不存在')).toEqual([]);
  });
});

describe('resolveDownload', () => {
  it('回傳最新版可下載資訊（檔案），含上傳者/時間', () => {
    const data = [att('合約', 1), att('合約', 2)];
    const dl = resolveDownload(data, '合約');
    expect(dl.version).toBe(2);
    expect(dl.sourceType).toBe('FILE');
    expect(dl.url).toBe('https://files/合約-v2.pdf');
    expect(dl.permissionModel).toBe('SYSTEM');
    expect(dl.uploadedById).toBe('user-1');
    expect(dl.uploadedAt).toBeInstanceOf(Date);
  });
  it('SharePoint 連結回傳 linkUrl 並標記 M365_INHERITED', () => {
    const data = [
      att('規格書', 1, {
        fileUrl: null,
        linkUrl: 'https://contoso.sharepoint.com/sites/p/spec.docx',
      }),
    ];
    const dl = resolveDownload(data, '規格書');
    expect(dl.sourceType).toBe('LINK');
    expect(dl.url).toBe('https://contoso.sharepoint.com/sites/p/spec.docx');
    expect(dl.provider).toBe('SHAREPOINT');
    expect(dl.permissionModel).toBe('M365_INHERITED');
  });
  it('找不到附件 → attachment_not_found', () => {
    expect(() => resolveDownload([], 'X')).toThrow(AttachmentsEngineError);
    try {
      resolveDownload([], 'X');
    } catch (e) {
      expect((e as AttachmentsEngineError).code).toBe('attachment_not_found');
    }
  });
});

describe('distinctAttachmentNames', () => {
  it('去重並排序', () => {
    const data = [att('合約', 1), att('合約', 2), att('報價', 1)];
    expect(distinctAttachmentNames(data)).toEqual(['合約', '報價']);
  });
});
