import { NotFoundException } from '@nestjs/common';
import { StepTemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

describe('StepTemplatesController（issue 8.8 #43）', () => {
  it('GET /steps/:stepId/templates：回傳最新版範本清單', async () => {
    const svc = {
      getStepTemplates: jest.fn().mockResolvedValue([{ name: 'SOP.docx', version: 3 }]),
    } as unknown as TemplatesService;
    const controller = new StepTemplatesController(svc);

    const result = await controller.list('step-1');

    expect(result).toEqual([{ name: 'SOP.docx', version: 3 }]);
    expect(svc.getStepTemplates).toHaveBeenCalledWith('step-1');
  });

  it('GET /steps/:stepId/templates/download：回傳下載解析結果', async () => {
    const svc = {
      getDownloadTarget: jest.fn().mockResolvedValue({ url: 'https://x/SOP.docx' }),
    } as unknown as TemplatesService;
    const controller = new StepTemplatesController(svc);

    const result = await controller.download('step-1', 'SOP.docx');

    expect(result).toEqual({ url: 'https://x/SOP.docx' });
    expect(svc.getDownloadTarget).toHaveBeenCalledWith('step-1', 'SOP.docx');
  });

  it('GET /steps/:stepId/templates/history：回傳版本歷史', async () => {
    const svc = {
      getTemplateHistory: jest.fn().mockResolvedValue([
        { name: 'SOP.docx', version: 2 },
        { name: 'SOP.docx', version: 1 },
      ]),
    } as unknown as TemplatesService;
    const controller = new StepTemplatesController(svc);

    const result = await controller.history('step-1', 'SOP.docx');

    expect(result).toHaveLength(2);
  });

  it('service 丟出 NotFound（template_not_found）→ 原樣透傳 404', async () => {
    const svc = {
      getDownloadTarget: jest
        .fn()
        .mockRejectedValue(new NotFoundException('template_not_found')),
    } as unknown as TemplatesService;
    const controller = new StepTemplatesController(svc);

    await expect(controller.download('step-1', '不存在')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
