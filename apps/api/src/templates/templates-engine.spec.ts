import {
  EngineStepTemplate,
  TemplatesEngineError,
  assertValidTemplateInput,
  distinctTemplateNames,
  latestTemplates,
  latestVersionByName,
  nextVersion,
  planCreateTemplate,
  resolveDownload,
  sourceTypeOf,
  templateHistory,
  validateTemplateInput,
} from './templates-engine';

const STEP = 'step-1';

function tpl(
  name: string,
  version: number,
  opts: Partial<EngineStepTemplate> = {},
): EngineStepTemplate {
  return {
    id: opts.id ?? `${name}-v${version}`,
    stepId: opts.stepId ?? STEP,
    name,
    fileUrl:
      'fileUrl' in opts
        ? (opts.fileUrl ?? null)
        : 'https://files/' + name + '-v' + version + '.pdf',
    linkUrl: 'linkUrl' in opts ? (opts.linkUrl ?? null) : null,
    fileType: opts.fileType ?? 'pdf',
    version,
    createdAt: opts.createdAt ?? new Date(2026, 0, version),
  };
}

describe('validateTemplateInput', () => {
  it('name 為空 → missing_name', () => {
    expect(validateTemplateInput({ stepId: STEP, name: '  ', fileUrl: 'u' })).toContain(
      'missing_name',
    );
  });

  it('未提供任何來源 → missing_source', () => {
    expect(validateTemplateInput({ stepId: STEP, name: 'SOP' })).toContain('missing_source');
  });

  it('同時提供檔案與連結 → both_sources', () => {
    expect(
      validateTemplateInput({ stepId: STEP, name: 'SOP', fileUrl: 'f', linkUrl: 'l' }),
    ).toContain('both_sources');
  });

  it('合法（僅檔案）→ 空陣列', () => {
    expect(validateTemplateInput({ stepId: STEP, name: 'SOP', fileUrl: 'f' })).toEqual([]);
  });

  it('合法（僅連結）→ 空陣列', () => {
    expect(validateTemplateInput({ stepId: STEP, name: 'SOP', linkUrl: 'l' })).toEqual([]);
  });

  it('assertValidTemplateInput 不合法時丟出 TemplatesEngineError', () => {
    expect(() => assertValidTemplateInput({ stepId: STEP, name: '' })).toThrow(
      TemplatesEngineError,
    );
    try {
      assertValidTemplateInput({ stepId: STEP, name: '' });
    } catch (e) {
      expect((e as TemplatesEngineError).code).toBe('missing_name');
    }
  });
});

describe('sourceTypeOf', () => {
  it('有 fileUrl → FILE', () => {
    expect(sourceTypeOf({ fileUrl: 'f', linkUrl: null })).toBe('FILE');
  });
  it('僅 linkUrl → LINK', () => {
    expect(sourceTypeOf({ fileUrl: null, linkUrl: 'l' })).toBe('LINK');
  });
});

describe('nextVersion', () => {
  it('無同名範本 → 1', () => {
    expect(nextVersion([], STEP, '檢核表')).toBe(1);
  });

  it('同名最大版本 +1', () => {
    const existing = [tpl('檢核表', 1), tpl('檢核表', 2), tpl('SOP', 5)];
    expect(nextVersion(existing, STEP, '檢核表')).toBe(3);
  });

  it('不同步驟不互相影響', () => {
    const existing = [tpl('檢核表', 9, { stepId: 'other' })];
    expect(nextVersion(existing, STEP, '檢核表')).toBe(1);
  });

  it('name 去空白後比對', () => {
    const existing = [tpl('檢核表', 4)];
    expect(nextVersion(existing, STEP, '  檢核表 ')).toBe(5);
  });
});

describe('planCreateTemplate', () => {
  it('首版為 1，檔案來源 linkUrl 清為 null', () => {
    const plan = planCreateTemplate([], {
      stepId: STEP,
      name: 'SOP',
      fileUrl: ' https://f/sop.pdf ',
      fileType: 'pdf',
    });
    expect(plan.version).toBe(1);
    expect(plan.sourceType).toBe('FILE');
    expect(plan.fileUrl).toBe('https://f/sop.pdf');
    expect(plan.linkUrl).toBeNull();
    expect(plan.name).toBe('SOP');
  });

  it('連結來源 fileUrl 清為 null', () => {
    const plan = planCreateTemplate([], {
      stepId: STEP,
      name: 'SOP',
      linkUrl: 'https://sharepoint/sop',
    });
    expect(plan.sourceType).toBe('LINK');
    expect(plan.linkUrl).toBe('https://sharepoint/sop');
    expect(plan.fileUrl).toBeNull();
  });

  it('同名再上傳 → 版本遞增', () => {
    const existing = [tpl('SOP', 1), tpl('SOP', 2)];
    const plan = planCreateTemplate(existing, { stepId: STEP, name: 'SOP', fileUrl: 'f' });
    expect(plan.version).toBe(3);
  });

  it('不合法輸入丟出錯誤', () => {
    expect(() => planCreateTemplate([], { stepId: STEP, name: 'X' })).toThrow(
      TemplatesEngineError,
    );
  });

  it('採用傳入的 now 作為 createdAt', () => {
    const now = new Date(2026, 5, 6);
    const plan = planCreateTemplate([], { stepId: STEP, name: 'SOP', fileUrl: 'f' }, now);
    expect(plan.createdAt).toBe(now);
  });
});

describe('latestVersionByName / latestTemplates', () => {
  const data = [
    tpl('檢核表', 1),
    tpl('檢核表', 3),
    tpl('檢核表', 2),
    tpl('SOP', 1),
  ];

  it('每名稱取最大版本', () => {
    const map = latestVersionByName(data);
    expect(map.get('檢核表')?.version).toBe(3);
    expect(map.get('SOP')?.version).toBe(1);
  });

  it('latestTemplates 每名稱一筆且依名稱排序', () => {
    const list = latestTemplates(data);
    expect(list.map((t) => t.name)).toEqual(['SOP', '檢核表']);
    expect(list.find((t) => t.name === '檢核表')?.version).toBe(3);
  });

  it('同版本時取 createdAt 較新者', () => {
    const a = tpl('X', 2, { id: 'old', createdAt: new Date(2026, 0, 1) });
    const b = tpl('X', 2, { id: 'new', createdAt: new Date(2026, 0, 9) });
    expect(latestVersionByName([a, b]).get('X')?.id).toBe('new');
  });
});

describe('templateHistory', () => {
  it('依版本由新到舊', () => {
    const data = [tpl('SOP', 1), tpl('SOP', 3), tpl('SOP', 2), tpl('其他', 1)];
    expect(templateHistory(data, 'SOP').map((t) => t.version)).toEqual([3, 2, 1]);
  });

  it('無該名稱 → 空陣列', () => {
    expect(templateHistory([tpl('SOP', 1)], '不存在')).toEqual([]);
  });
});

describe('resolveDownload', () => {
  it('回傳最新版的可下載資訊（檔案）', () => {
    const data = [tpl('SOP', 1), tpl('SOP', 2)];
    const dl = resolveDownload(data, 'SOP');
    expect(dl.version).toBe(2);
    expect(dl.sourceType).toBe('FILE');
    expect(dl.url).toBe('https://files/SOP-v2.pdf');
  });

  it('連結型範本回傳 linkUrl', () => {
    const data = [
      tpl('委任權限表', 1, { fileUrl: null, linkUrl: 'https://sharepoint/doc' }),
    ];
    const dl = resolveDownload(data, '委任權限表');
    expect(dl.sourceType).toBe('LINK');
    expect(dl.url).toBe('https://sharepoint/doc');
  });

  it('找不到範本 → template_not_found', () => {
    expect(() => resolveDownload([], 'X')).toThrow(TemplatesEngineError);
    try {
      resolveDownload([], 'X');
    } catch (e) {
      expect((e as TemplatesEngineError).code).toBe('template_not_found');
    }
  });
});

describe('distinctTemplateNames', () => {
  it('去重並排序', () => {
    const data = [tpl('SOP', 1), tpl('SOP', 2), tpl('檢核表', 1)];
    expect(distinctTemplateNames(data)).toEqual(['SOP', '檢核表']);
  });
});
