# Этап 1 — аккаунты и email

Небольшой модуль FastAPI + SQLite: регистрация, подтверждение email, вход, выход,
профиль, восстановление пароля и рассылки подписчикам через SMTP.
Python 3.11+. Отдельные PostgreSQL, Redis и сервер очередей не нужны.

Согласно `case_task.txt`, аккаунты необязательны для защиты. Этот этап добавлен
по отдельному запросу: он не меняет рейтинг, каталог, переключатель демо-ролей,
отклики или ручной выбор команды. После слияния также доступны AI analyze/build-card,
OpenAI/NVIDIA, проверка схем и локальный fallback; см. корневой README.

## 1. Запуск

Из корня репозитория в PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
# Только если .env ещё не создан:
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000
```

Если `.venv` уже есть, первые две команды можно пропустить после установки зависимостей.
Также поддерживается прежний запуск `uvicorn main:app` из папки `backend`.
`.env` всегда читается из корня репозитория, независимо от рабочей папки.

- Формы аккаунта: http://localhost:8000/account
- Swagger: http://localhost:8000/docs
- Проверка сервера: http://localhost:8000/health и `/api/health`

База создаётся автоматически в `backend/data/app.sqlite3`. Она переживает перезапуск.
Папка `backend/data/`, база, письма и `.env` исключены из Git.

## 2. Подключение своего SMTP

В корневом `.env` установи:

```dotenv
MAIL_BACKEND=smtp
MAIL_FROM=AI Sana <your-address@gmail.com>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-address@gmail.com
SMTP_PASSWORD=your-app-password
AUTH_PAGE_URL=http://localhost:8000/account
```

Подставь свои значения и перезапусти сервер. Для Gmail используй пароль приложения,
если он разрешён настройками аккаунта; обычный пароль аккаунта сюда не подходит.
Для другого провайдера укажи его SMTP-хост, порт и учётные данные.
Порт 587 использует STARTTLS, 465 — SSL; сертификат проверяется в обоих режимах.
Настройки Gmail: [официальная справка Google](https://support.google.com/mail/answer/7104828).

Ключи OpenAI/NVIDIA и SMTP-пароль находятся только на сервере. Во frontend нельзя
помещать их в переменные с префиксом `VITE_`: такие значения попадают в браузер.
Здесь SMTP использует логин и пароль приложения, а не API-ключ AI-провайдера.

После регистрации письмо ставится в SQLite-очередь. Фоновый обработчик проверяет
её каждые 5 секунд. Ошибки не пропадают: письмо повторяется до 5 попыток с задержкой.
Статус `sent` означает, что SMTP-сервер принял письмо, а не подтверждение попадания
во входящие. Если письма нет, проверь «Спам» и статус очереди:

```powershell
.\.venv\Scripts\python.exe -m backend.manage mail-status
```

Статусы: `pending`, `sending`, `sent`, `preview`, `failed`, `skipped`.
`last_error` содержит тип ошибки без пароля и тела письма. После исправления SMTP
можно запросить новое письмо через форму. Ручная обработка готовых к отправке писем:

```powershell
.\.venv\Scripts\python.exe -m backend.manage send-pending
```

## 3. Проверка без реальных писем

По умолчанию `MAIL_BACKEND=file`: письма сохраняются как `.eml` в `backend/data/mail/`.
Никаких внешних писем в этом режиме не отправляется, статус — `preview`.
Зарегистрируй аккаунт, подожди до 5 секунд, затем найди ID письма и прочитай его:

```powershell
.\.venv\Scripts\python.exe -m backend.manage mail-status
.\.venv\Scripts\python.exe -m backend.manage preview-mail 1
```

Открой ссылку из письма, нажми «Подтвердить мой email», затем войди.
Проверь обновление страницы, выход, повторный вход и «Забыли пароль?».
Ссылка сброса действует 30 минут; подтверждение email — 24 часа.
Сброс завершает все сессии аккаунта. При повторном запросе предыдущая ссылка заменяется.
Обновление страницы со ссылкой удаляет токен из памяти: при необходимости открой письмо снова.

## 4. Контракт для frontend-разработчика

Готовые файлы:

- `frontend/src/types/auth.ts` — `Account`, `Registration`, роли.
- `frontend/src/services/authClient.ts` — методы регистрации, входа и восстановления.
- `backend/static/account.*` — отдельные рабочие формы для тестирования и образец интеграции.

Общий `App.tsx`, Zustand Store и папки коллег не изменены. Формы `/account` пока
не встроены в React; коллега может подключить клиент в свои компоненты:

```typescript
import { authClient } from './services/authClient';

await authClient.register({
  email: 'person@example.com',
  password: 'A strong password 123!',
  full_name: 'Имя',
  role: 'business',
  newsletter_opt_in: false,
});
// После подтверждения почты:
const account = await authClient.login('person@example.com', 'A strong password 123!');
const restored = await authClient.me(); // при загрузке приложения; 401 = гость
await authClient.logout();
```

Для другого адреса API задай `VITE_API_BASE_URL` в `frontend/.env.local` (только URL).
Cookie `HttpOnly` отправляется через `credentials: 'include'`. Токен сессии не
возвращается в JSON и не хранится в LocalStorage. Роль аккаунта приходит от сервера;
`activeRole` в существующем демо-store остаётся лишь переключателем интерфейса.

| Метод и путь | Тело JSON | Результат |
| --- | --- | --- |
| POST `/api/auth/register` | `email`, `password`, `full_name`, `role`, `newsletter_opt_in` | 202, письмо подтверждения |
| POST `/api/auth/verify-email` | `token` | Подтверждение адреса |
| POST `/api/auth/resend-verification` | `email` | 202, новое письмо |
| POST `/api/auth/login` | `email`, `password` | Account + cookie |
| GET `/api/auth/me` | — | Account или 401 |
| POST `/api/auth/logout` | — | Отзыв текущей сессии |
| POST `/api/auth/forgot-password` | `email` | 202, одинаковый ответ для известных и неизвестных адресов |
| POST `/api/auth/reset-password` | `token`, `new_password` | Сброс + отзыв всех сессий |
| PATCH `/api/auth/preferences` | `newsletter_opt_in` | Обновлённый Account |
| POST `/api/mail/unsubscribe` | `token` | Отписка без входа |

Пароль: 12–128 символов. Самостоятельно можно выбрать только `student` или `business`.
Лишние поля (например, `role: admin` в настройках) отклоняются.

Запросы с cookie, меняющие состояние, требуют разрешённый `Origin` из `API_ALLOWED_ORIGINS` или дополнительного `CORS_ORIGINS`.
Браузер выставляет его сам; для curl/Postman добавь `Origin: http://localhost:8000`.
Для разработки используй один хост последовательно: `localhost` и `127.0.0.1`
не взаимозаменяемы для cookie. В development без API_ACCESS_TOKEN Swagger работает после входа на `/account` на том же хосте.

Для будущих серверных методов доступны `Depends(current_user)` и
`Depends(require_role('business'))` из `backend/services/security.py`.
Проверку владельца конкретной задачи нужно добавить вместе с её серверной моделью.
Текущие данные задач в браузере не становятся защищёнными просто от наличия аккаунтов.

## 5. Рассылки

Сначала зарегистрируй и подтверди собственный аккаунт, затем локально назначь его
администратором (публичного API назначения администратора нет):

```powershell
.\.venv\Scripts\python.exe -m backend.manage make-admin your-address@gmail.com
```

Войди через `/account`. В Swagger выполни `POST /api/mail/campaigns`:

```json
{
  "subject": "Новые задачи AI Sana",
  "text": "В каталоге появились новые задачи. Заходите выбрать проект для команды."
}
```

Ответ содержит `id` и `queued`. Статусы получишь через
`GET /api/mail/campaigns/{id}`. Статистика хранится 7 дней, после чего задания
удаляются из очереди; запись кампании остаётся без подробной статистики.
Адреса получателей не принимаются из запроса: выбираются только пользователи
с подтверждённой почтой и явным согласием. Каждому отправляется отдельное письмо
со ссылкой отписки. Перед отправкой согласие проверяется ещё раз.
Отписка от новостей не отключает восстановление пароля и подтверждение email.
Лимит этого MVP — 500 получателей на кампанию и 3 кампании за 15 минут с одного IP.

## 6. Проверки и границы этапа

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_accounts.py -q
```

Тесты используют отдельные временные базы и подменённый SMTP, реальные письма не отправляются.
Проверяются роли, валидация, сессии, срок и одноразовость токенов, CSRF, лимиты,
согласие и отписка, SMTP TLS, повтор отправки и сохранение данных после перезапуска.

Пароли хешируются Argon2id. Сессии и одноразовые токены хранятся как SHA-256 от
случайного секрета, а не как исходный секрет. Тело ожидающего письма содержит ссылку
и очищается после успешной доставки; локальные `.eml` остаются до ручного удаления.
Базу, резервные копии и папку писем нельзя публиковать или включать в общий репозиторий.
Подход к токенам: [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

Для размещения задай реальные `AUTH_PAGE_URL`, `CORS_ORIGINS`, HTTPS и
`COOKIE_SECURE=true`; frontend и API должны находиться на одном сайте для SameSite=Lax.
За reverse proxy доверяй forwarded-заголовкам только от своего прокси.
SQLite и встроенная очередь рассчитаны на небольшой MVP, не на массовый почтовый сервис.
SMTP не гарантирует ровно одну доставку при аварии после принятия письма сервером,
но до записи статуса в SQLite: редкий повтор возможен.

Общие проверки интеграции: `npm run check` из корня. AI-маршруты сохраняют bearer-защиту; зарегистрированные методы аккаунтов/почты используют собственные сессии и токены. В production задайте APP_ENV=production, API_ACCESS_TOKEN, API_ALLOWED_HOSTS и API_ALLOWED_ORIGINS (HTTPS). Swagger отключён в production.
