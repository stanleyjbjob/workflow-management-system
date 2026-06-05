/**
 * 種子資料 — 供開發 / 測試使用。
 * 以 upsert 撰寫，可重複執行（idempotent）。
 * 內容涵蓋：6 個角色、各角色示範使用者、一條完整「銷售流程」定義
 * （含步驟、表單、步驟-表單關聯、作業範本檔），以及一個示範專案
 * （含流程掛載與行事曆排除日）。
 */
import { PrismaClient, RoleCode, FlowType, FieldType } from '@prisma/client';

const prisma = new PrismaClient();

async function seedRoles() {
  const roles: { code: RoleCode; name: string; description: string }[] = [
    { code: RoleCode.MANAGER, name: '部門主管', description: '部門整體管控、流程定義與審核' },
    { code: RoleCode.SALES, name: '業務', description: '業務開發、報價、簽約；銷售流程發起人' },
    { code: RoleCode.CONSULTANT, name: '顧問', description: '系統導入、教育訓練、複測' },
    { code: RoleCode.ENG_LEAD, name: '工程主管', description: '客製化任務分派、工程資源調度' },
    { code: RoleCode.ENGINEER, name: '工程師', description: '環境建置、客製化開發、測試文件' },
    { code: RoleCode.ASSISTANT, name: '助理', description: '操作手冊、新產品測試（暂不納入，預留）' },
  ];
  const result: Record<string, string> = {};
  for (const r of roles) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description },
      create: r,
    });
    result[r.code] = role.id;
  }
  return result;
}

async function seedUsers(roleIds: Record<string, string>) {
  const users: { email: string; displayName: string; role: RoleCode }[] = [
    { email: 'manager@example.com', displayName: '王主管', role: RoleCode.MANAGER },
    { email: 'sales@example.com', displayName: '陳業務', role: RoleCode.SALES },
    { email: 'consultant@example.com', displayName: '林顧問', role: RoleCode.CONSULTANT },
    { email: 'englead@example.com', displayName: '張工程主管', role: RoleCode.ENG_LEAD },
    { email: 'engineer@example.com', displayName: '李工程師', role: RoleCode.ENGINEER },
  ];
  const result: Record<string, string> = {};
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { displayName: u.displayName },
      create: { email: u.email, displayName: u.displayName },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: roleIds[u.role] } },
      update: {},
      create: { userId: user.id, roleId: roleIds[u.role] },
    });
    result[u.role] = user.id;
  }
  return result;
}

/** 建立或取得一張表單定義（含欄位） */
async function upsertForm(
  code: string,
  name: string,
  isSignable: boolean,
  fields: { key: string; label: string; fieldType: FieldType; required?: boolean }[],
) {
  const form = await prisma.formDefinition.upsert({
    where: { code_version: { code, version: 1 } },
    update: { name, isSignable },
    create: { code, name, isSignable },
  });
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    await prisma.formField.upsert({
      where: { formId_key: { formId: form.id, key: f.key } },
      update: { label: f.label, fieldType: f.fieldType, required: f.required ?? false, order: i + 1 },
      create: {
        formId: form.id,
        order: i + 1,
        key: f.key,
        label: f.label,
        fieldType: f.fieldType,
        required: f.required ?? false,
      },
    });
  }
  return form;
}

async function seedSalesWorkflow(roleIds: Record<string, string>, managerId: string) {
  const workflow = await prisma.workflowDefinition.upsert({
    where: { flowType_name_version: { flowType: FlowType.SALES, name: '標準銷售流程', version: 1 } },
    update: { description: '業務開發 → 拜訪/Demo → 報價 → 需求確認 → 成案/失敗' },
    create: {
      flowType: FlowType.SALES,
      name: '標準銷售流程',
      description: '業務開發 → 拜訪/Demo → 報價 → 需求確認 → 成案/失敗',
      createdById: managerId,
    },
  });

  const formOpportunity = await upsertForm('FORM-OPP', '商機建立表', false, [
    { key: 'source', label: '客戶來源', fieldType: FieldType.MULTISELECT, required: true },
    { key: 'product', label: '產品項目', fieldType: FieldType.SELECT, required: true },
    { key: 'saleMode', label: '銷售模式', fieldType: FieldType.SELECT, required: true },
  ]);
  const formVisit = await upsertForm('FORM-VISIT', '拜訪/會議記錄', false, [
    { key: 'visitDate', label: '拜訪日期', fieldType: FieldType.DATE, required: true },
    { key: 'summary', label: '會議摘要', fieldType: FieldType.TEXTAREA, required: true },
  ]);
  const formQuote = await upsertForm('FORM-QUOTE', '報價單', false, [
    { key: 'amount', label: '報價金額', fieldType: FieldType.NUMBER, required: true },
    { key: 'items', label: '報價項目', fieldType: FieldType.TEXTAREA, required: true },
  ]);
  const formReq = await upsertForm('FORM-REQ', '客製需求文件', false, [
    { key: 'requirements', label: '客製需求', fieldType: FieldType.TEXTAREA, required: true },
  ]);
  const formFail = await upsertForm('FORM-FAIL', '失敗原因記錄', false, [
    { key: 'reason', label: '失敗原因分類', fieldType: FieldType.SELECT, required: true },
    { key: 'note', label: '說明', fieldType: FieldType.TEXTAREA },
  ]);

  const steps: {
    order: number;
    name: string;
    role: RoleCode;
    forms: string[];
    optional?: boolean;
  }[] = [
    { order: 1, name: '建立商機', role: RoleCode.SALES, forms: [formOpportunity.id] },
    { order: 2, name: '拜訪 / Demo', role: RoleCode.SALES, forms: [formVisit.id] },
    { order: 3, name: '報價', role: RoleCode.SALES, forms: [formQuote.id] },
    { order: 4, name: '需求確認', role: RoleCode.CONSULTANT, forms: [formReq.id] },
    { order: 5, name: '成案', role: RoleCode.SALES, forms: [formQuote.id, formReq.id] },
    { order: 6, name: '失敗結案', role: RoleCode.SALES, forms: [formFail.id], optional: true },
  ];

  const stepIds: string[] = [];
  for (const s of steps) {
    const step = await prisma.stepDefinition.upsert({
      where: { workflowId_order: { workflowId: workflow.id, order: s.order } },
      update: { name: s.name, responsibleRoleId: roleIds[s.role], isOptional: s.optional ?? false },
      create: {
        workflowId: workflow.id,
        order: s.order,
        name: s.name,
        responsibleRoleId: roleIds[s.role],
        isOptional: s.optional ?? false,
      },
    });
    stepIds.push(step.id);
    for (const formId of s.forms) {
      await prisma.stepForm.upsert({
        where: { stepId_formId: { stepId: step.id, formId } },
        update: {},
        create: { stepId: step.id, formId, isRequired: true },
      });
    }
  }

  const existingTemplate = await prisma.stepTemplate.findFirst({
    where: { stepId: stepIds[2], name: '報價單範本' },
  });
  if (!existingTemplate) {
    await prisma.stepTemplate.create({
      data: {
        stepId: stepIds[2],
        name: '報價單範本',
        linkUrl: 'https://contoso.sharepoint.com/sites/sales/Templates/Quote.xlsx',
        fileType: 'xlsx',
      },
    });
  }

  return { workflowId: workflow.id, stepIds };
}

async function seedProject(managerId: string) {
  const project = await prisma.project.upsert({
    where: { code: 'PRJ-2026-0001' },
    update: { name: 'Contoso 人事系統導入案' },
    create: {
      code: 'PRJ-2026-0001',
      name: 'Contoso 人事系統導入案',
      client: 'Contoso 股份有限公司',
      ownerId: managerId,
      createdById: managerId,
      planStart: new Date('2026-06-01'),
      planEnd: new Date('2026-12-31'),
    },
  });

  const flows: { flowType: FlowType; name: string; planStart: string; planEnd: string; progress: number }[] = [
    { flowType: FlowType.SALES, name: '銷售流程', planStart: '2026-06-01', planEnd: '2026-07-15', progress: 100 },
    { flowType: FlowType.ONBOARDING, name: '系統導入流程', planStart: '2026-07-10', planEnd: '2026-09-30', progress: 40 },
    { flowType: FlowType.ENVIRONMENT, name: '環境建置流程', planStart: '2026-08-01', planEnd: '2026-08-31', progress: 0 },
  ];
  for (const f of flows) {
    const exists = await prisma.projectFlow.findFirst({
      where: { projectId: project.id, flowType: f.flowType, name: f.name },
    });
    if (!exists) {
      await prisma.projectFlow.create({
        data: {
          projectId: project.id,
          flowType: f.flowType,
          name: f.name,
          planStart: new Date(f.planStart),
          planEnd: new Date(f.planEnd),
          progress: f.progress,
        },
      });
    }
  }

  const exclusionExists = await prisma.exclusion.findFirst({
    where: { projectId: project.id, reason: '客戶端系統凍結' },
  });
  if (!exclusionExists) {
    await prisma.exclusion.create({
      data: {
        projectId: project.id,
        fromDate: new Date('2026-08-15'),
        toDate: new Date('2026-08-20'),
        reason: '客戶端系統凍結',
        source: 'CUSTOMER',
      },
    });
  }

  return project.id;
}

async function main() {
  const roleIds = await seedRoles();
  const userIds = await seedUsers(roleIds);
  await seedSalesWorkflow(roleIds, userIds[RoleCode.MANAGER]);
  await seedProject(userIds[RoleCode.MANAGER]);
  console.log('✅ 種子資料載入完成');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
