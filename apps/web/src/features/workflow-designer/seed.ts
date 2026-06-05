// 四大標準流程種子資料（依需求規格 §4–§7），供首次使用時載入並調整。
import type { FlowType, RoleCode } from './constants';
import { createForm, genId } from './designer';
import type { StepDraft, StepFormRef, WorkflowDraft } from './types';

interface StepSeed {
  name: string;
  role: RoleCode | null;
  optional?: boolean;
  forms?: Array<{ name: string; required?: boolean; iso?: string }>;
}

function buildSteps(seeds: StepSeed[]): StepDraft[] {
  return seeds.map((s, i) => {
    const forms: StepFormRef[] = (s.forms ?? []).map((f) => {
      const ref = createForm(f.name);
      ref.isRequired = f.required ?? true;
      ref.isoMapping = f.iso ?? '';
      return ref;
    });
    return {
      id: genId('step'),
      order: i + 1,
      name: s.name,
      description: '',
      responsibleRole: s.role,
      isOptional: s.optional ?? false,
      forms,
    };
  });
}

function wf(
  flowType: FlowType,
  name: string,
  initiatorRole: RoleCode,
  condition: string,
  steps: StepDraft[],
): WorkflowDraft {
  return {
    id: genId('wf'),
    flowType,
    name,
    description: '系統內建範本，可依需要調整。',
    version: 1,
    isActive: true,
    trigger: { initiatorRole, condition },
    calendar: { deferOnHoliday: true, deferStrategy: 'NEXT_WORKDAY', note: '遇國定假日 / 連假自動評估遞延。' },
    steps,
    updatedAt: new Date().toISOString(),
  };
}

export function seedWorkflows(): WorkflowDraft[] {
  const sales = wf('SALES', '銷售流程（標準）', 'SALES', '業務建立商機時觸發', buildSteps([
    { name: '建立商機', role: 'SALES', forms: [{ name: '商機建立表' }] },
    { name: '拜訪 / Demo', role: 'SALES', forms: [{ name: '拜訪紀錄', iso: '溝通與決策紀錄' }, { name: '會議記錄', iso: '溝通與決策紀錄' }] },
    { name: '報價', role: 'SALES', forms: [{ name: '報價單' }] },
    { name: '需求確認', role: 'SALES', forms: [{ name: '客製需求文件' }] },
    { name: '成案', role: 'SALES', forms: [{ name: '報價單（定版）' }, { name: '客製需求文件' }] },
  ]));

  const onboarding = wf('ONBOARDING', '系統導入流程（標準）', 'CONSULTANT', '銷售成案後移交顧問', buildSteps([
    { name: '接收移交', role: 'CONSULTANT', forms: [{ name: '報價單' }, { name: '客製需求文件' }] },
    { name: '導入規劃', role: 'CONSULTANT', forms: [{ name: '導入計畫表' }] },
    { name: '啟動會議', role: 'CONSULTANT', forms: [{ name: '啟動會議記錄', iso: '溝通與決策紀錄' }] },
    { name: '蒐集客戶資料', role: 'CONSULTANT', forms: [{ name: '人員資料表', iso: '個資 / 資產盤點' }, { name: '委任權限表', required: true, iso: '存取控制、權限授予紀錄（需簽核）' }] },
    { name: '移交工程', role: 'CONSULTANT', forms: [{ name: '移交清單' }] },
  ]));

  const environment = wf('ENVIRONMENT', '環境建置流程（標準）', 'ENGINEER', '導入啟動會議完成後移交工程師', buildSteps([
    { name: '接收移交', role: 'ENGINEER', forms: [{ name: '移交清單' }] },
    { name: '主機建置（買斷）', role: 'ENGINEER', optional: true, forms: [{ name: '環境建置檢核表', iso: '營運安全、組態管理' }] },
    { name: '租戶開立（訂閱）', role: 'ENGINEER', optional: true, forms: [{ name: '租戶開立紀錄' }] },
    { name: '環境驗收', role: 'ENGINEER', forms: [{ name: '環境驗收表', iso: '建置與驗收佐證' }] },
  ]));

  const customization = wf('CUSTOMIZATION', '客製化（需求變更）流程（標準）', 'CONSULTANT', '系統上線後客戶提出需求', buildSteps([
    { name: '發起需求變更', role: 'CONSULTANT', forms: [{ name: '需求變更單', iso: '變更管理流程' }] },
    { name: '指派', role: 'CONSULTANT' },
    { name: '分派開發', role: 'ENG_LEAD', forms: [{ name: '開發任務單' }] },
    { name: '客製開發', role: 'ENGINEER', forms: [{ name: '開發紀錄' }] },
    { name: '撰寫測試文件', role: 'ENGINEER', forms: [{ name: '測試文件', iso: '變更管理、測試紀錄' }] },
    { name: '複測', role: 'CONSULTANT', forms: [{ name: '複測報告', iso: '變更管理、測試紀錄' }] },
    { name: '更新測試區', role: 'ENGINEER', forms: [{ name: '測試區更新紀錄' }] },
    { name: '更新正式區', role: 'ENGINEER', forms: [{ name: '正式區上線紀錄' }] },
  ]));

  return [sales, onboarding, environment, customization];
}
