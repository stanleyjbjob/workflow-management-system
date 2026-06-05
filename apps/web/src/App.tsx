import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export function App(): JSX.Element {
  const [apiStatus, setApiStatus] = useState<string>('檢查中…');

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((d: { status?: string }) => setApiStatus(d.status === 'ok' ? '正常 (ok)' : '異常'))
      .catch(() => setApiStatus('無法連線'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>工作流程管理系統</h1>
      <p>前端空殼已啟動。後續功能依 issue 逐步開發。</p>
      <p>
        API 健康狀態：<strong>{apiStatus}</strong>
      </p>
    </main>
  );
}
