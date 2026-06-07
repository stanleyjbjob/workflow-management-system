/**
 * 案件詳情 / 推進（對應原型 view-case）：
 *  - 案件選擇 + 標籤、步驟 stepper（done / active）。
 *  - 左：當前（或選取）步驟的表單欄位與推進按鈕。
 *  - 右：步驟資訊、應產出文件、附件/連結。
 * 視覺對齊 prototype/index.html；資料為 seed 範例，REST 就緒後替換。
 */
import { useMemo, useState } from 'react';
import { sampleCases } from './seed';
import type { CaseRecord, CaseStep } from './types';

export interface CaseDetailViewProps {
  /** 預先選取的案件（例如自任務看板導入）；找不到時退回第一筆。 */
  caseId?: string | null;
  cases?: CaseRecord[];
}

export function CaseDetailView({ caseId = null, cases = sampleCases }: CaseDetailViewProps): JSX.Element {
  const initial = useMemo(() => {
    const found = caseId ? cases.find((c) => c.id === caseId) : undefined;
    return found ?? cases[0];
  }, [caseId, cases]);

  const [currentId, setCurrentId] = useState<string>(initial.id);
  const current = cases.find((c) => c.id === currentId) ?? initial;
  const defaultStep = Math.max(current.steps.findIndex((s) => s.active), 0);
  const [stepIdx, setStepIdx] = useState<number>(defaultStep);
  const step: CaseStep | undefined = current.steps[stepIdx];

  const selectCase = (id: string): void => {
    setCurrentId(id);
    const c = cases.find((x) => x.id === id);
    setStepIdx(c ? Math.max(c.steps.findIndex((s) => s.active), 0) : 0);
  };

  return (
    <section>
      <div className="banner">
        💡 檢視單一案件如何逐步推進、每步驟的表單與產出、以及「下一步 / 負責人」的指派。（示範資料）
      </div>

      <div className="card pad">
        <div className="case-head">
          <div>
            <h2>{current.title}</h2>
            <div className="muted">{current.meta}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <select className="btn" style={{ marginBottom: 8 }} value={currentId} onChange={(e) => selectCase(e.target.value)}>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <div>
              {current.tags.map(([label, pill]) => (
                <span key={label} className={`pill ${pill}`} style={{ marginLeft: 6 }}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="stepper">
          {current.steps.map((s, i) => (
            <div
              key={s.name}
              className={`step ${s.done ? 'done' : ''} ${i === stepIdx ? 'active' : ''}`}
              onClick={() => setStepIdx(i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setStepIdx(i);
              }}
            >
              <div className="line" />
              <div className="node">{s.done ? '✓' : i + 1}</div>
              <div className="lbl">
                {s.name}
                <br />
                <span className="muted" style={{ fontSize: 11 }}>
                  {s.role}
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
              {step.done ? <span className="pill p-green">已完成</span> : step.active ? <span className="pill p-blue">進行中</span> : <span className="pill p-grey">未開始</span>}
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              {step.desc}
            </p>
            {step.forms.map((f) => (
              <div className="field" key={f}>
                <label>{f}</label>
                <textarea placeholder={`填寫「${f}」內容…（示意）`} disabled={step.done} />
              </div>
            ))}
            {step.forms.length === 0 && <p className="muted">此步驟無需填寫表單。</p>}
            <div style={{ textAlign: 'right', marginTop: 6 }}>
              <button className="btn" disabled={step.done}>
                儲存草稿
              </button>{' '}
              <button className="btn primary" disabled={step.done}>
                完成此步驟並推進 →
              </button>
            </div>
          </div>

          <div>
            <div className="card pad" style={{ marginBottom: 16 }}>
              <div className="sec-title" style={{ fontSize: 14 }}>
                步驟資訊
              </div>
              <ul className="meta-list">
                <li>
                  <span className="k">所屬流程</span>
                  <span>{current.flowLabel}</span>
                </li>
                <li>
                  <span className="k">負責角色</span>
                  <span>{step.role}</span>
                </li>
                <li>
                  <span className="k">狀態</span>
                  <span>{step.done ? '已完成' : step.active ? '進行中' : '未開始'}</span>
                </li>
                {step.due && (
                  <li>
                    <span className="k">到期日</span>
                    <span>{step.due}</span>
                  </li>
                )}
                <li>
                  <span className="k">步驟順序</span>
                  <span>
                    第 {stepIdx + 1} / {current.steps.length} 步
                  </span>
                </li>
              </ul>
            </div>

            <div className="card pad">
              <div className="sec-title" style={{ fontSize: 14 }}>
                應產出文件
              </div>
              {step.forms.length === 0 && <div className="muted" style={{ fontSize: 12 }}>無</div>}
              {step.forms.map((f) => (
                <div className="output" key={f}>
                  <span className="ico">📄</span>
                  <span>
                    {f}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {step.done ? '已留存於案件軌跡' : '完成步驟前需填寫'}
                    </div>
                  </span>
                </div>
              ))}
            </div>

            <div className="card pad" style={{ marginTop: 16 }}>
              <div className="sec-title" style={{ fontSize: 14 }}>
                附件 / 連結
              </div>
              {current.attachments.length === 0 && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  尚無附件
                </div>
              )}
              {current.attachments.map((a) => (
                <div className="att" key={a.name}>
                  <span className={`ic ${a.kind}`}>{a.kind === 'file' ? '📎' : '🔗'}</span>
                  <span>
                    {a.name}
                    <div className="meta">{a.meta}</div>
                  </span>
                </div>
              ))}
              <div className="att-actions">
                <button className="btn sm">📎 上傳檔案</button>
                <button className="btn sm">🔗 加入連結</button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                連結優先支援 SharePoint / OneDrive，沿用 Microsoft 365 權限。
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
