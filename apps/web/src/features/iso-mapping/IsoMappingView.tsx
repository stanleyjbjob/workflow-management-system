/**
 * ISO 文件對應頁（對應原型 view-iso；issue 6.2 後端就緒後改 fetch）。
 * 呈現各系統表單/產出對應的 ISO 27001 面向與覆蓋狀態。資料為 seed 範例。
 */
export interface IsoMappingRow {
  form: string;
  flow: string;
  iso: string;
  cover: boolean;
  note: string;
}

export const sampleIsoMappings: IsoMappingRow[] = [
  { form: '委任權限表（簽核）', flow: '導入', iso: 'A.5 存取控制 / 權限授予紀錄', cover: true, note: '具簽核軌跡與版本' },
  { form: '人員資料表', flow: '導入', iso: 'A.5 資產 / 個資盤點', cover: true, note: '留存與保護' },
  { form: '啟動會議記錄', flow: '導入', iso: '溝通與決策紀錄', cover: true, note: '可追溯' },
  { form: '需求變更單', flow: '客製化', iso: 'A.8 變更管理流程', cover: true, note: '變更申請與核准' },
  { form: '測試文件 / 複測報告', flow: '客製化', iso: 'A.8 變更測試紀錄', cover: true, note: '對應變更控制' },
  { form: '環境建置 / 驗收檢核表', flow: '環境建置', iso: 'A.8 組態 / 營運安全', cover: false, note: '待補簽核欄位' },
  { form: '失敗原因 / 退回紀錄', flow: '銷售 / 客製化', iso: '矯正與持續改善', cover: false, note: '待定義分類與覆核' },
];

export interface IsoMappingViewProps {
  rows?: IsoMappingRow[];
}

export function IsoMappingView({ rows = sampleIsoMappings }: IsoMappingViewProps): JSX.Element {
  return (
    <section>
      <div className="iso-note">
        🛡️ <b>目標：</b>讓系統內的流程表單取代現行 ISO 27001 文件，將文件化需求整合進流程。下表呈現各表單／產出對應的
        ISO 面向與目前覆蓋狀態。
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '22%' }}>系統表單 / 產出</th>
              <th style={{ width: '14%' }}>來源流程</th>
              <th style={{ width: '26%' }}>對應 ISO 27001 面向</th>
              <th style={{ width: '14%' }}>覆蓋狀態</th>
              <th>備註</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.form}>
                <td style={{ fontWeight: 600 }}>{r.form}</td>
                <td>{r.flow}</td>
                <td>{r.iso}</td>
                <td>
                  <span className={`pill ${r.cover ? 'cover' : 'nocover'}`}>{r.cover ? '已覆蓋' : '待補'}</span>
                </td>
                <td className="muted">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend">
        <span>
          <span className="pill cover">已覆蓋</span> 表單已內建於流程並具簽核 / 版本軌跡
        </span>
        <span>
          <span className="pill nocover">待補</span> 需補欄位或簽核設定
        </span>
      </div>
    </section>
  );
}
