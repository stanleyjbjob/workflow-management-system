import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SessionUser } from '../auth/auth.service';
import { CaseAccessService } from '../common/case-access.service';
import {
  CaseSubmissionsController,
  FormsController,
  StepFormsController,
} from './forms.controller';
import { FormsService } from './forms.service';

const user: SessionUser = { sub: 'u-1', roles: ['SALES'] } as unknown as SessionUser;

function allowAccess(): CaseAccessService {
  return {
    assertCanViewCaseById: jest.fn().mockResolvedValue(undefined),
    assertCanViewTarget: jest.fn().mockResolvedValue(undefined),
  } as unknown as CaseAccessService;
}

function denyAccess(): CaseAccessService {
  const err = new ForbiddenException('case_not_visible');
  return {
    assertCanViewCaseById: jest.fn().mockRejectedValue(err),
    assertCanViewTarget: jest.fn().mockRejectedValue(err),
  } as unknown as CaseAccessService;
}

describe('FormsController（issue 8.8 #43）', () => {
  it('POST /forms/submissions：以登入者為 submittedById 轉呼叫 service', async () => {
    const forms = {
      submitForm: jest.fn().mockResolvedValue({ id: 's-1' }),
    } as unknown as FormsService;
    const access = allowAccess();
    const controller = new FormsController(forms, access);

    const result = await controller.submit(user, {
      formDefinitionId: 'f-1',
      caseId: 'c-1',
      data: { amount: 100 },
    });

    expect(result).toEqual({ id: 's-1' });
    expect(access.assertCanViewTarget).toHaveBeenCalledWith(user, { caseId: 'c-1' });
    expect(forms.submitForm).toHaveBeenCalledWith({
      formDefinitionId: 'f-1',
      caseId: 'c-1',
      stepInstanceId: null,
      data: { amount: 100 },
      submittedById: 'u-1',
    });
  });

  it('POST /forms/submissions：案件不可見 → 403 且不觸碰 service', async () => {
    const forms = { submitForm: jest.fn() } as unknown as FormsService;
    const controller = new FormsController(forms, denyAccess());

    await expect(
      controller.submit(user, { formDefinitionId: 'f-1', caseId: 'c-x', data: {} }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(forms.submitForm).not.toHaveBeenCalled();
  });

  it('POST approve/reject：以登入者為簽核人、可見性以 formSubmissionId 回溯', async () => {
    const forms = {
      approveSubmission: jest.fn().mockResolvedValue({ id: 's-1', status: 'APPROVED' }),
      rejectSubmission: jest.fn().mockResolvedValue({ id: 's-1', status: 'REJECTED' }),
    } as unknown as FormsService;
    const access = allowAccess();
    const controller = new FormsController(forms, access);

    await controller.approve(user, 's-1');
    await controller.reject(user, 's-1');

    expect(access.assertCanViewTarget).toHaveBeenCalledWith(user, { formSubmissionId: 's-1' });
    expect(forms.approveSubmission).toHaveBeenCalledWith('s-1', 'u-1');
    expect(forms.rejectSubmission).toHaveBeenCalledWith('s-1', 'u-1');
  });

  it('引擎業務錯誤（snake_case code）→ 400 BadRequest', async () => {
    const engineErr = Object.assign(new Error('missing required'), {
      code: 'missing_required_fields',
    });
    const forms = {
      submitForm: jest.fn().mockRejectedValue(engineErr),
    } as unknown as FormsService;
    const controller = new FormsController(forms, allowAccess());

    await expect(
      controller.submit(user, { formDefinitionId: 'f-1', caseId: 'c-1', data: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CaseSubmissionsController（GET /cases/:caseId/submissions）', () => {
  it('可見案件回傳提交清單', async () => {
    const forms = {
      listCaseSubmissions: jest.fn().mockResolvedValue([{ id: 's-1' }]),
    } as unknown as FormsService;
    const access = allowAccess();
    const controller = new CaseSubmissionsController(forms, access);

    const result = await controller.list(user, 'c-1');

    expect(result).toEqual([{ id: 's-1' }]);
    expect(access.assertCanViewCaseById).toHaveBeenCalledWith(user, 'c-1');
  });

  it('不可見案件 → 403', async () => {
    const forms = { listCaseSubmissions: jest.fn() } as unknown as FormsService;
    const controller = new CaseSubmissionsController(forms, denyAccess());

    await expect(controller.list(user, 'c-x')).rejects.toBeInstanceOf(ForbiddenException);
    expect(forms.listCaseSubmissions).not.toHaveBeenCalled();
  });
});

describe('StepFormsController（GET /steps/:stepId/forms）', () => {
  it('回傳步驟掛載表單（含欄位與必填旗標）', async () => {
    const forms = {
      getStepForms: jest.fn().mockResolvedValue([
        { isRequired: true, form: { id: 'f-1', fields: [] } },
      ]),
    } as unknown as FormsService;
    const controller = new StepFormsController(forms);

    const result = await controller.stepForms('step-1');

    expect(result).toHaveLength(1);
    expect(forms.getStepForms).toHaveBeenCalledWith('step-1');
  });
});
