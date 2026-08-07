import { useState } from 'react';
import { Link } from 'react-router-dom';
import InquiryForm from './components/InquiryForm.tsx';
import InquiryHistory from './components/InquiryHistory.tsx';
import './App.css';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="app">
      <header className="app-header">
        <h1>中辉仓储订货咨询系统</h1>
        <Link to="/admin" className="admin-link">管理后台</Link>
      </header>
      <main className="app-main">
        <InquiryForm onSubmitted={() => setRefreshKey(k => k + 1)} />
        <InquiryHistory refreshKey={refreshKey} />
      </main>
    </div>
  );
}
