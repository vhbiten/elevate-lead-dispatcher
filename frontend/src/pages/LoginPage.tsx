import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { errorMessage } from '../format';
import type { User } from '../types';

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError('');
    const result = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: { email, password } });
    setSending(false);
    if (result.ok) onLogin(result.data.user);
    else setError(result.status === 400 ? 'Informe um e-mail válido e a senha.' : errorMessage(result.error));
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand brand-dark">
          <span className="brand-mark" aria-hidden="true" />
          Elevate <span className="brand-product">Lead Dispatcher</span>
        </div>
        <h1>Entrar</h1>
        <label>
          E-mail
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="button primary" type="submit" disabled={sending}>
          {sending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
