/**
 * 案件詳情示範資料（REST 層就緒前驅動 UI）。
 * 內容對齊 prototype/index.html 的 CASES；id 同時涵蓋任務看板 seed 的 caseId，
 * 讓「看板點卡 → 案件詳情」導覽可運作。
 */
import type { CaseRecord } from './types';

export const sampleCases: CaseRecord[] = [
  {
    id: 'case-sales-1',
    title: '宏全國際 — ERP 商機（買斷）',
    meta: '客戶來源：行銷管道　·　產品：ERP　·　模式：買斷制',
    flowLabel: '銷售流程',
    tags: [
      ['進行中', 'p-blue'],
      ['買斷', 'p-grey'],
    ],
    steps: [
      { name: '建立商機', role: '業務', done: true, forms: ['商機建立表'], desc: '記錄客戶來源、產品、銷售模式。' },
      { name: '拜訪 / Demo', role: '業務', done: true, forms: ['拜訪紀錄', '會議記錄'], desc: '可多次拜訪，逐次留存紀錄與會議記錄供後續調閱。' },
      { name: '報價', role: '業務', done: false, active: true, forms: ['報價單'], desc: '成案前提供報價單。', due: '2026-06-03' },
      { name: '需求確認', role: '業務 / 顧問', done: false, forms: ['客製需求文件'], desc: '蒐集客製需求，成案後帶往導入。' },
      { name: '成案 / 移交', role: '業務', done: false, forms: ['報價單(定版)', '客製需求文件'], desc: '簽約並移交顧問；失敗則記錄原因。' },
    ],
    attachments: [
      { kind: 'file', name: '宏全_報價草稿_v2.xlsx', meta: '上傳於 2026-06-02 · 業務 David' },
      { kind: 'link', name: '宏全商機資料夾（SharePoint）', meta: 'sharepoint.com/.../hongchuan' },
    ],
  },
  {
    id: 'case-onb-1',
    title: '台鹽 — 人事系統導入（買斷）',
    meta: '承接銷售案件　·　顧問：Amy',
    flowLabel: '系統導入流程',
    tags: [
      ['進行中', 'p-blue'],
      ['導入', 'p-purple'],
    ],
    steps: [
      { name: '接收移交', role: '顧問', done: true, forms: ['報價單', '客製需求文件'], desc: '自銷售階段帶入文件。' },
      { name: '導入規劃', role: '顧問', done: true, forms: ['導入計畫表'], desc: '安排導入時程與教育訓練。' },
      { name: '啟動會議', role: '顧問', done: false, active: true, forms: ['啟動會議記錄'], desc: '與客戶確認啟動，會後移交工程。', due: '2026-06-08' },
      { name: '蒐集客戶資料', role: '顧問 / 客戶', done: false, forms: ['人員資料表', '委任權限表(簽核)'], desc: '依預定義表單蒐集；此步受連假影響已遞延。', due: '2026-06-15' },
      { name: '移交工程', role: '顧問', done: false, forms: ['移交清單'], desc: '啟動會議後移交工程師建置。' },
    ],
    attachments: [
      { kind: 'link', name: '台鹽導入資料夾（SharePoint）', meta: 'sharepoint.com/.../taiyen-onboarding' },
    ],
  },
  {
    id: 'case-env-1',
    title: '台鹽 — 主機環境建置（買斷）',
    meta: '模式：買斷制（主機採購）　·　工程師：Leo',
    flowLabel: '環境建置流程',
    tags: [
      ['進行中', 'p-blue'],
      ['環境', 'p-grey'],
    ],
    steps: [
      { name: '接收移交', role: '工程師', done: true, forms: ['移交清單'], desc: '接收導入移交清單。' },
      { name: '主機建置', role: '工程師', done: false, active: true, forms: ['主機建置紀錄'], desc: '買斷制依採購主機建置環境。', due: '2026-06-22' },
      { name: '環境驗收', role: '工程師 / 顧問', done: false, forms: ['環境驗收表'], desc: '確認環境就緒。' },
    ],
    attachments: [],
  },
  {
    id: 'case-cus-1',
    title: '宏全國際 — 報表客製（需求變更）',
    meta: '發起：顧問 Amy　·　指派：工程主管 Ken',
    flowLabel: '客製化流程',
    tags: [
      ['進行中', 'p-blue'],
      ['客製', 'p-purple'],
    ],
    steps: [
      { name: '發起需求變更', role: '顧問', done: true, forms: ['需求變更單'], desc: '登錄客戶需求。' },
      { name: '分派開發', role: '工程主管', done: false, active: true, forms: ['開發任務單'], desc: '工程主管指派工程師。' },
      { name: '客製開發', role: '工程師', done: false, forms: ['開發紀錄'], desc: '進行客製開發。' },
      { name: '撰寫測試文件', role: '工程師', done: false, forms: ['測試文件'], desc: '開發後撰寫測試文件。' },
      { name: '複測', role: '顧問', done: false, forms: ['複測報告'], desc: '顧問複測；不通過退回開發。' },
      { name: '更新測試區', role: '工程師', done: false, forms: ['測試區更新紀錄'], desc: '複測通過後更新客戶測試區。' },
      { name: '更新正式區', role: '工程師', done: false, forms: ['正式區上線紀錄'], desc: '測試區無誤後上線正式區。' },
    ],
    attachments: [{ kind: 'file', name: '報表需求說明.docx', meta: '上傳於 2026-06-05 · 顧問 Amy' }],
  },
  {
    id: 'case-cus-2',
    title: '中油 — 介面調整（需求變更）',
    meta: '發起：顧問 Amy',
    flowLabel: '客製化流程',
    tags: [
      ['待辦', 'p-grey'],
      ['客製', 'p-purple'],
    ],
    steps: [
      { name: '發起需求變更', role: '顧問', done: false, active: true, forms: ['需求變更單'], desc: '登錄客戶需求。', due: '2026-06-13' },
      { name: '分派開發', role: '工程主管', done: false, forms: ['開發任務單'], desc: '工程主管指派工程師。' },
      { name: '客製開發', role: '工程師', done: false, forms: ['開發紀錄'], desc: '進行客製開發。' },
      { name: '複測', role: '顧問', done: false, forms: ['複測報告'], desc: '顧問複測；不通過退回開發。' },
    ],
    attachments: [],
  },
];
