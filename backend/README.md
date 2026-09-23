# AI Sana backend: аккаунты и почта

Главная страница аккаунта теперь находится в React: **http://localhost:5173**.
Регистрация, вход, восстановление, новый пароль, профиль и подписка оформлены в одном интерфейсе.
В этот же FastAPI объединены анализ бизнес-задач, уточняющие вопросы, сборка карточки и Prompt Inspector из ветки `alim`.

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
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --reload --port 8000 --no-proxy-headers
```

В другом терминале:

```powershell
cd frontend
npm ci
npm run dev
```

Существующую `.venv` можно использовать повторно. Старый запуск `uvicorn main:app` из `backend` тоже поддерживается.
`.env` бэкенда читается из корня репозитория; необязательный `backend/.env` дополняет отсутствующие переменные.
Существующие переменные процесса имеют приоритет. Frontend читает `frontend/.env.local`.

- Аккаунт: http://localhost:5173
- Предпросмотр письма сброса: http://localhost:8000/email-preview/recovery
- Предпросмотр подтверждения: http://localhost:8000/email-preview/confirmation
- Swagger: http://localhost:8000/docs
- Health: http://localhost:8000/health
- Старые локальные формы / отписка от новостей: http://localhost:8000/account

## AI и общие ограничения API

- `POST /api/ai/analyze` принимает `draft` и необязательный `industry`, возвращает извлечённые поля и минимум три вопроса.
- `POST /api/ai/generate-card` принимает черновик и ответы, возвращает редактируемую неподтверждённую карточку.
- `GET /api/ai/inspector` показывает промпты, схемы и правила обработки ошибок.

Без AI-ключей работает локальный fallback. Для внешнего анализа задайте серверный `OPENAI_API_KEY` или `NVIDIA_API_KEY`,
при необходимости `AI_MODEL`; если заполнены оба ключа, используется OpenAI. AI не подтверждает и не публикует карточку.
Файл `shared/aiScopePolicy.json` нужен и backend, и frontend. Ошибки тематики `OFF_TOPIC`/`PROMPT_INJECTION`
возвращаются как HTTP 422 и не обходятся локальным fallback. Подробности формулы рейтинга и сценария — в корневом README.

Development принимает только loopback-клиентов и разрешённые Host/Origin. `--no-proxy-headers` сохраняет эту проверку.
На всех API действуют лимиты запросов и строгая JSON-валидация; cookie-операции дополнительно требуют доверенный Origin.
При `APP_ENV=production` обязательны `API_ALLOWED_HOSTS`, HTTPS `API_ALLOWED_ORIGINS` и серверный `API_ACCESS_TOKEN`
из 32–256 символов; Swagger отключается. Secure-cookie включаются по умолчанию; явное `COOKIE_SECURE=false` в production отклоняется.
`API_ALLOWED_ORIGINS` имеет приоритет над прежним `CORS_ORIGINS`; используйте точные HTTPS origins в production.

При заданном `API_ACCESS_TOKEN` все `/api/*`, включая account/mail/config, требуют серверный deployment-токен.
Gateway передаёт его в `X-API-Access-Token`, сохраняя `Authorization: Bearer <токен пользователя>` для Supabase.
Если отдельный заголовок отсутствует, серверный токен можно передать через `Authorization`; это не заменяет пользовательскую сессию.
Account/mail-маршруты дополнительно проверяют свои cookie, одноразовые токены или пользовательский Supabase bearer.
Токен gateway нельзя помещать в браузер или `VITE_*`; gateway должен отдельно проверять право доступа пользователя.
Неизвестные пути и методы не получают исключение. В локальном development `API_ACCESS_TOKEN` по умолчанию пустой,
поэтому frontend обращается к API напрямую. Готовый production gateway в проект не входит.

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

## Настоящие письма через Python, без Supabase

FastAPI умеет самостоятельно отправлять подтверждение почты, восстановление пароля и рассылки через SMTP.
Для этого не нужны ключи Supabase. Существующие локальные аккаунты остаются в SQLite.

Откройте **корневой `.env`** — рядом с этим репозиторием `README.md`, папками `backend` и `frontend`.
Это не `frontend/.env.local` и не `.env.example`. Заполните:

```dotenv
AUTH_PROVIDER=local
AUTH_PAGE_URL=http://localhost:5173
MAIL_BACKEND=smtp
MAIL_WORKER_ENABLED=true
MAIL_FROM=AI Sana <your-address@gmail.com>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-address@gmail.com
SMTP_PASSWORD=your-app-password
```

Для текстовых писем подтверждения и сброса укажите `AUTH_MAIL_FORMAT=text`.
При `AUTH_MAIL_FORMAT=html` (по умолчанию) письмо содержит текстовую и оформленную HTML-версию.
HTML-шаблоны оформлены в стиле Aurora Glass: тёмная брендовая панель, бирюзовые акценты и контрастная кнопка.
Почтовая вёрстка использует inline-стили и таблицы; текстовая версия остаётся альтернативой для почтовых клиентов.
Срок действия и одноразовость ссылки одинаковы в обоих форматах. Изменение формата не гарантирует доставку;
проверяйте получение у адресата. Предпросмотр `/email-preview/confirmation` и `/email-preview/recovery`
в локальном режиме показывает тот же HTML, который используется в отправке, с демонстрационной ссылкой без настоящего токена.

Замените примеры настоящими значениями. `MAIL_FROM` должен содержать адрес отправителя, разрешённый вашим SMTP-сервисом.
В `frontend/.env.local` оставьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY` пустыми для локального `npm run dev`.
Для Gmail включите двухэтапную аутентификацию и создайте [пароль приложения Google](https://myaccount.google.com/apppasswords).
Если такого пункта нет, проверьте [ограничения аккаунта в справке Google](https://support.google.com/accounts/answer/185833?hl=ru).
Обычный пароль от почты здесь не используется. Секреты сохраняйте только локально, не в Git и не в чате.

После сохранения выполните из корня проекта:

```powershell
# Проверка подключения, TLS и авторизации. Писем не отправляет.
.\.venv\Scripts\python.exe -m backend.manage check-mail
# Ровно одно тестовое письмо на адрес SMTP_USER, без обработки очереди.
.\.venv\Scripts\python.exe -m backend.manage check-mail --send-test
```

Затем перезапустите FastAPI: остановите старый процесс через Ctrl+C и запустите снова.
Изменение `.env` само по себе не меняет настройки уже работающего процесса.

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --reload --port 8000 --no-proxy-headers
```

Откройте http://localhost:5173 и запросите новое подтверждение или восстановление пароля.
Старые письма со статусом `preview` автоматически не отправляются: это уже завершённые предпросмотры, их ссылки могли устареть.
Повторная регистрация неподтверждённого аккаунта отправляет новое подтверждение, сохраняя прежние данные и пароль.
Используйте последнюю ссылку: новый запрос заменяет предыдущий токен.
Ссылка с `localhost` открывается на компьютере с запущенным приложением; на телефоне `localhost` обозначает сам телефон.
Восстановление отправляется только для существующего локального аккаунта; ответ формы намеренно не раскрывает, есть ли такой адрес в базе.

Если письмо не пришло, выполните `python -m backend.manage mail-status`: `sent` означает принятие SMTP-сервером,
`pending` — ожидание/повторную попытку, `failed` — исчерпанные попытки, `preview` — запись в файл без отправки.
Проверьте папку «Спам». Команда `check-mail` объясняет ошибки SMTP, не выводя пароль и ответы сервера с личными данными.

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
npm run check
node supabase/tests/run-migrations.mjs
```

`npm run check` объединяет Python-тесты, smoke локального сервера, frontend regression suites, lint и production build.
Только backend: `.\.venv\Scripts\python.exe -m pytest tests -q`.
Тесты используют временные базы, подменённые AI/Supabase/SMTP ответы и PostgreSQL WASM. Реальных писем не отправляют.
Облачные миграции, реальные настройки Auth и доставку на почту надо проверить отдельно после подключения проекта.

Конструктор, рейтинг, каталог, отклики и ручной выбор команды используют объединённый frontend.
Задачи и отклики пока сохраняются в LocalStorage браузера, а не в общей серверной базе.
Демо-переключатель ролей не является источником серверных прав; аккаунты и их письма обслуживаются отдельно.
