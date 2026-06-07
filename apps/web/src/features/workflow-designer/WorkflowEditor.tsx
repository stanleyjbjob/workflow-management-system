/**
 * 流程編輯器（issue 2.2）。視覺對齊 prototype view-designer：
 * .designer 兩欄 — 左：步驟卡（StepCard，.flow-step）+ .add-step；右：流程設定卡 + 驗證結果。
 * 邏輯（designer.ts 純函式）不變。
 */
import { DEFER_STRATEGIES, FLOW_TYPES, ROLES } from './constants';
import type { DeferStrategy, FlowType, RoleCode } from './constants';
import {
  addForm,
  addStep,
  moveStep,
  removeForm,
  removeStep,
  updateForm,
  updateStep,
  validateWorkflow,
} from './designer';
import { StepCard } from './StepCard';
import type { StepDraft, WorkflowDraft } from './types';

interface Props {
  workflow: WorkflowDraft;
  onChange: (wf: WorkflowDraft) => void;
  onSave: () => void;
  onDelete: () => void;
  savedAt: string | null;
}

export function WorkflowEditor(props: Props): JSX.Element {
  const { workflow: wf } = props;
  const { errors, warnings } = validateWorkflow(wf);

  const patch = (p: Partial<WorkflowDraft>): void => props.onChange({ ...wf, ...p });
  const setSteps = (steps: StepDraft[]): void => patch({ steps });

  return (
    <div className="designer">
      {/* 左欄：步驟 */}
      <div>
        <div className="sec-title" style={{ fontSize: 14 }}>
          步驟（{wf.steps.length}）
        </div>
        {wf.steps.map((s, i) => (
          <div key={s.id}>
            {i > 0 && <div className="flow-conn" />}
            <StepCard
              step={s}
              allSteps={wf.steps}
              isFirst={i === 0}
              isLast={i === wf.steps.length - 1}
              onChange={(p) => setSteps(updateStep(wf.steps, s.id, p))}
              onMove={(dir) => setSteps(moveStep(wf.steps, s.id, dir))}
              onRemove={() => setSteps(removeStep(wf.steps, s.id))}
              onAddForm={() => setSteps(addForm(wf.steps, s.id))}
              onRemoveForm={(fid) => setSteps(removeForm(wf.steps, s.id, fid))}
              onChangeForm={(fid, p) => setSteps(updateForm(wf.steps, s.id, fid, p))}
            />
          </div>
        ))}
        {wf.steps.length > 0 && <div className="flow-conn" />}
        <div
          className="add-step"
          onClick={() => setSteps(addStep(wf.steps))}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setSteps(addStep(wf.steps));
          }}
        >
          ＋ 新增步驟
        </div>
      </div>

      {/* 右欄：流程設定 */}
      <div>
        <div className="card pad">
          <div className="sec-title" style={{ fontSize: 14 }}>
            流程設定
          </div>
          <div className="field">
            <label>流程名稱</label>
            <input value={wf.name} placeholder="如：銷售流程（標準）" onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="field">
            <label>流程類型</label>
            <select value={wf.flowType} onChange={(e) => patch({ flowType: e.target.value as FlowType })}>
              {FLOW_TYPES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>版本</label>
            <input
              type="number"
              min={1}
              value={wf.version}
              onChange={(e) => patch({ version: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          <div className="field">
            <label>描述</label>
            <input value={wf.description} onChange={(e) => patch({ description: e.target.value })} />
          </div>
          <div className="field">
            <label>觸發角色（發起人）</label>
            <select
              value={wf.trigger.initiatorRole ?? ''}
              onChange={(e) => patch({ trigger: { ...wf.trigger, initiatorRole: (e.target.value || null) as RoleCode | null } })}
            >
              <option value="">未指定</option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>觸發條件</label>
            <input
              value={wf.trigger.condition}
              placeholder="如：銷售成案後移交顧問"
              onChange={(e) => patch({ trigger: { ...wf.trigger, condition: e.target.value } })}
            />
          </div>
          <div className="field">
            <label>行事曆規則</label>
            <label className="muted" style={{ display: 'block', fontWeight: 400, marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={wf.calendar.deferOnHoliday}
                onChange={(e) => patch({ calendar: { ...wf.calendar, deferOnHoliday: e.target.checked } })}
              />{' '}
              遇假日 / 連假自動遞延
            </label>
            <select
              value={wf.calendar.deferStrategy}
              disabled={!wf.calendar.deferOnHoliday}
              onChange={(e) => patch({ calendar: { ...wf.calendar, deferStrategy: e.target.value as DeferStrategy } })}
            >
              {DEFER_STRATEGIES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>行事曆 / ISO 備註</label>
            <input value={wf.calendar.note} onChange={(e) => patch({ calendar: { ...wf.calendar, note: e.target.value } })} />
          </div>
          <label className="muted" style={{ fontSize: '12.5px' }}>
            <input type="checkbox" checked={wf.isActive} onChange={(e) => patch({ isActive: e.target.checked })} />{' '}
            啟用（可套用於新案件）
          </label>
          <div className="muted" style={{ fontSize: '11.5px', marginTop: 10 }}>
            變更會套用至此流程未來建立的新案件。
          </div>
        </div>

        <div className="card pad" style={{ marginTop: 16 }}>
          <div className="sec-title" style={{ fontSize: 14 }}>
            驗證與儲存
          </div>
          {errors.length === 0 && warnings.length === 0 && (
            <div className="muted" style={{ fontSize: '12.5px', marginBottom: 8 }}>
              ✅ 通過驗證
            </div>
          )}
          {errors.map((e, i) => (
            <div key={`e${i}`} style={{ color: 'var(--red)', fontSize: '12.5px', marginBottom: 4 }}>
              ⛔ {e}
            </div>
          ))}
          {warnings.map((w, i) => (
            <div key={`w${i}`} style={{ color: 'var(--amber)', fontSize: '12.5px', marginBottom: 4 }}>
              ⚠ {w}
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={errors.length > 0} onClick={props.onSave}>
              💾 儲存流程定義
            </button>{' '}
            <button className="btn" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={props.onDelete}>
              刪除此流程
            </button>
          </div>
          {props.savedAt && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              已儲存：{props.savedAt}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
