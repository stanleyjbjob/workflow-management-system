import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { FormDefinition, FormField, FormSubmission } from '@prisma/client';
import { SessionUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CaseAccessService } from '../common/case-access.service';
import { guardEngine } from '../common/engine-http';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { EngineFormSubmission } from './forms-engine';
import { FormsService } from './forms.service';

/** POST /forms/submissions 的 body（issue 8.8 建議最小集）。 */
export interface SubmitFormBodyDto {
  formDefinitionId: string;
  caseId: string;
  stepInstanceId?: string | null;
  data: Record<string, unknown>;
}

/**
 * 表單通用 REST（issue 8.8 #43 / docs B3）。
 *
 * 與四大流程既有 `POST .../forms/:formCode` 的分工：
 * 流程層端點負責「流程語意」（formCode 對應該流程步驟、推進把關）；
 * 本通用層以 formDefinitionId / submissionId 直接操作表單提交與簽核，
 * 供案件詳情頁等跨流程 UI 使用，兩者互補不重複。
 *
 * 權限：填寫 `form:fill`、簽核 `form:approve`、查詢 `form:read`；
 * 所有操作另以 CaseAccessService 比照所屬案件可見性把關（403 case_not_visible）。
 */
@Controller('forms')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly caseAccess: CaseAccessService,
  ) {}

  /** 送出一筆表單填寫（submittedById＝登入者）。 */
  @Post('submissions')
  @Permissions('form:fill')
  async submit(
    @CurrentUser() user: SessionUser,
    @Body() body: SubmitFormBodyDto,
  ): Promise<FormSubmission> {
    return guardEngine(async () => {
      await this.caseAccess.assertCanViewTarget(user, { caseId: body?.caseId });
      return this.forms.submitForm({
        formDefinitionId: body.formDefinitionId,
        caseId: body.caseId,
        stepInstanceId: body.stepInstanceId ?? null,
        data: body.data ?? {},
        submittedById: user.sub,
      });
    });
  }

  /** 核可一筆已送出的簽核類表單填寫（approvedById＝登入者）。 */
  @Post('submissions/:id/approve')
  @Permissions('form:approve')
  async approve(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<FormSubmission> {
    return guardEngine(async () => {
      await this.caseAccess.assertCanViewTarget(user, { formSubmissionId: id });
      return this.forms.approveSubmission(id, user.sub);
    });
  }

  /** 退回一筆已送出的簽核類表單填寫（記錄退回人）。 */
  @Post('submissions/:id/reject')
  @Permissions('form:approve')
  async reject(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<FormSubmission> {
    return guardEngine(async () => {
      await this.caseAccess.assertCanViewTarget(user, { formSubmissionId: id });
      return this.forms.rejectSubmission(id, user.sub);
    });
  }
}

/**
 * 案件表單提交查詢（issue 8.8：GET /cases/:caseId/submissions）。
 * 與 CasesController 同掛 `cases` 前綴、路徑不重疊；可見性比照案件。
 */
@Controller('cases')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CaseSubmissionsController {
  constructor(
    private readonly forms: FormsService,
    private readonly caseAccess: CaseAccessService,
  ) {}

  /** 列出某案件全部表單提交（含步驟順序，供詳情頁與追溯）。 */
  @Get(':caseId/submissions')
  @Permissions('form:read')
  async list(
    @CurrentUser() user: SessionUser,
    @Param('caseId') caseId: string,
  ): Promise<EngineFormSubmission[]> {
    return guardEngine(async () => {
      await this.caseAccess.assertCanViewCaseById(user, caseId);
      return this.forms.listCaseSubmissions(caseId);
    });
  }
}

/**
 * 步驟掛載表單查詢（GET /steps/:stepId/forms）。
 * 步驟定義層級資料（非案件實例），供 UI 帶出欄位定義渲染填寫表單。
 */
@Controller('steps')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class StepFormsController {
  constructor(private readonly forms: FormsService) {}

  /** 取得某步驟掛載的表單（含欄位、是否必填）。 */
  @Get(':stepId/forms')
  @Permissions('form:read')
  async stepForms(
    @Param('stepId') stepId: string,
  ): Promise<
    Array<{ isRequired: boolean; form: FormDefinition & { fields: FormField[] } }>
  > {
    return guardEngine(() => this.forms.getStepForms(stepId));
  }
}
