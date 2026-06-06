// 專案管理模組 — 種子資料（對齊 prototype/index.html 之 PROJECTS / CASES）
// 供前端展示與雙向導覽 demo；正式資料來源待 5.1 專案 CRUD API 落地後替換。
import type { CaseDetail, Project } from './types';

// 系統展示用「今日」基準（與 prototype 一致），實際應改取系統時間。
export const DEMO_TODAY = '2026-06-06';

export const seedProjects: Record<string, Project> = {
  p1: {
    id: 'p1',
    name: '晴光集團 人事系統導入案',
    client: '晴光集團',
    owner: 'Amy',
    planStart: '2026-05-18',
    planEnd: '2026-07-25',
    status: 'IN_PROGRESS',
    flows: [
      { flowId: 'p1-f1', flowType: 'SALES', name: '銷售流程', planStart: '2026-05-18', planEnd: '2026-05-29', progress: 100 },
      { flowId: 'p1-f2', flowType: 'ONBOARDING', name: '系統導入流程', planStart: '2026-05-25', planEnd: '2026-06-20', progress: 28, caseRef: 'c2' },
      { flowId: 'p1-f3', flowType: 'ENVIRONMENT', name: '環境建置流程', planStart: '2026-06-02', planEnd: '2026-06-30', progress: 42 },
      { flowId: 'p1-f4', flowType: 'CUSTOMIZATION', name: '客製化流程（考核公式）', planStart: '2026-06-12', planEnd: '2026-07-25', progress: 0, caseRef: 'c4' },
    ],
    exclusions: [{ from: '2026-06-19', to: '2026-06-21', reason: '客戶端盤點，暫停作業', source: 'CLIENT' }],
  },
  p2: {
    id: 'p2',
    name: '大新企業 入口網站（訂閱）',
    client: '大新企業',
    owner: 'Leo',
    planStart: '2026-05-25',
    planEnd: '2026-07-03',
    status: 'IN_PROGRESS',
    flows: [
      { flowId: 'p2-f1', flowType: 'SALES', name: '銷售流程', planStart: '2026-05-25', planEnd: '2026-06-02', progress: 100 },
      { flowId: 'p2-f2', flowType: 'ONBOARDING', name: '系統導入流程', planStart: '2026-05-28', planEnd: '2026-06-22', progress: 20 },
      { flowId: 'p2-f3', flowType: 'ENVIRONMENT', name: '環境建置流程（租戶）', planStart: '2026-06-03', planEnd: '2026-07-03', progress: 35, caseRef: 'c3' },
    ],
    exclusions: [],
  },
};

export const seedCases: Record<string, CaseDetail> = {
  // c1：無所屬專案 → 案件詳情顯示「未指派專案」，不提供反向跳轉
  c1: {
    id: 'c1',
    projectId: null,
    title: '宏達科技 — 人事系統（買斷）',
    meta: '客戶來源：行銷管道 · 產品：人事系統 · 模式：買斷制',
    flowLabel: '銷售流程',
    tags: ['進行中', '買斷'],
    steps: [
      { name: '建立商機', role: '業務', done: true, forms: ['商機建立表'], description: '記錄客戶來源、產品、銷售模式。' },
      { name: '拜訪 / Demo', role: '業務', done: false, active: true, forms: ['拜訪紀錄', '會議記錄'], description: '可多次拜訪，逐次留存紀錄。' },
      { name: '報價', role: '業務', done: false, forms: ['報價單'], description: '成案前提供報價單。' },
      { name: '成案 / 移交', role: '業務', done: false, forms: ['報價單(定版)', '客製需求文件'], description: '簽約並移交顧問。' },
    ],
  },
  c2: {
    id: 'c2',
    projectId: 'p1',
    title: '晴光集團 — 人事系統導入（買斷）',
    meta: '承接案件 S-1011 · 顧問：Amy',
    flowLabel: '系統導入流程',
    tags: ['進行中', '導入'],
    steps: [
      { name: '接收移交', role: '顧問', done: true, forms: ['報價單', '客製需求文件'], description: '自銷售階段帶入文件。' },
      { name: '導入規劃', role: '顧問', done: true, forms: ['導入計畫表'], description: '安排導入時程與教育訓練。' },
      { name: '啟動會議', role: '顧問', done: false, active: true, forms: ['啟動會議記錄'], description: '與客戶確認啟動，會後移交工程。' },
      { name: '蒐集客戶資料', role: '顧問 / 客戶', done: false, forms: ['人員資料表', '委任權限表(簽核)'], description: '依預定義表單蒐集；受連假影響已遞延。' },
      { name: '移交工程', role: '顧問', done: false, forms: ['移交清單'], description: '啟動會議後移交工程師建置。' },
    ],
  },
  c3: {
    id: 'c3',
    projectId: 'p2',
    title: '大新企業 — 員工入口網站（訂閱）',
    meta: '模式：訂閱制（開立租戶） · 工程師：Leo',
    flowLabel: '環境建置流程',
    tags: ['進行中', '訂閱'],
    steps: [
      { name: '接收移交', role: '工程師', done: true, forms: ['移交清單'], description: '接收導入移交清單。' },
      { name: '租戶開立', role: '工程師', done: false, active: true, forms: ['租戶開立紀錄'], description: '訂閱制以開立租戶方式建置。' },
      { name: '環境驗收', role: '工程師 / 顧問', done: false, forms: ['環境驗收表'], description: '確認環境就緒。' },
    ],
  },
  c4: {
    id: 'c4',
    projectId: 'p1',
    title: '晴光集團 — 考核公式客製（需求變更）',
    meta: '發起：顧問 Amy · 指派：工程主管 Ken → 工程師 Leo',
    flowLabel: '客製化流程',
    tags: ['進行中', '客製'],
    steps: [
      { name: '發起需求變更', role: '顧問', done: true, forms: ['需求變更單'], description: '登錄客戶需求。' },
      { name: '指派', role: '顧問→工程主管', done: true, forms: [], description: '指派工程主管。' },
      { name: '分派開發', role: '工程主管', done: true, forms: ['開發任務單'], description: '工程主管指派工程師。' },
      { name: '客製開發', role: '工程師', done: false, active: true, forms: ['開發紀錄'], description: '進行客製開發。' },
      { name: '撰寫測試文件', role: '工程師', done: false, forms: ['測試文件'], description: '開發後撰寫測試文件。' },
      { name: '複測', role: '顧問', done: false, forms: ['複測報告'], description: '顧問複測；不通過退回開發。' },
      { name: '更新測試區', role: '工程師', done: false, forms: ['測試區更新紀錄'], description: '複測通過後更新客戶測試區。' },
      { name: '更新正式區', role: '工程師', done: false, forms: ['正式區上線紀錄'], description: '測試區無誤後上線正式區。' },
    ],
  },
};
