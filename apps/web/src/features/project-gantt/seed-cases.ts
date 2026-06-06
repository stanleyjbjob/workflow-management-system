/**
 * 案件詳情示範資料（issue #28，5.6）。caseId 對齊 seed.ts `sampleProjectGantt` 之各甘特列，
 * 所屬專案對齊該 seed 專案（PRJ-202601-0007），使雙向導覽可被實際操作與展示。
 * 注意：seed 中「教育訓練」列 caseId=null，刻意無對應案件（驗證 §5.3 不提供跳轉）。
 * 待 REST 層就緒後改以 fetch 取得相同結構即可移除本檔。
 */
import type { CaseSummary } from './cases';

const PROJECT_CODE = 'PRJ-202601-0007';
const PROJECT_NAME = '某客戶 ERP 導入專案';

export const sampleCases: Record<string, CaseSummary> = {
  'CASE-SALE-001': {
    caseId: 'CASE-SALE-001',
    projectCode: PROJECT_CODE,
    projectName: PROJECT_NAME,
    title: '宏遠科技 — ERP 銷售案',
    meta: '客戶來源：既有客戶 · 產品：ERP · 模式：買斷制',
    flowLabel: '銷售流程',
    tags: ['已完成', '買斷'],
    steps: [
      { name: '建立商機', role: '業務', done: true, forms: ['商機建立表'], description: '記錄客戶來源、產品、銷售模式。' },
      { name: '拜訪 / Demo', role: '業務', done: true, forms: ['拜訪紀錄', '會議記錄'], description: '多次拜訪並留存紀錄。' },
      { name: '報價', role: '業務', done: true, forms: ['報價單'], description: '提供報價單。' },
      { name: '成案 / 移交', role: '業務', done: true, forms: ['報價單(定版)', '客製需求文件'], description: '簽約並移交顧問。' },
    ],
  },
  'CASE-ONB-001': {
    caseId: 'CASE-ONB-001',
    projectCode: PROJECT_CODE,
    projectName: PROJECT_NAME,
    title: '宏遠科技 — ERP 系統導入',
    meta: '承接銷售案 · 顧問：Amy',
    flowLabel: '系統導入流程',
    tags: ['已完成', '導入'],
    steps: [
      { name: '接收移交', role: '顧問', done: true, forms: ['報價單', '客製需求文件'], description: '自銷售階段帶入文件。' },
      { name: '導入規劃', role: '顧問', done: true, forms: ['導入計畫表'], description: '安排導入時程與教育訓練。' },
      { name: '啟動會議', role: '顧問', done: true, forms: ['啟動會議記錄'], description: '與客戶確認啟動。' },
      { name: '移交工程', role: '顧問', done: true, forms: ['移交清單'], description: '移交工程師建置。' },
    ],
  },
  'CASE-ACC-001': {
    caseId: 'CASE-ACC-001',
    projectCode: PROJECT_CODE,
    projectName: PROJECT_NAME,
    title: '宏遠科技 — 客戶驗收',
    meta: '顧問：Amy · 工程師：Leo',
    flowLabel: '系統導入流程（驗收）',
    tags: ['進行中', '超前'],
    steps: [
      { name: '驗收準備', role: '顧問', done: true, forms: ['驗收計畫'], description: '彙整驗收項目。' },
      { name: '客戶驗收', role: '顧問 / 客戶', done: false, active: true, forms: ['驗收表'], description: '客戶逐項確認。' },
      { name: '結案', role: '顧問', done: false, forms: ['結案報告'], description: '驗收通過後結案。' },
    ],
  },
  'CASE-ENV-001': {
    caseId: 'CASE-ENV-001',
    projectCode: PROJECT_CODE,
    projectName: PROJECT_NAME,
    title: '宏遠科技 — 環境建置（買斷）',
    meta: '模式：買斷制（主機建置） · 工程師：Leo',
    flowLabel: '環境建置流程',
    tags: ['進行中', '準時'],
    steps: [
      { name: '接收移交', role: '工程師', done: true, forms: ['移交清單'], description: '接收導入移交清單。' },
      { name: '主機建置', role: '工程師', done: false, active: true, forms: ['主機建置紀錄'], description: '買斷制以建置主機方式進行。' },
      { name: '環境驗收', role: '工程師 / 顧問', done: false, forms: ['環境驗收表'], description: '確認環境就緒。' },
    ],
  },
  'CASE-CUS-001': {
    caseId: 'CASE-CUS-001',
    projectCode: PROJECT_CODE,
    projectName: PROJECT_NAME,
    title: '宏遠科技 — 報表客製（需求變更）',
    meta: '發起：顧問 Amy · 指派：工程主管 Ken → 工程師 Leo',
    flowLabel: '客製化流程',
    tags: ['進行中', '延遲'],
    steps: [
      { name: '發起需求變更', role: '顧問', done: true, forms: ['需求變更單'], description: '登錄客戶需求。' },
      { name: '分派開發', role: '工程主管', done: true, forms: ['開發任務單'], description: '工程主管指派工程師。' },
      { name: '客製開發', role: '工程師', done: false, active: true, forms: ['開發紀錄'], description: '進行客製開發。' },
      { name: '複測', role: '顧問', done: false, forms: ['複測報告'], description: '顧問複測；不通過退回開發。' },
      { name: '更新正式區', role: '工程師', done: false, forms: ['正式區上線紀錄'], description: '測試區無誤後上線。' },
    ],
  },
};
