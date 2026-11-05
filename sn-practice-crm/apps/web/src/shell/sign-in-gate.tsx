import React, { useState, type FormEvent } from 'react';

export interface SignInGateProps {
  onSignIn: (credentials: { email: string; password: string }) => Promise<unknown>;
}

export function SignInGate({ onSignIn }: SignInGateProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await onSignIn({ email: email.trim(), password });
    } catch (err: unknown) {
      setIsSubmitting(false);
      setErrorMessage(err instanceof Error ? err.message : 'Sign in failed. Please check your credentials.');
    }
  }

  return (
    <div className="session-screen-center">
      <div className="sign-in-card" style={{ maxWidth: 400, width: '100%', margin: '0 auto', padding: 32, background: 'var(--surface)', borderRadius: 16, boxShadow: 'var(--shadow-card)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0', color: 'var(--ink-strong)' }}>SN Practice CRM</h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-muted)' }}>Sign in to your practice workspace</p>
        </div>

        {errorMessage ? (
          <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13 }}>
            {errorMessage}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="email" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@sn-demo.local"
              style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }}
            />
          </div>

          <div>
            <label htmlFor="password" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              height: 42,
              marginTop: 8,
              background: 'var(--brand)',
              color: 'var(--surface)',
              border: 0,
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
