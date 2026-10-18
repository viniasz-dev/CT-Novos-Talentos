# Aluguel de Campos Society Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a landing estática do CT Novos Talentos em um sistema Django de reserva de campos society, com login, calendário de horários, painel admin, criptografia e notificações.

**Architecture:** Monólito Django que serve templates (landing preservada e redesenhada) e uma API JSON consumida por `fetch` com sessão e CSRF. Regras de reserva vivem em `bookings/services.py`; views só traduzem HTTP. Notificações reagem a um signal emitido pelos services, então falha de e-mail nunca afeta a reserva.

**Tech Stack:** Python 3.12, Django 5.2 LTS, `cryptography` (Fernet), `python-dotenv`, `dj-database-url`, `psycopg[binary]`, `gunicorn`, `whitenoise`; SQLite em dev, PostgreSQL em prod; HTML/CSS/JS (ES modules) sem framework; `agent-browser` (Vercel) para e2e.

**Spec:** `docs/superpowers/specs/2026-10-18-aluguel-campos-design.md`

## Global Constraints

- Django 5.2 LTS. Sem Django REST Framework. Sem biblioteca de calendário no frontend.
- Estados de pedido, exatamente: `pendente`, `aprovado`, `recusado`, `cancelado`. Transições: `pendente -> aprovado|recusado|cancelado`, `aprovado -> cancelado`; `recusado` e `cancelado` são finais.
- Fuso: `America/Sao_Paulo`. `LANGUAGE_CODE = "pt-br"`. Toda mensagem ao usuário em pt-BR.
- `BUSINESS_HOURS` em settings: dict `weekday(0=segunda) -> (hora_abre, hora_fecha)`; padrão segunda a sexta `(18, 23)`. Slots de 1h cheia; reserva de 1 a 4 slots (`BOOKING_MAX_HOURS = 4`); só no futuro; mesmo dia local.
- Conflito: intervalo meio-aberto `[start, end)` sobrepõe pedido `aprovado` ou `TimeBlock` do mesmo campo.
- Erros da API: `{"error": {"code": "...", "message": "pt-BR", "fields": {...}}}`. Datas em ISO 8601 com offset; datetime sem offset é 400.
- CSRF sempre ativo (nenhum `csrf_exempt`). Cabeçalho `X-CSRFToken`. Nenhum token ou segredo em `localStorage`/`sessionStorage`.
- Chaves de criptografia só em env `FIELD_ENCRYPTION_KEYS` (lista separada por vírgula, a primeira cifra). Segredos fora do Git.
- Senhas: hash padrão do Django. E-mails nunca levam senha, chave, contato nem mensagem.
- Pedido de outro usuário responde 404, não 403.
- Rotas: `/`, `/sobre/`, `/servicos/`, `/contato/`, `/entrar/`, `/cadastro/`, `/senha/...`, `/reservar/`, `/minhas-reservas/`, `/painel/`, `/api/...`, `/django-admin/`.
- Comandos Python: `.venv/Scripts/python` (Windows, Git Bash). Testes: `.venv/Scripts/python manage.py test`. JS puro testado com `node --test`.
- Todo commit termina com a linha: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Preservar identidade visual: logo, verde `#7ac400`, tema escuro, Bebas Neue, fotos e vídeo existentes.

## Review Focus

1. Datetime sem offset, ou string/número no lugar de data (`start: 123`), JSON vazio ou malformado: 400 com mensagem, nunca 500. (Task 1 `parse_aware_datetime`, Task 4)
2. Reserva que cruza meia-noite, começa fora do expediente, ou num dia sem expediente (sábado): 400 `closed`. (Task 3)
3. Contato/mensagem com emoji, acentos, só espaços, ou 5000 caracteres: aceita Unicode, recusa vazio e acima do limite (contato 120, mensagem 500), round trip exato. (Task 3, Task 4)
4. Mesmo e-mail com caixa diferente (`Joao@X.com` vs `joao@x.com`): trata como a mesma conta, 409. (Task 5)
5. Cancelar pedido cuja hora já começou, ou aprovar pedido no passado: 409 `too_late` / 400 `in_past`. Usuário desativado ou rebaixado de staff com sessão antiga perde acesso imediatamente. (Task 3, Task 10)
6. Banco sem nenhum campo ativo: telas mostram estado vazio claro, sem erro de JS. (Task 7a, Task 7b)

## Ondas

Máximo de 3 agents por onda. A ordem difere da sugestão original só onde havia dependência de código (criptografia base e modelo de usuário sobem para a Task 1 porque tudo depende deles).

- Onda 1 (sequencial, 2 agents): Task 1, depois Task 2.
- Onda 2 (3 em paralelo): Task 3, Task 5, Task 6.
- Onda 3 (3 em paralelo): Task 4, Task 8, Task 7a.
- Onda 4 (3 em paralelo): Task 7b, Task 9, Task 10.
- Onda 5 (2 em paralelo): Task 11, Task 12.

Dentro de uma onda cada task só mexe nos arquivos listados nela; nunca em `config/settings.py` ou `config/urls.py` depois da Task 1 (Task 1 deixa todos os includes prontos).

---

### Task 1: Scaffold Django, utilitários comuns, criptografia base, usuário

**Files:**
- Create: `manage.py`, `config/{__init__,settings,urls,wsgi,asgi}.py`, `requirements.txt`, `.env.example`
- Create: `common/{__init__,apps,http,crypto}.py`, `common/tests/{__init__,test_http,test_crypto}.py`
- Create: `accounts/{__init__,apps,models,serializers,urls}.py` (+ migration), `accounts/tests/{__init__,test_models}.py`
- Create: `bookings/{__init__,apps,urls,api_public,api_admin}.py`, `notifications/{__init__,apps}.py`, `site_pages/{__init__,apps,views,urls}.py`, `site_pages/tests/test_pages.py`
- Move: `css/ -> static/css/`, `imgs/ -> static/imgs/`, `video/ -> static/video/` (`git mv`); `index|sobre|servicos|contato.html -> templates/pages/*.html` via `{% extends "base.html" %}`
- Create: `templates/base.html`, `templates/pages/{entrar,cadastro,reservar,minhas_reservas,painel}.html` (placeholders que estendem base)

**Interfaces:**
- Produces `common.http`:
  - `class ApiError(Exception)`: `__init__(self, code: str, message: str, status: int = 400, fields: dict | None = None)`.
  - `json_error(code, message, status, fields=None) -> JsonResponse` no formato do contrato.
  - `read_json(request) -> dict`: levanta `ApiError("invalid_json", ..., 400)` se corpo vazio, malformado ou não-objeto.
  - `parse_aware_datetime(value: object) -> datetime`: aceita só `str` ISO com offset; senão `ApiError("invalid_datetime", ..., 400)`.
  - `parse_date(value: object) -> date` (`YYYY-MM-DD`; erro `invalid_date`).
  - `api(methods: list[str])`: decorator de view; responde 405 `method_not_allowed` e converte `ApiError` em `json_error`.
  - `csrf_failure(request, reason="") -> JsonResponse` (403 `csrf_failed` para `/api/`, HTML simples nas demais), ligado em `CSRF_FAILURE_VIEW`.
- Produces `common.crypto`: `encrypt(plaintext: str) -> str`, `decrypt(token: str) -> str`, `get_fernet() -> MultiFernet`, `class DecryptionError(Exception)`, `class EncryptionConfigError(ImproperlyConfigured)`.
- Produces `accounts.models.User(AbstractBaseUser, PermissionsMixin)`: `email` (único, salvo em minúsculas), `name`, `phone_enc`, `is_active`, `is_staff`, `date_joined`, `USERNAME_FIELD = "email"`, `REQUIRED_FIELDS = ["name"]`, propriedade `phone` (get/set via crypto), `UserManager.create_user(email, password, name="", **extra)` e `create_superuser(...)`. `settings.AUTH_USER_MODEL = "accounts.User"`.
- Produces `accounts.serializers.user_to_dict(user) -> dict` com `id, name, email, is_staff`.
- Produces settings: `FIELD_ENCRYPTION_KEYS: list[str]`, `BUSINESS_HOURS`, `BOOKING_MAX_HOURS`, `STAFF_NOTIFY_EMAIL`, `WHATSAPP_ENABLED`, `LOGIN_MAX_ATTEMPTS = 5`, `LOGIN_WINDOW_SECONDS = 900`, `REGISTER_MAX_PER_HOUR = 10`, `DEFAULT_FROM_EMAIL`, e-mail via env.
- Produces `config/urls.py`: `django-admin/`; `api/` -> `accounts.urls`; `api/` -> `bookings.urls`; `senha/` -> `accounts.password_urls` (arquivo criado vazio com `urlpatterns = []`); `""` -> `site_pages.urls`. `bookings/urls.py` concatena `api_public.urlpatterns + api_admin.urlpatterns` (ambas `[]` por enquanto).

- [ ] **Step 1: Criar venv e `requirements.txt`**
  `python -m venv .venv`; fixar `Django>=5.2,<5.3`, `cryptography`, `python-dotenv`, `dj-database-url`, `psycopg[binary]`, `gunicorn`, `whitenoise`. Instalar com `.venv/Scripts/pip install -r requirements.txt`. `.env` e `.venv` já estão no `.gitignore`.
- [ ] **Step 2: Escrever testes que falham**
  - `test_http`: `read_json` rejeita corpo vazio, `"[]"`, `"{bad"` (todos `invalid_json`); `parse_aware_datetime("2026-10-20T19:00:00-03:00")` ok; `"2026-10-20T19:00:00"` -> `invalid_datetime`; `123` -> `invalid_datetime`; `api(["GET"])` devolve 405 para POST; `json_error` produz `{"error": {"code","message","fields"}}`.
  - `test_crypto` (com `override_settings(FIELD_ENCRYPTION_KEYS=[k1])`): round trip com `"João 😀 (19) 99911-7711"`; `encrypt(x) != x`; duas cifras do mesmo texto diferem; token adulterado -> `DecryptionError`; chaves `[k2, k1]` decifram token feito com `[k1]`; lista vazia -> `EncryptionConfigError`.
  - `accounts/tests/test_models`: `create_user("Joao@X.com", "senha-forte-123")` salva `joao@x.com`, senha não é texto claro, `phone` round trip e `phone_enc` no banco difere do número; `create_superuser` -> `is_staff` e `is_superuser`.
  - `site_pages/tests/test_pages`: GET de cada rota de página devolve 200; `/static/css/style.css` resolvido por `staticfiles` (usar `django.contrib.staticfiles.finders.find`).
- [ ] **Step 3: Rodar e ver falhar** (`ModuleNotFoundError`/falhas).
- [ ] **Step 4: Implementar**
  Settings lê `.env` com `python-dotenv`; `DEBUG` do env (padrão `False`); em `DEBUG` sem `FIELD_ENCRYPTION_KEYS` usa uma chave de desenvolvimento fixa e inofensiva (comentada como insegura); fora de `DEBUG` sem chave ou `SECRET_KEY` levanta `ImproperlyConfigured`. `DATABASES` via `dj_database_url.config(default="sqlite:///db.sqlite3")`. WhiteNoise no middleware. `TIME_ZONE`/`LANGUAGE_CODE` conforme Global Constraints. `EMAIL_BACKEND` console quando `DEBUG`, SMTP por env caso contrário. Bloco de segurança (SSL redirect, HSTS, cookies Secure/HttpOnly/SameSite=Lax, `CSRF_TRUSTED_ORIGINS`, `SECURE_PROXY_SSL_HEADER`) só quando `not DEBUG`. Portar as 4 páginas HTML para templates sem mudar o visual, trocando caminhos por `{% static %}` e `{% url %}`; corrigir o banner de `sobre` que aponta para `.png` inexistente (o arquivo é `.jpeg`). `base.html` define blocos `title`, `content`, `scripts`, nav com links reais e um `<li data-auth-nav>` vazio.
- [ ] **Step 5: Rodar testes e `manage.py check`** — Expected: PASS, `System check identified no issues`. `manage.py makemigrations --check` limpo.
- [ ] **Step 6: Commit** (`feat: scaffold django project, common utils, base crypto, user model`).

---

### Task 2: Modelos de reservas, serializers, signal e seed

**Files:**
- Create: `bookings/models.py` (+ migration), `bookings/serializers.py`, `bookings/events.py`
- Create: `bookings/management/{__init__}.py`, `bookings/management/commands/{__init__,seed_demo}.py`
- Test: `bookings/tests/{__init__,test_models,test_serializers,test_seed}.py`

**Interfaces:**
- Consumes: `common.crypto.encrypt/decrypt`, `accounts.User`, `settings.AUTH_USER_MODEL`.
- Produces em `bookings.models`:
  - `Field`: `name`, `description`, `price_per_hour` (`DecimalField(8,2)`), `active`, `photo` (str caminho estático, blank).
  - `BookingRequest`: `user`, `field`, `start`, `end`, `status` (`Status` TextChoices: `PENDING="pendente"`, `APPROVED="aprovado"`, `REJECTED="recusado"`, `CANCELLED="cancelado"`), `contact_enc`, `message_enc`, `created_at`, `updated_at`, `decided_by` (nulo). Métodos `set_contact(text)`, `get_contact() -> str`, `set_message(text)`, `get_message() -> str`; propriedade `contact_masked -> "••••••"`. Constante de módulo `ALLOWED_TRANSITIONS: dict[str, set[str]]`.
  - `TimeBlock`: `field`, `start`, `end`, `reason`, `created_by`, `created_at`.
  - `AuditEvent`: `actor` (nulo), `action`, `object_type`, `object_id`, `meta` (JSONField), `created_at`; `AuditEvent.log(actor, action, obj, **meta) -> AuditEvent`.
  - `CheckConstraint(start < end)` em `BookingRequest` e `TimeBlock`; índice `(field, start)` em ambos.
- Produces `bookings.events.booking_event = django.dispatch.Signal()` (kwargs `booking`, `kind` in `created|approved|rejected|cancelled`, `actor`).
- Produces `bookings.serializers`: `field_to_dict(field)`, `booking_to_dict(booking, admin: bool = False)` (campos `id, field{id,name}, start, end, status, status_label, contact_masked, message_present, created_at, can_cancel`; com `admin=True` soma `user{id,name,email}` e `decided_by`), `block_to_dict(block)`. Datas em ISO no fuso do negócio.
- Produces `manage.py seed_demo`: cria o campo "Quadra Society" (R$ 150,00/h, ativo), `cliente@exemplo.test`, `cliente2@exemplo.test` e `equipe@exemplo.test` (staff), senha `Demo-12345-Senha` (documentada no README, são contas de teste não reais). Idempotente; recusa rodar com `DEBUG=False` (`CommandError`).

- [ ] **Step 1: Testes que falham** — `test_models`: `start >= end` viola constraint (`IntegrityError`); `set_contact("x")` grava `contact_enc` diferente de `"x"` e `get_contact()` devolve `"x"`; `ALLOWED_TRANSITIONS` igual ao descrito em Global Constraints; `AuditEvent.log(None, "x", booking)` grava `object_type="BookingRequest"`, `object_id`; `Field.price_per_hour` arredonda para 2 casas. `test_serializers`: `booking_to_dict` nunca contém contato ou mensagem em texto claro, só `contact_masked`; `admin=True` inclui `user.email`; `start` sai com offset `-03:00`. `test_seed`: roda duas vezes sem duplicar; com `override_settings(DEBUG=False)` levanta `CommandError`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** os modelos, migration, serializers, signal e comando conforme Interfaces.
- [ ] **Step 4: Rodar testes + `makemigrations --check`** — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: add booking models, serializers, seed command`).

---

### Task 3: Regras de reserva (services)

**Files:**
- Create: `bookings/services.py`, `bookings/tests/test_services.py`

**Interfaces:**
- Consumes: modelos, `booking_event`, `AuditEvent.log`, `common.http.ApiError`, `settings.BUSINESS_HOURS`, `BOOKING_MAX_HOURS`.
- Produces em `bookings.services`:
  - `class BookingError(ApiError)`; subclasses `ValidationFailed` (400), `Conflict` (409), `Forbidden` (403). Códigos: `field_inactive`, `invalid_range`, `not_aligned`, `bad_duration`, `in_past`, `closed`, `naive_datetime`, `invalid_contact`, `invalid_message`, `slot_taken`, `blocked`, `duplicate`, `invalid_transition`, `too_late`, `forbidden`.
  - `validate_window(field: Field, start: datetime, end: datetime, now: datetime | None = None) -> None`
  - `find_conflicts(field: Field, start, end, exclude_booking_id: int | None = None) -> dict` com chaves `bookings: list[BookingRequest]` (só aprovados) e `blocks: list[TimeBlock]`.
  - `create_booking(user, field, start, end, contact: str, message: str = "") -> BookingRequest` (status `pendente`).
  - `set_status(booking, new_status: str, actor) -> BookingRequest` (só staff; aprovar revalida janela, exige futuro e rechecagem de conflito sem contar a si mesmo).
  - `cancel_booking(booking, actor) -> BookingRequest` (dono ou staff; dono não cancela depois do início: `too_late`).
  - `create_block(field, start, end, reason: str, actor) -> TimeBlock` (staff; `slot_taken` se houver aprovado no intervalo, com `fields={"conflicts": [ids]}`) e `delete_block(block, actor) -> None`.
  - `day_slots(field: Field, day: date, now=None) -> dict` `{"open": bool, "slots": [{"start","end","state"}]}`, `state` in `free|booked|blocked|past|closed`.
  - `month_overview(field: Field, date_from: date, date_to: date, now=None) -> dict[str, dict]` (`"YYYY-MM-DD" -> {"open": bool, "free": int, "total": int}`; erro `bad_range` se `date_to - date_from > 31 dias`).
- Cada função de escrita roda em `transaction.atomic()` com `Field.objects.select_for_update().get(pk=...)`; emite `booking_event` e grava `AuditEvent` (`booking.created|approved|rejected|cancelled`, `block.created|deleted`).

- [ ] **Step 1: Testes que falham** (`test_services.py`, relógio injetado por `now=`):
  - Janela: `end <= start` -> `invalid_range`; `19:30` -> `not_aligned`; 5h -> `bad_duration`; 0h -> `invalid_range`; passado -> `in_past`; sábado -> `closed`; 17:00 e 22:00-24:00 -> `closed`; cruzar meia-noite -> `closed`; campo inativo -> `field_inactive`; datetime naive -> `naive_datetime`; 18:00-22:00 (4h, limite) aceita; 22:00-23:00 (último slot) aceita.
  - Conflito: criar sobre aprovado -> `slot_taken`; sobre bloqueio -> `blocked`; borda `[19,20)` e `[20,21)` não conflitam; dois `pendente` de usuários diferentes no mesmo horário coexistem; mesmo usuário repetindo intervalo igual ou sobreposto -> `duplicate`.
  - Contato/mensagem: `"   "` -> `invalid_contact`; 121 chars -> `invalid_contact`; 501 chars de mensagem -> `invalid_message`; `"João 😀"` salva e `get_contact()` volta idêntico.
  - Transições: cliente comum chamando `set_status` -> `Forbidden`; `pendente->aprovado` ok e grava `decided_by`; aprovar segundo pedido do mesmo horário -> `slot_taken`; `recusado->aprovado` -> `invalid_transition`; aprovar pedido cujo `start` já passou -> `in_past`; dono cancela `pendente` e `aprovado`; dono cancela após `start` -> `too_late`; outro usuário cancelando -> `Forbidden`; staff cancela qualquer um.
  - Bloqueio: `create_block` sobre aprovado -> `slot_taken` com ids; depois do bloqueio, `create_booking` no horário -> `blocked`; `delete_block` libera.
  - Disponibilidade: `day_slots` marca `booked` (aprovado), `blocked`, `past`, `free`; dia sem expediente -> `{"open": False, "slots": []}`; `month_overview` conta `free`/`total`; intervalo > 31 dias -> `ValidationFailed("bad_range")`.
  - Eventos/auditoria: cada escrita dispara `booking_event` com o `kind` certo (receiver de teste) e cria `AuditEvent`; evento só após commit não é exigido aqui (a Task 9 usa `on_commit`).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `services.py` conforme assinaturas. Conversões de fuso com `zoneinfo`/`timezone.localtime`.
- [ ] **Step 4: Rodar testes** — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: booking rules service`).

---

### Task 4: API pública de reservas

**Files:**
- Modify: `bookings/api_public.py`
- Test: `bookings/tests/test_api_public.py`

**Interfaces:**
- Consumes: `bookings.services`, `bookings.serializers`, `common.http` (`api`, `read_json`, `parse_aware_datetime`, `parse_date`, `ApiError`), `accounts.decorators.login_required_json` (Task 5).
- Produces `api_public.urlpatterns` (rotas relativas a `/api/`):
  - `GET fields` -> `{"fields": [field_to_dict...]}` (só ativos).
  - `GET availability?field=<id>&date=YYYY-MM-DD` -> `{"field": id, "date": "...", "open": bool, "slots": [...]}`; ou `?field=&from=&to=` -> `{"field": id, "days": {...}}`. Falta de parâmetro ou campo inexistente/inativo: 400/404.
  - `POST bookings` body `{field, start, end, contact, message?}` -> 201 `{"booking": booking_to_dict}`.
  - `GET bookings` -> só do usuário logado, `-start`, `{"bookings": [...]}`.
  - `POST bookings/<int:pk>/cancel` -> 200 `{"booking": ...}`; pedido de outro usuário ou inexistente -> 404.

- [ ] **Step 1: Testes que falham** (cliente Django com `enforce_csrf_checks=False` para lógica; CSRF é testado na Task 10): anônimo em `POST/GET bookings` -> 401; criar com dados válidos -> 201 e `contact_masked`, resposta sem contato claro; JSON vazio/malformado -> 400 `invalid_json`; `start` numérico -> 400 `invalid_datetime`; sem offset -> 400; `field` ausente/texto -> 400 com `fields`; campo inexistente -> 404; conflito -> 409 `slot_taken`; duplicado -> 409; contato vazio e 121 chars -> 400; `GET bookings` não traz pedidos de outro usuário; cancelar pedido alheio -> 404; cancelar o próprio -> 200 `cancelado`; `availability` do dia devolve estados corretos; `from`/`to` > 31 dias -> 400; `fields` oculta campo inativo; sem campos ativos -> `{"fields": []}`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar views finas** que parseiam entrada, chamam services, serializam. `BookingError` já é `ApiError`, então o decorator `api` responde o erro.
- [ ] **Step 4: Rodar testes** — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: public booking api`).

---

### Task 5: Autenticação, throttle e reset de senha

**Files:**
- Create: `accounts/{api,decorators,throttle,password_urls}.py`, `templates/registration/{password_reset_form,password_reset_done,password_reset_confirm,password_reset_complete}.html`, `templates/registration/password_reset_email.txt`, `templates/registration/password_reset_subject.txt`
- Modify: `accounts/urls.py`
- Test: `accounts/tests/{test_api,test_throttle,test_reset}.py`

**Interfaces:**
- Consumes: `common.http`, `accounts.models.User`, `accounts.serializers.user_to_dict`, settings de throttle.
- Produces `accounts.decorators`: `login_required_json(view)` (401 `not_authenticated`) e `staff_required_json(view)` (401 se anônimo, 403 `forbidden` se não staff; também 401 se `not user.is_active`).
- Produces `accounts.throttle`: `check(key: str, limit: int, window: int) -> bool` (conta tentativas no cache local; `True` = bloqueado), `hit(key, window)`, `reset(key)`.
- Produces rotas em `/api/`: `GET csrf` (204, seta cookie via `ensure_csrf_cookie`), `POST auth/register` (`name,email,password,phone` -> 201 `{"user"}` e login automático), `POST auth/login` (`email,password` -> 200 `{"user"}`; credencial errada 401 genérico `invalid_credentials`; bloqueado 429 `too_many_attempts`), `POST auth/logout` (204), `GET auth/me` (200 `{"user": ... | null}`).
- Produces `/senha/`: `reset/`, `reset/enviado/`, `reset/<uidb64>/<token>/`, `reset/concluido/` com as views genéricas do Django e templates simples que estendem `base.html`.

- [ ] **Step 1: Testes que falham**: cadastro cria usuário com `phone` cifrado, loga e devolve 201; senha fraca (`"123"`) -> 400 com `fields.password`; e-mail repetido, inclusive `JOAO@X.COM` vs `joao@x.com` -> 409 `email_taken`; campos faltando -> 400 com `fields`; login ok; senha errada e e-mail inexistente dão a mesma resposta 401; 6ª tentativa errada em 15 min -> 429 e login correto também bloqueado durante a janela; login zera contador; usuário inativo não entra; logout limpa sessão e `me` volta `null`; `login_required_json`/`staff_required_json` devolvem 401/403 corretos (view de teste montada com `RequestFactory`); reset: e-mail existente e inexistente dão a mesma página "enviado"; e-mail de reset sai em `mail.outbox` com link; usar o link define nova senha; resposta de cadastro/login nunca inclui hash ou `phone_enc`; throttle de cadastro: 11º registro/hora/IP -> 429.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Normalizar e-mail com `strip().lower()`; validar senha com `validate_password`; throttle usa chave `login:<ip>:<email>`.
- [ ] **Step 4: Rodar testes** — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: auth api, throttling, password reset`).

---

### Task 6: Criptografia: rotação, validação de chave, revelação auditada

**Files:**
- Modify: `common/crypto.py`, `bookings/apps.py`
- Create: `bookings/privacy.py`, `common/management/{__init__}.py`, `common/management/commands/{__init__,rotate_encryption}.py`, `docs/ENCRYPTION.md`
- Test: `common/tests/test_rotation.py`, `bookings/tests/test_privacy.py`

**Interfaces:**
- Consumes: `common.crypto`, modelos, `AuditEvent.log`.
- Produces `common.crypto.rotate_token(token: str) -> str` (recifra com a primeira chave via `MultiFernet.rotate`) e `check_encryption_config() -> None` (levanta `EncryptionConfigError` se fora de `DEBUG` e sem chaves válidas; chamada em `BookingsConfig.ready()` exceto durante testes).
- Produces `bookings.privacy.reveal_contact(booking: BookingRequest, actor) -> dict` com `{"contact": str, "message": str}`; exige `actor.is_staff` (senão `Forbidden`), grava `AuditEvent` `booking.decrypted` sem o conteúdo no `meta`.
- Produces `manage.py rotate_encryption [--dry-run]`: recifra `BookingRequest.contact_enc`, `message_enc` e `User.phone_enc` em lotes atômicos; imprime contagens; idempotente.
- `docs/ENCRYPTION.md`: gerar chave (`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`), onde guardar, backup separado do banco, passo a passo de rotação (nova chave na frente, comando, remover a antiga), consequência de perder a chave.

- [ ] **Step 1: Testes que falham**: `rotate_token` produz token que decifra com a chave nova e não decifra só com a antiga removida; comando migra dados criados com `[k1]` quando settings passa a `[k2, k1]`, depois decifram com `[k2]` sozinha; `--dry-run` não altera o banco; segunda execução não muda nada; `check_encryption_config` falha sem chaves quando `DEBUG=False` e passa com chaves; chave inválida (não base64 Fernet) falha com mensagem clara; `reveal_contact` por staff devolve texto exato e cria `AuditEvent` sem o texto em `meta`; por não-staff -> `Forbidden`, sem evento.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** conforme Interfaces; escrever `docs/ENCRYPTION.md`.
- [ ] **Step 4: Rodar testes** — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: key rotation, config check, audited reveal`).

---

### Task 7a: Design system, páginas existentes redesenhadas, login e cadastro

**Files:**
- Create: `static/css/{tokens,base,components,pages}.css`, `static/css/app.css` (importa os demais); remover `static/css/style.css` ao final
- Create: `static/js/{api,ui,auth,home}.js`, `static/js/tests/{api.test,ui.test,auth.test}.mjs`
- Modify: `templates/base.html`, `templates/pages/{index→home,sobre,servicos,contato,entrar,cadastro}.html`, `templates/registration/*.html`
- Test: `site_pages/tests/test_pages.py` (atualizar)

**Interfaces:**
- Consumes: `/api/auth/*`, `/api/csrf`, `/api/fields`, `/api/availability` (contrato do spec §5).
- Produces ES modules:
  - `api.js`: `class ApiError extends Error {status, code, fields}`; `api.get(path, params?)`, `api.post(path, body?)`, `api.del(path)` (JSON, `credentials: "same-origin"`, `X-CSRFToken` lido do cookie `csrftoken`, busca `/api/csrf` se o cookie faltar; erro HTTP vira `ApiError` com o corpo do contrato; rede fora -> `ApiError(status=0, code="network")`).
  - `ui.js`: `toast(message, type = "info")`, `setBusy(button, busy)`, `showFieldErrors(form, fields)` / `clearFieldErrors(form)`, `formatDateTime(iso)`, `formatPrice(number)` (`R$ 150,00`), `$(selector, root?)`.
  - `auth.js`: `safeNext(value: string | null) -> string` (só caminho interno começando com `/` e não `//`; senão `/`), `initAuthNav()` (preenche `<li data-auth-nav>`: anônimo -> "Entrar" e "Criar conta"; logado -> "Minhas reservas", "Painel" se staff, "Sair"), `initLoginForm()`, `initRegisterForm()` (redirecionam para `safeNext(next)`).
- Produces templates com blocos `title`, `content`, `scripts`, `<script type="module">` por página; todas as páginas carregam `auth.js` para o nav.

- [ ] **Step 1: Invocar `/frontend-design:frontend-design`** antes de qualquer CSS e definir a direção: manter identidade (verde `#7ac400`, preto, Bebas Neue, logo, fotos, vídeo) e elevar ao nível de sites de reserva de quadras. Registrar tokens (cores, escala tipográfica, raios, sombras, espaçamento) em `tokens.css`; par tipográfico Bebas Neue + sans legível de corpo; contraste AA; foco visível; `prefers-reduced-motion` respeitado; vídeo de fundo pausa em reduced motion.
- [ ] **Step 2: Testes JS que falham** (`node --test static/js/tests`): `safeNext("/reservar/?date=2026-10-20")` mantém; `safeNext("//evil.com")`, `safeNext("https://evil.com")`, `safeNext("javascript:alert(1)")`, `null` -> `"/"`; `api` com `fetch` simulado: envia `X-CSRFToken`, converte erro `{"error":{"code":"slot_taken",...}}` em `ApiError` com `.code`, `.status`, `.fields`; falha de rede -> `status 0`; `formatPrice(150)` -> `"R$ 150,00"`.
- [ ] **Step 3: Testes Django que falham**: cada página renderiza 200 e contém seus marcos (`<h1>`, nav com os 4 links, `<main id="main">`, link "pular para o conteúdo", `lang="pt-BR"`); home contém contêiner `#campos` e formulário de busca `#busca-rapida`; `/entrar/` e `/cadastro/` contêm os `<form>` com `autocomplete` corretos e `novalidate`.
- [ ] **Step 4: Implementar.**
  - Home: hero com vídeo e CTA "Reservar horário" + busca rápida (data -> `/reservar/?date=`), cards de campos carregados de `/api/fields` (estado vazio amigável quando `[]`, skeleton no carregamento, mensagem de erro com "tentar de novo"), passo a passo "Escolha, Horário, Confirme", estrutura (quadra, lanchonete, churrasqueira, área de resenha) com ícones SVG, seção de preços (diária R$ 150,00, mensal R$ 600,00 com desconto PIX R$ 30,00, torneios sob consulta), depoimento/fotos, CTA final, rodapé completo com endereço, horário e redes.
  - Sobre, Serviços, Contato: mesmo conteúdo textual, novo visual; cards de serviço levam a `/reservar/`; contato mantém WhatsApp e mapa, formulário de mensagem vira link `mailto`-free: envia para o WhatsApp via `wa.me` com texto montado (sem backend novo).
  - Entrar/Cadastro: formulários com validação inline, mostrar/ocultar senha, estado ocupado, mensagens de `ApiError.fields`.
  - Responsivo mobile-first (nav com menu hambúrguer acessível), sem rolagem horizontal em 360px.
- [ ] **Step 5: Rodar `node --test` e `manage.py test site_pages`** — Expected: PASS.
- [ ] **Step 6: Commit** (`feat: design system and redesigned public pages`).

---

### Task 8: API admin e Django Admin

**Files:**
- Modify: `bookings/api_admin.py`
- Create: `bookings/admin.py`
- Test: `bookings/tests/{test_api_admin,test_django_admin}.py`

**Interfaces:**
- Consumes: `services`, `privacy.reveal_contact`, `serializers`, `accounts.decorators.staff_required_json`.
- Produces `api_admin.urlpatterns` (sob `/api/`):
  - `GET admin/bookings?status=&field=&date=` -> `{"bookings": [booking_to_dict(admin=True)]}`.
  - `POST admin/bookings/<pk>/status` body `{status}` -> 200 `{"booking"}`; status inválido -> 400 `invalid_status`; erros de service viram 403/409.
  - `GET admin/bookings/<pk>/contact` -> 200 `{"contact","message"}` e audita; 404 se não existir.
  - `GET admin/blocks?field=&date=` -> `{"blocks": [...]}`, `POST admin/blocks` `{field,start,end,reason}` -> 201, `DELETE admin/blocks/<pk>` -> 204.
  - `GET admin/agenda?field=&date=` -> `{"slots": [... com booking/ block resumido ...]}` (reservas aprovadas e bloqueios do dia, sem contato).
- `bookings/admin.py`: `FieldAdmin`; `BookingRequestAdmin` (lista com campo, início, fim, status, usuário; filtros por status/campo/data; contato e mensagem ocultos; ações "Aprovar", "Recusar", "Cancelar" chamam `services.set_status` e reportam erros via `messages`); `TimeBlockAdmin` cujo `clean()` usa `services` para validar e recusar conflito; `AuditEventAdmin` somente leitura.

- [ ] **Step 1: Testes que falham**: anônimo 401 e cliente comum 403 em todas as rotas `admin/*`; staff lista com `?status=pendente`; aprovar muda status, cria auditoria e aprovar conflito -> 409; `status=banana` -> 400; contato revelado só para staff e cria `AuditEvent` `booking.decrypted`; resposta de listagem não contém texto de contato; criar bloqueio -> 201, sobre aprovado -> 409 com `fields.conflicts`; deletar -> 204; usuário staff desativado -> 401; Django Admin: ação "Aprovar" aprova pedidos selecionados e pula/avisa os conflitantes; página de edição do pedido não exibe contato em claro; bloqueio sobreposto a aprovado é rejeitado no formulário.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar testes** — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: admin api and django admin`).

---

### Task 7b: Reservar, minhas reservas e painel admin (frontend)

**Files:**
- Create: `static/js/{calendar,booking,account,panel}.js`, `static/js/tests/calendar.test.mjs`
- Modify: `templates/pages/{reservar,minhas_reservas,painel}.html`, `static/css/pages.css`, `static/css/components.css`
- Test: `site_pages/tests/test_pages.py`

**Interfaces:**
- Consumes: `api.js`, `ui.js`, `auth.js` (Task 7a); API pública e admin.
- Produces em `calendar.js` (funções puras, testáveis sem DOM):
  - `buildMonthGrid(year: number, month: number, today: Date) -> Array<Array<{date: string, inMonth: boolean, isPast: boolean}>>` (semanas começando no domingo; `month` 0-11; `date` `YYYY-MM-DD`).
  - `toggleSlot(selected: number[], index: number, slots: Array<{state: string}>, maxSlots = 4) -> number[]` (índices de slots livres; seleção sempre contígua: clicar fora do bloco reinicia em `[index]`, clicar no extremo remove, estender só adjacente e até `maxSlots`; slot não `free` é ignorado).
  - `selectionToRange(selected: number[], slots) -> {start: string, end: string} | null`.

- [ ] **Step 1: Invocar `/frontend-design:frontend-design`** e seguir os tokens da 7a; referência de UX: fluxo de reserva de quadras (campo -> dia -> horário -> confirmar), resumo fixo com preço total, estados vazios, skeletons.
- [ ] **Step 2: Testes JS que falham**: `buildMonthGrid(2026, 9, new Date(2026,9,18))` começa no domingo certo, tem 5 ou 6 semanas, marca dias anteriores a hoje como `isPast`, dias fora do mês `inMonth:false`; `toggleSlot` seleciona um slot livre, ignora `booked`/`blocked`/`past`, estende para vizinho livre, reinicia ao clicar longe, remove extremo, para em 4, não cruza um slot ocupado no meio; `selectionToRange([])` -> `null`, e `[1,2]` -> `start` do slot 1 e `end` do slot 2.
- [ ] **Step 3: Testes Django que falham**: `/reservar/`, `/minhas-reservas/`, `/painel/` renderizam 200 com os contêineres `#campos-reserva`, `#calendario`, `#horarios`, `#resumo`, `#lista-reservas`, `#painel-abas`.
- [ ] **Step 4: Implementar.**
  - Reservar: seleção de campo (cards com foto e preço/h), calendário mensal (dias fechados/passados desabilitados via `month_overview`), grade de horários (livre/ocupado/bloqueado/passado, legenda), resumo com preço total, campos de contato e mensagem com contador, envio com estado ocupado. 409 mostra o motivo e recarrega a grade; 401 redireciona para `/entrar/?next=...` preservando campo/data; sucesso mostra confirmação com status "pendente" e link para Minhas reservas. `?date=` e `?field=` pré-selecionam. Sem campos ativos -> estado vazio com WhatsApp.
  - Minhas reservas: lista com badge de status, filtro por status, cancelar com confirmação inline (sem `confirm()`), estado vazio com CTA, exige login (redireciona).
  - Painel (somente staff; não-staff vê mensagem de acesso negado, sem mostrar dados): abas Pedidos (filtros, aprovar/recusar/cancelar, "Ver contato" que chama a rota auditada), Bloqueios (criar com motivo, listar, remover) e Agenda do dia.
  - Tudo responsivo; navegação por teclado; mensagens de erro em pt-BR.
- [ ] **Step 5: Rodar `node --test` e testes Django** — Expected: PASS.
- [ ] **Step 6: Commit** (`feat: booking flow, client area and admin panel UI`).

---

### Task 9: Notificações por e-mail e adaptador WhatsApp

**Files:**
- Create: `notifications/{models,channels,messages,services,receivers}.py` (+ migration), `notifications/admin.py`
- Modify: `notifications/apps.py` (conecta receivers em `ready()`)
- Test: `notifications/tests/{__init__,test_messages,test_services,test_integration}.py`

**Interfaces:**
- Consumes: `bookings.events.booking_event`, `settings.STAFF_NOTIFY_EMAIL`, `WHATSAPP_ENABLED`, Django `send_mail`.
- Produces `notifications.models.Notification`: `booking` (FK, `SET_NULL`, nulo), `channel` (`email|whatsapp`), `kind`, `status` (`enviado|falhou|ignorado`), `error` (CharField 200), `created_at`.
- Produces `notifications.messages.render(kind: str, booking) -> tuple[str, str]` (assunto, corpo) em pt-BR com só campo, data, horário e status; nunca contato, mensagem, senha ou chave.
- Produces `notifications.channels`: `class EmailChannel.send(to: str, subject: str, body: str) -> None`; `class WhatsAppChannel.send(...)` que, com `WHATSAPP_ENABLED` falso, levanta `ChannelDisabled`.
- Produces `notifications.services.notify_booking_event(booking, kind: str) -> list[Notification]`: envia ao cliente (todos os `kind`) e à equipe (`created`, para `STAFF_NOTIFY_EMAIL` se definido); cada tentativa vira uma `Notification`; qualquer exceção é capturada e vira `falhou` com `error=type(exc).__name__`; WhatsApp desligado vira `ignorado`.
- Receiver de `booking_event` agenda `notify_booking_event` com `transaction.on_commit`.

- [ ] **Step 1: Testes que falham**: `render` não contém o contato nem a mensagem do pedido (pedido de teste com contato `"SEGREDO-123"`); criar via `services.create_booking` grava `Notification(email, enviado)` para cliente e para equipe, com `mail.outbox` de 2 e-mails; aprovar notifica só o cliente; com `EMAIL_BACKEND` que levanta `SMTPException("senha=abc")` o pedido continua salvo, `Notification.status="falhou"`, `error="SMTPException"` e a senha não aparece em nenhum registro nem log; WhatsApp desligado grava `ignorado`; rollback da transação de criação não envia e-mail (usar `TransactionTestCase` ou `captureOnCommitCallbacks`).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** e registrar `Notification` no admin (somente leitura).
- [ ] **Step 4: Rodar testes** — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: email notifications with whatsapp adapter`).

---

### Task 10: Testes integrados de segurança e autorização

**Files:**
- Create: `common/tests/{test_security,test_authorization,test_concurrency}.py`

**Interfaces:**
- Consumes: tudo anterior pelas rotas HTTP reais.

- [ ] **Step 1: Escrever os testes** (devem passar se as tasks anteriores estão corretas; qualquer falha é bug a corrigir no módulo responsável):
  - `test_authorization` (matriz): usuário A cria pedido; usuário B não lista, não cancela (404) e não vê; B em cada rota `/api/admin/*` -> 403; anônimo em cada rota protegida -> 401; staff vê todos; staff rebaixado (`is_staff=False`) com sessão aberta perde acesso na próxima chamada; usuário desativado com sessão aberta -> 401; sessão expirada (apagar sessão) -> 401 em `bookings`.
  - `test_security`: com `Client(enforce_csrf_checks=True)`, `POST` em `auth/login`, `auth/register`, `bookings`, `bookings/<id>/cancel` e `admin/*` sem token -> 403 `csrf_failed` em JSON; com token passa; nenhuma resposta da API contém `password`, `phone_enc`, `contact_enc`, `message_enc` ou o texto claro do contato; cabeçalho `Set-Cookie` da sessão tem `HttpOnly`; com `override_settings(DEBUG=False)` + chaves, `manage.py check --deploy` não acusa erros críticos (rodar via `call_command("check", deploy=True)` com settings de produção simulados); XSS: contato `"<script>alert(1)</script>"` volta escapado no JSON e o HTML das páginas não ecoa entrada.
  - `test_concurrency`: sequencial — dois pedidos `pendente` no mesmo horário, aprovar o primeiro e depois o segundo -> segundo 409; bloquear após aprovar -> 409; versão com 2 threads (`TransactionTestCase`) disputando `create_booking`+`set_status` roda só se `connection.vendor == "postgresql"` (`skipUnless`) e exige exatamente 1 aprovado.
- [ ] **Step 2: Rodar a suíte inteira** (`.venv/Scripts/python manage.py test`) — Expected: tudo PASS. Corrigir no módulo dono qualquer falha (commit separado `fix: ...`).
- [ ] **Step 3: Commit** (`test: integrated authorization and security suite`).

---

### Task 11: Teste ponta a ponta com agent-browser

**Files:**
- Create: `docs/qa/e2e-checklist.md`, `docs/qa/e2e-results.md`, `docs/qa/run_e2e.md` (comandos usados)
- Modify: qualquer arquivo com bug encontrado (commits `fix:` separados)

**Interfaces:**
- Consumes: app completo rodando em `http://127.0.0.1:8765` (`manage.py migrate`, `seed_demo`, `runserver 8765` em segundo plano, DB descartável `db.sqlite3` ou `DATABASE_URL=sqlite:///e2e.sqlite3`).

- [ ] **Step 1:** Ler o guia da ferramenta: `npx --yes agent-browser skills get core --full`. Seguir os comandos dele (não adivinhar flags).
- [ ] **Step 2: Executar o fluxo em desktop (1280x800) e mobile (390x844)**, salvando evidências (snapshots/screenshots) em `docs/qa/evidence/` (fora do Git se grandes; listar no results):
  1. Home: campos carregam, CTA e busca rápida levam a `/reservar/?date=`.
  2. Cadastro com senha fraca mostra erro; cadastro válido loga e o nav muda.
  3. Reservar: escolher campo, dia, 2 horários contíguos; slot ocupado não seleciona; resumo com preço; enviar -> confirmação "pendente".
  4. Minhas reservas lista o pedido; cancelar com confirmação inline; reservar de novo.
  5. Segundo cliente tenta o mesmo horário (pendente coexiste); logout.
  6. Equipe entra, abre `/painel/`, aprova o primeiro pedido, tenta aprovar o segundo -> erro de conflito exibido; cria bloqueio; ver contato (conferir auditoria no Django Admin); agenda do dia reflete.
  7. Cliente volta: horário aprovado/bloqueado aparece indisponível na grade; tentar reservar força 409 visível.
  8. Cliente comum abre `/painel/`: vê acesso negado sem dados.
  9. Sem horizontal scroll em 390px; navegação por Tab chega aos controles principais; nenhum erro no console.
- [ ] **Step 3:** Registrar resultado de cada passo (passou/falhou) em `docs/qa/e2e-results.md`; corrigir cada falha na origem, rerodar o passo, anotar o commit. Parar o servidor ao terminar.
- [ ] **Step 4: Commit** (`test: end-to-end results and fixes`).

---

### Task 12: Segurança de configuração, deploy e README

**Files:**
- Create: `README.md`, `docs/DEPLOY.md`, `docs/API.md`, `Procfile`, `.env.example` (revisar), `docs/SECURITY-CHECKLIST.md`
- Modify: `config/settings.py` (apenas ajustes de segurança que o checklist exigir)
- Test: `common/tests/test_settings_prod.py`

**Interfaces:**
- Consumes: spec §6, §10.

- [ ] **Step 1: Testes que falham** (`test_settings_prod.py`, carregando settings em subprocesso com env de produção simulado): sem `SECRET_KEY` -> falha; sem `FIELD_ENCRYPTION_KEYS` -> falha; com tudo definido `DEBUG=False`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS > 0` verdadeiros e `ALLOWED_HOSTS` vindo do env; `manage.py check --deploy` com esse env sai com 0 avisos de severidade alta; `.env.example` não contém valores que pareçam segredo reais (regex de chaves Fernet válidas).
- [ ] **Step 2: Rodar e ver falhar; ajustar settings; rodar até passar.**
- [ ] **Step 3: Escrever documentação.**
  - `README.md`: visão geral, requisitos, instalação local passo a passo (venv, `pip install`, `.env`, `migrate`, `seed_demo`, `runserver`), contas de teste não reais, variáveis de ambiente (tabela), comandos úteis (testes Python, `node --test`), estrutura de pastas, regras de negócio resumidas, link para API e deploy.
  - `docs/API.md`: o contrato do spec §5 com exemplos reais de requisição e resposta (copiar de respostas verdadeiras do app rodando), códigos HTTP e tabela de códigos de erro.
  - `docs/DEPLOY.md`: Gunicorn + WhiteNoise (`Procfile`: `web: gunicorn config.wsgi`), PostgreSQL (`DATABASE_URL`), `migrate`, `collectstatic`, `createsuperuser`, variáveis, HTTPS no proxy, domínio, backup e restauração do banco (`pg_dump`/`pg_restore`) e da chave, teste de restauração, plano para WhatsApp Cloud API (o que falta: conta, número, templates, token) e riscos conhecidos.
  - `docs/SECURITY-CHECKLIST.md`: lista marcável (DEBUG, ALLOWED_HOSTS, HTTPS, cookies, CSRF, CORS ausente, segredos fora do Git, chave com backup, logs sem segredo, usuário admin criado, rate limit, backups).
- [ ] **Step 4: Validação final**: suíte completa Python e `node --test` verdes; `check --deploy` limpo; `git grep` por padrões de chave/senha reais não acha nada; `git status` limpo.
- [ ] **Step 5: Commit** (`docs: readme, deploy guide, api reference, security checklist`).

---

## Auto-revisão

- **Cobertura do spec:** §2 arquitetura (T1), §3 modelos (T2), §4 regras (T3), §5 API (T4, T5, T8), §6 segurança (T1, T5, T6, T10, T12), §7 notificações (T9), §8 frontend (T7a, T7b), §9 testes (por task + T10 + T11), §10 entrega (T12). Sem lacunas.
- **Consistência de tipos:** `BookingError(ApiError)`, `ValidationFailed/Conflict/Forbidden`, `reveal_contact`, `booking_to_dict(admin=)`, `day_slots`/`month_overview`, `staff_required_json` e `login_required_json` têm uma única definição e os consumidores usam os mesmos nomes.
- **Proporção:** plano descreve assinaturas, testes e decisões; corpos de função ficam para o implementador.
