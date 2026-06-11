import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SessionUser } from '../auth/auth.service';
import { CaseAccessService } from '../common/case-access.service';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

const user: SessionUser = { sub: 'u-1', roles: ['SALES'] } as unknown as SessionUser;

function allowAccess(): CaseAccessService {
  return {
    assertCanViewCaseById: jest.fn().mockResolvedValue(undefined),
    assertCanViewTarget: jest.fn().mockResolvedValue(undefined),
  } as unknown as CaseAccessService;
}

describe('AttachmentsController（issue 8.8 #43）', () => {
  it('GET /attachments?caseId=：查清單並比照案件可見性', async () => {
    const svc = {
      listAttachments: jest.fn().mockResolvedValue([{ name: 'a.pdf', version: 2 }]),
    } as unknown as AttachmentsService;
    const access = allowAccess();
    const controller = new AttachmentsController(svc, access);

    const result = await controller.list(user, 'c-1', undefined, undefined);

    expect(result).toEqual([{ name: 'a.pdf', version: 2 }]);
    expect(access.assertCanViewTarget).toHaveBeenCalledWith(user, {
      caseId: 'c-1',
      stepInstanceId: null,
      formSubmissionId: null,
    });
    expect(svc.listAttachments).toHaveBeenCalledWith({
      caseId: 'c-1',
      stepInstanceId: null,
      formSubmissionId: null,
    });
  });

  it('POST /attachments：uploadedById＝登入者、目標與內容轉呼叫 service', async () => {
    const svc = {
      addAttachment: jest.fn().mockResolvedValue({ id: 'a-1', version: 1 }),
    } as unknown as AttachmentsService;
    const controller = new AttachmentsController(svc, allowAccess());

    const result = await controller.add(user, {
      stepInstanceId: 'si-1',
      name: '驗收紀錄.docx',
      linkUrl: 'https://contoso.sharepoint.com/x',
    });

    expect(result).toEqual({ id: 'a-1', version: 1 });
    expect(svc.addAttachment).toHaveBeenCalledWith(
      { caseId: null, stepInstanceId: 'si-1', formSubmissionId: null },
      expect.objectContaining({
        name: '驗收紀錄.docx',
        linkUrl: 'https://contoso.sharepoint.com/x',
        uploadedById: 'u-1',
      }),
    );
  });

  it('GET /attachments/download：回傳下載解析結果', async () => {
    const svc = {
      getDownloadTarget: jest.fn().mockResolvedValue({
        url: 'https://contoso.sharepoint.com/x',
        permissionModel: 'M365_CLOUD',
      }),
    } as unknown as AttachmentsService;
    const controller = new AttachmentsController(svc, allowAccess());

    const result = await controller.download(user, 'a.pdf', 'c-1', undefined, undefined);

    expect(result).toEqual(
      expect.objectContaining({ permissionModel: 'M365_CLOUD' }),
    );
    expect(svc.getDownloadTarget).toHaveBeenCalledWith(
      { caseId: 'c-1', stepInstanceId: null, formSubmissionId: null },
      'a.pdf',
    );
  });

  it('GET /attachments/history：回傳版本歷史', async () => {
    const svc = {
      getAttachmentHistory: jest.fn().mockResolvedValue([
        { name: 'a.pdf', version: 2 },
        { name: 'a.pdf', version: 1 },
      ]),
    } as unknown as AttachmentsService;
    const controller = new AttachmentsController(svc, allowAccess());

    const result = await controller.history(user, 'a.pdf', 'c-1', undefined, undefined);

    expect(result).toHaveLength(2);
  });

  it('案件不可見 → 403 且不觸碰 service', async () => {
    const svc = { listAttachments: jest.fn() } as unknown as AttachmentsService;
    const access = {
      assertCanViewTarget: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('case_not_visible')),
    } as unknown as CaseAccessService;
    const controller = new AttachmentsController(svc, access);

    await expect(
      controller.list(user, 'c-x', undefined, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.listAttachments).not.toHaveBeenCalled();
  });

  it('目標未指定 → 400 invalid_target（由 CaseAccessService 把關）', async () => {
    const svc = { listAttachments: jest.fn() } as unknown as AttachmentsService;
    const access = {
      assertCanViewTarget: jest
        .fn()
        .mockRejectedValue(new BadRequestException('invalid_target')),
    } as unknown as CaseAccessService;
    const controller = new AttachmentsController(svc, access);

    await expect(
      controller.list(user, undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
