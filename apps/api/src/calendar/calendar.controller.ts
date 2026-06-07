import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HolidaySource, HolidayType } from '@prisma/client';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { guardEngine } from '../common/engine-http';
import {
  CheckpointOffset,
  DeferralMode,
  HolidayCalendarInput,
  RescheduledCheckpoint,
  toIsoDate,
} from './calendar-engine';
import { CalendarService, HolidayRecordInput } from './calendar.service';

/**
 * 行事曆 REST 端點（issue 8.1 #33 第 3 批 / 需求規格 §8.3、§12-5、§10.5）。
 *
 * 沿用 KanbanController / ProjectsController 風格：@UseGuards(SessionAuthGuard, PermissionsGuard)
 * + @Permissions；與 CalendarService 方法一一對應。
 *
 * 權限對應（RBAC 既有矩陣 permissions.ts）：
 * - 行事曆查詢／遞延運算（純讀取）→ `workflow:read`（全角色皆有，平台基礎資訊）。
 * - Holiday 假日 CRUD（主管維護，7.1 #31 定案）→ `admin:manage`（僅 MANAGER）。
 *
 * 路由一覽：
 * - GET    /calendar/holidays?from=&to=&type=        假日／補班清單（日期升冪）
 * - POST   /calendar/holidays                        新增假日／補班（主管維護）
 * - PATCH  /calendar/holidays/:id                    更新假日／補班（部分更新）
 * - DELETE /calendar/holidays/:id                    刪除假日／補班
 * - GET    /calendar/is-workday?date=&projectId=     某日是否工作日（DB 假日＋週末／補班＋專案排除日）
 * - GET    /calendar/defer?date=&projectId=          遞延至最近（含當日）工作日
 * - GET    /calendar/next-workday?date=&projectId=   嚴格下一個工作日
 * - POST   /calendar/reschedule                      錨點＋時間點位移重算時程（純計算，§8.3 遞延）
 *
 * 註：reschedule 為純計算端點（不寫入），以 POST 承載結構化參數（checkpoints／custom
 * 行事曆覆寫無法以 query 合理表達），與 onboarding/environment 之 /schedule 慣例一致。
 */
@Controller('calendar')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  // ---- 解析（非法輸入一律 400 + code，沿用既有慣例）----

  private parseRequiredDateQuery(value: string | undefined, field: string): Date {
    if (value == null || value === '') {
      throw new BadRequestException({ code: 'invalid_query', message: `${field} 必填（ISO 日期）` });
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException({ code: 'invalid_query', message: `${field} 不是合法日期：${value}` });
    }
    return d;
  }

  private parseHolidayType(value: string | undefined, code: string): HolidayType | undefined {
    if (value == null || value === '') return undefined;
    const all = Object.values(HolidayType) as string[];
    if (!all.includes(value)) {
      throw new BadRequestException({ code, message: `type 必須為 ${all.join(' / ')}：${value}` });
    }
    return value as HolidayType;
  }

  private parseHolidaySource(value: string | undefined): HolidaySource | undefined {
    if (value == null || value === '') return undefined;
    const all = Object.values(HolidaySource) as string[];
    if (!all.includes(value)) {
      throw new BadRequestException({ code: 'invalid_body', message: `source 必須為 ${all.join(' / ')}：${value}` });
    }
    return value as HolidaySource;
  }

  private parseDeferralMode(value: string | undefined): DeferralMode | undefined {
    if (value == null || value === '') return undefined;
    const all = Object.values(DeferralMode) as string[];
    if (!all.includes(value)) {
      throw new BadRequestException({ code: 'invalid_body', message: `mode 必須為 ${all.join(' / ')}：${value}` });
    }
    return value as DeferralMode;
  }

  // ---- Holiday CRUD（主管維護，§12-5）----

  /** 假日／補班清單（可依日期區間與類型過濾），日期升冪。 */
  @Get('holidays')
  @Permissions('workflow:read')
  listHolidays(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
  ) {
    const opts: { from?: Date; to?: Date; type?: HolidayType } = {};
    if (from) opts.from = this.parseRequiredDateQuery(from, 'from');
    if (to) opts.to = this.parseRequiredDateQuery(to, 'to');
    const t = this.parseHolidayType(type, 'invalid_query');
    if (t) opts.type = t;
    return this.calendar.listHolidays(opts);
  }

  /** 新增一筆假日／補班（主管維護；日期重複→400 holiday_date_duplicate）。 */
  @Post('holidays')
  @Permissions('admin:manage')
  addHoliday(
    @Body()
    body: { date?: string; name?: string; type?: string; source?: string; note?: string | null },
  ) {
    if (body.date == null || body.date === '') {
      throw new BadRequestException({ code: 'invalid_body', message: 'date 必填（yyyy-mm-dd）' });
    }
    if (body.name == null || body.name.trim() === '') {
      throw new BadRequestException({ code: 'holiday_name_required', message: 'name 必填' });
    }
    const input: HolidayRecordInput = {
      date: body.date,
      name: body.name,
      type: this.parseHolidayType(body.type, 'invalid_body'),
      source: this.parseHolidaySource(body.source),
      note: body.note ?? null,
    };
    return this.calendar.addHoliday(input);
  }

  /** 更新一筆假日／補班（部分更新；查無→404）。 */
  @Patch('holidays/:id')
  @Permissions('admin:manage')
  updateHoliday(
    @Param('id') id: string,
    @Body()
    body: { date?: string; name?: string; type?: string; source?: string; note?: string | null },
  ) {
    const patch: Partial<HolidayRecordInput> = {};
    if (body.date !== undefined) patch.date = body.date;
    if (body.name !== undefined) patch.name = body.name;
    if (body.type !== undefined) patch.type = this.parseHolidayType(body.type, 'invalid_body');
    if (body.source !== undefined) patch.source = this.parseHolidaySource(body.source);
    if (body.note !== undefined) patch.note = body.note;
    return this.calendar.updateHoliday(id, patch);
  }

  /** 刪除一筆假日／補班（查無→404）。 */
  @Delete('holidays/:id')
  @Permissions('admin:manage')
  removeHoliday(@Param('id') id: string): Promise<{ id: string }> {
    return this.calendar.removeHoliday(id);
  }

  // ---- 行事曆查詢／遞延運算（DB 假日驅動，§8.3）----

  /** 某日是否工作日（DB 假日＋週末／補班＋專案排除日 §10.5）。 */
  @Get('is-workday')
  @Permissions('workflow:read')
  async isWorkday(
    @Query('date') date?: string,
    @Query('projectId') projectId?: string,
  ): Promise<{ date: string; workday: boolean }> {
    const d = this.parseRequiredDateQuery(date, 'date');
    const isExcluded = await this.calendar.buildIsExcluded({ projectId: projectId || undefined });
    return { date: toIsoDate(d), workday: !isExcluded(d) };
  }

  /** 遞延至最近（含當日）之工作日。 */
  @Get('defer')
  @Permissions('workflow:read')
  async defer(
    @Query('date') date?: string,
    @Query('projectId') projectId?: string,
  ): Promise<{ input: string; deferred: string; deferredDays: number }> {
    const d = this.parseRequiredDateQuery(date, 'date');
    const out = await this.calendar.deferToWorkday(d, { projectId: projectId || undefined });
    const deferredDays = Math.round((out.getTime() - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86_400_000);
    return { input: toIsoDate(d), deferred: toIsoDate(out), deferredDays: Math.max(0, deferredDays) };
  }

  /** 嚴格下一個工作日。 */
  @Get('next-workday')
  @Permissions('workflow:read')
  async nextWorkday(
    @Query('date') date?: string,
    @Query('projectId') projectId?: string,
  ): Promise<{ input: string; next: string }> {
    const d = this.parseRequiredDateQuery(date, 'date');
    const out = await this.calendar.nextWorkday(d, { projectId: projectId || undefined });
    return { input: toIsoDate(d), next: toIsoDate(out) };
  }

  /**
   * 依錨點＋時間點位移重算時程（純計算；mode 預設 NEXT_WORKDAY，可選 PUSH_FORWARD；§12-5 兩規則皆供）。
   * checkpoints 由呼叫端提供（key＋offsetDays），引擎驗證錯誤經 guardEngine 轉 400（保留 code）。
   */
  @Post('reschedule')
  @Permissions('workflow:read')
  reschedule(
    @Body()
    body: {
      anchor?: string;
      checkpoints?: readonly CheckpointOffset[];
      mode?: string;
      projectId?: string;
      custom?: HolidayCalendarInput;
    },
  ): Promise<RescheduledCheckpoint[]> {
    if (body.anchor == null || body.anchor === '') {
      throw new BadRequestException({ code: 'invalid_body', message: 'anchor 必填（ISO 日期）' });
    }
    const anchor = new Date(body.anchor);
    if (Number.isNaN(anchor.getTime())) {
      throw new BadRequestException({ code: 'invalid_body', message: `anchor 不是合法日期：${body.anchor}` });
    }
    if (!Array.isArray(body.checkpoints) || body.checkpoints.length === 0) {
      throw new BadRequestException({ code: 'invalid_body', message: 'checkpoints 必填（非空陣列）' });
    }
    const mode = this.parseDeferralMode(body.mode);
    return guardEngine(() =>
      this.calendar.reschedule(anchor, body.checkpoints as CheckpointOffset[], {
        projectId: body.projectId || undefined,
        custom: body.custom,
        mode,
      }),
    );
  }
}
