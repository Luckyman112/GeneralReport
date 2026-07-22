# COLLAPSAR Report System

Бэкенд для сбора и управления рапортами боевых формирований Star Wars Garry's Mod
сервера. Авторизация и права доступа — через Discord OAuth2 и роли участника в гильдии.
Бот стоит на **одном** Discord-сервере — формирования (501-й, Гвардия и т.д.) различаются
ролями внутри этого сервера, а не отдельными серверами.

## Стек

- FastAPI (async) + Uvicorn
- SQLAlchemy 2.0 (async) + PostgreSQL (asyncpg)
- Alembic — миграции БД
- Discord OAuth2 + Discord REST API (через httpx, без discord.py и без gateway-подключения)
- JWT (python-jose) — сессия пользователя

## Настройка Discord-приложения

1. **Создать приложение**: https://discord.com/developers/applications → New Application.
2. **OAuth2 → General**: скопировать `CLIENT ID` и `CLIENT SECRET` →
   `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.
3. **OAuth2 → Redirects**: добавить адрес фронтенда для логина пользователей (например
   `https://your-org.github.io/`) → `DISCORD_REDIRECT_URI`.
4. **Bot**: Add Bot → скопировать токен → `DISCORD_BOT_TOKEN`. Включить
   **SERVER MEMBERS INTENT** в Privileged Gateway Intents.
5. **OAuth2 → URL Generator**: scope `bot`, права минимум **View Channels** → получившуюся
   ссылку открыть с правами администратора на вашем единственном Discord-сервере, чтобы
   добавить туда бота. Включить Режим разработчика в Discord (Настройки → Расширенные),
   скопировать ID этого сервера (`DISCORD_GUILD_ID`).
6. На этом сервере создать роль администратора и общую роль «Командир» (одну на весь
   сервер, не по одной на формирование), скопировать их ID → `ADMIN_ROLE_ID`,
   `COMMANDER_ROLE_ID`. Роли самих формирований (боец 501, боец Гвардии и т.д.) тоже
   создаются на этом сервере — их ID указываются при создании формирования в веб-панели.

## Создание формирования

Формирования создаются вручную в веб-панели (`RegimentsAdminPage`, только администратор):
название + выбор Discord-роли этого формирования из списка ролей сервера
(`GET /api/regiments/discord-roles`) → `POST /api/regiments`. Формирование сразу полностью
рабочее — его бойцы (у кого есть эта роль) получают доступ при следующем логине.

Права командира над формированием = роль этого формирования **и** общая роль «Командир»
(`COMMANDER_ROLE_ID`) одновременно.

## Запуск

1. Скопировать `.env.example` в `.env` и заполнить переменные.
2. Установить зависимости:
   ```
   pip install -r requirements.txt
   ```
3. Применить миграции:
   ```
   alembic upgrade head
   ```
4. Запустить сервер:
   ```
   uvicorn app.main:app --reload
   ```
5. Swagger UI: http://localhost:8000/docs

## Модель доступа

- **Боец** (Discord-роль `regiments.discord_role_id`) — видит и создаёт только свои
  рапорты в своём формировании.
- **Командир** (роль формирования **и** общая роль `COMMANDER_ROLE_ID` одновременно) —
  видит все рапорты своего формирования, меняет статусы, отклоняет с указанием причины,
  удаляет.
- **Администратор** (роль `ADMIN_ROLE_ID`) — видит и управляет рапортами всех
  формирований, создаёт/настраивает формирования.

## API

- `POST /auth/discord` — обмен OAuth2-кода на JWT-токен сессии.
- `GET /api/regiments` — список формирований (`id`, `name`, `discord_role_id`).
- `GET /api/regiments/discord-roles` — роли единственного Discord-сервера (админ) — для
  формы создания/переименования формирования.
- `POST /api/regiments` — создание формирования: название + роль (админ).
- `PATCH /api/regiments/{id}` — переименование/смена роли формирования (админ).
- `GET /api/reports` — список рапортов (фильтр по правам, `?status=`, `?regiment_id=`).
- `POST /api/reports` — создание рапорта.
- `PATCH /api/reports/{id}` — изменение статуса. Одобрить/отклонить/удалить может только
  командир/администратор; исключение — автор рапорта может сам перевести **свой** черновик
  в `submitted` (отправить).
- `DELETE /api/reports/{id}` — мягкое удаление (только командир/администратор).
- `GET /api/me` — текущий пользователь и его уровень доступа (`is_admin`,
  `commander_regiment_ids`, `soldier_regiment_ids`) — нужен фронтенду для UI.

## Фронтенд (`frontend/`)

React + Vite, деплой на GitHub Pages через GitHub Actions
(`.github/workflows/deploy-frontend.yml`). Три экрана: логин через Discord, рапорты
(список/создание/командирские действия), админ-панель формирований.

### Локальный запуск

```
cd frontend
cp .env.example .env   # заполнить VITE_API_BASE_URL / VITE_DISCORD_CLIENT_ID / VITE_DISCORD_REDIRECT_URI
npm install
npm run dev
```

`VITE_DISCORD_REDIRECT_URI` должен быть зарегистрирован в Discord Developer Portal
(OAuth2 → Redirects) **без** хэша (`#...`) — Discord дописывает `?code=...` к этому URL как
query-параметр, а всё после `#` браузер считает частью фрагмента, а не query-строки.
Разбор `?code=` происходит на верхнем уровне приложения (`AuthContext`) ещё до того, как
`HashRouter` возьмёт на себя маршрутизацию по `#/...`.

### Деплой на GitHub Pages

1. Создать репозиторий на GitHub, запушить проект.
2. В Settings → Pages → Source выбрать **GitHub Actions**.
3. В Settings → Secrets and variables → Actions → вкладка **Variables** добавить
   `VITE_API_BASE_URL`, `VITE_DISCORD_CLIENT_ID`, `VITE_DISCORD_REDIRECT_URI` (значения
   подставляются в сборку воркфлоу `deploy-frontend.yml`).
4. В `frontend/vite.config.js` поправить `base` под реальное имя репозитория:
   `'/<имя-репозитория>/'` (или `'/'`, если это user/org-страница `<org>.github.io`).
5. Пуш в `main` с изменениями в `frontend/**` запускает сборку и деплой автоматически.
