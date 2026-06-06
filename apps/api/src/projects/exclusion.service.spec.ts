import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExclusionService } from './exclusion.service';
import { DeferralMode } from '../calendar/calendar-engine';
import { toIsoDate } from './exclusion-engine';

/**
 * ExclusionService 單元測試（issue 5.4 / #26）。
 *
 * 以手刻 mock 取代 PrismaService 與 CalendarService（與本模組「不依賴真實 DB / Nest 容器」之
 * 純測試風格一致），聚焦驗證「服務層的委派與守門」行為：
 * - CRUD 是否正確委派 Prisma、並把 exclusion-engine 的正規化結果（UTC 午夜日界）寫入。
 * - 專案 / 排除日不存在時是否丟 NotFoundException。
 * - 引擎驗證失敗是否轉成 BadRequestException 並保留可判讀 code。
 * - 時程避讓是否委派 CalendarService（讀同一張表，排除日與假日併行）。
 *
 * 不涵蓋 §9-5（全專案 vs 特定流程）/ §9-6（planEnd 自動順延）等待釐清業務規則 —— 該等規則尚未定案，
 * 服務目前刻意不寫回 planEnd，待人類 review 後再補對應測試。
 */

type PrismaMock = {
  project: { findUnique: jest.Mock };
  exclusion: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

type CalendarMock = {
  deferToWorkday: jest.Mock;
  reschedule: jest.Mock;
};

function makePrisma(): PrismaMock {
  return {
    project: { findUnique: jest.fn() },
    exclusion: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function makeCalendar(): CalendarMock {
  return {
    deferToWorkday: jest.fn(),
    reschedule: jest.fn(),
  };
}

function makeService(prisma: PrismaMock, calendar: CalendarMock): ExclusionService {
  // 服務只透過建構子注入這兩個相依，型別以 any 餵入手刻 mock。
  return new ExclusionService(prisma as any, calendar as any);
}

const PROJECT_OK = { id: 'p1' };

describe('ExclusionService', () => {
  let prisma: PrismaMock;
  let calendar: CalendarMock;
  let service: ExclusionService;

  beforeEach(() => {
    prisma = makePrisma();
    calendar = makeCalendar();
    service = makeService(prisma, calendar);
  });

  describe('addExclusion', () => {
    it('專案存在＋輸入合法時，以正規化（UTC 午夜）資料委派 prisma.exclusion.create 並回傳 id', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_OK);
      prisma.exclusion.create.mockResolvedValue({ id: 'e1' });

      const res = await service.addExclusion('p1', {
        fromDate: '2026-02-16',
        toDate: '2026-02-18',
        reason: ' 客戶教育訓練 ',
        source: 'CUSTOMER',
      });

      expect(res).toEqual({ id: 'e1' });
      expect(prisma.exclusion.create).toHaveBeenCalledTimes(1);
      const arg = prisma.exclusion.create.mock.calls[0][0];
      expect(arg.data.projectId).toBe('p1');
      // 日界正規化為 UTC 午夜
      expect(toIsoDate(arg.data.fromDate)).toBe('2026-02-16');
      expect(toIsoDate(arg.data.toDate)).toBe('2026-02-18');
      expect(arg.data.fromDate.getUTCHours()).toBe(0);
      // reason 已 trim
      expect(arg.data.reason).toBe('客戶教育訓練');
      expect(arg.data.source).toBe('CUSTOMER');
    });

    it('專案不存在時丟 NotFoundException，且不呼叫 create', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(
        service.addExclusion('nope', { fromDate: '2026-02-16', toDate: '2026-02-16', reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.exclusion.create).not.toHaveBeenCalled();
    });

    it('引擎驗證失敗（reason 空白）轉為 BadRequestException 並保留 code', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_OK);

      let captured: any;
      try {
        await service.addExclusion('p1', { fromDate: '2026-02-16', toDate: '2026-02-16', reason: '   ' });
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(BadRequestException);
      expect(captured.getResponse()).toMatchObject({ code: 'reason_required' });
      expect(prisma.exclusion.create).not.toHaveBeenCalled();
    });

    it('toDate 早於 fromDate 轉為 BadRequestException(code=invalid_range)', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_OK);

      let captured: any;
      try {
        await service.addExclusion('p1', { fromDate: '2026-02-18', toDate: '2026-02-16', reason: 'x' });
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(BadRequestException);
      expect(captured.getResponse()).toMatchObject({ code: 'invalid_range' });
    });
  });

  describe('listExclusions', () => {
    it('委派 prisma.exclusion.findMany（依 fromDate 升冪）', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_OK);
      const rows = [{ id: 'e1' }, { id: 'e2' }];
      prisma.exclusion.findMany.mockResolvedValue(rows);

      const res = await service.listExclusions('p1');

      expect(res).toBe(rows);
      expect(prisma.exclusion.findMany).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
        orderBy: { fromDate: 'asc' },
      });
    });

    it('專案不存在時丟 NotFoundException', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(service.listExclusions('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateExclusion', () => {
    it('部分更新：未提供欄位沿用現值，提供欄位重新正規化後委派 update', async () => {
      prisma.exclusion.findUnique.mockResolvedValue({
        fromDate: new Date(Date.UTC(2026, 1, 16)),
        toDate: new Date(Date.UTC(2026, 1, 18)),
        reason: '原因A',
        source: 'CUSTOMER',
      });
      prisma.exclusion.update.mockResolvedValue({ id: 'e1' });

      const res = await service.updateExclusion('e1', { reason: '改成原因B' });

      expect(res).toEqual({ id: 'e1' });
      const arg = prisma.exclusion.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'e1' });
      expect(arg.data.reason).toBe('改成原因B');
      // 未提供 → 沿用現值
      expect(toIsoDate(arg.data.fromDate)).toBe('2026-02-16');
      expect(toIsoDate(arg.data.toDate)).toBe('2026-02-18');
      expect(arg.data.source).toBe('CUSTOMER');
    });

    it('排除日不存在時丟 NotFoundException，且不呼叫 update', async () => {
      prisma.exclusion.findUnique.mockResolvedValue(null);
      await expect(service.updateExclusion('nope', { reason: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.exclusion.update).not.toHaveBeenCalled();
    });

    it('更新後造成 from>to 時轉為 BadRequestException(code=invalid_range)', async () => {
      prisma.exclusion.findUnique.mockResolvedValue({
        fromDate: new Date(Date.UTC(2026, 1, 16)),
        toDate: new Date(Date.UTC(2026, 1, 18)),
        reason: '原因A',
        source: null,
      });

      let captured: any;
      try {
        await service.updateExclusion('e1', { fromDate: '2026-02-20' }); // 20 > 18
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(BadRequestException);
      expect(captured.getResponse()).toMatchObject({ code: 'invalid_range' });
      expect(prisma.exclusion.update).not.toHaveBeenCalled();
    });
  });

  describe('removeExclusion', () => {
    it('存在時刪除並回傳 id', async () => {
      prisma.exclusion.findUnique.mockResolvedValue({ id: 'e1' });
      prisma.exclusion.delete.mockResolvedValue({ id: 'e1' });

      const res = await service.removeExclusion('e1');

      expect(res).toEqual({ id: 'e1' });
      expect(prisma.exclusion.delete).toHaveBeenCalledWith({ where: { id: 'e1' } });
    });

    it('不存在時丟 NotFoundException，且不呼叫 delete', async () => {
      prisma.exclusion.findUnique.mockResolvedValue(null);
      await expect(service.removeExclusion('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.exclusion.delete).not.toHaveBeenCalled();
    });
  });

  describe('時程避讓（委派 CalendarService）', () => {
    it('deferDateAvoidingExclusions 以 { projectId } 委派 calendar.deferToWorkday', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_OK);
      const deferred = new Date(Date.UTC(2026, 1, 19));
      calendar.deferToWorkday.mockResolvedValue(deferred);

      const res = await service.deferDateAvoidingExclusions('p1', '2026-02-16');

      expect(res).toBe(deferred);
      expect(calendar.deferToWorkday).toHaveBeenCalledTimes(1);
      const [dateArg, optsArg] = calendar.deferToWorkday.mock.calls[0];
      expect(dateArg).toBeInstanceOf(Date);
      expect(optsArg).toEqual({ projectId: 'p1' });
    });

    it('rescheduleWithExclusions 以 { projectId, mode } 委派 calendar.reschedule（預設 NEXT_WORKDAY）', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_OK);
      const out = [{ key: 'k', date: new Date(Date.UTC(2026, 1, 19)) }];
      calendar.reschedule.mockResolvedValue(out);

      const checkpoints = [{ key: 'k', offsetDays: 1 }] as any;
      const res = await service.rescheduleWithExclusions('p1', '2026-02-16', checkpoints);

      expect(res).toBe(out);
      const [anchorArg, cpArg, optsArg] = calendar.reschedule.mock.calls[0];
      expect(anchorArg).toBeInstanceOf(Date);
      expect(cpArg).toBe(checkpoints);
      expect(optsArg).toEqual({ projectId: 'p1', mode: DeferralMode.NEXT_WORKDAY });
    });

    it('rescheduleWithExclusions 可傳入自訂 mode（PUSH_FORWARD）', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_OK);
      calendar.reschedule.mockResolvedValue([]);

      await service.rescheduleWithExclusions('p1', '2026-02-16', [] as any, DeferralMode.PUSH_FORWARD);

      const optsArg = calendar.reschedule.mock.calls[0][2];
      expect(optsArg.mode).toBe(DeferralMode.PUSH_FORWARD);
    });

    it('避讓委派前仍會守門：專案不存在丟 NotFoundException', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(service.deferDateAvoidingExclusions('nope', '2026-02-16')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(calendar.deferToWorkday).not.toHaveBeenCalled();
    });
  });
});
