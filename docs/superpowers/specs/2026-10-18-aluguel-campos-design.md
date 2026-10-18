# Sistema de aluguel de campos society: design

Fonte: `trabalho_de_sexta.pdf` (Downloads). Projeto base: landing estática do CT Novos Talentos.

## 1. Entendimento (para correção)

**Dito pelo usuário:** evoluir a landing (index, sobre, serviços, contato) para sistema web com Django + PostgreSQL: cadastro/login, solicitações de reserva, disponibilidade, painel admin, criptografia de dados sensíveis, notificações por e-mail (WhatsApp em contingência), interface interativa, visual mais bonito e amigável inspirado em sites de reserva de quadras. Executar tudo sem perguntas, entregar testado.

**Suposições (decididas aqui, sem consulta):**

- Um CT, uma quadra hoje, mas o modelo suporta vários campos.
- Preços vêm do site atual: diária R$ 150,00 por reserva avulsa; mensal e torneios continuam "consulta" (viram pedido com observação, não cobrança automática). Sem pagamento online.
- Funcionamento: Segunda a Sexta, 18h às 23h (contato.html). Configurável em settings (`BUSINESS_HOURS`).
- Reservas em blocos de 1h cheia, de 1 a 4 blocos seguidos, só no futuro.
- Fuso do negócio: `America/Sao_Paulo`.
- Login obrigatório para solicitar (recomendação do doc).

**Sucesso:** cliente cadastra, entra, escolhe campo/dia/horário num calendário, envia pedido; admin aprova/recusa/cancela/bloqueia; conflitos recusados no servidor; contato e mensagem criptografados; e-mail enviado sem derrubar o pedido; testes passam; README permite subir do zero.

## 2. Arquitetura

Monólito Django servindo templates (landing preservada) + API JSON consumida por `fetch` com sessão e CSRF. Sem DRF: views JSON simples, menos dependências.

| Camada | Escolha |
|---|---|
| Backend | Django 5.2 LTS, apps `accounts`, `bookings`, `notifications`, `site_pages` |
| Auth | Sessão Django + CSRF (cookie `csrftoken` lido pelo JS e enviado em `X-CSRFToken`). Nenhum token em localStorage. |
| Dados | SQLite em dev, PostgreSQL em prod via `DATABASE_URL` (`dj-database-url`, `psycopg`) |
| Cripto | `cryptography` Fernet / `MultiFernet` (rotação). Chaves em `FIELD_ENCRYPTION_KEYS` (env, lista separada por vírgula, a primeira cifra) |
| Estáticos | WhiteNoise |
| Frontend | HTML/CSS/JS puro, ES modules, calendário próprio |

Estrutura:

```
manage.py
config/            settings.py, urls.py, wsgi.py
accounts/          cadastro, login, logout, reset de senha, /api/auth/*
bookings/          models, services (regras), api views, admin.py, testes
notifications/     Notification model, e-mail, adaptador WhatsApp (stub)
site_pages/        views das páginas HTML
templates/         base.html + páginas
static/css|js|imgs|video
docs/              spec, plano, contrato de API
```

## 3. Modelos

- `Field`: `name`, `description`, `price_per_hour` (Decimal), `active`, `photo` (caminho estático, opcional).
- `BookingRequest`: `user` FK, `field` FK, `start`, `end` (datetimes aware), `status` (`pendente|aprovado|recusado|cancelado`), `contact_enc`, `message_enc` (TextField com token Fernet), `created_at`, `updated_at`, `decided_by` FK nulo.
- `TimeBlock`: `field` FK, `start`, `end`, `reason`, `created_by`, `created_at`.
- `AuditEvent`: `actor` FK nulo, `action`, `object_type`, `object_id`, `created_at`, `meta` (JSON sem segredos). Ações: `booking.created|approved|rejected|cancelled`, `block.created|deleted`, `booking.decrypted`.
- `Notification`: `booking` FK, `channel` (`email|whatsapp`), `kind`, `status` (`enviado|falhou|ignorado`), `error` (texto curto sem segredos), `created_at`.

Estados padronizados, transições permitidas:

```
pendente -> aprovado | recusado | cancelado
aprovado -> cancelado
recusado, cancelado: finais
```

Cliente só pode `pendente|aprovado -> cancelado` no próprio pedido. Admin faz as demais.

## 4. Regras de reserva (servidor, `bookings/services.py`)

`validate_window(field, start, end)`: campo ativo; `start < end`; alinhado a hora cheia; 1 a 4h; `start` no futuro; dentro de `BUSINESS_HOURS` (mesmo dia local); sem cruzar meia-noite.

Conflito: intervalo meio-aberto `[start,end)` sobrepõe `aprovado` ou `TimeBlock` do mesmo campo. Pedidos `pendente` não bloqueiam, mas o mesmo usuário não pode ter dois pendentes/aprovados sobrepostos no campo (duplicado) nem enviar o mesmo intervalo exato duas vezes.

Concorrência: criação e aprovação dentro de `transaction.atomic()` com `select_for_update()` na linha do `Field`; conflito rechecado dentro da transação. Aprovar rechecado contra aprovados e bloqueios; criar bloqueio sobre horário já aprovado é recusado (409) com a lista de conflitos.

Disponibilidade: `GET /api/availability?field=<id>&date=YYYY-MM-DD` devolve os slots do dia com `free|booked|blocked|past|closed`. Também `?from=&to=` (até 31 dias) para o calendário do mês.

## 5. Contrato de API

JSON, UTF-8, sessão + CSRF. Erros: `{"error": {"code": "...", "message": "pt-BR", "fields": {...}}}`.

| Método e rota | Auth | Descrição | Sucesso | Erros |
|---|---|---|---|---|
| `GET /api/csrf` | - | seta cookie CSRF | 204 | - |
| `POST /api/auth/register` | - | `name,email,password,phone` | 201 user | 400 validação, 409 e-mail existe |
| `POST /api/auth/login` | - | `email,password` | 200 user | 400, 401 |
| `POST /api/auth/logout` | - | encerra a sessão (idempotente, também sem sessão) | 204 | - |
| `GET /api/auth/me` | - | usuário ou `null` | 200 | - |
| `GET /api/fields` | - | campos ativos | 200 lista | - |
| `GET /api/availability` | - | slots | 200 | 400 |
| `POST /api/bookings` | cliente | `field,start,end,contact,message` | 201 booking | 400, 401, 409 conflito/duplicado |
| `GET /api/bookings` | cliente | só os do próprio usuário | 200 lista | 401 |
| `POST /api/bookings/<id>/cancel` | dono | cancela | 200 | 401, 404, 409 transição |
| `GET /api/admin/bookings?status=` | staff | todos, contato mascarado | 200 | 401, 403 |
| `POST /api/admin/bookings/<id>/status` | staff | `status` | 200 | 403, 404, 409 |
| `GET /api/admin/bookings/<id>/contact` | staff | descriptografa e audita | 200 | 403, 404 |
| `GET/POST /api/admin/blocks` | staff | lista / cria bloqueio | 200/201 | 403, 409 |
| `DELETE /api/admin/blocks/<id>` | staff | remove | 204 | 403, 404 |

Datas trafegam em ISO 8601 com offset. Pedido de outro usuário responde 404 (não vaza existência). Recuperação de senha pelas views do Django (`/senha/...`), e-mail com link de reset.

## 6. Segurança

- Senhas: hashers padrão do Django + validadores. Nada reversível.
- Cripto: Fernet autenticado; `contact` e `message` cifrados antes de salvar, nunca logados. `FIELD_ENCRYPTION_KEYS` só por env; app falha ao iniciar em produção sem chave. Rotação: nova chave na frente da lista, comando `manage.py rotate_encryption` recifra, depois remove a antiga. Backup da chave documentado (cofre separado do backup do banco).
- Prod (`DEBUG=False`): `ALLOWED_HOSTS` do env, `SECURE_SSL_REDIRECT`, HSTS, cookies `Secure` + `HttpOnly` (sessão) + `SameSite=Lax`, CSRF ativo, `CSRF_TRUSTED_ORIGINS` do env, CORS não habilitado (mesma origem). Cabeçalhos `X-Content-Type-Options`, `Referrer-Policy`.
- Rate limit simples de login/cadastro por IP (cache local) para frear força bruta.
- E-mails: só dados mínimos (campo, data, horário, status). Nunca senha, chave, contato ou mensagem.
- Admin Django: contato/mensagem ficam ocultos (nem mascarados aparecem); revelar só pelo endpoint auditado do painel (`booking.decrypted`).

## 7. Notificações

`notifications/services.py`: `notify_booking_event(booking, kind)` chamado após commit (`transaction.on_commit`). Envia e-mail ao cliente (criado, aprovado, recusado, cancelado) e ao e-mail da equipe (`STAFF_NOTIFY_EMAIL`) em novos pedidos. Falha capturada: grava `Notification(status=falhou, error=<tipo da exceção>)`, nunca propaga, nunca apaga reserva. `EMAIL_BACKEND` console em dev, SMTP por env em prod. `WhatsAppChannel` é adaptador com a mesma interface, desligado por `WHATSAPP_ENABLED=false`, registra `ignorado`; README descreve credenciais/templates da Cloud API necessários.

## 8. Frontend

Direção visual (skill `frontend-design`, referências: sites de reserva de quadras tipo Playtomic, Quadra Livre, Sympla-like de agendamento): manter identidade (logo, verde #7ac400, tema escuro, Bebas Neue, fotos e vídeo), subir o polimento: tipografia com par Bebas Neue + corpo sans legível, cards de campo com foto e preço, hero com CTA "Reservar horário" e busca rápida (data), passos do fluxo (1 Escolha, 2 Horário, 3 Confirme), prova social/estrutura em ícones SVG, footer completo, microinterações, foco visível, contraste AA, mobile-first.

Páginas (templates Django): `/` home, `/sobre/`, `/servicos/`, `/contato/` (existentes, redesenhadas), `/entrar/`, `/cadastro/`, `/senha/...` (reset), `/reservar/`, `/minhas-reservas/`, `/painel/` (staff).

Reservar: seleção de campo (cards) -> calendário mensal (dias fechados/passados desativados) -> grade de horários do dia (livre/ocupado/bloqueado, seleção de 1-4 blocos contíguos) -> resumo + contato + mensagem -> envio. Estados de carregamento, validação inline, erro 409 mostra conflito e recarrega a grade. Anônimo é levado ao login e volta (`next`).

Área do cliente: lista com badges de status, filtro, cancelar com confirmação inline (sem `confirm()`). Painel admin: abas Pedidos / Bloqueios / Agenda, aprovar/recusar/cancelar, revelar contato (audita), criar bloqueio com motivo, agenda do dia com reservas e bloqueios.

Kanban e bloqueio (2026-10-18, pedido do dono): o painel abre na aba Kanban, com as colunas Pendente, Aprovado, Recusado e Cancelado; o card muda de coluna por arrastar e soltar ou pelo botão "Mover para…" (teclado e toque), respeitando as transições do §3, com confirmação inline para recusar/cancelar e o 409 mostrado no próprio card. Filtros de campo, período (`date_from`/`date_to` em `GET /api/admin/bookings`, padrão hoje a +30 dias) e busca por cliente. A equipe não reserva (`create_booking` responde 403 `staff_cannot_book`): para ela o `/reservar/` vira "Bloquear horário", com o mesmo fluxo campo, dia e horários, motivo obrigatório e horários bloqueados clicáveis para liberar (dados de `GET /api/admin/agenda`, que traz id, motivo e intervalo do bloqueio). Lógica pura em `kanban.js` e `block-mode.js`.

JS: `static/js/` com `api.js` (fetch + CSRF + erros), `calendar.js`, `booking.js`, `account.js`, `panel.js`, `auth.js`, `ui.js` (toasts/estados). Sem tokens em storage; só estado de UI em memória.

## 9. Testes

Django `TestCase`: validação de janela (igual, sobreposta, borda, campo inativo, fora do expediente, passado, não alinhado), duplicados, transições, aprovação com conflito, bloqueio sobre aprovado, isolamento A/B (lista, cancelar, detalhe), usuário comum em rotas admin (403), anônimo (401), CSRF exigido, sessão expirada, criptografia (texto no banco != texto claro, round trip, rotação), auditoria, falha de e-mail não perde reserva, throttling, senha não reversível. Fluxo ponta a ponta no navegador com `agent-browser` (Vercel) em desktop e mobile.

## 10. Entrega e deploy

README: instalação local, variáveis, comandos, endpoints, contas de teste não reais (`seed_demo`), checklist de produção, deploy (Gunicorn + WhiteNoise, `migrate`, `collectstatic`, `createsuperuser`, HTTPS no proxy), backup/restore do banco e da chave. Deploy só preparado, nada publicado. `.env.example` sem segredos.

## 11. Fora de escopo

Pagamento online, WhatsApp em produção, app mobile, multi-CT com donos distintos, recorrência automática de mensal.
