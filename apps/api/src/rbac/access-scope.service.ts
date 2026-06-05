import { ForbiddenException, Injectable } from '@nestjs/common';
import { FlowType } from '@prisma/client';
import { SessionUser } from '../auth/auth.service';
import { isManager, visibleFlowTypesForRoles } from './permissions';

/** 可直接展開進 Prisma `where` 的篩選物件（型別保持寬鬆，避免耦合產生的 Prisma 命名空間）。 */
export type ScopeWhere = Record<string, unknown>;

/** 判斷案件可見性所需的最小欄位。 */
export interface CaseScopeRef {
  flowType: FlowType;
  assigneeId?: string | null;
  createdById?: string | null;
}

/** 判斷專案可見性所需的最小欄位。 */
export interface ProjectScopeRef {
  ownerId?: string | null;
  createdById?: string | null;
}

/**
 * 可見範圍服務：依使用者角色推導「可見哪些資料」。
 * 設計重點（對應 §8.5）：
 * - 部門主管（MANAGER）綜覽全部 → 回傳空篩選（不加限制）。
 * - 其他角色：自己經手（assignee/createdBy/owner）的資料一律可見，
 *   另加上該角色負責的流程型別（FLOW_VISIBILITY）之案件。
 * 這些方法回傳 Prisma where 片段，供後續 WBS 的 case/project/workflow 查詢直接套用。
 */
@Injectable()
export class AccessScopeService {
  /** 是否為可綜覽全部的主管。 */
  isManager(user: SessionUser): boolean {
    return isManager(user.roles);
  }

  /** 使用者可見的流程型別清單。 */
  visibleFlowTypes(user: SessionUser): FlowType[] {
    return visibleFlowTypesForRoles(user.roles);
  }

  /** 案件查詢的可見範圍 where。主管回傳 {}（全部）。 */
  caseWhere(user: SessionUser): ScopeWhere {
    if (this.isManager(user)) return {};
    const flowTypes = this.visibleFlowTypes(user);
    const or: ScopeWhere[] = [{ assigneeId: user.sub }, { createdById: user.sub }];
    if (flowTypes.length > 0) or.push({ flowType: { in: flowTypes } });
    return { OR: or };
  }

  /** 專案查詢的可見範圍 where。主管回傳 {}（全部）；其餘為自己擁有或建立。 */
  projectWhere(user: SessionUser): ScopeWhere {
    if (this.isManager(user)) return {};
    return { OR: [{ ownerId: user.sub }, { createdById: user.sub }] };
  }

  /** 工作流程定義查詢的可見範圍 where。主管全部；其餘僅可見其負責流程型別。 */
  workflowWhere(user: SessionUser): ScopeWhere {
    if (this.isManager(user)) return {};
    const flowTypes = this.visibleFlowTypes(user);
    return { flowType: { in: flowTypes } };
  }

  /** 是否可檢視某案件（主管恆可；經手者可；流程型別在可見清單內可）。 */
  canViewCase(user: SessionUser, ref: CaseScopeRef): boolean {
    if (this.isManager(user)) return true;
    if (ref.assigneeId && ref.assigneeId === user.sub) return true;
    if (ref.createdById && ref.createdById === user.sub) return true;
    return this.visibleFlowTypes(user).includes(ref.flowType);
  }

  /** 不可檢視則丟出 ForbiddenException。 */
  assertCanViewCase(user: SessionUser, ref: CaseScopeRef): void {
    if (!this.canViewCase(user, ref)) {
      throw new ForbiddenException('case_not_visible');
    }
  }

  /** 是否可檢視某專案（主管恆可；擁有者或建立者可）。 */
  canViewProject(user: SessionUser, ref: ProjectScopeRef): boolean {
    if (this.isManager(user)) return true;
    if (ref.ownerId && ref.ownerId === user.sub) return true;
    if (ref.createdById && ref.createdById === user.sub) return true;
    return false;
  }

  /** 不可檢視則丟出 ForbiddenException。 */
  assertCanViewProject(user: SessionUser, ref: ProjectScopeRef): void {
    if (!this.canViewProject(user, ref)) {
      throw new ForbiddenException('project_not_visible');
    }
  }
}
