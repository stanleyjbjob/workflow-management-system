/**
 * 專案維護面板（issue 8.10 #45）：選定專案的編輯／狀態／刪除、流程掛載維護、
 * 排除日維護（§10.5）、排除日×流程衝突警示（§9-6 A 案：僅警示、由使用者決定）、
 * 延遲／超前清單（§4.2–§4.4）。呈現於甘特圖下方；所有寫入透過上層 `onMutate` 完成後重載。
 */
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DelayReport, ExclusionRecord, FlowConflict, ProjectFlowRecord, ProjectRecord } from './api';
import {
  changeProjectStatus,
  deleteProject,
  addExclusion,
  isoDay,
  mountFlow,
  refreshFlowProgress,
  removeExclusion,
  unmountFlow,
  updateExclusion,
  updateFlowWindow,
  updateProject,
} from './api';
import {
  EMPTY_EXCLUSION_FORM,
  EMPTY_MOUNT_FORM,
  EXCLUSION_SOURCE_LABEL,
  FLOW_TYPE_LABEL,
  FLOW_TYPE_OPTIONS,
  PROJECT_STATUS_LABEL,
  allowedStatusTargets,
  validateExclusionForm,
  validateMountForm,
  validateProjectForm,
  type ExclusionFormState,
  type MountFormState,
  type ProjectFormState,
} from './manage';
import { ui } from './styles';

const panel: CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: '0.75rem 0.9rem', marginTop: '0.9rem' };
const h3: CSSProperties = { margin: '0 0 0.5rem', fontSize: '0.95rem' };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' };
const th: CSSProperties = { textAlign: 'left', color: '#64748b', fontWeight: 500, padding: '0.25rem 0.4rem', borderBottom: '1px solid #e2e8f0' };
const td: CSSProperties = { padding: '0.3rem 0.4rem', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' };
const input: CSSProperties = { padding: '0.3rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: 5, fontSize: '0.83rem' };
const errText: CSSProperties = { color: '#b91c1c', fontSize: '0.8rem', margin: '0.3rem 0' };
const smallBtn: CSSProperties = { ...ui.btn, padding: '0.2rem 0.55rem', fontSize: '0.8rem' };

const STATUS_TONE: Record<string, string> = { DELAYED: '#b91c1c', AHEAD: '#047857', ON_TIME: '#2563eb', COMPLETED: '#475569', NOT_STARTED: '#94a3b8' };
const STATUS_TEXT: Record<string, string> = { DELAYED: '延遲', AHEAD: '超前', ON_TIME: '準時', COMPLETED: '已完成', NOT_STARTED: '未開始' };

function Errors({ errors }: { errors: string[] }): JSX.Element | null {
  if (errors.length === 0) return null;
  return <p style={errText}>{errors.join('；')}</p>;
}

/** 將 unknown 錯誤轉為可顯示文字（ApiError.message 已含後端訊息）。 */
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface ProjectManagePanelProps {
  project: ProjectRecord;
  delays: DelayReport | null;
  conflicts: FlowConflict[];
  /** 任一寫入成功後呼叫（上層重載清單與甘特）。deleted=true 表示專案已刪除。 */
  onMutate: (opts?: { deleted?: boolean }) => void;
}

export function ProjectManagePanel({ project, delays, conflicts, onMutate }: ProjectManagePanelProps): JSX.Element {
  return (
    <div>
      <ConflictAlert conflicts={conflicts} />
      <DelaysSection delays={delays} />
      <FlowsSection project={project} onMutate={onMutate} />
      <ExclusionsSection project={project} onMutate={onMutate} />
      <ProjectEditSection project={project} onMutate={onMutate} />
    </div>
  );
}

// ---- 排除日×流程衝突警示（§9-6 A 案） ----

function ConflictAlert({ conflicts }: { conflicts: FlowConflict[] }): JSX.Element | null {
  if (conflicts.length === 0) return null;
  return (
    <section style={{ ...panel, borderColor: '#fbbf24', background: '#fffbeb' }}>
      <h3 style={{ ...h3, color: '#92400e' }}>排除日與流程計畫期間重疊警示（不自動順延，請自行評估是否調整計畫）</h3>
      <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.83rem', color: '#92400e' }}>
        {conflicts.map((c) => (
          <li key={c.flowId}>
            <strong>{c.name ?? c.flowId}</strong>（{isoDay(c.planStart)} ~ {isoDay(c.planEnd)}）共 {c.overlapCalendarDays} 天落於排除日：
            {c.conflicts
              .map((x) => `${isoDay(x.overlapFrom)}~${isoDay(x.overlapTo)}（${x.reason ?? '未填原因'}，${x.overlapCalendarDays} 天）`)
              .join('、')}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- 延遲／超前清單 ----

function DelaysSection({ delays }: { delays: DelayReport | null }): JSX.Element {
  return (
    <section style={panel}>
      <h3 style={h3}>各流程延遲／超前{delays ? `（差異天數基準：${delays.basis === 'WORKDAY' ? '工作日' : '日曆日'}）` : ''}</h3>
      {!delays || delays.rows.length === 0 ? (
        <p style={ui.muted}>尚無掛載流程，無延遲資料。</p>
      ) : (
        <>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>流程</th>
                <th style={th}>計畫期間</th>
                <th style={th}>預期/實際</th>
                <th style={th}>差異</th>
                <th style={th}>差異天數</th>
                <th style={th}>狀態</th>
              </tr>
            </thead>
            <tbody>
              {delays.rows.map((r, i) => (
                <tr key={r.id ?? i}>
                  <td style={td}>{r.name ?? '-'}</td>
                  <td style={td}>{isoDay(r.planStart)} ~ {isoDay(r.planEnd)}</td>
                  <td style={td}>{r.expected}% / {r.actual}%</td>
                  <td style={{ ...td, color: r.deltaPercent < 0 ? '#b91c1c' : r.deltaPercent > 0 ? '#047857' : undefined }}>
                    {r.deltaPercent > 0 ? `+${r.deltaPercent}` : r.deltaPercent} 點
                  </td>
                  <td style={td}>{r.delayDays > 0 ? `落後 ${r.delayDays} 天` : r.aheadDays > 0 ? `超前 ${r.aheadDays} 天` : '—'}</td>
                  <td style={{ ...td, color: STATUS_TONE[r.status], fontWeight: 600 }}>{STATUS_TEXT[r.status] ?? r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ ...ui.muted, marginTop: '0.4rem' }}>
            共 {delays.summary.total} 條：延遲 {delays.summary.delayedCount}、超前 {delays.summary.aheadCount}、準時 {delays.summary.onTimeCount}、
            已完成 {delays.summary.completedCount}、未開始 {delays.summary.notStartedCount}；最大落後 {delays.summary.maxDelayDays} 天。
          </p>
        </>
      )}
    </section>
  );
}

// ---- 掛載流程維護 ----

function FlowsSection({ project, onMutate }: { project: ProjectRecord; onMutate: ProjectManagePanelProps['onMutate'] }): JSX.Element {
  const [form, setForm] = useState<MountFormState>(EMPTY_MOUNT_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ planStart: '', planEnd: '', progress: '' });

  const run = (fn: () => Promise<unknown>): void => {
    setBusy(true);
    setErrors([]);
    fn()
      .then(() => {
        setBusy(false);
        setForm(EMPTY_MOUNT_FORM);
        setEditing(null);
        onMutate();
      })
      .catch((e: unknown) => {
        setBusy(false);
        setErrors([errMessage(e)]);
      });
  };

  const submitMount = (): void => {
    const r = validateMountForm(form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    run(() => mountFlow(project.id, r.payload));
  };

  const startEdit = (f: ProjectFlowRecord): void => {
    setEditing(f.id);
    setEditDraft({ planStart: isoDay(f.planStart), planEnd: isoDay(f.planEnd), progress: String(f.progress) });
  };

  const submitEdit = (flowId: string): void => {
    const progress = Number(editDraft.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      setErrors(['進度需為 0..100 的數值']);
      return;
    }
    if (editDraft.planEnd < editDraft.planStart) {
      setErrors(['計畫結束日不可早於開始日']);
      return;
    }
    run(() => updateFlowWindow(flowId, { planStart: editDraft.planStart, planEnd: editDraft.planEnd, progress: Math.round(progress) }));
  };

  return (
    <section style={panel}>
      <h3 style={h3}>掛載流程（{project.flows.length}）</h3>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>流程</th>
            <th style={th}>型別</th>
            <th style={th}>案件</th>
            <th style={th}>計畫期間</th>
            <th style={th}>進度</th>
            <th style={th}>操作</th>
          </tr>
        </thead>
        <tbody>
          {project.flows.map((f) => (
            <tr key={f.id}>
              <td style={td}>{f.name}</td>
              <td style={td}>{FLOW_TYPE_LABEL[f.flowType] ?? f.flowType}</td>
              <td style={td}>{f.caseId ?? '—'}</td>
              <td style={td}>
                {editing === f.id ? (
                  <>
                    <input type="date" style={input} value={editDraft.planStart} onChange={(e) => setEditDraft((d) => ({ ...d, planStart: e.target.value }))} />
                    {' ~ '}
                    <input type="date" style={input} value={editDraft.planEnd} onChange={(e) => setEditDraft((d) => ({ ...d, planEnd: e.target.value }))} />
                  </>
                ) : (
                  `${isoDay(f.planStart)} ~ ${isoDay(f.planEnd)}`
                )}
              </td>
              <td style={td}>
                {editing === f.id ? (
                  <input style={{ ...input, width: 60 }} value={editDraft.progress} onChange={(e) => setEditDraft((d) => ({ ...d, progress: e.target.value }))} />
                ) : (
                  `${f.progress}%`
                )}
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                {editing === f.id ? (
                  <>
                    <button style={{ ...smallBtn, ...ui.btnPrimary }} disabled={busy} onClick={() => submitEdit(f.id)}>儲存</button>{' '}
                    <button style={smallBtn} disabled={busy} onClick={() => setEditing(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <button style={smallBtn} disabled={busy} onClick={() => startEdit(f)}>編輯</button>{' '}
                    {f.caseId && (
                      <>
                        <button style={smallBtn} disabled={busy} title="依案件步驟完成比例回寫進度" onClick={() => run(() => refreshFlowProgress(f.id))}>重算進度</button>{' '}
                      </>
                    )}
                    <button
                      style={smallBtn}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`移除掛載「${f.name}」？（不會刪除案件本身）`)) run(() => unmountFlow(f.id));
                      }}
                    >
                      移除
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {project.flows.length === 0 && (
            <tr>
              <td style={td} colSpan={6}><span style={ui.muted}>尚未掛載任何流程。</span></td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={{ ...ui.toolbar, marginTop: '0.6rem', marginBottom: 0 }}>
        <input style={input} placeholder="案件 ID（可空）" value={form.caseId} onChange={(e) => setForm((s) => ({ ...s, caseId: e.target.value }))} />
        <select style={input} value={form.flowType} onChange={(e) => setForm((s) => ({ ...s, flowType: e.target.value as MountFormState['flowType'] }))}>
          <option value="">流程型別（依案件帶出）</option>
          {FLOW_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{FLOW_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <input style={input} placeholder="流程名稱（依案件帶出）" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        <input type="date" style={input} value={form.planStart} onChange={(e) => setForm((s) => ({ ...s, planStart: e.target.value }))} />
        <span style={ui.muted}>~</span>
        <input type="date" style={input} value={form.planEnd} onChange={(e) => setForm((s) => ({ ...s, planEnd: e.target.value }))} />
        <input style={{ ...input, width: 90 }} placeholder="進度 %" value={form.progress} onChange={(e) => setForm((s) => ({ ...s, progress: e.target.value }))} />
        <button style={{ ...ui.btn, ...ui.btnPrimary }} disabled={busy} onClick={submitMount}>掛載流程</button>
      </div>
      <Errors errors={errors} />
    </section>
  );
}

// ---- 排除日維護（§10.5） ----

function ExclusionsSection({ project, onMutate }: { project: ProjectRecord; onMutate: ProjectManagePanelProps['onMutate'] }): JSX.Element {
  const [form, setForm] = useState<ExclusionFormState>(EMPTY_EXCLUSION_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ExclusionFormState>(EMPTY_EXCLUSION_FORM);

  const run = (fn: () => Promise<unknown>): void => {
    setBusy(true);
    setErrors([]);
    fn()
      .then(() => {
        setBusy(false);
        setForm(EMPTY_EXCLUSION_FORM);
        setEditing(null);
        onMutate();
      })
      .catch((e: unknown) => {
        setBusy(false);
        setErrors([errMessage(e)]);
      });
  };

  const submitAdd = (): void => {
    const r = validateExclusionForm(form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    run(() => addExclusion(project.id, r.payload));
  };

  const startEdit = (x: ExclusionRecord): void => {
    setEditing(x.id);
    setEditDraft({ fromDate: isoDay(x.fromDate), toDate: isoDay(x.toDate), reason: x.reason, source: x.source ?? '' });
  };

  const submitEdit = (id: string): void => {
    const r = validateExclusionForm(editDraft);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    run(() => updateExclusion(id, r.payload));
  };

  const fields = (state: ExclusionFormState, set: (f: ExclusionFormState) => void): ReactNode => (
    <>
      <input type="date" style={input} value={state.fromDate} onChange={(e) => set({ ...state, fromDate: e.target.value })} />
      <span style={ui.muted}>~</span>
      <input type="date" style={input} value={state.toDate} onChange={(e) => set({ ...state, toDate: e.target.value })} />
      <input style={input} placeholder="原因" value={state.reason} onChange={(e) => set({ ...state, reason: e.target.value })} />
      <select style={input} value={state.source} onChange={(e) => set({ ...state, source: e.target.value as ExclusionFormState['source'] })}>
        <option value="">來源（可空）</option>
        <option value="CUSTOMER">{EXCLUSION_SOURCE_LABEL.CUSTOMER}</option>
        <option value="INTERNAL">{EXCLUSION_SOURCE_LABEL.INTERNAL}</option>
      </select>
    </>
  );

  return (
    <section style={panel}>
      <h3 style={h3}>專案排除日（{project.exclusions.length}）</h3>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>期間</th>
            <th style={th}>原因</th>
            <th style={th}>來源</th>
            <th style={th}>操作</th>
          </tr>
        </thead>
        <tbody>
          {project.exclusions.map((x) => (
            <tr key={x.id}>
              {editing === x.id ? (
                <td style={td} colSpan={3}>
                  <div style={{ ...ui.toolbar, marginBottom: 0 }}>{fields(editDraft, setEditDraft)}</div>
                </td>
              ) : (
                <>
                  <td style={td}>{isoDay(x.fromDate)} ~ {isoDay(x.toDate)}</td>
                  <td style={td}>{x.reason}</td>
                  <td style={td}>{x.source ? EXCLUSION_SOURCE_LABEL[x.source] : '—'}</td>
                </>
              )}
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                {editing === x.id ? (
                  <>
                    <button style={{ ...smallBtn, ...ui.btnPrimary }} disabled={busy} onClick={() => submitEdit(x.id)}>儲存</button>{' '}
                    <button style={smallBtn} disabled={busy} onClick={() => setEditing(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <button style={smallBtn} disabled={busy} onClick={() => startEdit(x)}>編輯</button>{' '}
                    <button
                      style={smallBtn}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm('移除此排除日？')) run(() => removeExclusion(x.id));
                      }}
                    >
                      移除
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {project.exclusions.length === 0 && (
            <tr>
              <td style={td} colSpan={4}><span style={ui.muted}>尚無排除日。</span></td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={{ ...ui.toolbar, marginTop: '0.6rem', marginBottom: 0 }}>
        {fields(form, setForm)}
        <button style={{ ...ui.btn, ...ui.btnPrimary }} disabled={busy} onClick={submitAdd}>新增排除日</button>
      </div>
      <Errors errors={errors} />
    </section>
  );
}

// ---- 專案編輯 / 狀態 / 刪除 ----

function ProjectEditSection({ project, onMutate }: { project: ProjectRecord; onMutate: ProjectManagePanelProps['onMutate'] }): JSX.Element {
  const [form, setForm] = useState<ProjectFormState>({
    name: project.name,
    client: project.client,
    ownerId: project.ownerId,
    planStart: isoDay(project.planStart),
    planEnd: isoDay(project.planEnd),
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const targets = allowedStatusTargets(project.status);

  const run = (fn: () => Promise<unknown>, opts?: { deleted?: boolean }): void => {
    setBusy(true);
    setErrors([]);
    fn()
      .then(() => {
        setBusy(false);
        onMutate(opts);
      })
      .catch((e: unknown) => {
        setBusy(false);
        setErrors([errMessage(e)]);
      });
  };

  const submitSave = (): void => {
    const r = validateProjectForm(form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    run(() => updateProject(project.id, r.payload));
  };

  return (
    <section style={panel}>
      <h3 style={h3}>
        專案基本資料{' '}
        <span style={{ ...ui.muted, fontWeight: 400 }}>
          （{project.code}，狀態：{PROJECT_STATUS_LABEL[project.status]}
          {project.owner ? `，負責人：${project.owner.displayName}` : ''}）
        </span>
      </h3>
      <div style={{ ...ui.toolbar, marginBottom: '0.5rem' }}>
        <input style={input} placeholder="專案名稱" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        <input style={input} placeholder="客戶名稱" value={form.client} onChange={(e) => setForm((s) => ({ ...s, client: e.target.value }))} />
        <input style={{ ...input, width: 200 }} placeholder="負責人（使用者 ID）" value={form.ownerId} onChange={(e) => setForm((s) => ({ ...s, ownerId: e.target.value }))} />
        <input type="date" style={input} value={form.planStart} onChange={(e) => setForm((s) => ({ ...s, planStart: e.target.value }))} />
        <span style={ui.muted}>~</span>
        <input type="date" style={input} value={form.planEnd} onChange={(e) => setForm((s) => ({ ...s, planEnd: e.target.value }))} />
        <button style={{ ...ui.btn, ...ui.btnPrimary }} disabled={busy} onClick={submitSave}>儲存變更</button>
      </div>
      <div style={{ ...ui.toolbar, marginBottom: 0 }}>
        {targets.length > 0 ? (
          targets.map((t) => (
            <button key={t} style={smallBtn} disabled={busy} onClick={() => run(() => changeProjectStatus(project.id, t))}>
              轉為「{PROJECT_STATUS_LABEL[t]}」
            </button>
          ))
        ) : (
          <span style={ui.muted}>已為終態（{PROJECT_STATUS_LABEL[project.status]}），不可再變更狀態。</span>
        )}
        <span style={ui.spacer} />
        <button
          style={{ ...smallBtn, borderColor: '#fca5a5', color: '#b91c1c' }}
          disabled={busy}
          onClick={() => {
            if (window.confirm(`刪除專案「${project.name}」？將連帶刪除流程掛載與排除日（不刪除案件本身），且需要主管權限。`)) {
              run(() => deleteProject(project.id), { deleted: true });
            }
          }}
        >
          刪除專案
        </button>
      </div>
      <Errors errors={errors} />
    </section>
  );
}
