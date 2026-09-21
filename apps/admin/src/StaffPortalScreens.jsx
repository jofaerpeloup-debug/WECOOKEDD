import { useState } from 'react';
import {
  AlertCircle, ArrowRight, Check, CheckCircle2, Clock, Eye, EyeOff,
  Leaf, Lock, Mail, ShieldAlert, User, XCircle,
} from 'lucide-react';
import { EMAIL_MAX_CHARS } from '@wecooked/contracts';
import {
  hasStaffAuthErrors,
  loginPayload,
  passwordRequirementState,
  registrationPayload,
  validateStaffLogin,
  validateStaffRegistration,
} from './staffContracts.js';
import { staffErrorMessage, staffFieldErrors } from './staffErrorMessage.js';

function FieldErrors({ id, messages = [] }) {
  if (!messages.length) return null;
  return (
    <ul id={id} className="wc-auth-field-errors" role="alert">
      {messages.map((message) => <li key={message}>{message}</li>)}
    </ul>
  );
}

export function PasswordRequirements({ password }) {
  const state = passwordRequirementState(password);
  return (
    <div id="staff-password-requirements" className="wc-pw-requirements" aria-live="polite">
      <div className="wc-pw-title">Password requirements</div>
      <ul className="wc-pw-checklist">
        {state.requirements.map(({ message, label, met }) => (
          <li key={message} className={met ? 'ok' : ''} aria-label={`${met ? 'Met' : 'Not met'}: ${label}`}>
            {met ? <Check size={13} /> : <span className="wc-pw-dot" />}{label}
          </li>
        ))}
      </ul>
      {state.meetsRequirements && (
        <div className="wc-pw-complete">Meets password requirements</div>
      )}
    </div>
  );
}

function PortalFrame({ icon, title, subtitle, children }) {
  return (
    <div className="wc-auth-wrap">
      <div className="wc-auth-bg" />
      <div className="wc-auth-tagline">
        <div className="wc-auth-visual-title wc-serif">Good food, thoughtfully managed.</div>
        <div className="wc-auth-visual-sub">Help keep the WeCooked catalog useful, reliable, and welcoming.</div>
      </div>
      <div className="wc-auth-panel">
        <div className="wc-auth-badge">{icon}</div>
        <div className="wc-auth-title wc-serif">{title}</div>
        {subtitle && <div className="wc-auth-sub">{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

export function StaffPortalAuthScreen({ onSignIn, onRegisterAndApply, onForgotPassword }) {
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetStatus, setResetStatus] = useState('');
  const [resetting, setResetting] = useState(false);
  const applying = mode === 'apply';

  function updateField(field, value, setter) {
    setter(value);
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function switchMode(next) {
    setMode(next);
    setFieldErrors({});
    setError('');
    setResetStatus('');
    setPassword('');
  }

  async function submit(event) {
    event.preventDefault();
    const values = { name, email, password };
    const validationErrors = applying
      ? validateStaffRegistration(values)
      : validateStaffLogin(values);

    setFieldErrors(validationErrors);
    setError('');
    if (hasStaffAuthErrors(validationErrors)) return;

    setSubmitting(true);
    try {
      if (applying) await onRegisterAndApply(registrationPayload(values));
      else await onSignIn(loginPayload(values));
    } catch (requestError) {
      const apiFieldErrors = staffFieldErrors(
        requestError,
        applying ? ['name', 'email', 'password'] : ['email', 'password'],
      );
      setFieldErrors(apiFieldErrors);
      if (!hasStaffAuthErrors(apiFieldErrors)) {
        setError(staffErrorMessage(requestError, 'Unable to continue. Check your details and try again.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function forgotPassword() {
    if (!email.trim()) {
      setResetStatus('Enter your email above first, then choose Forgot password.');
      return;
    }
    setResetting(true);
    setResetStatus('');
    try {
      await onForgotPassword(email.trim());
      setResetStatus('If an eligible WeCooked account exists for that email, password reset instructions have been sent.');
    } catch {
      setResetStatus('Password reset is temporarily unavailable. Please try again.');
    } finally {
      setResetting(false);
    }
  }

  return (
    <PortalFrame
      icon={<Leaf size={20} color="#4A5D4E" />}
      title="WeCooked Staff Portal"
      subtitle={applying
        ? 'Create a WeCooked account and submit your Moderator application.'
        : 'Existing staff and account holders can sign in here.'}
    >
      <form onSubmit={submit} noValidate>
        {applying && (
          <div className="wc-auth-field">
            <label htmlFor="staff-apply-name">Name <span aria-hidden="true">*</span></label>
            <div className="wc-auth-input-wrap">
              <User size={15} />
              <input
                id="staff-apply-name"
                value={name}
                onChange={(e) => updateField('name', e.target.value, setName)}
                autoComplete="name"
                required
                aria-invalid={Boolean(fieldErrors.name?.length)}
                aria-describedby={fieldErrors.name?.length ? 'staff-name-error' : undefined}
              />
            </div>
            <FieldErrors id="staff-name-error" messages={fieldErrors.name} />
          </div>
        )}
        <div className="wc-auth-field">
          <label htmlFor="staff-auth-email">Email <span aria-hidden="true">*</span></label>
          <div className="wc-auth-input-wrap">
            <Mail size={15} />
            <input
              id="staff-auth-email"
              type="email"
              value={email}
              onChange={(e) => updateField('email', e.target.value, setEmail)}
              autoComplete="username"
              maxLength={EMAIL_MAX_CHARS}
              required
              aria-invalid={Boolean(fieldErrors.email?.length)}
              aria-describedby={fieldErrors.email?.length ? 'staff-email-error' : undefined}
            />
          </div>
          <FieldErrors id="staff-email-error" messages={fieldErrors.email} />
        </div>
        <div className="wc-auth-field">
          <label htmlFor="staff-auth-password">Password <span aria-hidden="true">*</span></label>
          <div className="wc-auth-input-wrap">
            <Lock size={15} />
            <input
              id="staff-auth-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => updateField('password', e.target.value, setPassword)}
              autoComplete={applying ? 'new-password' : 'current-password'}
              required
              aria-invalid={Boolean(fieldErrors.password?.length)}
              aria-describedby={[
                fieldErrors.password?.length ? 'staff-password-error' : '',
                applying ? 'staff-password-requirements' : '',
              ].filter(Boolean).join(' ') || undefined}
            />
            <button type="button" className="wc-auth-eye" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <FieldErrors id="staff-password-error" messages={fieldErrors.password} />
        </div>

        {applying && <PasswordRequirements password={password} />}

        {!applying && (
          <div className="wc-auth-switch" style={{ textAlign: 'right', marginTop: -6 }}>
            <button type="button" onClick={forgotPassword} disabled={resetting}>{resetting ? 'Sending…' : 'Forgot password?'}</button>
          </div>
        )}
        {resetStatus && <div className="wc-auth-note" role="status">{resetStatus}</div>}
        {error && <div className="wc-auth-error" role="alert"><AlertCircle size={14} /> {error}</div>}
        <button type="submit" className="wc-btn-primary wc-auth-submit" disabled={submitting}>
          {submitting ? 'Please wait…' : applying ? 'Create account and apply' : 'Sign In'} <ArrowRight size={15} />
        </button>
      </form>
      <div className="wc-auth-switch">
        {applying ? (
          <>Already have an account? <button type="button" onClick={() => switchMode('signin')}>Sign In</button></>
        ) : (
          <>Want to help manage WeCooked recipes? <button type="button" onClick={() => switchMode('apply')}>Apply as Moderator</button></>
        )}
      </div>
      {applying && <div className="wc-auth-note">Submitting this form applies for review; it does not grant staff access immediately.</div>}
    </PortalFrame>
  );
}

function ActionError({ message }) {
  return message ? <div className="wc-auth-error" role="alert"><AlertCircle size={14} /> {message}</div> : null;
}

export function ConsumerScreen({ user, notice, onApply, onSignOut }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function apply() {
    setBusy(true); setError('');
    try { await onApply(); } catch (requestError) { setError(staffErrorMessage(requestError)); }
    finally { setBusy(false); }
  }
  return (
    <PortalFrame icon={<ShieldAlert size={20} color="#4A5D4E" />} title="No staff access" subtitle={<>You&rsquo;re signed in as <strong>{user?.email}</strong>. You don&rsquo;t currently have staff access.</>}>
      {notice && <div className="wc-portal-notice" role="status">{notice}</div>}
      <div className="wc-auth-sub">Want to help manage WeCooked recipes?</div>
      <ActionError message={error} />
      <button type="button" className="wc-btn-primary wc-auth-submit" onClick={apply} disabled={busy}>{busy ? 'Submitting…' : notice ? 'Retry Application' : 'Apply as Moderator'}</button>
      <div className="wc-auth-switch"><button type="button" onClick={onSignOut}>Sign Out</button></div>
    </PortalFrame>
  );
}

export function VerifyEmailState({ user, onResend, onRefresh, onSignOut }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function run(kind, action) {
    setBusy(kind); setMessage(''); setError('');
    try { await action(); if (kind === 'resend') setMessage(`Verification email sent to ${user?.email}.`); }
    catch (requestError) { setError(staffErrorMessage(requestError)); }
    finally { setBusy(''); }
  }
  return (
    <PortalFrame icon={<Mail size={20} color="#4A5D4E" />} title="Moderator Application" subtitle={<>Email verification required for <strong>{user?.email}</strong>.</>}>
      <div className="wc-portal-step"><Clock size={17} /> Open the verification email, follow its link, then refresh your status.</div>
      {message && <div className="wc-portal-notice" role="status">{message}</div>}
      <ActionError message={error} />
      <button type="button" className="wc-btn-primary wc-auth-submit" onClick={() => run('resend', onResend)} disabled={Boolean(busy)}>{busy === 'resend' ? 'Sending…' : 'Resend Verification Email'}</button>
      <button type="button" className="wc-btn-secondary wc-auth-submit" onClick={() => run('refresh', onRefresh)} disabled={Boolean(busy)}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh Status'}</button>
      <div className="wc-auth-switch"><button type="button" onClick={onSignOut}>Sign Out</button></div>
    </PortalFrame>
  );
}

export function PendingState({ onRefresh, onSignOut }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setBusy(true); setError('');
    try { await onRefresh(); } catch (requestError) { setError(staffErrorMessage(requestError)); }
    finally { setBusy(false); }
  }
  return (
    <PortalFrame icon={<Clock size={20} color="#4A5D4E" />} title="Moderator Application" subtitle="Your application is waiting for Admin review.">
      <div className="wc-portal-step"><CheckCircle2 size={17} /> Email verified</div>
      <div className="wc-portal-step"><Clock size={17} /> Moderator application pending Admin review</div>
      <ActionError message={error} />
      <button type="button" className="wc-btn-primary wc-auth-submit" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh Status'}</button>
      <div className="wc-auth-switch"><button type="button" onClick={onSignOut}>Sign Out</button></div>
    </PortalFrame>
  );
}

export function RejectedState({ reason, onApplyAgain, onSignOut }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function applyAgain() {
    setBusy(true); setError('');
    try { await onApplyAgain(); } catch (requestError) { setError(staffErrorMessage(requestError)); }
    finally { setBusy(false); }
  }
  return (
    <PortalFrame icon={<XCircle size={20} color="#B15A3E" />} title="Moderator application not approved" subtitle="You can review the decision and submit a new application.">
      <div className="wc-portal-reason"><strong>Reason</strong><span>{reason || 'No reason was provided.'}</span></div>
      <ActionError message={error} />
      <button type="button" className="wc-btn-primary wc-auth-submit" onClick={applyAgain} disabled={busy}>{busy ? 'Submitting…' : 'Apply Again'}</button>
      <div className="wc-auth-switch"><button type="button" onClick={onSignOut}>Sign Out</button></div>
    </PortalFrame>
  );
}

export function StaffBootstrapError({ message, onRetry, onSignOut }) {
  return (
    <PortalFrame icon={<AlertCircle size={20} color="#B15A3E" />} title="Staff Portal unavailable" subtitle={message}>
      <button type="button" className="wc-btn-primary wc-auth-submit" onClick={() => Promise.resolve(onRetry()).catch(() => {})}>Try Again</button>
      <div className="wc-auth-switch"><button type="button" onClick={onSignOut}>Sign Out</button></div>
    </PortalFrame>
  );
}

export function StaffPortalScreenStyles() {
  return <style>{`
    .wc-admin *:focus-visible { outline:2px solid var(--saffron); outline-offset:2px; }
    .wc-btn-secondary { display:flex; align-items:center; justify-content:center; gap:6px; background:transparent; color:var(--sage-deep); border:1px solid var(--sage-mid); padding:9px 16px; border-radius:8px; font-size:14px; font-weight:600; }
    .wc-btn-secondary:disabled { opacity:.6; cursor:default; }
    .wc-auth-field-errors { margin:5px 0 0; padding-left:18px; color:var(--clay); font-size:12px; line-height:1.4; }
    .wc-pw-requirements { margin:-4px 0 14px; }
    .wc-pw-title { margin-bottom:6px; color:var(--ink); font-size:12px; font-weight:700; }
    .wc-pw-requirements .wc-pw-checklist { margin:0; }
    .wc-pw-complete { margin-top:7px; color:var(--sage-deep); font-size:12px; font-weight:700; }
    .wc-portal-notice { background:rgba(192,213,194,.45); border:1px solid var(--sage-light); border-radius:8px; padding:10px 12px; font-size:12.5px; line-height:1.45; margin-bottom:12px; }
    .wc-portal-step { display:flex; align-items:center; gap:9px; padding:9px 0; color:var(--ink); font-size:13px; }
    .wc-portal-step svg { color:var(--sage-deep); flex-shrink:0; }
    .wc-portal-reason { display:flex; flex-direction:column; gap:5px; padding:12px; border-radius:9px; background:rgba(177,90,62,.1); border:1px solid rgba(177,90,62,.25); font-size:13px; line-height:1.45; margin-bottom:12px; }
  `}</style>;
}
