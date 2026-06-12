/**
 * 案件詳情頁（issue 8.12 #47）：REST 驅動（非 seed）。
 *  - 載入 `GET /cases` 清單與 `GET /cases/:id/detail` 詳情；
 *    初始選取由上層帶入 caseId（看板 / 專案管理 openCase 統一導入），否則取清單第一筆。
 *  - 動作（推進 / 退回 / 填表 / 簽核 / 加附件）成功後重新整理詳情（stale-while-revalidate，
 *    遞增序號防過時回應覆蓋；與 8.9 / 8.10 慣例一致）。
 *  - 載入 / 錯誤 / 空狀態依 8.4 慣例；動作錯誤（400 / 403）顯示於操作區，權限以後端為準。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, ErrorState, LoadingState, toErrorState, type NormalizedError } from '../../components/AsyncStates';
import {
  addAttachment,
  advanceCase,
  approveSubmission,
  fetchCaseDetail,
  fetchCases,
  rejectSubmission,
  returnCase,
  submitForm,
  type CaseDetail,
  type CaseStep,
  type CaseStepForm,
  type CaseSummary,
} from './api';
import { CaseDetailView } from './CaseDetailView';

export interface CaseDetailPageProps {
  /** 預先選取的案件（自任務看板 / 專案管理導入）；null 取清單第一筆。 */
  caseId?: string | null;
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; cases: CaseSummary[] }
  | { kind: 'error'; error: NormalizedError };

type DetailState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; detail: CaseDetail; refreshing: boolean }
  | { kind: 'error'; error: NormalizedError };

export function CaseDetailPage({ caseId = null }: CaseDetailPageProps): JSX.Element {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(caseId);
  const [detail, setDetail] = useState<DetailState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<NormalizedError | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const listSeq = useRef(0);
  const detailSeq = useRef(0);

  // 上層導入的 caseId 變更（如看板點不同卡片）時切換選取。
  useEffect(() => {
    if (caseId) setSelectedId(caseId);
  }, [caseId]);

  const loadList = useCallback((): void => {
    const seq = ++listSeq.current;
    setList((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    fetchCases()
      .then((cases) => {
        if (listSeq.current !== seq) return;
        setList({ kind: 'ready', cases });
        setSelectedId((prev) => prev ?? (cases.length > 0 ? cases[0].id : null));
      })
      .catch((err: unknown) => {
        if (listSeq.current !== seq) return;
        setList({ kind: 'error', error: toErrorState(err) });
      });
  }, []);

  const loadDetail = useCallback((id: string): void => {
    const seq = ++detailSeq.current;
    setDetail((prev) => (prev.kind === 'ready' ? { ...prev, refreshing: true } : { kind: 'loading' }));
    fetchCaseDetail(id)
      .then((d) => {
        if (detailSeq.current !== seq) return;
        setDetail({ kind: 'ready', detail: d, refreshing: false });
      })
      .catch((err: unknown) => {
        if (detailSeq.current !== seq) return;
        setDetail({ kind: 'error', error: toErrorState(err) });
      });
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    setActionError(null);
    setActionNotice(null);
    if (selectedId) loadDetail(selectedId);
    else setDetail({ kind: 'idle' });
  }, [selectedId, loadDetail]);

  /** 包動作：busy / 錯誤 / 成功訊息 / 重新整理（詳情必刷、清單視需要）。 */
  const runAction = useCallback(
    (action: () => Promise<unknown>, notice: string, opts: { reloadList?: boolean } = {}): void => {
      if (!selectedId) return;
      setBusy(true);
      setActionError(null);
      setActionNotice(null);
      action()
        .then(() => {
          setBusy(false);
          setActionNotice(notice);
          loadDetail(selectedId);
          if (opts.reloadList) loadList();
        })
        .catch((err: unknown) => {
          setBusy(false);
          setActionError(toErrorState(err));
        });
    },
    [selectedId, loadDetail, loadList],
  );

  if (list.kind === 'loading') return <LoadingState label="案件清單載入中…" />;
  if (list.kind === 'error') return <ErrorState title="案件清單載入失敗" error={list.error} onRetry={loadList} />;
  if (list.cases.length === 0 && !selectedId) {
    return <EmptyState message="目前沒有可檢視的案件。建立流程案件後（或由主管調整可見範圍），即可在此追蹤推進。" />;
  }
  if (detail.kind === 'idle' || detail.kind === 'loading') return <LoadingState label="案件詳情載入中…" />;
  if (detail.kind === 'error') {
    return (
      <ErrorState
        title="案件詳情載入失敗"
        error={detail.error}
        onRetry={() => selectedId && loadDetail(selectedId)}
      />
    );
  }

  const d = detail.detail;
  return (
    <CaseDetailView
      cases={list.cases}
      detail={d}
      refreshing={detail.refreshing}
      busy={busy}
      actionError={actionError}
      actionNotice={actionNotice}
      onSelectCase={setSelectedId}
      onAdvance={(note) =>
        runAction(() => advanceCase(d.id, { note: note === '' ? null : note }), '已完成此步驟並推進。', { reloadList: true })
      }
      onReturn={(targetStepDefinitionId, reason) =>
        runAction(() => returnCase(d.id, { targetStepDefinitionId, reason }), '已退回至指定步驟。', { reloadList: true })
      }
      onSubmitForm={(form: CaseStepForm, step: CaseStep, content: string) =>
        runAction(
          () =>
            submitForm({
              formDefinitionId: form.formId,
              caseId: d.id,
              stepInstanceId: step.stepInstanceId,
              data: { content },
            }),
          `已送出「${form.name}」。`,
        )
      }
      onApprove={(submissionId) => runAction(() => approveSubmission(submissionId), '已簽核通過。')}
      onReject={(submissionId) => runAction(() => rejectSubmission(submissionId), '已簽核退回。')}
      onAddLink={(name, url) => runAction(() => addAttachment({ caseId: d.id, name, linkUrl: url }), `已加入連結「${name}」。`)}
    />
  );
}
