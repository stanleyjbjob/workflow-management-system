/**
 * 專案進度頁（issue 8.10 #45）：以 REST `/projects` 系列驅動（取代 seed）。
 *
 * - 專案清單 / 選擇器接 `GET /projects`；選定後並行載入專案（含流程/排除日）、甘特
 *   （`GET /projects/:id/gantt`）、延遲（`GET /projects/:id/delays`）、衝突警示
 *   （`GET /projects/:id/exclusion-conflicts`）。
 * - 「重新整理（fresh）」以 fresh=true 先依案件步驟比例回寫各流程進度再重算（§6.2）。
 * - 重載期間保留現有畫面（淡化），以遞增序號防過時回應覆蓋（沿用 8.9 TaskKanbanPage 慣例）。
 * - 建立專案表單於清單上方；其餘維護（編輯/狀態/刪除/掛載/排除日）在 ProjectManagePanel。
 * - 甘特圖 / 簡報模式 / 案件雙向導覽沿用 ProjectWorkspace（案件側欄改接 `/cases/:id/detail`
 *   屬第二階段，現仍為 seed 範例對照）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, ErrorState, LoadingState, toErrorState, type NormalizedError } from '../../components/AsyncStates';
import {
  createProject,
  fetchExclusionConflicts,
  fetchProject,
  fetchProjectDelays,
  fetchProjectGantt,
  fetchProjects,
  projectOverallProgress,
  toProjectGanttData,
  type DelayReport,
  type FlowConflict,
  type ProjectRecord,
  type ProjectSummary,
} from './api';
import { EMPTY_PROJECT_FORM, PROJECT_STATUS_LABEL, validateProjectForm, type ProjectFormState } from './manage';
import { ProjectManagePanel } from './ProjectManagePanel';
import { ProjectWorkspace } from './ProjectWorkspace';
import { ui } from './styles';
import type { GanttView } from './types';

/** 選定專案的完整資料束。 */
interface ProjectBundle {
  project: ProjectRecord;
  gantt: GanttView;
  delays: DelayReport;
  conflicts: FlowConflict[];
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; projects: ProjectSummary[] }
  | { kind: 'error'; error: NormalizedError };

type BundleState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; bundle: ProjectBundle; refreshing: boolean }
  | { kind: 'error'; error: NormalizedError };

export interface ProjectWorkspacePageProps {
  /** 建立專案表單之預設負責人（目前登入者 ID）。 */
  currentUserId?: string | null;
}

export function ProjectWorkspacePage({ currentUserId = null }: ProjectWorkspacePageProps): JSX.Element {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<BundleState>({ kind: 'idle' });
  const [basis, setBasis] = useState<'CALENDAR' | 'WORKDAY'>('CALENDAR');
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<ProjectFormState>(EMPTY_PROJECT_FORM);
  const [createErrors, setCreateErrors] = useState<string[]>([]);
  const [createBusy, setCreateBusy] = useState(false);
  const listSeq = useRef(0);
  const bundleSeq = useRef(0);

  const loadList = useCallback((selectFirst: boolean): void => {
    const seq = ++listSeq.current;
    setList((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    fetchProjects()
      .then((projects) => {
        if (listSeq.current !== seq) return;
        setList({ kind: 'ready', projects });
        if (selectFirst) setSelectedId((prev) => prev ?? (projects.length > 0 ? projects[0].id : null));
      })
      .catch((err: unknown) => {
        if (listSeq.current !== seq) return;
        setList({ kind: 'error', error: toErrorState(err) });
      });
  }, []);

  const loadBundle = useCallback(
    (id: string, opts: { fresh?: boolean; basis?: 'CALENDAR' | 'WORKDAY' } = {}): void => {
      const seq = ++bundleSeq.current;
      const useBasis = opts.basis ?? basis;
      setBundle((prev) => (prev.kind === 'ready' ? { ...prev, refreshing: true } : { kind: 'loading' }));
      // fresh=true 僅放在 gantt：回寫一次進度後，delays 讀到的已是更新後資料（避免重複回寫）。
      Promise.all([
        fetchProject(id),
        fetchProjectGantt(id, { fresh: opts.fresh }),
        fetchProjectDelays(id, { basis: useBasis }),
        fetchExclusionConflicts(id),
      ])
        .then(([project, gantt, delays, conflicts]) => {
          if (bundleSeq.current !== seq) return;
          setBundle({ kind: 'ready', bundle: { project, gantt, delays, conflicts }, refreshing: false });
        })
        .catch((err: unknown) => {
          if (bundleSeq.current !== seq) return;
          setBundle({ kind: 'error', error: toErrorState(err) });
        });
    },
    [basis],
  );

  useEffect(() => {
    loadList(true);
  }, [loadList]);

  useEffect(() => {
    if (selectedId) loadBundle(selectedId);
    else setBundle({ kind: 'idle' });
    // basis 變更由 onBasisChange 主動帶參數重載，這裡僅追蹤選擇變更。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const submitCreate = (): void => {
    const r = validateProjectForm(createForm);
    if (!r.ok) {
      setCreateErrors(r.errors);
      return;
    }
    setCreateBusy(true);
    setCreateErrors([]);
    createProject(r.payload)
      .then((created) => {
        setCreateBusy(false);
        setCreating(false);
        setCreateForm(EMPTY_PROJECT_FORM);
        setSelectedId(created.id);
        loadList(false);
      })
      .catch((err: unknown) => {
        setCreateBusy(false);
        setCreateErrors([toErrorState(err).message]);
      });
  };

  const onMutate = (opts?: { deleted?: boolean }): void => {
    if (opts?.deleted) {
      setSelectedId(null);
      setList({ kind: 'loading' });
      listSeq.current += 1;
      fetchProjects()
        .then((projects) => {
          setList({ kind: 'ready', projects });
          setSelectedId(projects.length > 0 ? projects[0].id : null);
        })
        .catch((err: unknown) => setList({ kind: 'error', error: toErrorState(err) }));
      return;
    }
    loadList(false);
    if (selectedId) loadBundle(selectedId);
  };

  if (list.kind === 'loading') return <LoadingState label="專案清單載入中…" />;
  if (list.kind === 'error') return <ErrorState title="專案清單載入失敗" error={list.error} onRetry={() => loadList(true)} />;

  const projects = list.projects;
  const input = { padding: '0.3rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: 5, fontSize: '0.85rem' } as const;

  const createFormUi = creating && (
    <div style={{ ...ui.toolbar, border: '1px dashed #cbd5e1', borderRadius: 8, padding: '0.6rem' }}>
      <input style={input} placeholder="專案名稱" value={createForm.name} onChange={(e) => setCreateForm((s) => ({ ...s, name: e.target.value }))} />
      <input style={input} placeholder="客戶名稱" value={createForm.client} onChange={(e) => setCreateForm((s) => ({ ...s, client: e.target.value }))} />
      <input
        style={{ ...input, width: 200 }}
        placeholder="負責人（使用者 ID）"
        value={createForm.ownerId}
        onChange={(e) => setCreateForm((s) => ({ ...s, ownerId: e.target.value }))}
      />
      <input type="date" style={input} value={createForm.planStart} onChange={(e) => setCreateForm((s) => ({ ...s, planStart: e.target.value }))} />
      <span style={ui.muted}>~</span>
      <input type="date" style={input} value={createForm.planEnd} onChange={(e) => setCreateForm((s) => ({ ...s, planEnd: e.target.value }))} />
      <button style={{ ...ui.btn, ...ui.btnPrimary }} disabled={createBusy} onClick={submitCreate}>建立</button>
      <button style={ui.btn} disabled={createBusy} onClick={() => setCreating(false)}>取消</button>
      {createErrors.length > 0 && <span style={{ color: '#b91c1c', fontSize: '0.8rem' }}>{createErrors.join('；')}</span>}
    </div>
  );

  const openCreate = (): void => {
    setCreateForm({ ...EMPTY_PROJECT_FORM, ownerId: currentUserId ?? '' });
    setCreateErrors([]);
    setCreating(true);
  };

  if (projects.length === 0) {
    return (
      <section>
        {createFormUi || (
          <EmptyState message="尚無專案。建立第一個專案後，即可掛載流程並追蹤甘特進度。">
            <button style={{ ...ui.btn, ...ui.btnPrimary }} onClick={openCreate}>新增專案</button>
          </EmptyState>
        )}
      </section>
    );
  }

  return (
    <section>
      <div style={ui.toolbar}>
        <label style={ui.muted} htmlFor="project-select">專案</label>
        <select id="project-select" style={{ ...input, minWidth: 260 }} value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value || null)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code}｜{p.name}（{PROJECT_STATUS_LABEL[p.status]}，{projectOverallProgress(p)}%）
            </option>
          ))}
        </select>
        <label style={ui.muted} htmlFor="basis-select">差異天數基準</label>
        <select
          id="basis-select"
          style={input}
          value={basis}
          onChange={(e) => {
            const b = e.target.value as 'CALENDAR' | 'WORKDAY';
            setBasis(b);
            if (selectedId) loadBundle(selectedId, { basis: b });
          }}
        >
          <option value="CALENDAR">日曆日</option>
          <option value="WORKDAY">工作日</option>
        </select>
        <button
          style={ui.btn}
          title="先依案件步驟完成比例回寫各流程進度，再重算甘特與延遲（fresh=true）"
          disabled={!selectedId || (bundle.kind === 'ready' && bundle.refreshing)}
          onClick={() => selectedId && loadBundle(selectedId, { fresh: true })}
        >
          重新整理（回寫進度）
        </button>
        <span style={ui.spacer} />
        {!creating && (
          <button style={{ ...ui.btn, ...ui.btnPrimary }} onClick={openCreate}>新增專案</button>
        )}
      </div>
      {createFormUi}

      {bundle.kind === 'loading' && <LoadingState label="專案資料載入中…" />}
      {bundle.kind === 'error' && selectedId && (
        <ErrorState title="專案資料載入失敗" error={bundle.error} onRetry={() => loadBundle(selectedId)} />
      )}
      {bundle.kind === 'ready' && (
        <div style={{ opacity: bundle.refreshing ? 0.6 : 1, transition: 'opacity 0.15s' }}>
          <ProjectWorkspace data={toProjectGanttData(bundle.bundle.project, bundle.bundle.gantt)} />
          <ProjectManagePanel
            project={bundle.bundle.project}
            delays={bundle.bundle.delays}
            conflicts={bundle.bundle.conflicts}
            onMutate={onMutate}
          />
        </div>
      )}
    </section>
  );
}
