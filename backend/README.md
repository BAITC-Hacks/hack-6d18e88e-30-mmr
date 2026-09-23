# AI Sana backend: аккаунты и почта

Главная страница аккаунта теперь находится в React: **http://localhost:5173**.
Регистрация, вход, восстановление, новый пароль, профиль и подписка оформлены в одном интерфейсе.

Поддерживаются два режима:

- **Supabase**: аккаунты в Supabase Auth, профили и очередь рассылок в PostgreSQL. Подтверждение и сброс отправляет Supabase через SMTP, настроенный в его панели.
- **Локальная разработка**: если Supabase-параметры пустые, `npm run dev` работает с прежним FastAPI + SQLite. Письма по умолчанию сохраняются как `.eml`.

Настроенный Supabase никогда не переключается на локальную базу при ошибке. Production-сборка frontend требует Supabase-конфигурацию.

## Запуск

Из корня репозитория (Python 3.11+):

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
# Только если .env ещё не существует:
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000
```

В другом терминале:

```powershell
cd frontend
npm ci
npm run dev
```

Существующую `.venv` можно использовать повторно. Старый запуск `uvicorn main:app` из `backend` тоже поддерживается.
`.env` бэкенда читается из корня репозитория, frontend читает `frontend/.env.local`.

- Аккаунт: http://localhost:5173
- Предпросмотр письма сброса: http://localhost:8000/email-preview/recovery
- Предпросмотр подтверждения: http://localhost:8000/email-preview/confirmation
- Swagger: http://localhost:8000/docs
- Health: http://localhost:8000/health
- Старые локальные формы / отписка от новостей: http://localhost:8000/account

## Подключение Supabase

Полная инструкция с SQL и настройками писем: **[docs/SUPABASE_SETUP.md](../docs/SUPABASE_SETUP.md)**.

1. Заполнить публичные URL/key в `frontend/.env.local` по `frontend/.env.example`.
2. Заполнить `SUPABASE_URL` и `SUPABASE_PUBLISHABLE_KEY` в корневом `.env`, указать `AUTH_PROVIDER=supabase`.
3. Применить миграции из `supabase/migrations` в SQL Editor проекта.
4. Настроить Email provider, Site URL и SMTP в панели Supabase.
5. Вставить HTML из `supabase/email-templates` в Confirm sign up / Reset password.
6. Перезапустить frontend/backend и проверить регистрацию, подтверждение и сброс.

Пароли хранятся только в Supabase Auth; `profiles` хранит UUID, имя, защищённую роль и согласие на новости.
При signup SQL-триггер создаёт профиль автоматически. RLS и права на столбцы запрещают чтение чужого профиля и изменение своей роли.
Существующие локальные аккаунты автоматически в Supabase не переносятся.

В браузере клиент Supabase управляет сессией через свой LocalStorage и обновляет токены. На сервере `Depends(current_user)` проверяет Bearer-токен через Supabase Auth и читает роль из защищённого профиля. `GET /api/auth/me` поддерживает эту проверку.
`GET /api/auth/config` показывает выбранный режим без ключей. В Supabase-режиме старые SQLite-методы login/register/reset не публикуются.
API-ключи AI и серверный `SUPABASE_SECRET_KEY` никогда не попадают в frontend.

## Локальный сценарий без внешних писем

Оставьте Supabase-параметры пустыми, `MAIL_BACKEND=file`, `AUTH_PAGE_URL=http://localhost:5173`.
Откройте React, зарегистрируйте тестовый аккаунт. Через несколько секунд письмо появится в `backend/data/mail`.
Найдите его ID и прочитайте текст:

```powershell
.\.venv\Scripts\python.exe -m backend.manage mail-status
.\.venv\Scripts\python.exe -m backend.manage preview-mail 1
```

Откройте ссылку. Подтверждение действует 24 часа, сброс — 30 минут; повторный запрос заменяет предыдущую ссылку.
Локальные письма содержат текстовую и HTML-версию. `.eml` можно открыть в почтовой программе.
После сброса локальные сессии отзываются, вход выполняется новым паролем.
Ссылки очищаются из URL браузера; при обновлении страницы сброса может потребоваться новое письмо.

Локальные пароли хешируются Argon2id, сессии хранятся в HttpOnly-cookie, токены в базе — в виде SHA-256.
Используйте один hostname последовательно (`localhost` или `127.0.0.1`).
Локальные cookie-запросы на изменение данных требуют доверенный `Origin` (браузер выставляет сам).

## Рассылки

Supabase Auth SMTP отправляет письма аккаунта. **Новости отправляет FastAPI**, поэтому для них отдельно нужны настройки корневого `.env`:

```dotenv
MAIL_BACKEND=smtp
MAIL_FROM=AI Sana <your-address@gmail.com>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-address@gmail.com
SMTP_PASSWORD=your-app-password
UNSUBSCRIBE_PAGE_URL=http://localhost:8000/account
```

Для Gmail используется пароль приложения, если разрешён аккаунтом. [Справка Google](https://support.google.com/accounts/answer/185833?hl=ru).
`587` использует STARTTLS, `465` — SSL с проверкой сертификата. Для предварительного просмотра оставьте `MAIL_BACKEND=file`.

В Supabase-режиме дополнительно нужен `SUPABASE_SECRET_KEY` **только на сервере** и миграция 002.
Без него обычный вход работает, но серверные рассылки возвращают понятную ошибку настройки.
Администратора назначает владелец проекта через SQL из инструкции. В локальном режиме:

```powershell
.\.venv\Scripts\python.exe -m backend.manage make-admin your-verified-email@example.com
```

API администратора:

```text
POST /api/mail/campaigns
{"subject":"Новые задачи AI Sana","text":"В каталоге появились новые задачи для команд."}

GET /api/mail/campaigns/{id}
```

В Supabase-режиме передавайте `Authorization: Bearer <токен текущего пользователя>`.
Его можно получить через `authClient.getAccessToken()`. Service key браузеру не нужен.
В локальном режиме используется cookie после входа и доверенный Origin.

Получатели выбираются только среди подтверждённых подписчиков; проверка повторяется перед отправкой.
Каждый получает отдельное письмо и ссылку отписки. Лимит MVP — 500 получателей/кампания, 3 кампании за 15 минут с IP.
Очередь сохраняется после перезапуска, делает до пяти попыток с задержкой. Статусы: pending, sending, sent, preview, failed, skipped.
`sent` значит принятие SMTP-сервером, а не гарантию попадания во входящие.
После аварии между отправкой и записью статуса редкое повторное письмо возможно.

```powershell
.\.venv\Scripts\python.exe -m backend.manage mail-status
.\.venv\Scripts\python.exe -m backend.manage send-pending
```

Тела успешно отправленных писем удаляются из очереди. Локальные задания старше 7 дней очищаются фоновым worker;
для Supabase архивирование старых кампаний пока выполняется владельцем проекта. Локальные `.eml` остаются до ручного удаления.
SQLite в Supabase-режиме используется только для локального rate limit; аккаунты и почтовая очередь в нём не дублируются.

## Проверки

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_accounts.py tests/test_supabase_backend.py -q
cd frontend
npm test
npm run build
cd ..
node supabase/tests/run-migrations.mjs
```

Тесты используют временные базы, подменённые Supabase/SMTP ответы и PostgreSQL WASM. Реальных писем не отправляют.
Облачные миграции, реальные настройки Auth и доставку на почту надо проверить отдельно после подключения проекта.

Выполненные изменения не реализуют конструктор задач, рейтинг или AI: `/api/ai/analyze` пока остаётся исходной заглушкой.
Существующий переключатель ролей сохранён за кнопкой «Открыть демо»; это демо-интерфейс, не источник серверных прав.
