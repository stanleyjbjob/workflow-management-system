import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionUser } from '../auth/auth.service';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import {
  AuditExport,
  IsoDocumentKind,
  TraceRecordType,
  TraceabilityRecord,
  TrailFilter,
  TrailSummary,
} from './iso-trail-engine';
import { IsoTrailService } from './iso-trail.service';

/**
 * ISO 27001 文件化軌跡 REST 端點（issue 6.2 / §11）。
 * 需登入（SessionAuthGuard）且具 `case:read` 權限；可見範圍由 IsoTrailService 依角色收斂。
 *
 * GET /iso-trail            ：查閱軌跡（可過濾 recordType/documentKind/case/project/日期/簽核狀態）。
 * GET /iso-trail/summary    ：彙總統計（簽核缺口、留存到期）。
 * GET /iso-trail/export     ：完整稽核匯出包（JSON）。
 * GET /iso-trail/export.csv ：稽核紀錄 CSV 下載。
 */
@Controller('iso-trail')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class IsoTrailController {
  constructor(private readonly trail: IsoTrailService) {}

  private buildFilter(
    recordType?: string,
    documentKind?: string,
    caseId?: string,
    projectId?: string,
    from?: string,
    to?: string,
    requiresSignatureOnly?: string,
    signedOff?: string,
  ): TrailFilter {
    const filter: TrailFilter = {};
    if (recordType) filter.recordTypes = recordType.split(',') as TraceRecordType[];
    if (documentKind) filter.documentKinds = documentKind.split(',') as IsoDocumentKind[];
    if (caseId) filter.caseId = caseId;
    if (projectId) filter.projectId = projectId;
    if (from && !Number.isNaN(Date.parse(from))) filter.from = new Date(from);
    if (to && !Number.isNaN(Date.parse(to))) filter.to = new Date(to);
    if (requiresSignatureOnly === 'true' || requiresSignatureOnly === '1') {
      filter.requiresSignatureOnly = true;
    }
    if (signedOff === 'true') filter.signedOff = true;
    else if (signedOff === 'false') filter.signedOff = false;
    return filter;
  }

  @Get()
  @Permissions('case:read')
  getTrail(
    @CurrentUser() user: SessionUser,
    @Query('recordType') recordType?: string,
    @Query('documentKind') documentKind?: string,
    @Query('caseId') caseId?: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('requiresSignatureOnly') requiresSignatureOnly?: string,
    @Query('signedOff') signedOff?: string,
  ): Promise<TraceabilityRecord[]> {
    const filter = this.buildFilter(recordType, documentKind, caseId, projectId, from, to, requiresSignatureOnly, signedOff);
    return this.trail.getTrail(user, filter);
  }

  @Get('summary')
  @Permissions('case:read')
  getSummary(
    @CurrentUser() user: SessionUser,
    @Query('recordType') recordType?: string,
    @Query('documentKind') documentKind?: string,
    @Query('caseId') caseId?: string,
    @Query('projectId') projectId?: string,
  ): Promise<TrailSummary> {
    const filter = this.buildFilter(recordType, documentKind, caseId, projectId);
    return this.trail.getSummary(user, filter);
  }

  @Get('export')
  @Permissions('case:read')
  exportAudit(
    @CurrentUser() user: SessionUser,
    @Query('recordType') recordType?: string,
    @Query('documentKind') documentKind?: string,
    @Query('caseId') caseId?: string,
    @Query('projectId') projectId?: string,
  ): Promise<AuditExport> {
    const filter = this.buildFilter(recordType, documentKind, caseId, projectId);
    return this.trail.exportAudit(user, filter);
  }

  @Get('export.csv')
  @Permissions('case:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="iso-trail.csv"')
  exportCsv(
    @CurrentUser() user: SessionUser,
    @Query('recordType') recordType?: string,
    @Query('documentKind') documentKind?: string,
    @Query('caseId') caseId?: string,
    @Query('projectId') projectId?: string,
  ): Promise<string> {
    const filter = this.buildFilter(recordType, documentKind, caseId, projectId);
    return this.trail.exportCsv(user, filter);
  }
}
