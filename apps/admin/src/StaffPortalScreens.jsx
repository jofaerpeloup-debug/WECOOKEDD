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
import staffSignInHero from './assets/auth/staff-sign-in-adobo.jpg';

export function FieldErrors({ id, messages = [] }) {
  if (!messages.length) return null;
  return (
    <ul id={id} className="wc-auth-field-errors" role="alert">
      {messages.map((message) => <li key={message}>{message}</li>)}
    </ul>
  );
}

export function PasswordRequirements({ password }) {
  const state = passwordRequirementState(password);
  const metCount = state.requirements.filter(({ met }) => met).length;
  return (
    <div id="staff-password-requirements" className="wc-pw-requirements">
      <div className="wc-pw-title">Password requirements</div>
      <ul className="wc-pw-checklist">
        {state.requirements.map(({ message, label, met }) => (
          <li key={message} className={met ? 'ok' : ''} aria-label={`${met ? 'Met' : 'Not met'}: ${label}`}>
            {met ? <Check size={13} /> : <span className="wc-pw-dot" />}{label}
          </li>
        ))}
      </ul>
      <span className="wc-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {state.meetsRequirements
          ? 'All password requirements met.'
          : `${metCount} of ${state.requirements.length} password requirements met.`}
      </span>
      {state.meetsRequirements && (
        <div className="wc-pw-complete">Meets password requirements</div>
      )}
    </div>
  );
}

export function SupportingAuthFrame({ icon, eyebrow, title, subtitle, children }) {
  return (
    <main className="wc-support-auth">
      <header className="wc-support-auth__brand" aria-label="WeCooked Staff Portal">
        <span className="wc-staff-auth__brand-mark" aria-hidden="true"><Leaf size={18} strokeWidth={2.25} /></span>
        <span className="wc-staff-auth__wordmark">WeCooked</span>
        <span className="wc-staff-auth__designation">Staff Portal</span>
      </header>

      <section className="wc-support-auth__panel" aria-labelledby="supporting-auth-title">
        <div className="wc-support-auth__status-icon" aria-hidden="true">{icon}</div>
        {eyebrow && <p className="wc-support-auth__eyebrow">{eyebrow}</p>}
        <h1 id="supporting-auth-title">{title}</h1>
        {subtitle && <div className="wc-support-auth__sub">{subtitle}</div>}
        <div className="wc-support-auth__content">{children}</div>
      </section>

      <aside className="wc-support-auth__context" aria-label="Staff Portal context">
        <p className="wc-support-auth__context-kicker">Thoughtful tools for trusted teams</p>
        <p className="wc-support-auth__context-title">Good food, thoughtfully managed.</p>
        <p>Help keep the WeCooked catalog useful, reliable, and welcoming.</p>
      </aside>
    </main>
  );
}

function StaffSignInFrame({ children }) {
  return (
    <main className="wc-staff-auth">
      <header className="wc-staff-auth__brand" aria-label="WeCooked Staff Portal">
        <span className="wc-staff-auth__brand-mark" aria-hidden="true"><Leaf size={18} strokeWidth={2.25} /></span>
        <span className="wc-staff-auth__wordmark">WeCooked</span>
        <span className="wc-staff-auth__designation">Staff Portal</span>
      </header>

      <section className="wc-staff-auth__intro" aria-labelledby="staff-auth-hero-title">
        <h1 id="staff-auth-hero-title" className="wc-staff-auth__headline">
          <span>KEEP EVERY</span>
          <span>RECIPE</span>
          <span className="wc-staff-auth__headline-accent">COOKABLE.</span>
        </h1>
        <p className="wc-staff-auth__lede">
          Manage recipe quality, ingredients, moderation, and catalog reliability for a better food community.
        </p>
      </section>

      <figure className="wc-staff-auth__media">
        <img
          src={staffSignInHero}
          alt="Chicken adobo with rice and egg in a ceramic bowl"
          width="1536"
          height="1024"
          decoding="async"
          fetchpriority="high"
        />
      </figure>

      <section className="wc-staff-auth__access" aria-labelledby="staff-sign-in-title">
        <div className="wc-staff-auth__panel">
          <h2 id="staff-sign-in-title">Staff Portal</h2>
          <p className="wc-staff-auth__support">Sign in with your WeCooked account to continue.</p>
          {children}
        </div>
      </section>
    </main>
  );
}

function ModeratorApplicationFrame({ children }) {
  return (
    <main className="wc-moderator-apply">
      <section className="wc-moderator-apply__context" aria-labelledby="moderator-application-title">
        <header className="wc-moderator-apply__brand" aria-label="WeCooked Staff Portal">
          <span className="wc-staff-auth__brand-mark" aria-hidden="true"><Leaf size={18} strokeWidth={2.25} /></span>
          <span className="wc-staff-auth__wordmark">WeCooked</span>
          <span className="wc-staff-auth__designation">Staff Portal</span>
        </header>

        <div className="wc-moderator-apply__intro">
          <p className="wc-moderator-apply__eyebrow">Moderator application</p>
          <h1 id="moderator-application-title">Apply as Moderator.</h1>
          <p>
            Help maintain recipe and catalog quality with access designed for careful, consistent moderation.
          </p>
        </div>

        <div className="wc-moderator-apply__review">
          <ShieldAlert size={18} aria-hidden="true" />
          <span>Staff access is reviewed before it is granted.</span>
        </div>
      </section>

      <section className="wc-moderator-apply__form-region" aria-labelledby="moderator-application-form-title">
        <div className="wc-moderator-apply__form-surface">
          <p className="wc-moderator-apply__form-kicker">Staff access request</p>
          <h2 id="moderator-application-form-title">Application details</h2>
          <p className="wc-moderator-apply__form-support">
            Create your WeCooked account and submit it for Moderator review.
          </p>
          {children}
        </div>
      </section>
    </main>
  );
}

export function StaffPortalAuthScreen({ onSignIn, onRegisterAndApply, onForgotPassword, notice = '', initialMode = 'signin' }) {
  const [mode, setMode] = useState(initialMode);
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
  const forgot = mode === 'forgot';

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

  async function forgotPassword(event) {
    event.preventDefault();
    if (!email.trim()) {
      setResetStatus('Enter your email above first.');
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

  if (forgot) {
    return (
      <SupportingAuthFrame
        icon={<Mail size={20} />}
        eyebrow="Account recovery"
        title="Forgot your password?"
        subtitle="Enter the email used for your WeCooked account. We’ll send reset instructions when the account is eligible."
      >
        <form onSubmit={forgotPassword} noValidate aria-busy={resetting}>
          <div className="wc-auth-field">
            <label htmlFor="staff-forgot-email">Email <span aria-hidden="true">*</span></label>
            <div className="wc-auth-input-wrap">
              <Mail size={15} />
              <input
                id="staff-forgot-email"
                type="email"
                value={email}
                onChange={(changeEvent) => setEmail(changeEvent.target.value)}
                autoComplete="username"
                maxLength={EMAIL_MAX_CHARS}
                required
              />
            </div>
          </div>
          {resetStatus && <div className="wc-support-auth__notice" role="status">{resetStatus}</div>}
          <button type="submit" className="wc-btn-primary wc-auth-submit" disabled={resetting}>
            {resetting ? 'Sending…' : 'Send Reset Instructions'} <ArrowRight size={15} />
          </button>
        </form>
        <div className="wc-auth-switch">
          <button type="button" onClick={() => switchMode('signin')}>Back to Sign In</button>
        </div>
      </SupportingAuthFrame>
    );
  }

  const formContent = (
    <>
      {notice && <div className="wc-settings-success" role="status">{notice}</div>}
      <form className={applying ? 'wc-apply-form' : undefined} onSubmit={submit} noValidate aria-busy={submitting}>
        {applying && (
          <div className="wc-auth-field wc-apply-form__name">
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
        <div className={`wc-auth-field${applying ? ' wc-apply-form__email' : ''}`}>
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
        <div className={`wc-auth-field${applying ? ' wc-apply-form__password' : ''}`}>
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
          <div className="wc-auth-switch wc-auth-forgot">
            <button type="button" onClick={() => switchMode('forgot')}>Forgot password?</button>
          </div>
        )}
        {error && <div className="wc-auth-error" role="alert"><AlertCircle size={14} /> {error}</div>}
        {applying && (
          <p className="wc-apply-form__review-note">
            Submitting applies for review; it does not grant staff access immediately.
          </p>
        )}
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
    </>
  );

  if (applying) {
    return (
      <ModeratorApplicationFrame>
        {formContent}
      </ModeratorApplicationFrame>
    );
  }

  return (
    <StaffSignInFrame>
      {formContent}
    </StaffSignInFrame>
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
    <SupportingAuthFrame icon={<ShieldAlert size={20} />} eyebrow="Account active" title="Staff access not enabled" subtitle={<>You&rsquo;re signed in as <strong>{user?.email}</strong>. This valid account does not currently have Staff Portal access.</>}>
      {notice && <div className="wc-support-auth__notice" role="status">{notice}</div>}
      <p className="wc-support-auth__prompt">Want to help manage WeCooked recipes? You can submit a Moderator application for review.</p>
      <ActionError message={error} />
      <button type="button" className="wc-btn-primary wc-auth-submit" onClick={apply} disabled={busy}>{busy ? 'Submitting…' : notice ? 'Retry Application' : 'Apply as Moderator'}</button>
      <div className="wc-auth-switch"><button type="button" onClick={onSignOut}>Sign Out</button></div>
    </SupportingAuthFrame>
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
    <SupportingAuthFrame icon={<Mail size={20} />} eyebrow="Verification required" title="Verify your email" subtitle={<>Confirm <strong>{user?.email}</strong> before your Moderator application can move forward.</>}>
      <div className="wc-support-auth__step"><Clock size={17} /> <span>Open the verification email, follow its link, then refresh your status.</span></div>
      {message && <div className="wc-support-auth__notice" role="status">{message}</div>}
      <ActionError message={error} />
      <button type="button" className="wc-btn-primary wc-auth-submit" onClick={() => run('resend', onResend)} disabled={Boolean(busy)}>{busy === 'resend' ? 'Sending…' : 'Resend Verification Email'}</button>
      <button type="button" className="wc-btn-secondary wc-auth-submit" onClick={() => run('refresh', onRefresh)} disabled={Boolean(busy)}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh Status'}</button>
      <div className="wc-auth-switch"><button type="button" onClick={onSignOut}>Sign Out</button></div>
    </SupportingAuthFrame>
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
    <SupportingAuthFrame icon={<Clock size={20} />} eyebrow="Application status" title="Under review" subtitle="Your Moderator application is waiting for Admin review. We don’t provide an approval timeline.">
      <div className="wc-support-auth__step"><CheckCircle2 size={17} /> <span>Email verified</span></div>
      <div className="wc-support-auth__step"><Clock size={17} /> <span>Moderator application pending Admin review</span></div>
      <ActionError message={error} />
      <button type="button" className="wc-btn-primary wc-auth-submit" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh Status'}</button>
      <div className="wc-auth-switch"><button type="button" onClick={onSignOut}>Sign Out</button></div>
    </SupportingAuthFrame>
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
    <SupportingAuthFrame icon={<XCircle size={20} />} eyebrow="Application status" title="Application not approved" subtitle="Your account remains active. You can review the decision and submit a new Moderator application.">
      {reason && <div className="wc-support-auth__reason"><strong>Reason</strong><span>{reason}</span></div>}
      <ActionError message={error} />
      <button type="button" className="wc-btn-primary wc-auth-submit" onClick={applyAgain} disabled={busy}>{busy ? 'Submitting…' : 'Apply Again'}</button>
      <div className="wc-auth-switch"><button type="button" onClick={onSignOut}>Sign Out</button></div>
    </SupportingAuthFrame>
  );
}

export function StaffBootstrapError({ message, onRetry, onSignOut }) {
  return (
    <SupportingAuthFrame icon={<AlertCircle size={20} />} eyebrow="Connection issue" title="Staff Portal unavailable" subtitle={message}>
      <button type="button" className="wc-btn-primary wc-auth-submit" onClick={() => Promise.resolve(onRetry()).catch(() => {})}>Try Again</button>
      <div className="wc-auth-switch"><button type="button" onClick={onSignOut}>Sign Out</button></div>
    </SupportingAuthFrame>
  );
}

export function StaffPortalScreenStyles() {
  return <style>{`
    .wc-btn-secondary { display:flex; align-items:center; justify-content:center; gap:6px; background:transparent; color:var(--sage-deep); border:1px solid var(--sage-mid); padding:9px 16px; border-radius:8px; font-size:14px; font-weight:600; }
    .wc-btn-secondary:disabled { opacity:.6; cursor:default; }
    .wc-auth-field-errors { margin:5px 0 0; padding-left:18px; color:var(--clay); font-size:12px; line-height:1.4; }
    .wc-pw-requirements { margin:-4px 0 14px; }
    .wc-pw-title { margin-bottom:6px; color:var(--ink); font-size:12px; font-weight:700; }
    .wc-pw-requirements .wc-pw-checklist { margin:0; }
    .wc-pw-complete { margin-top:7px; color:var(--sage-deep); font-size:12px; font-weight:700; }
  `}</style>;
}
