-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('MANAGER', 'SALES', 'CONSULTANT', 'ENG_LEAD', 'ENGINEER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "FlowType" AS ENUM ('SALES', 'ONBOARDING', 'ENVIRONMENT', 'CUSTOMIZATION');

-- CreateEnum
CREATE TYPE "SaleMode" AS ENUM ('PURCHASE', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "StepInstanceStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'RETURNED');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'CHECKBOX', 'FILE', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('FILE', 'LINK');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExclusionSource" AS ENUM ('CUSTOMER', 'INTERNAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "entraOid" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isLocalAccount" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entraGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "flowType" "FlowType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepDefinition" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "responsibleRoleId" TEXT,
    "nextStepId" TEXT,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepTemplate" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT,
    "linkUrl" TEXT,
    "fileType" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isSignable" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormField" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "FieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,

    CONSTRAINT "FormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepForm" (
    "stepId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StepForm_pkey" PRIMARY KEY ("stepId","formId")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "flowType" "FlowType" NOT NULL,
    "title" TEXT NOT NULL,
    "clientName" TEXT,
    "saleMode" "SaleMode",
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStepInstanceId" TEXT,
    "failureReason" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepInstance" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "stepDefinitionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "StepInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "formDefinitionId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "stepInstanceId" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT,
    "linkUrl" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedById" TEXT,
    "caseId" TEXT,
    "stepInstanceId" TEXT,
    "formSubmissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "planStart" TIMESTAMP(3) NOT NULL,
    "planEnd" TIMESTAMP(3) NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFlow" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "caseId" TEXT,
    "flowType" "FlowType" NOT NULL,
    "name" TEXT NOT NULL,
    "planStart" TIMESTAMP(3) NOT NULL,
    "planEnd" TIMESTAMP(3) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exclusion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "source" "ExclusionSource",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_entraOid_key" ON "User"("entraOid");
CREATE INDEX "User_entraOid_idx" ON "User"("entraOid");
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE INDEX "WorkflowDefinition_flowType_idx" ON "WorkflowDefinition"("flowType");
CREATE UNIQUE INDEX "WorkflowDefinition_flowType_name_version_key" ON "WorkflowDefinition"("flowType","name","version");
CREATE UNIQUE INDEX "StepDefinition_nextStepId_key" ON "StepDefinition"("nextStepId");
CREATE INDEX "StepDefinition_workflowId_idx" ON "StepDefinition"("workflowId");
CREATE INDEX "StepDefinition_responsibleRoleId_idx" ON "StepDefinition"("responsibleRoleId");
CREATE UNIQUE INDEX "StepDefinition_workflowId_order_key" ON "StepDefinition"("workflowId","order");
CREATE INDEX "StepTemplate_stepId_idx" ON "StepTemplate"("stepId");
CREATE UNIQUE INDEX "FormDefinition_code_version_key" ON "FormDefinition"("code","version");
CREATE INDEX "FormField_formId_idx" ON "FormField"("formId");
CREATE UNIQUE INDEX "FormField_formId_key_key" ON "FormField"("formId","key");
CREATE UNIQUE INDEX "FormField_formId_order_key" ON "FormField"("formId","order");
CREATE INDEX "StepForm_formId_idx" ON "StepForm"("formId");
CREATE UNIQUE INDEX "Case_code_key" ON "Case"("code");
CREATE UNIQUE INDEX "Case_currentStepInstanceId_key" ON "Case"("currentStepInstanceId");
CREATE INDEX "Case_workflowId_idx" ON "Case"("workflowId");
CREATE INDEX "Case_status_idx" ON "Case"("status");
CREATE INDEX "Case_flowType_idx" ON "Case"("flowType");
CREATE INDEX "StepInstance_caseId_idx" ON "StepInstance"("caseId");
CREATE INDEX "StepInstance_stepDefinitionId_idx" ON "StepInstance"("stepDefinitionId");
CREATE INDEX "StepInstance_assigneeId_idx" ON "StepInstance"("assigneeId");
CREATE INDEX "FormSubmission_formDefinitionId_idx" ON "FormSubmission"("formDefinitionId");
CREATE INDEX "FormSubmission_caseId_idx" ON "FormSubmission"("caseId");
CREATE INDEX "FormSubmission_stepInstanceId_idx" ON "FormSubmission"("stepInstanceId");
CREATE INDEX "Attachment_caseId_idx" ON "Attachment"("caseId");
CREATE INDEX "Attachment_stepInstanceId_idx" ON "Attachment"("stepInstanceId");
CREATE INDEX "Attachment_formSubmissionId_idx" ON "Attachment"("formSubmissionId");
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");
CREATE INDEX "Project_status_idx" ON "Project"("status");
CREATE INDEX "ProjectFlow_projectId_idx" ON "ProjectFlow"("projectId");
CREATE INDEX "ProjectFlow_caseId_idx" ON "ProjectFlow"("caseId");
CREATE INDEX "Exclusion_projectId_idx" ON "Exclusion"("projectId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StepDefinition" ADD CONSTRAINT "StepDefinition_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepDefinition" ADD CONSTRAINT "StepDefinition_responsibleRoleId_fkey" FOREIGN KEY ("responsibleRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StepDefinition" ADD CONSTRAINT "StepDefinition_nextStepId_fkey" FOREIGN KEY ("nextStepId") REFERENCES "StepDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StepTemplate" ADD CONSTRAINT "StepTemplate_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "StepDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormField" ADD CONSTRAINT "FormField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "FormDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepForm" ADD CONSTRAINT "StepForm_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "StepDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepForm" ADD CONSTRAINT "StepForm_formId_fkey" FOREIGN KEY ("formId") REFERENCES "FormDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_currentStepInstanceId_fkey" FOREIGN KEY ("currentStepInstanceId") REFERENCES "StepInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StepInstance" ADD CONSTRAINT "StepInstance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepInstance" ADD CONSTRAINT "StepInstance_stepDefinitionId_fkey" FOREIGN KEY ("stepDefinitionId") REFERENCES "StepDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StepInstance" ADD CONSTRAINT "StepInstance_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formDefinitionId_fkey" FOREIGN KEY ("formDefinitionId") REFERENCES "FormDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_stepInstanceId_fkey" FOREIGN KEY ("stepInstanceId") REFERENCES "StepInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_stepInstanceId_fkey" FOREIGN KEY ("stepInstanceId") REFERENCES "StepInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectFlow" ADD CONSTRAINT "ProjectFlow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectFlow" ADD CONSTRAINT "ProjectFlow_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Exclusion" ADD CONSTRAINT "Exclusion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
