import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SessionUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessScopeService } from '../rbac/access-scope.service';

/** 附件／表單操作可指向的目標（三者擇一，與 attachments-engine 的 AttachmentTarget 對齊）。 */
export interface CaseBoundTarget {
  caseId?: string | null;
  stepInstanceId?: string | null;
  formSubmissionId?: string | null;
}

/**
 * 案件可見性共用服務（issue 8.8 #43）。
 *
 * forms / attachments 的通用 REST 端點皆「比照所屬案件權限」：
 * 由 caseId（或可回溯到案件的 stepInstanceId / formSubmissionId）載入案件最小欄位，
 * 再委派 1.4 的 AccessScopeService.assertCanViewCase 斷言（不可見 → 403 case_not_visible）。
 * 與 CasesService 既有做法一致，抽出共用避免三個 controller 重複。
 */
@Injectable()
export class CaseAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
  ) {}

  /** 斷言登入者可見某案件；案件不存在 → 404 case_not_found。 */
  async assertCanViewCaseById(user: SessionUser, caseId: string): Promise<void> {
    const row = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { flowType: true, assigneeId: true, createdById: true },
    });
    if (!row) throw new NotFoundException('case_not_found');
    this.accessScope.assertCanViewCase(user, row);
  }

  /**
   * 由目標（case / stepInstance / formSubmission 三者擇一）回溯所屬案件並斷言可見性。
   * 未指定或指定多個目標 → 400 invalid_target（與 attachments-engine resolveTarget 慣例一致）。
   */
  async assertCanViewTarget(user: SessionUser, target: CaseBoundTarget): Promise<void> {
    const keys = (['caseId', 'stepInstanceId', 'formSubmissionId'] as const).filter(
      (k) => target[k] != null && target[k] !== '',
    );
    if (keys.length !== 1) throw new BadRequestException('invalid_target');

    if (keys[0] === 'caseId') {
      await this.assertCanViewCaseById(user, target.caseId as string);
      return;
    }
    if (keys[0] === 'stepInstanceId') {
      const step = await this.prisma.stepInstance.findUnique({
        where: { id: target.stepInstanceId as string },
        select: { caseId: true },
      });
      if (!step) throw new NotFoundException('step_instance_not_found');
      await this.assertCanViewCaseById(user, step.caseId);
      return;
    }
    const submission = await this.prisma.formSubmission.findUnique({
      where: { id: target.formSubmissionId as string },
      select: { caseId: true },
    });
    if (!submission) throw new NotFoundException('submission_not_found');
    await this.assertCanViewCaseById(user, submission.caseId);
  }
}
