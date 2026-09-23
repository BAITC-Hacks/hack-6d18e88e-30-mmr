const message = document.querySelector('#message');
const sections = document.querySelectorAll('section');
const fragment = new URLSearchParams(location.hash.slice(1));
let actionToken = '';
let linkView = '';
for (const name of ['reset', 'verify', 'unsubscribe']) {
  if (fragment.has(name)) { linkView = name; actionToken = fragment.get(name); break; }
}
// Tokens stay in memory and never enter access logs, localStorage or referrer headers.
if (location.hash) history.replaceState(null, '', location.pathname);

function tell(text, error = false) {
  message.textContent = text;
  message.classList.toggle('error', error);
}
function show(name) {
  for (const section of sections) section.hidden = section.id !== name;
  document.querySelector('#navigation').hidden = name === 'profile';
}
async function api(path, body, method = 'POST') {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method, credentials: 'include', headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { throw new Error('Не удалось связаться с сервером. Попробуйте ещё раз.'); }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(typeof data.detail === 'string' ? data.detail : 'Проверьте заполнение полей.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function profile(user) {
  document.querySelector('#profile-name').textContent = user.full_name;
  document.querySelector('#profile-email').textContent = user.email;
  document.querySelector('#profile-role').textContent = { student: 'Студенческая команда', business: 'Бизнес', admin: 'Администратор' }[user.role];
  document.querySelector('#newsletter').checked = user.newsletter_opt_in;
  show('profile');
}
function bind(formId, handler) {
  const form = document.getElementById(formId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    tell('');
    try { await handler(Object.fromEntries(new FormData(form))); }
    catch (error) { tell(error.message, true); }
    finally { button.disabled = false; }
  });
}
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => { tell(''); show(button.dataset.view); });
}
bind('login-form', async (data) => { profile(await api('auth/login', data)); document.querySelector('#login-form').reset(); });
bind('register-form', async (data) => {
  const result = await api('auth/register', { ...data, newsletter_opt_in: data.newsletter_opt_in === 'on' });
  document.querySelector('#register-form').reset(); show('login'); tell(result.message);
});
bind('forgot-form', async (data) => tell((await api('auth/forgot-password', data)).message));
bind('resend-form', async (data) => tell((await api('auth/resend-verification', data)).message));
bind('reset-form', async (data) => {
  if (data.new_password !== data.confirm_password) throw new Error('Пароли не совпадают.');
  const result = await api('auth/reset-password', { token: actionToken, new_password: data.new_password });
  actionToken = ''; document.querySelector('#reset-form').reset(); show('login'); tell(result.message);
});
bind('verify-form', async () => {
  const result = await api('auth/verify-email', { token: actionToken });
  actionToken = ''; show('login'); tell(result.message);
});
bind('unsubscribe-form', async () => {
  const result = await api('mail/unsubscribe', { token: actionToken });
  actionToken = ''; show('login'); tell(result.message);
});
bind('preferences-form', async (data) => {
  profile(await api('auth/preferences', { newsletter_opt_in: data.newsletter_opt_in === 'on' }, 'PATCH'));
  tell('Настройки сохранены.');
});
document.querySelector('#logout').addEventListener('click', async (event) => {
  event.target.disabled = true;
  try { await api('auth/logout'); show('login'); tell('Вы вышли из аккаунта.'); }
  catch (error) { tell(error.message, true); }
  finally { event.target.disabled = false; }
});
async function initializeAccountPage() {
  show(linkView || 'login');
  try {
    const config = await api('auth/config', undefined, 'GET');
    if (config.provider === 'supabase' && linkView !== 'unsubscribe') {
      location.replace(config.account_url);
      return;
    }
    if (!linkView) profile(await api('auth/me', undefined, 'GET'));
  } catch (error) {
    if (error.status !== 401) tell(error.message, true);
  }
}
void initializeAccountPage();
