/**
 * 案件詳情 / 推進（issue 8.12 #47；對應原型 view-case）：
 *  - 案件選擇 + 標籤、步驟 stepper（done / active 由後端狀態判定）。
 *  - 左：選取步驟的表單（填寫 / 送出 / 簽核）與當前步驟的推進 / 退回。
 *  - 右：步驟資訊、應產出文件（達成狀態）、附件 / 連結（可加入連結）。
 * 純呈現元件：資料與動作皆由 CaseDetailPage 注入；可操作性僅做 UI 層收斂
 * （流程狀態 / 表單狀態），實際權限以後端 403 為準（錯誤訊息顯示於動作區）。
 */
import { useEffect, useMemo, useState } from 'react';
import { errorHint } from '../../components/errorHint';
import type { NormalizedError } from '../../components/AsyncStates';
import type { CaseDetail, CaseStep, CaseStepForm, CaseSummary } from './api';
import {
  FORM_STATUS_PILLS,
  activeStepIndex,
  attachmentMeta,
  canAdvance,
  canFill,
  canSign,
  caseMeta,
  caseOptionLabel,
  caseTags,
  dateOnly,
  flowLabel,
  returnTargets,
  stepActive,
  stepDone,
  stepRoleLabel,
  stepStatusPill,
  unmetRequiredFormNames,
} from './presentation';

export interface CaseDetailViewProps {
  /** 可切換的案件清單（後端已收斂可見範圍）。 */
  cases: CaseSummary[];
  /** 目前顯示的案件詳情。 */
  detail: CaseDetail;
  /** 背景重新整理中（淡化呈現）。 */
  refreshing: boolean;
  /** 動作進行中（disable 所有動作按鈕）。 */
  busy: boolean;
  /** 最近一次動作的錯誤（後端 400/403 等；顯示於動作區）。 */
  actionError: NormalizedError | null;
  /** 最近一次動作的成功訊息。 */
  actionNotice: string | null;
  onSelectCase: (id: string) => void;
  /** 完成當前步驟並推進（note 可空）。 */
  onAdvance: (note: string) => void;
  /** 退回至指定步驟（targetStepDefinitionId + 必填 reason）。 */
  onReturn: (targetStepDefinitionId: string, reason: string) => void;
  /** 填寫 / 送出表單（自由文字內容，data={content}）。 */
  onSubmitForm: (form: CaseStepForm, step: CaseStep, content: string) => void;
  /** 簽核通過 / 退回。 */
  onApprove: (submissionId: string) => void;
  onReject: (submissionId: string) => void;
  /** 加入連結附件（SharePoint / OneDrive 優先）。 */
  onAddLink: (name: string, url: string) => void;
}

export function CaseDetailView(props: CaseDetailViewProps): JSX.Element {
  const { cases, detail, refreshing, busy, actionError, actionNotice } = props;
  const defaultIdx = useMemo(() => activeStepIndex(detail), [detail]);
  const [stepIdx, setStepIdx] = useState<number>(defaultIdx);
  // 切換案件（detail.id 變更）時回到當前步驟。
  useEffect(() => {
    setStepIdx(defaultIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  const step: CaseStep | undefined = detail.steps[Math.min(stepIdx, detail.steps.length - 1)];
  const isCurrent = step ? stepActive(step, detail) : false;
  const advanceable = isCurrent && canAdvance(detail);
  const targets = returnTargets(detail);

  return (
    <section style={{ opacity: refreshing ? 0.6 : 1, transition: 'opacity 0.15s' }}>
      <div className="card pad">
        <div className="case-head">
          <div>
            <h2>{detail.title}</h2>
            <div className="muted">{caseMeta(detail)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <select
              className="btn"
              style={{ marginBottom: 8, maxWidth: 360 }}
              value={detail.id}
              onChange={(e) => props.onSelectCase(e.target.value)}
              aria-label="選擇案件"
            >
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {caseOptionLabel(c)}
                </option>
              ))}
              {!cases.some((c) => c.id === detail.id) && <option value={detail.id}>{detail.code}｜{detail.title}</option>}
            </select>
            <div>
              {caseTags(detail).map(([label, pill]) => (
                <span key={label} className={`pill ${pill}`} style={{ marginLeft: 6 }}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="stepper">
          {detail.steps.map((s, i) => (
            <div
              key={s.stepInstanceId}
              className={`step ${stepDone(s) ? 'done' : ''} ${i === stepIdx ? 'active' : ''}`}
              onClick={() => setStepIdx(i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setStepIdx(i);
              }}
            >
              <div className="line" />
              <div className="node">{stepDone(s) ? '✓' : i + 1}</div>
              <div className="lbl">
                {s.name}
                <br />
                <span className="muted" style={{ fontSize: 11 }}>
                  {stepRoleLabel(s)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {step && (
        <div className="detail-grid">
          <div className="card pad">
            <div className="sec-title">
              ✍️ {step.name}
              <span className={`pill ${stepStatusPill(step, isCurrent)[1]}`}>{stepStatusPill(step, isCurrent)[0]}</span>
            </div>
            {step.description && (
              <p className="muted" style={{ marginTop: 0 }}>
                {step.description}
              </p>
            )}

            {step.forms.length === 0 && <p className="muted">此步驟無需填寫表單。</p>}
            {step.forms.map((f) => (
              <FormRow
                key={f.formId}
                form={f}
                step={step}
                busy={busy}
                onSubmit={(content) => props.onSubmitForm(f, step, content)}
                onApprove={props.onApprove}
                onReject={props.onReject}
              />
            ))}

            {advanceable && (
              <AdvancePanel
                busy={busy}
                unmet={unmetRequiredFormNames(step)}
                targets={targets}
                onAdvance={props.onAdvance}
                onReturn={props.onReturn}
              />
            )}
            {!advanceable && isCurrent && (
              <p className="muted" style={{ fontSize: 12 }}>
                案件目前狀態不可推進（{detail.status}）。
              </p>
            )}

            {actionError && (
              <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 12.5 }}>
                操作失敗（{actionError.code}）：{actionError.message}
                {errorHint(actionError.status) && <div className="muted">{errorHint(actionError.status)}</div>}
              </div>
            )}
            {!actionError && actionNotice && (
              <div style={{ marginTop: 10, color: '#15803d', fontSize: 12.5 }}>{actionNotice}</div>
            )}
          </div>

          <div>
            <div className="card pad" style={{ marginBottom: 16 }}>
              <div className="sec-title" style={{ fontSize: 14 }}>
                步驟資訊
              </div>
              <ul className="meta-list">
                <li>
                  <span className="k">所屬流程</span>
                  <span>
                    {flowLabel(detail.flowType)}（{detail.workflow.name} v{detail.workflow.version}）
                  </span>
                </li>
                <li>
                  <span className="k">負責角色</span>
                  <span>{stepRoleLabel(step)}</span>
                </li>
                {step.assignee && (
                  <li>
                    <span className="k">負責人</span>
                    <span>{step.assignee.displayName}</span>
                  </li>
                )}
                <li>
                  <span className="k">狀態</span>
                  <span>{stepStatusPill(step, isCurrent)[0]}</span>
                </li>
                {step.dueDate && (
                  <li>
                    <span className="k">到期日</span>
                    <span>{dateOnly(step.dueDate)}</span>
                  </li>
                )}
                <li>
                  <span className="k">步驟順序</span>
                  <span>
                    第 {stepIdx + 1} / {detail.steps.length} 步
                  </span>
                </li>
                {step.note && (
                  <li>
                    <span className="k">備註</span>
                    <span>{step.note}</span>
                  </li>
                )}
              </ul>
            </div>

            <div className="card pad">
              <div className="sec-title" style={{ fontSize: 14 }}>
                應產出文件
              </div>
              {step.forms.length === 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  無
                </div>
              )}
              {step.forms.map((f) => (
                <div className="output" key={f.formId}>
                  <span className="ico">📄</span>
                  <span>
                    {f.name}
                    {f.isRequired && <span className="muted">（必填{f.isSignable ? '，需簽核' : ''}）</span>}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {f.satisfied ? '已留存於案件軌跡' : '完成步驟前需填寫'}
                    </div>
                  </span>
                </div>
              ))}
            </div>

            <AttachmentsCard detail={detail} busy={busy} onAddLink={props.onAddLink} />
          </div>
        </div>
      )}
    </section>
  );
}

/** 單一表單列：狀態 pill ＋（可填時）內容輸入與送出 ＋（可簽核時）通過 / 退回。 */
function FormRow({
  form,
  step,
  busy,
  onSubmit,
  onApprove,
  onReject,
}: {
  form: CaseStepForm;
  step: CaseStep;
  busy: boolean;
  onSubmit: (content: string) => void;
  onApprove: (submissionId: string) => void;
  onReject: (submissionId: string) => void;
}): JSX.Element {
  const [content, setContent] = useState('');
  const [statusLabel, pill] = FORM_STATUS_PILLS[form.status] ?? [form.status, 'p-grey'];
  const fillable = canFill(form) && stepDone(step) === false;
  const signable = canSign(form);

  return (
    <div className="field">
      <label>
        {form.name}
        <span className={`pill ${pill}`} style={{ marginLeft: 6 }}>
          {statusLabel}
        </span>
        {form.submittedAt && (
          <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
            送出於 {dateOnly(form.submittedAt)}
          </span>
        )}
      </label>
      {fillable && (
        <>
          <textarea
            placeholder={`填寫「${form.name}」內容…`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={busy}
          />
          <div style={{ textAlign: 'right', marginTop: 4 }}>
            <button className="btn sm" disabled={busy || content.trim() === ''} onClick={() => onSubmit(content.trim())}>
              送出表單
            </button>
            {signable && form.submissionId && (
              <>
                {' '}
                <button className="btn sm" disabled={busy} onClick={() => onApprove(form.submissionId!)}>
                  ✅ 簽核通過
                </button>{' '}
                <button className="btn sm" disabled={busy} onClick={() => onReject(form.submissionId!)}>
                  ❌ 簽核退回
                </button>
              </>
            )}
          </div>
        </>
      )}
      {!fillable && signable && form.submissionId && (
        <div style={{ textAlign: 'right' }}>
          <button className="btn sm" disabled={busy} onClick={() => onApprove(form.submissionId!)}>
            ✅ 簽核通過
          </button>{' '}
          <button className="btn sm" disabled={busy} onClick={() => onReject(form.submissionId!)}>
            ❌ 簽核退回
          </button>
        </div>
      )}
    </div>
  );
}

/** 推進 / 退回操作區（僅當前步驟顯示）。 */
function AdvancePanel({
  busy,
  unmet,
  targets,
  onAdvance,
  onReturn,
}: {
  busy: boolean;
  unmet: string[];
  targets: CaseStep[];
  onAdvance: (note: string) => void;
  onReturn: (targetStepDefinitionId: string, reason: string) => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [returning, setReturning] = useState(false);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 12, paddingTop: 10 }}>
      {unmet.length > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          ⚠️ 尚有必填表單未達成：{unmet.join('、')}（推進時由後端把關）。
        </p>
      )}
      <div className="field">
        <label>推進備註（可空）</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：報價已寄出，待客戶回覆" disabled={busy} />
      </div>
      <div style={{ textAlign: 'right', marginTop: 6 }}>
        {targets.length > 0 && (
          <button className="btn" disabled={busy} onClick={() => setReturning((v) => !v)}>
            ← 退回步驟
          </button>
        )}{' '}
        <button className="btn primary" disabled={busy} onClick={() => onAdvance(note.trim())}>
          完成此步驟並推進 →
        </button>
      </div>
      {returning && targets.length > 0 && (
        <div style={{ marginTop: 8, padding: 8, border: '1px dashed #cbd5e1', borderRadius: 8 }}>
          <div className="field">
            <label>退回至</label>
            <select className="btn" value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
              <option value="">— 選擇步驟 —</option>
              {targets.map((t) => (
                <option key={t.stepDefinitionId} value={t.stepDefinitionId}>
                  第 {t.order} 步：{t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>退回原因（必填）</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：報價金額需修正" disabled={busy} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <button
              className="btn"
              disabled={busy || target === '' || reason.trim() === ''}
              onClick={() => onReturn(target, reason.trim())}
            >
              確認退回
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 附件 / 連結卡（案件層彙整；可加入連結）。 */
function AttachmentsCard({
  detail,
  busy,
  onAddLink,
}: {
  detail: CaseDetail;
  busy: boolean;
  onAddLink: (name: string, url: string) => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  return (
    <div className="card pad" style={{ marginTop: 16 }}>
      <div className="sec-title" style={{ fontSize: 14 }}>
        附件 / 連結
      </div>
      {detail.attachments.length === 0 && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          尚無附件
        </div>
      )}
      {detail.attachments.map((a) => {
        const href = a.type === 'LINK' ? a.linkUrl : a.fileUrl;
        return (
          <div className="att" key={a.id}>
            <span className={`ic ${a.type === 'FILE' ? 'file' : 'link'}`}>{a.type === 'FILE' ? '📎' : '🔗'}</span>
            <span>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer">
                  {a.name}
                </a>
              ) : (
                a.name
              )}
              <div className="meta">{attachmentMeta(a)}</div>
            </span>
          </div>
        );
      })}
      <div className="att-actions">
        <button className="btn sm" disabled={busy} onClick={() => setAdding((v) => !v)}>
          🔗 加入連結
        </button>
      </div>
      {adding && (
        <div style={{ marginTop: 8 }}>
          <div className="field">
            <label>名稱</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：宏全商機資料夾（SharePoint）" disabled={busy} />
          </div>
          <div className="field">
            <label>連結 URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" disabled={busy} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <button
              className="btn sm"
              disabled={busy || name.trim() === '' || url.trim() === ''}
              onClick={() => {
                onAddLink(name.trim(), url.trim());
                setAdding(false);
                setName('');
                setUrl('');
              }}
            >
              加入
            </button>
          </div>
        </div>
      )}
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        連結優先支援 SharePoint / OneDrive，沿用 Microsoft 365 權限。
      </div>
    </div>
  );
}
