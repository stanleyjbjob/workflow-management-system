/**
 * 步驟卡（issue 2.2）。視覺對齊 prototype .flow-step（序號方塊 + 內容 + chip）。
 * 表單編輯維持原功能（名稱 / ISO 對應 / 必填 / 刪除）。
 */
import { ROLES, roleLabel } from './constants';
import type { RoleCode } from './constants';
import { nextStepOf } from './designer';
import type { StepDraft } from './types';

interface Props {
  step: StepDraft;
  allSteps: StepDraft[];
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<Omit<StepDraft, 'id' | 'order'>>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAddForm: () => void;
  onRemoveForm: (formId: string) => void;
  onChangeForm: (formId: string, patch: { name?: string; isRequired?: boolean; isoMapping?: string }) => void;
}

export function StepCard(props: Props): JSX.Element {
  const { step, allSteps, isFirst, isLast } = props;
  const next = nextStepOf(allSteps, step.id);

  return (
    <div className="flow-step">
      <div className="seq">{step.order}</div>
      <div className="body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span className="nm">
            步驟 {step.order}
            {step.isOptional && (
              <span className="pill p-grey" style={{ marginLeft: 6 }}>
                選擇性
              </span>
            )}
          </span>
          <span>
            <button className="btn sm" disabled={isFirst} onClick={() => props.onMove(-1)} title="上移">
              ↑
            </button>{' '}
            <button className="btn sm" disabled={isLast} onClick={() => props.onMove(1)} title="下移">
              ↓
            </button>{' '}
            <button className="btn sm" style={{ color: 'var(--red)' }} onClick={props.onRemove}>
              移除
            </button>
          </span>
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <div className="field" style={{ flex: 2, minWidth: 180, marginBottom: 8 }}>
            <label>步驟名稱</label>
            <input value={step.name} placeholder="如：建立商機" onChange={(e) => props.onChange({ name: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 8 }}>
            <label>負責角色</label>
            <select
              value={step.responsibleRole ?? ''}
              onChange={(e) => props.onChange({ responsibleRole: (e.target.value || null) as RoleCode | null })}
            >
              <option value="">未指定</option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 8 }}>
            <label>說明</label>
            <input value={step.description} onChange={(e) => props.onChange({ description: e.target.value })} />
          </div>
          <label className="muted" style={{ alignSelf: 'flex-end', whiteSpace: 'nowrap', fontSize: '12.5px', paddingBottom: 10 }}>
            <input type="checkbox" checked={step.isOptional} onChange={(e) => props.onChange({ isOptional: e.target.checked })} />{' '}
            選擇性步驟（可略過）
          </label>
        </div>

        <div className="field" style={{ marginBottom: 8 }}>
          <label>應填表單 / 應產出文件</label>
          {step.forms.length === 0 && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              尚未設定表單 / 產出。
            </div>
          )}
          {step.forms.map((f) => (
            <div key={f.id} className="row" style={{ marginBottom: 6, alignItems: 'center', gap: 8 }}>
              <input
                style={{ flex: 2, minWidth: 140 }}
                value={f.name}
                placeholder="表單 / 產出名稱"
                onChange={(e) => props.onChangeForm(f.id, { name: e.target.value })}
              />
              <input
                style={{ flex: 2, minWidth: 140 }}
                value={f.isoMapping}
                placeholder="ISO 27001 對應（選填）"
                onChange={(e) => props.onChangeForm(f.id, { isoMapping: e.target.value })}
              />
              <label className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={f.isRequired}
                  onChange={(e) => props.onChangeForm(f.id, { isRequired: e.target.checked })}
                />{' '}
                必填
              </label>
              <button className="btn sm" style={{ color: 'var(--red)' }} onClick={() => props.onRemoveForm(f.id)}>
                刪
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={props.onAddForm}>
            ＋ 新增表單 / 產出
          </button>
        </div>

        <div className="chip-set">
          <span className="chip role">👤 {roleLabel(step.responsibleRole)}</span>
          {step.forms.map((f) => (
            <span key={f.id} className="chip">
              📄 {f.name || '（未命名）'}
            </span>
          ))}
        </div>

        <div className="muted" style={{ fontSize: '12.5px', marginTop: 8 }}>
          完成後 →{' '}
          {next ? (
            <>
              步驟 {next.order}「{next.name || '（未命名）'}」（負責人：{roleLabel(next.responsibleRole)}）
            </>
          ) : (
            <>流程結束</>
          )}
        </div>
      </div>
    </div>
  );
}
