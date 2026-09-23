import { useEffect, useRef, useState } from 'react';
import type { FormEvent, InputHTMLAttributes, ReactNode } from 'react';
import { authClient } from '../../services/authClient';
import type { Account } from '../../types/auth';
import './AuthPage.css';

type Mode = 'login' | 'register' | 'forgot' | 'resend' | 'sent' | 'reset' | 'verified' | 'profile';
type IconName = 'arrow' | 'back' | 'mail' | 'lock' | 'eye' | 'eyeOff' | 'person' | 'team' | 'business' | 'check' | 'logout';

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    back: <><path d="M19 12H5m6-6-6 6 6 6" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3.1 3.9M6.2 6.2A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.1-1.2M10 10a3 3 0 0 0 4 4" /></>,
    person: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    team: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2" /></>,
    business: <><rect x="3" y="7" width="18" height="14" rx="3" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a24 24 0 0 0 18 0M12 11v4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    logout: <><path d="M10 4H5v16h5M9 12h12m-5-5 5 5-5 5" /></>,
  };
  return <svg className={`sana-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Field({ label, icon, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; icon: IconName; hint?: string }) {
  const [visible, setVisible] = useState(false);
  const isPassword = input.type === 'password';
  return <div className="sana-field">
    <label htmlFor={input.id}>{label}</label>
    <div className="sana-input-wrap">
      <Icon name={icon} />
      <input {...input} type={isPassword && visible ? 'text' : input.type} aria-describedby={hint ? `${input.id}-hint` : input['aria-describedby']} />
      {isPassword && <button className="sana-eye" type="button" onClick={() => setVisible(!visible)} aria-label={`${visible ? 'Скрыть' : 'Показать'} пароль: ${label.toLowerCase()}`} aria-pressed={visible} disabled={input.disabled}><Icon name={visible ? 'eyeOff' : 'eye'} /></button>}
    </div>
    {hint && <span className="sana-field-hint" id={`${input.id}-hint`}>{hint}</span>}
  </div>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`sana-brand ${compact ? 'sana-brand--compact' : ''}`} aria-label="AI Sana — TaskRank & TeamMatch">
    <span className="sana-brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
    <span>AI Sana<span className="sana-brand-dot">.</span></span>
    {!compact && <span className="sana-brand-product">TaskRank<br />& TeamMatch</span>}
  </div>;
}

function StoryPanel() {
  return <aside className="sana-story" aria-label="О платформе AI Sana">
    <Brand />
    <div className="sana-story-main">
      <p className="sana-eyebrow"><span /> МЕСТО ВСТРЕЧИ ИДЕЙ И КОМАНД</p>
      <h1>Реальные задачи.<br />Новые <em>возможности.</em></h1>
      <p className="sana-story-copy">Бизнес делится вызовами.<br />Студенты превращают знания в решения.<br />Здесь начинается ваша совместная работа.</p>
      <div className="sana-journey" aria-hidden="true">
        <div className="sana-journey-grid" />
        <svg className="sana-journey-path" viewBox="0 0 480 290" fill="none"><path d="M38 160C78 160 88 76 173 76S241 236 327 236s80-88 121-88" stroke="currentColor" strokeWidth="1.3" strokeDasharray="4 7" /><circle cx="38" cy="160" r="4" fill="currentColor" /><circle cx="448" cy="148" r="4" fill="currentColor" /></svg>
        <div className="sana-orbit sana-orbit--one" /><div className="sana-orbit sana-orbit--two" />
        <div className="sana-idea-card">
          <span className="sana-card-overline">НАЧИНАЕТСЯ С ИДЕИ</span>
          <span className="sana-card-icon"><Icon name="business" /></span>
          <strong>Задача бизнеса</strong>
          <span>Ясная цель. Понятный результат.</span>
          <div className="sana-card-line"><i /><i /><i /></div>
        </div>
        <div className="sana-team-card"><span className="sana-team-symbol"><Icon name="team" /></span><div><strong>Ваша команда</strong><span>Ваш следующий шаг</span></div><span className="sana-team-arrow">↗</span></div>
        <div className="sana-spark">✳</div>
      </div>
    </div>
    <div className="sana-story-footer"><span><b>01</b> Идея</span><i /><span><b>02</b> Задача</span><i /><span><b>03</b> Команда</span></div>
  </aside>;
}

const headings: Record<Mode, { eyebrow: string; title: string; description: string }> = {
  login: { eyebrow: 'РАДЫ ВИДЕТЬ ВАС СНОВА', title: 'Продолжим?', description: 'Войдите в аккаунт — ваши идеи ждут продолжения.' },
  register: { eyebrow: 'ВАШ ПЕРВЫЙ ШАГ', title: 'Начнём знакомство.', description: 'Создайте аккаунт и найдите свою роль в проекте.' },
  forgot: { eyebrow: 'ДОСТУП К АККАУНТУ', title: 'Забыли пароль?', description: 'Так бывает. Укажите почту аккаунта — мы отправим ссылку для восстановления.' },
  resend: { eyebrow: 'ПОДТВЕРЖДЕНИЕ ПОЧТЫ', title: 'Новое письмо.', description: 'Укажите почту аккаунта, чтобы запросить новую ссылку подтверждения.' },
  sent: { eyebrow: 'ОСТАЛСЯ ОДИН ШАГ', title: 'Проверьте почту.', description: '' },
  reset: { eyebrow: 'ВОССТАНОВЛЕНИЕ ДОСТУПА', title: 'Новый пароль.', description: 'Придумайте надёжный пароль, который вы ещё не использовали для этого аккаунта.' },
  verified: { eyebrow: 'ВСЁ ГОТОВО', title: 'Почта подтверждена.', description: 'Теперь можно войти в аккаунт и начать работу.' },
  profile: { eyebrow: 'ВАШ АККАУНТ', title: 'Вы на месте.', description: 'Здесь — ваш профиль и настройки писем.' },
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
}

export default function AuthPage({ onDemo }: { onDemo?: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [failedCallback, setFailedCallback] = useState<'recovery' | 'verification' | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [role, setRole] = useState<'student' | 'business'>('student');
  const [newsletter, setNewsletter] = useState(false);
  const [sentFor, setSentFor] = useState<'register' | 'forgot'>('register');
  const [resent, setResent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [verificationSuccess, setVerificationSuccess] = useState<'email' | 'password'>('email');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousMode = useRef(mode);

  useEffect(() => {
    let active = true;
    const callbackPath = window.location.pathname;
    void authClient.initialize().then((result) => {
      if (!active) return;
      setAccount(result.account);
      if (result.account) {
        setEmail(result.account.email);
        setNewsletter(result.account.newsletter_opt_in);
      }
      setMode(result.mode === 'recovery' ? 'reset' : result.mode === 'verified' ? 'verified' : result.account ? 'profile' : 'login');
      if (result.message) setNotice(result.message);
    }).catch((failure: unknown) => {
      if (active) {
        setError(errorMessage(failure));
        setFailedCallback(callbackPath === '/auth/reset-password' ? 'recovery' : callbackPath === '/auth/callback' ? 'verification' : null);
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (previousMode.current !== mode) {
      headingRef.current?.focus();
      previousMode.current = mode;
    }
  }, [mode]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setNotice('');
    setFailedCallback(null);
    setPassword('');
    setConfirmation('');
    setResent(false);
    setResendSeconds(0);
    if (next === 'register') setNewsletter(false);
  }

  function acceptAccount(next: Account) {
    setAccount(next);
    setEmail(next.email);
    setNewsletter(next.newsletter_opt_in);
  }

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((mode === 'register' || mode === 'reset') && password !== confirmation) {
      setError('Пароли не совпадают. Повторите новый пароль.');
      document.getElementById('sana-confirmation')?.focus();
      return;
    }
    if (mode === 'register' && !name.trim()) {
      setError('Введите ваше имя.');
      document.getElementById('sana-name')?.focus();
      return;
    }
    void perform(async () => {
      if (mode === 'login') {
        acceptAccount(await authClient.login(email.trim(), password));
        switchMode('profile');
      } else if (mode === 'register') {
        const result = await authClient.register({ email: email.trim(), password, full_name: name.trim(), role, newsletter_opt_in: newsletter });
        if (result.requires_email_confirmation === false) {
          acceptAccount(await authClient.me());
          switchMode('profile');
        } else {
          setSentFor('register');
          switchMode('sent');
          setResendSeconds(60);
        }
        setNotice(result.message);
      } else if (mode === 'forgot') {
        const result = await authClient.forgotPassword(email.trim());
        setSentFor('forgot');
        switchMode('sent');
        setResendSeconds(60);
        setNotice(result.message);
      } else if (mode === 'resend') {
        const result = await authClient.resendVerification(email.trim());
        setSentFor('register');
        switchMode('sent');
        setResendSeconds(60);
        setNotice(result.message);
      } else if (mode === 'reset') {
        const result = await authClient.resetPassword('', password);
        setAccount(null);
        setVerificationSuccess('password');
        switchMode('verified');
        setNotice(result.message);
      }
    });
  }

  function resend() {
    void perform(async () => {
      const result = sentFor === 'forgot' ? await authClient.forgotPassword(email.trim()) : await authClient.resendVerification(email.trim());
      setResent(true);
      setResendSeconds(60);
      setNotice(result.message);
    });
  }

  const heading = headings[mode];
  const isEntry = mode === 'login' || mode === 'register';
  const isForm = isEntry || mode === 'forgot' || mode === 'resend' || mode === 'reset';
  const successTitle = verificationSuccess === 'password' ? 'Пароль обновлён.' : heading.title;
  const submitLabel = mode === 'login' ? 'Войти в аккаунт' : mode === 'register' ? 'Создать аккаунт' : mode === 'forgot' || mode === 'resend' ? 'Отправить ссылку' : 'Сохранить пароль';

  return <div className="sana-auth">
    <a className="sana-skip" href="#sana-main">Перейти к форме</a>
    <StoryPanel />
    <div className="sana-right">
      <header className="sana-topbar">
        <div className="sana-mobile-brand"><Brand compact /></div>
        <span className="sana-topbar-label">ПРАКТИКА СО СМЫСЛОМ</span>
        {onDemo && <button type="button" className="sana-text-button sana-demo-button" onClick={onDemo} disabled={busy}>Открыть демо <span aria-hidden="true">↗</span></button>}
      </header>
      <main className={`sana-main ${mode === 'register' ? 'sana-main--register' : ''}`} id="sana-main">
        {loading ? <div className="sana-loading" role="status"><span className="sana-spinner" /><p>Готовим ваш аккаунт…</p></div> : <div className="sana-form-container" aria-busy={busy}>
          {isEntry && <nav className="sana-tabs" aria-label="Вход или регистрация"><button type="button" aria-pressed={mode === 'login'} onClick={() => switchMode('login')} disabled={busy}>Вход</button><button type="button" aria-pressed={mode === 'register'} onClick={() => switchMode('register')} disabled={busy}>Регистрация</button></nav>}
          {(mode === 'forgot' || mode === 'resend' || mode === 'reset' || mode === 'sent') && <button type="button" className="sana-back" onClick={() => switchMode('login')} disabled={busy}><Icon name="back" /> Вернуться ко входу</button>}
          {(mode === 'sent' || mode === 'verified') && <div className={`sana-state-icon ${mode === 'verified' ? 'sana-state-icon--success' : ''}`}><Icon name={mode === 'sent' ? 'mail' : 'check'} /></div>}
          <div className="sana-form-heading">
            <p className="sana-form-eyebrow">{heading.eyebrow}</p>
            <h2 ref={headingRef} tabIndex={-1}>{mode === 'verified' ? successTitle : heading.title}</h2>
            {heading.description && <p>{mode === 'verified' && verificationSuccess === 'password' ? 'Войдите с новым паролем, чтобы продолжить работу.' : mode === 'verified' && account ? 'Ваш адрес подтверждён. Можно переходить к аккаунту.' : heading.description}</p>}
          </div>
          {error && <div className="sana-message sana-message--error" role="alert"><span aria-hidden="true">!</span><p>{error}</p></div>}
          {failedCallback && <button type="button" className="sana-secondary sana-recovery-retry" onClick={() => switchMode(failedCallback === 'recovery' ? 'forgot' : 'resend')} disabled={busy}>Запросить новую ссылку</button>}
          {notice && (mode !== 'sent' || resent) && <div className="sana-message sana-message--success" role="status"><Icon name="check" /><p>{notice}</p></div>}

          {isForm && <form className="sana-form" onSubmit={submit}>
            {mode === 'register' && <fieldset className="sana-role-field" disabled={busy}><legend>Я здесь как</legend><div className="sana-roles">
              <label className={`sana-role ${role === 'student' ? 'is-selected' : ''}`}><input type="radio" name="role" value="student" checked={role === 'student'} onChange={() => setRole('student')} /><Icon name="team" /><span><strong>Студент</strong><small>Ищу задачи и опыт</small></span><i aria-hidden="true">{role === 'student' && <Icon name="check" />}</i></label>
              <label className={`sana-role ${role === 'business' ? 'is-selected' : ''}`}><input type="radio" name="role" value="business" checked={role === 'business'} onChange={() => setRole('business')} /><Icon name="business" /><span><strong>Бизнес</strong><small>Ищу команду</small></span><i aria-hidden="true">{role === 'business' && <Icon name="check" />}</i></label>
            </div></fieldset>}
            {mode === 'register' && <Field id="sana-name" name="full_name" label="Как вас зовут" icon="person" autoComplete="name" placeholder="Имя и фамилия" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} disabled={busy} />}
            {mode !== 'reset' && <Field id="sana-email" name="email" label="Электронная почта" icon="mail" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} disabled={busy} />}
            {mode !== 'forgot' && mode !== 'resend' && <Field id="sana-password" name="password" label={mode === 'reset' ? 'Новый пароль' : 'Пароль'} icon="lock" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Введите пароль' : 'Не менее 12 символов'} hint={mode !== 'login' ? 'От 12 символов. Можно использовать длинную фразу.' : undefined} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === 'login' ? 1 : 12} maxLength={128} required disabled={busy} />}
            {(mode === 'register' || mode === 'reset') && <Field id="sana-confirmation" name="password_confirmation" label="Повторите пароль" icon="lock" type="password" autoComplete="new-password" placeholder="Ещё раз, чтобы не ошибиться" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} maxLength={128} required disabled={busy} />}
            {mode === 'login' && <div className="sana-forgot-row"><span><Icon name="lock" /> Ваш личный аккаунт</span><button type="button" className="sana-text-button" onClick={() => switchMode('forgot')} disabled={busy}>Забыли пароль?</button></div>}
            {mode === 'register' && <label className="sana-checkbox"><input type="checkbox" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} disabled={busy} /><span>Хочу получать новости платформы по почте.<small>Необязательно. Отписаться можно в любой момент.</small></span></label>}
            <button type="submit" className="sana-primary" disabled={busy}>{busy ? <><span className="sana-spinner" /> Подождите…</> : <>{submitLabel}<Icon name="arrow" /></>}</button>
            {mode === 'login' && error && email && <button type="button" className="sana-text-button sana-resend-inline" disabled={busy} onClick={() => void perform(async () => { const result = await authClient.resendVerification(email.trim()); setSentFor('register'); switchMode('sent'); setResendSeconds(60); setNotice(result.message); })}>Отправить подтверждение почты повторно</button>}
          </form>}

          {mode === 'sent' && <div className="sana-sent">
            <p>{sentFor === 'forgot' ? 'Если аккаунт с этой почтой существует, на него придёт ссылка для смены пароля.' : 'Если для этого адреса требуется подтверждение, на него придёт письмо со ссылкой.'}</p>
            <div className="sana-recipient"><Icon name="mail" /><strong>{email}</strong></div>
            <div className="sana-mail-preview"><div className="sana-mail-preview-heading"><span className="sana-mail-avatar">S</span><div><strong>AI Sana</strong><span>Письмо от платформы</span></div></div><p>{sentFor === 'forgot' ? 'Восстановление доступа к AI Sana' : 'Подтвердите почту в AI Sana'}</p><span>{sentFor === 'forgot' ? 'В письме будет кнопка «Задать новый пароль».' : 'Откройте письмо и подтвердите ваш адрес.'}</span></div>
            <p className="sana-delivery-note">Письмо может идти несколько минут. Проверьте также папку «Спам».</p>
            <button type="button" className="sana-secondary" onClick={resend} disabled={busy || resendSeconds > 0}>{busy ? 'Отправляем…' : resendSeconds > 0 ? `Отправить ещё раз через ${resendSeconds} с` : 'Отправить письмо ещё раз'}</button>
            <button type="button" className="sana-text-button sana-centered" disabled={busy} onClick={() => switchMode(sentFor === 'forgot' ? 'forgot' : 'resend')}>Указать другую почту</button>
          </div>}

          {mode === 'verified' && <button type="button" className="sana-primary" onClick={() => switchMode(account ? 'profile' : 'login')}>{account ? 'Перейти в аккаунт' : 'Перейти ко входу'}<Icon name="arrow" /></button>}

          {mode === 'profile' && account && <div className="sana-profile">
            <p className="sana-delivery-note">Демо-задачи и команды сохраняются только в этом браузере.</p>
            <div className="sana-profile-card"><div className="sana-avatar">{account.full_name.trim().slice(0, 1).toUpperCase() || 'S'}</div><div><strong>{account.full_name}</strong><span>{account.email}</span><small>{account.role === 'student' ? 'Студент' : account.role === 'business' ? 'Представитель бизнеса' : 'Администратор'}</small></div></div>
            <div className="sana-verified-status"><Icon name={account.email_verified ? 'check' : 'mail'} /><span>{account.email_verified ? 'Электронная почта подтверждена' : 'Почта ожидает подтверждения'}</span></div>
            {!account.email_verified && <button type="button" className="sana-text-button" disabled={busy} onClick={() => void perform(async () => { const result = await authClient.resendVerification(account.email); setNotice(result.message); })}>Отправить письмо подтверждения</button>}
            <div className="sana-preferences"><h3>Письма от AI Sana</h3><label className="sana-checkbox"><input type="checkbox" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} disabled={busy} /><span>Новости и обновления платформы<small>Только с вашего согласия. Письма для восстановления доступа приходят независимо от подписки.</small></span></label><button className="sana-secondary" type="button" disabled={busy || newsletter === account.newsletter_opt_in} onClick={() => void perform(async () => { acceptAccount(await authClient.preferences(newsletter)); setNotice('Настройки писем сохранены.'); })}>{busy ? 'Сохраняем…' : 'Сохранить настройки'}</button></div>
            <button className="sana-profile-reset sana-text-button" type="button" disabled={busy} onClick={() => { setEmail(account.email); switchMode('forgot'); }}><Icon name="lock" /> Изменить пароль через почту <Icon name="arrow" /></button>
            <button className="sana-logout" type="button" disabled={busy} onClick={() => void perform(async () => { await authClient.logout(); setAccount(null); switchMode('login'); setNotice('Вы вышли из аккаунта.'); })}><Icon name="logout" /> Выйти из аккаунта</button>
          </div>}

          {isEntry && <p className="sana-alternate">{mode === 'login' ? 'Впервые здесь?' : 'Уже знакомы?'} <button type="button" className="sana-text-button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')} disabled={busy}>{mode === 'login' ? 'Создать аккаунт' : 'Войти в аккаунт'}<span aria-hidden="true"> ↗</span></button></p>}
        </div>}
      </main>
      <footer className="sana-footer"><span>AI Sana · TaskRank & TeamMatch</span><span>Вместе — от идеи к результату.</span></footer>
    </div>
  </div>;
}
