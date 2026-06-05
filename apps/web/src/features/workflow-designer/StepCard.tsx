import { ROLES, roleLabel } from './constants';
import type { RoleCode } from './constants';
import { nextStepOf } from './designer';
import type { StepDraft } from './types';
import { ui } from './styles';

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
    <div style={ui.card}>
      <div style={{ ...ui.row, alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>
          步驟 {step.order}
          {step.isOptional && <span style={ui.pill}>選擇性</span>}
        </strong>
        <span>
          <button style={ui.btn} disabled={isFirst} onClick={() => props.onMove(-1)} title="上移">
            ↑
          </button>{' '}
          <button style={ui.btn} disabled={isLast} onClick={() => props.onMove(1)} title="下移">
            ↓
          </button>{' '}
          <button style={{ ...ui.btn, ...ui.btnDanger }} onClick={props.onRemove}>
            移除
          </button>
        </span>
      </div>

      <div style={ui.row}>
        <div style={{ flex: 2, minWidth: 180 }}>
          <label style={ui.label}>步驟名稱</label>
          <input
            style={ui.input}
            value={step.name}
            placeholder="如：建立商機"
            onChange={(e) => props.onChange({ name: e.target.value })}
          />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={ui.label}>負責角色</label>
          <select
            style={ui.input}
            value={step.responsibleRole ?? ''}
            onChange={(e) =>
              props.onChange({ responsibleRole: (e.target.value || null) as RoleCode | null })
            }
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

      <div style={ui.row}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={ui.label}>說明</label>
          <input
            style={ui.input}
            value={step.description}
            onChange={(e) => props.onChange({ description: e.target.value })}
          />
        </div>
        <label style={{ ...ui.muted, alignSelf: 'flex-end', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={step.isOptional}
            onChange={(e) => props.onChange({ isOptional: e.target.checked })}
          />{' '}
          選擇性步驟（可略過）
        </label>
      </div>

      <div>
        <label style={ui.label}>應填表單 / 應產出文件</label>
        {step.forms.length === 0 && <div style={ui.muted}>尚未設定表單 / 產出。</div>}
        {step.forms.map((f) => (
          <div key={f.id} style={{ ...ui.row, marginBottom: 4 }}>
            <input
              style={{ ...ui.input, flex: 2, minWidth: 140 }}
              value={f.name}
              placeholder="表單 / 產出名稱"
              onChange={(e) => props.onChangeForm(f.id, { name: e.target.value })}
            />
            <input
              style={{ ...ui.input, flex: 2, minWidth: 140 }}
              value={f.isoMapping}
              placeholder="ISO 27001 對應（選填）"
              onChange={(e) => props.onChangeForm(f.id, { isoMapping: e.target.value })}
            />
            <label style={{ ...ui.muted, alignSelf: 'center', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={f.isRequired}
                onChange={(e) => props.onChangeForm(f.id, { isRequired: e.target.checked })}
              />{' '}
              必填
            </label>
            <button style={{ ...ui.btn, ...ui.btnDanger }} onClick={() => props.onRemoveForm(f.id)}>
              刪
            </button>
          </div>
        ))}
        <button style={ui.btn} onClick={props.onAddForm}>
          + 新增表單 / 產出
        </button>
      </div>

      <div style={ui.nextLine}>
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
  );
}
