import { useState } from 'react';
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
import { ui } from './styles';

interface Props {
  workflow: WorkflowDraft;
  onChange: (wf: WorkflowDraft) => void;
  onSave: () => void;
  onDelete: () => void;
  savedAt: string | null;
}

export function WorkflowEditor(props: Props): JSX.Element {
  const { workflow: wf } = props;
  const [showSeedNote] = useState(false);
  void showSeedNote;
  const { errors, warnings } = validateWorkflow(wf);

  const patch = (p: Partial<WorkflowDraft>): void => props.onChange({ ...wf, ...p });
  const setSteps = (steps: StepDraft[]): void => patch({ steps });

  return (
    <div style={ui.editor}>
      <div style={ui.row}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label style={ui.label}>流程名稱</label>
          <input style={ui.input} value={wf.name} placeholder="如：銷售流程（標準）"
            onChange={(e) => patch({ name: e.target.value })} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={ui.label}>流程類型</label>
          <select style={ui.input} value={wf.flowType}
            onChange={(e) => patch({ flowType: e.target.value as FlowType })}>
            {FLOW_TYPES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '0 0 90px' }}>
          <label style={ui.label}>版本</label>
          <input style={ui.input} type="number" min={1} value={wf.version}
            onChange={(e) => patch({ version: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
      </div>

      <div style={ui.row}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label style={ui.label}>描述</label>
          <input style={ui.input} value={wf.description}
            onChange={(e) => patch({ description: e.target.value })} />
        </div>
        <label style={{ ...ui.muted, alignSelf: 'flex-end', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={wf.isActive}
            onChange={(e) => patch({ isActive: e.target.checked })} /> 啟用（可套用於新案件）
        </label>
      </div>

      <fieldset style={{ ...ui.card, marginTop: '0.25rem' }}>
        <legend>流程設定</legend>
        <div style={ui.row}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={ui.label}>觸發角色（發起人）</label>
            <select style={ui.input} value={wf.trigger.initiatorRole ?? ''}
              onChange={(e) => patch({ trigger: { ...wf.trigger, initiatorRole: (e.target.value || null) as RoleCode | null } })}>
              <option value="">未指定</option>
              {ROLES.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
            </select>
          </div>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label style={ui.label}>觸發條件</label>
            <input style={ui.input} value={wf.trigger.condition} placeholder="如：銷售成案後移交顧問"
              onChange={(e) => patch({ trigger: { ...wf.trigger, condition: e.target.value } })} />
          </div>
        </div>
        <div style={ui.row}>
          <label style={{ ...ui.muted, alignSelf: 'center', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={wf.calendar.deferOnHoliday}
              onChange={(e) => patch({ calendar: { ...wf.calendar, deferOnHoliday: e.target.checked } })} /> 遇假日 / 連假自動遞延
          </label>
          <div style={{ flex: '0 0 200px' }}>
            <label style={ui.label}>遞延策略</label>
            <select style={ui.input} value={wf.calendar.deferStrategy} disabled={!wf.calendar.deferOnHoliday}
              onChange={(e) => patch({ calendar: { ...wf.calendar, deferStrategy: e.target.value as DeferStrategy } })}>
              {DEFER_STRATEGIES.map((d) => (<option key={d.value} value={d.value}>{d.label}</option>))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={ui.label}>行事曆 / ISO 備註</label>
            <input style={ui.input} value={wf.calendar.note}
              onChange={(e) => patch({ calendar: { ...wf.calendar, note: e.target.value } })} />
          </div>
        </div>
      </fieldset>

      <h3 style={{ marginBottom: '0.4rem' }}>步驟（{wf.steps.length}）</h3>
      {wf.steps.map((s, i) => (
        <StepCard
          key={s.id}
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
      ))}
      <button style={ui.btn} onClick={() => setSteps(addStep(wf.steps))}>+ 新增步驟</button>

      <div style={{ ...ui.card, marginTop: '1rem' }}>
        {errors.map((e, i) => (<div key={`e${i}`} style={ui.err}>⛔ {e}</div>))}
        {warnings.map((w, i) => (<div key={`w${i}`} style={ui.warn}>⚠ {w}</div>))}
        <div style={{ marginTop: '0.5rem' }}>
          <button style={{ ...ui.btn, ...ui.btnPrimary }} disabled={errors.length > 0} onClick={props.onSave}>
            儲存流程定義
          </button>{' '}
          <button style={{ ...ui.btn, ...ui.btnDanger }} onClick={props.onDelete}>刪除此流程</button>
          {props.savedAt && <span style={{ ...ui.muted, marginLeft: 8 }}>已儲存：{props.savedAt}</span>}
        </div>
      </div>
    </div>
  );
}
