import { useEffect, useState } from 'react';
import { api, SESSION_EXPIRED_EVENT } from './api';
import { DashboardPage } from './pages/DashboardPage';
import { DispatcherPage } from './pages/DispatcherPage';
import { LeadsPage } from './pages/LeadsPage';
import { LoginPage } from './pages/LoginPage';
import type { User } from './types';

type Tab = 'dashboard' | 'leads' | 'dispatcher';

const TAB_LABELS: Record<Tab, string> = {
  dashboard: 'Painel',
  leads: 'Leads',
  dispatcher: 'Distribuição',
};

// A tela só esconde o que o perfil não usa. Quem garante a permissão é a API (403/404).
function tabsFor(user: User): Tab[] {
  return user.role === 'ADMIN' ? ['dashboard', 'leads', 'dispatcher'] : ['leads'];
}

export function App() {
  // undefined = ainda conferindo a sessão; null = sem sessão.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('leads');

  useEffect(() => {
    api<{ user: User }>('/api/auth/me').then((result) => enter(result.ok ? result.data.user : null));
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  function enter(next: User | null) {
    setUser(next);
    if (next) setTab(tabsFor(next)[0]);
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }

  if (user === undefined) return null;
  if (user === null) return <LoginPage onLogin={enter} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Elevate <span className="brand-product">Lead Dispatcher</span>
        </div>
        <nav className="tabs">
          {tabsFor(user).map((item) => (
            <button key={item} className={item === tab ? 'tab active' : 'tab'} onClick={() => setTab(item)}>
              {TAB_LABELS[item]}
            </button>
          ))}
        </nav>
        <div className="session">
          <span className="session-user">
            {user.email}
            <small>{user.role === 'ADMIN' ? 'Administrador' : `Operador · ${user.call_center?.name}`}</small>
          </span>
          <button className="button ghost" onClick={logout}>
            Sair
          </button>
        </div>
      </header>

      <main className="content">
        {tab === 'dashboard' && <DashboardPage />}
        {tab === 'leads' && <LeadsPage user={user} />}
        {tab === 'dispatcher' && <DispatcherPage />}
      </main>
    </div>
  );
}
