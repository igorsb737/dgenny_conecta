import React, { useState } from 'react';
import { getAuth, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import '../App.css';
import './Login.css';

const Login: React.FC = () => {
  const auth = getAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: any) {
      setError(
        err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password'
          ? 'Credenciais inválidas'
          : 'Falha ao entrar. Verifique os dados.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError('Informe seu e-mail para recuperar a senha');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice('Enviamos um e-mail para redefinição de senha.');
    } catch (err: any) {
      setError('Não foi possível enviar o e-mail de redefinição.');
    }
  };

  return (
    <div className="login-page">
      <header className="app-header">
        <div className="header-inner">
          <h1>DGenny Conecta</h1>
        </div>
      </header>

      <main className="app-main">
        <div className="container">
          <div className="login-card">
            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="email">E-mail</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  autoComplete="email"
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Senha</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>

              {error && <div className="error-message-box">{error}</div>}
              {notice && <div className="success-message">{notice}</div>}

              <button className="login-btn" type="submit" disabled={loading}>
                {loading ? 'Entrando...' : 'Entrar'}
              </button>

              <button
                type="button"
                className="reset-btn"
                onClick={handleReset}
                disabled={loading}
              >
                Esqueci minha senha
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Login;
