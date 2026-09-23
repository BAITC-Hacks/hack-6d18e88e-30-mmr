import { useId } from 'react';
import type { ReactNode } from 'react';
import type { Account } from '../../types/auth';
import './ProfilePanel.css';

interface ProfilePanelProps {
  account: Account;
  newsletter: boolean;
  busy: boolean;
  onNewsletterChange: (value: boolean) => void;
  onSavePreferences: () => void;
  onResetPassword: () => void;
  onResendVerification: () => void;
  onLogout: () => void;
  onDemo?: () => void;
}

type ProfileIconName = 'mail' | 'shield' | 'check' | 'arrow' | 'logout' | 'spark' | 'business' | 'student';

function ProfileIcon({ name }: { name: ProfileIconName }) {
  const paths: Record<ProfileIconName, ReactNode> = {
    mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8.5 11.5 2.5 2.5 4.5-5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    logout: <><path d="M10 4H5v16h5M10 12h11m-5-5 5 5-5 5" /></>,
    spark: <><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /><path d="M20 3v3m-1.5-1.5h3" /></>,
    business: <><rect x="3" y="7" width="18" height="14" rx="3" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a23 23 0 0 0 18 0M12 11v4" /></>,
    student: <><path d="m2 9 10-5 10 5-10 5L2 9ZM6 11v6c4 3 8 3 12 0v-6M22 9v7" /></>,
  };
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const roleDetails: Record<Account['role'], { label: string; title: string; description: string; icon: ProfileIconName }> = {
  student: {
    label: 'Студент',
    title: 'От знаний к реальным задачам.',
    description: 'Применяйте знания к задачам бизнеса и развивайте свои идеи вместе с командой.',
    icon: 'student',
  },
  business: {
    label: 'Представитель бизнеса',
    title: 'У вашей идеи есть продолжение.',
    description: 'Начните с потребности вашего бизнеса. Ясное описание помогает превратить идею в понятную задачу.',
    icon: 'business',
  },
  admin: {
    label: 'Администратор',
    title: 'Место, где встречаются идеи.',
    description: 'AI Sana объединяет потребности бизнеса и желание студентов применять знания на практике.',
    icon: 'spark',
  },
};

export default function ProfilePanel({
  account,
  newsletter,
  busy,
  onNewsletterChange,
  onSavePreferences,
  onResetPassword,
  onResendVerification,
  onLogout,
  onDemo,
}: ProfilePanelProps) {
  const preferencesId = useId();
  const name = account.full_name.trim() || 'Участник AI Sana';
  const initials = name.split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0]).join('').toLocaleUpperCase('ru');
  const role = roleDetails[account.role];
  const preferencesChanged = newsletter !== account.newsletter_opt_in;

  return <div className="sana-account" aria-busy={busy}>
    <section className="sana-account-hero" aria-labelledby="sana-account-name">
      <div className="sana-account-hero-art" aria-hidden="true"><i /><i /><i /></div>
      <div className="sana-account-avatar-wrap">
        <div className="sana-account-avatar" aria-hidden="true">{initials}</div>
        {account.email_verified && <span className="sana-account-avatar-check" aria-hidden="true"><ProfileIcon name="check" /></span>}
      </div>
      <div className="sana-account-welcome">
        <p className="sana-account-eyebrow">Ваше личное пространство</p>
        <h1 id="sana-account-name">{name}</h1>
        <p className="sana-account-intro">Всё важное — в одном месте. Настройте аккаунт под себя.</p>
        <div className="sana-account-badges">
          <span className="sana-account-role"><ProfileIcon name={role.icon} />{role.label}</span>
          <span className={`sana-account-status ${account.email_verified ? 'sana-account-status--verified' : 'sana-account-status--pending'}`}>
            <span aria-hidden="true" />{account.email_verified ? 'Почта подтверждена' : 'Подтвердите почту'}
          </span>
        </div>
      </div>
    </section>

    <div className="sana-account-grid">
      <section className="sana-account-card sana-account-details" aria-labelledby="sana-account-details-title">
        <div className="sana-account-card-heading">
          <span className="sana-account-icon-box"><ProfileIcon name="mail" /></span>
          <div><p className="sana-account-kicker">На связи</p><h2 id="sana-account-details-title">Ваш аккаунт</h2></div>
        </div>
        <dl className="sana-account-data">
          <div><dt>Имя</dt><dd>{name}</dd></div>
          <div><dt>Электронная почта</dt><dd className="sana-account-email">{account.email}</dd></div>
          <div><dt>Роль на платформе</dt><dd>{role.label}</dd></div>
        </dl>
        <div className={`sana-account-email-note ${account.email_verified ? '' : 'sana-account-email-note--pending'}`}>
          <ProfileIcon name={account.email_verified ? 'check' : 'mail'} />
          <p>{account.email_verified ? 'Этот адрес используется для входа и восстановления доступа.' : 'Подтвердите адрес, чтобы завершить настройку аккаунта. Мы пришлём письмо со ссылкой.'}</p>
        </div>
        {!account.email_verified && <button className="sana-account-button sana-account-button--subtle" type="button" disabled={busy} onClick={onResendVerification}>Отправить подтверждение<ProfileIcon name="arrow" /></button>}
      </section>

      <section className="sana-account-card sana-account-notifications" aria-labelledby="sana-account-notifications-title">
        <div className="sana-account-card-heading">
          <span className="sana-account-icon-box"><ProfileIcon name="spark" /></span>
          <div><p className="sana-account-kicker">Только полезное</p><h2 id="sana-account-notifications-title">Письма от AI Sana</h2></div>
        </div>
        <p className="sana-account-card-description">Вы решаете, что будет в вашей почте.</p>
        <label className="sana-account-newsletter" htmlFor={preferencesId}>
          <span><strong>Новости платформы</strong><span id={`${preferencesId}-description`}>Обновления и новые возможности AI Sana.</span></span>
          <span className="sana-account-switch">
            <input id={preferencesId} type="checkbox" role="switch" checked={newsletter} aria-describedby={`${preferencesId}-description`} onChange={(event) => onNewsletterChange(event.target.checked)} disabled={busy} />
            <span className="sana-account-switch-track" aria-hidden="true"><i /></span>
          </span>
        </label>
        <p className="sana-account-service-note">Письма для подтверждения почты и восстановления пароля приходят независимо от подписки.</p>
        <div className="sana-account-save-area">
          <p className="sana-account-save-state" aria-live="polite">{preferencesChanged ? 'Есть несохранённые изменения' : 'Настройки сохранены'}</p>
          <button className="sana-account-button sana-account-button--primary" type="button" disabled={busy || !preferencesChanged} onClick={onSavePreferences}>Сохранить настройки<ProfileIcon name="check" /></button>
        </div>
      </section>

      <section className="sana-account-card sana-account-security" aria-labelledby="sana-account-security-title">
        <div className="sana-account-card-heading">
          <span className="sana-account-icon-box"><ProfileIcon name="shield" /></span>
          <div><p className="sana-account-kicker">Доступ под контролем</p><h2 id="sana-account-security-title">Пароль и вход</h2></div>
        </div>
        <p className="sana-account-card-description">Хотите сменить пароль? Запросите персональную ссылку на вашу почту и задайте новый пароль.</p>
        <button className="sana-account-button sana-account-button--subtle" type="button" disabled={busy} onClick={onResetPassword}>Изменить пароль<ProfileIcon name="arrow" /></button>
      </section>

      <section className="sana-account-card sana-account-next" aria-labelledby="sana-account-next-title">
        <div className="sana-account-next-art" aria-hidden="true"><span /><span /><span /></div>
        <p className="sana-account-kicker">Ваша следующая глава</p>
        <h2 id="sana-account-next-title">{role.title}</h2>
        <p className="sana-account-card-description">{role.description}</p>
        {onDemo && <button className="sana-account-button sana-account-button--text" type="button" disabled={busy} onClick={onDemo}>Открыть демо<ProfileIcon name="arrow" /></button>}
      </section>
    </div>

    <footer className="sana-account-footer">
      <p><ProfileIcon name="shield" />Личное пространство AI Sana</p>
      <button className="sana-account-logout" type="button" onClick={onLogout} disabled={busy}><ProfileIcon name="logout" />Выйти из аккаунта</button>
    </footer>
  </div>;
}
