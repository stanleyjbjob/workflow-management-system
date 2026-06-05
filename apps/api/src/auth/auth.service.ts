import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuthEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthConfigService } from './auth.config';
import { EntraClient, EntraProfile } from './entra.client';
import { signToken } from './token.util';

export interface SessionUser {
  sub: string;
  email: string;
  name: string;
  roles: string[];
}

export interface LoginContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entra: EntraClient,
    private readonly config: AuthConfigService,
  ) {}

  /** 將 Entra 群組 ID 對應為系統角色 ID（依 Role.entraGroupId 設定，資料驅動）。 */
  async mapGroupsToRoleIds(groupIds: string[]): Promise<string[]> {
    if (groupIds.length === 0) return [];
    const roles = await this.prisma.role.findMany({
      where: { entraGroupId: { in: groupIds } },
      select: { id: true },
    });
    return roles.map((r) => r.id);
  }

  /**
   * 將 Entra 衍生角色同步到使用者：
   * 只調整「由 Entra 群組對應（entraGroupId 非空）」的角色，保留其他手動指派的角色。
   */
  async syncUserRoles(userId: string, desiredRoleIds: string[]): Promise<void> {
    const entraManaged = await this.prisma.role.findMany({
      where: { entraGroupId: { not: null } },
      select: { id: true },
    });
    const entraManagedIds = new Set(entraManaged.map((r) => r.id));
    const desired = new Set(desiredRoleIds);

    const current = await this.prisma.userRole.findMany({
      where: { userId },
      select: { roleId: true },
    });
    const currentIds = new Set(current.map((c) => c.roleId));

    const toRemove = [...currentIds].filter((id) => entraManagedIds.has(id) && !desired.has(id));
    const toAdd = [...desired].filter((id) => !currentIds.has(id));

    if (toRemove.length > 0) {
      await this.prisma.userRole.deleteMany({ where: { userId, roleId: { in: toRemove } } });
    }
    for (const roleId of toAdd) {
      await this.prisma.userRole.create({ data: { userId, roleId } });
    }
  }

  /** 由 Entra 身分建立或更新系統使用者並同步角色；停用帳號則拒絕。 */
  async upsertUserFromProfile(
    profile: EntraProfile,
    groupIds: string[],
  ): Promise<{ userId: string; email: string; displayName: string; entraOid: string | null; roleCodes: string[] }> {
    const roleIds = await this.mapGroupsToRoleIds(groupIds);

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ entraOid: profile.oid }, { email: profile.email }] },
    });

    if (existing && !existing.isActive) {
      throw new ForbiddenException('account_disabled');
    }

    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { displayName: profile.displayName, entraOid: profile.oid, email: profile.email },
        })
      : await this.prisma.user.create({
          data: {
            email: profile.email,
            displayName: profile.displayName,
            entraOid: profile.oid,
            isActive: true,
          },
        });

    await this.syncUserRoles(user.id, roleIds);

    const roles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      select: { role: { select: { code: true } } },
    });

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      entraOid: user.entraOid,
      roleCodes: roles.map((r) => String(r.role.code)),
    };
  }

  /** 留存登入稽核紀錄（供 ISO 27001）。 */
  async recordLogin(p: {
    userId: string | null;
    email: string | null;
    entraOid: string | null;
    success: boolean;
    reason: string | null;
    ctx: LoginContext;
  }): Promise<void> {
    await this.prisma.loginAudit.create({
      data: {
        userId: p.userId ?? undefined,
        email: p.email ?? undefined,
        entraOid: p.entraOid ?? undefined,
        eventType: p.success ? AuthEventType.LOGIN_SUCCESS : AuthEventType.LOGIN_FAILURE,
        success: p.success,
        reason: p.reason ?? undefined,
        ipAddress: p.ctx.ip,
        userAgent: p.ctx.userAgent,
      },
    });
  }

  /** OAuth callback 主流程：換 token → 取身分/群組 → upsert → 簽發 session，並全程稽核。 */
  async handleCallback(
    code: string,
    ctx: LoginContext,
  ): Promise<{ token: string; user: SessionUser }> {
    let email: string | null = null;
    let entraOid: string | null = null;
    try {
      const tokens = await this.entra.exchangeCode(code);
      const profile = await this.entra.fetchProfile(tokens.access_token);
      email = profile.email;
      entraOid = profile.oid;
      const groupIds = await this.entra.fetchGroupIds(tokens.access_token);
      const result = await this.upsertUserFromProfile(profile, groupIds);

      await this.recordLogin({
        userId: result.userId,
        email: result.email,
        entraOid: result.entraOid,
        success: true,
        reason: null,
        ctx,
      });

      const sessionUser: SessionUser = {
        sub: result.userId,
        email: result.email,
        name: result.displayName,
        roles: result.roleCodes,
      };
      const token = signToken({ ...sessionUser }, this.config.sessionSecret, {
        expiresInSeconds: this.config.sessionTtlSeconds,
      });
      return { token, user: sessionUser };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown_error';
      this.logger.warn(`SSO login failed (${email ?? 'unknown'}): ${reason}`);
      await this
        .recordLogin({ userId: null, email, entraOid, success: false, reason, ctx })
        .catch(() => undefined);
      throw err;
    }
  }
}
