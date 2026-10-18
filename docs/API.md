# Referência da API

API JSON (UTF-8) consumida pelo próprio site, na mesma origem. Autenticação por sessão (cookie) mais CSRF. Não há CORS, token em storage nem Django REST Framework.

Todos os exemplos abaixo são respostas **reais** capturadas do app rodando localmente (`DEBUG=true`, SQLite, `seed_demo`). IDs, datas e `created_at` mudam a cada execução.

## Convenções

- **CSRF:** chame `GET /api/csrf` uma vez (define o cookie `csrftoken`, responde 204). Em todo `POST`/`DELETE`, envie o valor do cookie no cabeçalho `X-CSRFToken`. Sem ele: 403 `csrf_failed`. O cookie é renovado no login; releia-o depois.
- **Corpo:** `Content-Type: application/json`. Corpo que não seja um objeto JSON: 400 `invalid_json`.
- **Datas:** ISO 8601 **com offset** (`2026-10-20T19:00:00-03:00`). Sem offset: 400 `invalid_datetime`. Datas puras: `AAAA-MM-DD`. Respostas saem no fuso `America/Sao_Paulo`.
- **Erros:** `{"error": {"code": "...", "message": "pt-BR", "fields": {...}}}`. `fields` é um objeto (vazio quando não se aplica).
- **Pedido de outro usuário:** 404, nunca 403 (não revela existência).
- **Contato e mensagem** nunca saem em claro, exceto em `GET /api/admin/bookings/<id>/contact`. As demais respostas trazem `contact_masked` (sempre `••••••`) e `message_present`.
- **Rate limit:** login e cadastro respondem 429 `too_many_attempts` (ver `docs/DEPLOY.md`).

Roteiro `curl` usado para gerar os exemplos (Git Bash):

```bash
B=http://127.0.0.1:8766
curl -s -c jar $B/api/csrf
TOKEN=$(grep csrftoken jar | awk '{print $7}')
curl -s -b jar -c jar -X POST $B/api/auth/login \
  -H "Content-Type: application/json" -H "X-CSRFToken: $TOKEN" \
  --data '{"email":"cliente@exemplo.test","password":"Demo-12345-Senha"}'
```

## Endpoints

| Método e rota | Auth | Sucesso | Erros |
|---|---|---|---|
| `GET /api/csrf` | - | 204 | - |
| `POST /api/auth/register` | - | 201 | 400, 409, 429 |
| `POST /api/auth/login` | - | 200 | 400, 401, 429 |
| `POST /api/auth/logout` | - | 204 | - |
| `GET /api/auth/me` | - | 200 | - |
| `GET /api/fields` | - | 200 | - |
| `GET /api/availability` | - | 200 | 400, 404 |
| `POST /api/bookings` | cliente (não staff) | 201 | 400, 401, 403, 404, 409 |
| `GET /api/bookings` | cliente | 200 | 401 |
| `POST /api/bookings/<id>/cancel` | dono | 200 | 401, 404, 409 |
| `GET /api/admin/bookings?status=&field=&date=&date_from=&date_to=` | staff | 200 | 400, 401, 403 |
| `POST /api/admin/bookings/<id>/status` | staff | 200 | 400, 401, 403, 404, 409 |
| `GET /api/admin/bookings/<id>/contact` | staff | 200 | 401, 403, 404 |
| `GET /api/admin/blocks` | staff | 200 | 400, 401, 403 |
| `POST /api/admin/blocks` | staff | 201 | 400, 401, 403, 404, 409 |
| `DELETE /api/admin/blocks/<id>` | staff | 204 | 401, 403, 404 |
| `GET /api/admin/agenda?field=&date=` | staff | 200 | 400, 401, 403, 404 |

Observação: `logout` não exige sessão no código (responde 204 mesmo anônimo); o spec previa 401. Método não suportado em qualquer rota: 405 `method_not_allowed`. Rota "staff" sem login: 401; com usuário comum: 403.

---

## Autenticação

### `GET /api/csrf`

```
GET /api/csrf  ->  204 (sem corpo, Set-Cookie: csrftoken=...)
```

### `GET /api/auth/me`

Anônimo, 200:

```json
{ "user": null }
```

Logado, 200:

```json
{ "user": { "id": 1, "name": "Cliente Um", "email": "cliente@exemplo.test", "is_staff": false } }
```

### `POST /api/auth/register`

Corpo: `name`, `email`, `password`, `phone` (todos obrigatórios). A senha passa pelos validadores do Django. Já cria a sessão.

```
POST /api/auth/register
{"name":"Maria Souza","email":"maria@exemplo.test","password":"Demo-12345-Senha","phone":"(11) 91234-5678"}
```

201:

```json
{ "user": { "id": 4, "name": "Maria Souza", "email": "maria@exemplo.test", "is_staff": false } }
```

Validação, 400:

```
{"name":"","email":"nao-e-email","password":"123","phone":""}
```

```json
{
  "error": {
    "code": "validation_error",
    "message": "Revise os campos informados.",
    "fields": {
      "name": "Campo obrigatório.",
      "phone": "Campo obrigatório.",
      "email": "Informe um e-mail válido.",
      "password": "Esta senha é muito curta. Ela precisa conter pelo menos 8 caracteres. Esta senha é muito comum. Esta senha é inteiramente numérica."
    }
  }
}
```

E-mail já existe, 409:

```json
{
  "error": {
    "code": "email_taken",
    "message": "Este e-mail já está cadastrado.",
    "fields": { "email": "E-mail já cadastrado." }
  }
}
```

### `POST /api/auth/login`

Corpo: `email`, `password`. 200 devolve `{"user": {...}}` como em `me`.

Senha errada, 401:

```json
{ "error": { "code": "invalid_credentials", "message": "E-mail ou senha incorretos.", "fields": {} } }
```

Após 5 falhas seguidas (mesmo IP e e-mail) em 15 minutos, 429:

```json
{ "error": { "code": "too_many_attempts", "message": "Muitas tentativas. Aguarde alguns minutos e tente de novo.", "fields": {} } }
```

### `POST /api/auth/logout`

204 sem corpo.

---

## Campos e disponibilidade

### `GET /api/fields`

200 (só campos ativos):

```json
{
  "fields": [
    {
      "id": 1,
      "name": "Quadra Society",
      "description": "Campo society com grama sintetica.",
      "price_per_hour": "150.00",
      "photo": ""
    }
  ]
}
```

### `GET /api/availability`

Parâmetros: `field` (obrigatório) e **ou** `date=AAAA-MM-DD` **ou** `from` e `to` (máximo 31 dias). Estados de slot: `free`, `booked` (aprovado), `blocked`, `past`, `closed`.

`GET /api/availability?field=1&date=2026-10-20`, 200 (abreviado, são 5 slots, 18h às 23h):

```json
{
  "field": 1,
  "date": "2026-10-20",
  "open": true,
  "slots": [
    { "start": "2026-10-20T18:00:00-03:00", "end": "2026-10-20T19:00:00-03:00", "state": "free" },
    { "start": "2026-10-20T19:00:00-03:00", "end": "2026-10-20T20:00:00-03:00", "state": "free" }
  ]
}
```

Com bloqueio (`?field=1&date=2026-10-21`, após criar um bloqueio das 18h às 20h):

```json
{
  "field": 1,
  "date": "2026-10-21",
  "open": true,
  "slots": [
    { "start": "2026-10-21T18:00:00-03:00", "end": "2026-10-21T19:00:00-03:00", "state": "blocked" },
    { "start": "2026-10-21T19:00:00-03:00", "end": "2026-10-21T20:00:00-03:00", "state": "blocked" },
    { "start": "2026-10-21T20:00:00-03:00", "end": "2026-10-21T21:00:00-03:00", "state": "free" }
  ]
}
```

(os slots de 21h e 22h seguem `free`.)

Faixa, `GET /api/availability?field=1&from=2026-10-19&to=2026-10-25`, 200 (fim de semana fechado):

```json
{
  "field": 1,
  "days": {
    "2026-10-19": { "open": true, "free": 5, "total": 5 },
    "2026-10-20": { "open": true, "free": 5, "total": 5 },
    "2026-10-24": { "open": false, "free": 0, "total": 0 },
    "2026-10-25": { "open": false, "free": 0, "total": 0 }
  }
}
```

(dias 21 a 23 omitidos aqui; têm o mesmo formato.)

Sem `date` nem `from`/`to`, 400:

```json
{
  "error": {
    "code": "missing_params",
    "message": "Informe date ou from e to.",
    "fields": { "date": "Informe date ou from e to." }
  }
}
```

Outros erros: 400 `invalid_field` (campo ausente/inválido), 400 `invalid_date`, 400 `bad_range` (mais de 31 dias ou `to` antes de `from`), 404 `not_found` (campo inexistente ou inativo).

---

## Reservas do cliente

Requer login (senão 401 `not_authenticated`).

### `POST /api/bookings`

Corpo: `field` (id), `start`, `end` (ISO com offset), `contact` (texto, até 120), `message` (opcional, até 500). Cria com status `pendente`.

**A equipe não reserva.** Usuário `is_staff` recebe 403 `staff_cannot_book` (regra em `services.create_booking`, vale também fora da API). Para tirar um horário da agenda a equipe usa bloqueios (`POST /api/admin/blocks`, tela "Bloquear horário" em `/reservar/`). Resposta real (sessão `equipe@exemplo.test`, banco descartável):

```json
{ "error": { "code": "staff_cannot_book", "message": "A equipe não faz reservas; use \"Bloquear horário\".", "fields": {} } }
```

```
POST /api/bookings
{"field":1,"start":"2026-10-20T19:00:00-03:00","end":"2026-10-20T21:00:00-03:00","contact":"(11) 91234-5678","message":"Aniversario do time"}
```

201:

```json
{
  "booking": {
    "id": 1,
    "field": { "id": 1, "name": "Quadra Society" },
    "start": "2026-10-20T19:00:00-03:00",
    "end": "2026-10-20T21:00:00-03:00",
    "status": "pendente",
    "status_label": "Pendente",
    "contact_masked": "••••••",
    "message_present": true,
    "created_at": "2026-10-18T13:49:26.519562-03:00",
    "can_cancel": true
  }
}
```

Erros reais capturados (todos com `fields: {}` salvo indicação):

| Situação | Status | `code` | `message` |
|---|---|---|---|
| Mesmo usuário já tem pedido pendente/aprovado sobreposto | 409 | `duplicate` | Você já tem um pedido neste horário para este campo. |
| Data sem offset | 400 | `invalid_datetime` | Informe data e hora ISO 8601 com fuso (ex.: 2026-10-20T19:00:00-03:00). (`fields.start`) |
| Fora do expediente (padrão seg-sex 18h-23h) | 400 | `closed` | O campo está fechado neste horário. |
| No passado | 400 | `in_past` | Escolha um horário no futuro. |
| Mais de 4 horas | 400 | `bad_duration` | A reserva pode ter de 1 a 4 horas. |
| Não alinhado à hora cheia | 400 | `not_aligned` | Os horários devem ser em hora cheia. |
| Corpo não é objeto JSON | 400 | `invalid_json` | Corpo da requisição inválido. |

Exemplo (conflito com horário aprovado, capturado ao aprovar o pedido concorrente; ver `status` abaixo): 409 `slot_taken` com `fields.conflicts` listando ids. Horário bloqueado: 409 `blocked`.

### `GET /api/bookings`

200, só pedidos do próprio usuário, mais recentes primeiro:

```json
{
  "bookings": [
    {
      "id": 1,
      "field": { "id": 1, "name": "Quadra Society" },
      "start": "2026-10-20T19:00:00-03:00",
      "end": "2026-10-20T21:00:00-03:00",
      "status": "pendente",
      "status_label": "Pendente",
      "contact_masked": "••••••",
      "message_present": true,
      "created_at": "2026-10-18T13:49:26.519562-03:00",
      "can_cancel": true
    }
  ]
}
```

### `POST /api/bookings/<id>/cancel`

Sem corpo (mas com `X-CSRFToken`). O cliente cancela `pendente` ou `aprovado`, até o início do horário. 200 devolve `{"booking": {... "status": "cancelado", "status_label": "Cancelado", "can_cancel": false}}`.

Pedido de outro usuário, 404:

```json
{ "error": { "code": "not_found", "message": "Não encontrado.", "fields": {} } }
```

Já cancelado ou em estado final, 409:

```json
{ "error": { "code": "invalid_transition", "message": "Esta mudança de estado não é permitida.", "fields": {} } }
```

Depois do início do horário, 409 `too_late`.

---

## Painel da equipe

Requer `is_staff`. Anônimo: 401 `not_authenticated`. Usuário comum, 403:

```json
{ "error": { "code": "forbidden", "message": "Acesso restrito à equipe.", "fields": {} } }
```

### `GET /api/admin/bookings`

Filtros opcionais: `status` (`pendente|aprovado|recusado|cancelado`, senão 400 `invalid_status`), `field`, `date` (um dia), `date_from` e `date_to` (intervalo de dias, inclusivo, pelo dia local de São Paulo do início da reserva; usado pelo Kanban, que pede de hoje a hoje+30). Os filtros se combinam (E). Datas inválidas: 400 `invalid_date` com `fields.date_from`/`fields.date_to`; `date_to` antes de `date_from`, ou período acima de 366 dias: 400 `invalid_range` ("O período pode ter no máximo 366 dias."). Cada item traz `user` e `decided_by`. Ordem: início mais recente primeiro.

`GET /api/admin/bookings?date_from=2026-10-21&date_to=2026-10-21` (resposta real, um item):

```json
{
  "bookings": [
    {
      "id": 2,
      "field": { "id": 1, "name": "Quadra Society" },
      "start": "2026-10-21T18:00:00-03:00",
      "end": "2026-10-21T19:00:00-03:00",
      "status": "recusado",
      "status_label": "Recusado",
      "contact_masked": "••••••",
      "message_present": true,
      "created_at": "2026-10-18T18:00:00.826788-03:00",
      "can_cancel": false,
      "user": { "id": 1, "name": "Cliente Um", "email": "cliente@exemplo.test" },
      "decided_by": { "id": 3, "name": "Equipe", "email": "equipe@exemplo.test" }
    }
  ]
}
```

`?date_from=2026-10-21&date_to=2026-10-20`, 400:

```json
{
  "error": {
    "code": "invalid_range",
    "message": "A data final deve ser igual ou depois da inicial.",
    "fields": { "date_to": "A data final deve ser igual ou depois da inicial." }
  }
}
```

200 (`?status=pendente`, um item):

```json
{
  "bookings": [
    {
      "id": 2,
      "field": { "id": 1, "name": "Quadra Society" },
      "start": "2026-10-20T19:00:00-03:00",
      "end": "2026-10-20T21:00:00-03:00",
      "status": "pendente",
      "status_label": "Pendente",
      "contact_masked": "••••••",
      "message_present": false,
      "created_at": "2026-10-18T13:49:30.576913-03:00",
      "can_cancel": true,
      "user": { "id": 2, "name": "Cliente Dois", "email": "cliente2@exemplo.test" },
      "decided_by": null
    }
  ]
}
```

### `POST /api/admin/bookings/<id>/status`

Corpo `{"status": "aprovado"}` (ou `recusado`, `cancelado`). Aprovar confere de novo os conflitos dentro de transação.

200 (aprovado): o booking com `"status": "aprovado"` e `"decided_by": {"id": 3, "name": "Equipe", "email": "equipe@exemplo.test"}`.

Aprovar um segundo pedido sobre horário já aprovado, 409:

```json
{
  "error": {
    "code": "slot_taken",
    "message": "Este horário já está reservado.",
    "fields": { "conflicts": [1] }
  }
}
```

Transição proibida (ex.: `recusado` para `aprovado`), 409 `invalid_transition`. Status desconhecido, 400:

```json
{ "error": { "code": "invalid_status", "message": "Status inválido.", "fields": {} } }
```

Pedido inexistente: 404 `not_found` ("Pedido não encontrado.").

### `GET /api/admin/bookings/<id>/contact`

Decifra contato e mensagem e **grava auditoria** (`booking.decrypted`). 200:

```json
{ "contact": "(11) 91234-5678", "message": "Aniversario do time" }
```

Inexistente, 404:

```json
{ "error": { "code": "not_found", "message": "Pedido não encontrado.", "fields": {} } }
```

### `POST /api/admin/blocks`

Corpo: `field`, `start`, `end`, `reason` (opcional, até 200). 201:

```json
{
  "block": {
    "id": 1,
    "field": 1,
    "start": "2026-10-21T18:00:00-03:00",
    "end": "2026-10-21T20:00:00-03:00",
    "reason": "Manutencao da grama",
    "created_at": "2026-10-18T13:49:34.317116-03:00"
  }
}
```

Sobre horário com reserva aprovada, 409 (nenhum bloqueio é criado):

```json
{
  "error": {
    "code": "slot_taken",
    "message": "Existem reservas aprovadas neste intervalo.",
    "fields": { "conflicts": [1] }
  }
}
```

### `GET /api/admin/blocks`

Filtros opcionais `field` e `date`. 200:

```json
{
  "blocks": [
    {
      "id": 1,
      "field": 1,
      "start": "2026-10-21T18:00:00-03:00",
      "end": "2026-10-21T20:00:00-03:00",
      "reason": "Manutencao da grama",
      "created_at": "2026-10-18T13:49:34.317116-03:00"
    }
  ]
}
```

### `DELETE /api/admin/blocks/<id>`

204 sem corpo. Repetir a chamada, 404:

```json
{ "error": { "code": "not_found", "message": "Bloqueio não encontrado.", "fields": {} } }
```

### `GET /api/admin/agenda?field=<id>&date=AAAA-MM-DD`

Slots do dia com a reserva aprovada (`booking`) ou o bloqueio (`block`) que ocupa cada um. `block` traz `id`, `reason` e o intervalo inteiro do bloqueio (`start`, `end`), que pode cobrir vários slots; é o que a tela "Bloquear horário" usa para mostrar o bloqueio e liberá-lo com `DELETE /api/admin/blocks/<id>`. 200 (resposta real, `?field=1&date=2026-10-22`, abreviada):

```json
{
  "open": true,
  "slots": [
    {
      "start": "2026-10-22T20:00:00-03:00",
      "end": "2026-10-22T21:00:00-03:00",
      "state": "free"
    },
    {
      "start": "2026-10-22T21:00:00-03:00",
      "end": "2026-10-22T22:00:00-03:00",
      "state": "blocked",
      "block": {
        "id": 2,
        "reason": "Evento do CT",
        "start": "2026-10-22T21:00:00-03:00",
        "end": "2026-10-22T23:00:00-03:00"
      }
    },
    {
      "start": "2026-10-22T22:00:00-03:00",
      "end": "2026-10-22T23:00:00-03:00",
      "state": "blocked",
      "block": {
        "id": 2,
        "reason": "Evento do CT",
        "start": "2026-10-22T21:00:00-03:00",
        "end": "2026-10-22T23:00:00-03:00"
      }
    }
  ]
}
```

Reserva aprovada no slot: `"state": "booked"` e `"booking": {"id", "start", "end", "status"}`. Sem `field` ou `date`: 400 `invalid_params`.

---

## Outras respostas de erro reais

CSRF ausente (403):

```json
{ "error": { "code": "csrf_failed", "message": "Sessão expirada ou requisição inválida. Recarregue a página e tente de novo.", "fields": {} } }
```

Anônimo em rota de cliente (401):

```json
{ "error": { "code": "not_authenticated", "message": "Faça login para continuar.", "fields": {} } }
```

Método não permitido (405, com cabeçalho `Allow`):

```json
{ "error": { "code": "method_not_allowed", "message": "Método não permitido.", "fields": {} } }
```

## Tabela de códigos de erro

| Status | `code` | Quando |
|---|---|---|
| 400 | `validation_error` | Cadastro/login com campos inválidos (`fields` por campo) |
| 400 | `invalid_json` | Corpo não é um objeto JSON |
| 400 | `invalid_datetime` | Data/hora sem offset ou ilegível |
| 400 | `invalid_date` | Data fora do formato `AAAA-MM-DD` ou do intervalo 1900-2200 |
| 400 | `naive_datetime` | Datetime sem fuso chegando ao serviço |
| 400 | `invalid_range` | Fim não é depois do início (ou `date_to` antes de `date_from` no painel) |
| 400 | `bad_range` | Faixa de disponibilidade inválida ou acima de 31 dias |
| 400 | `missing_params` | Disponibilidade sem `date` nem `from`/`to` |
| 400 | `invalid_params` | Agenda sem `field` ou `date` |
| 400 | `invalid_field` | Campo (id) ausente ou inválido |
| 400 | `field_inactive` | Campo desativado |
| 400 | `not_aligned` | Horários fora de hora cheia |
| 400 | `bad_duration` | Mais de `BOOKING_MAX_HOURS` (4) horas |
| 400 | `in_past` | Início no passado |
| 400 | `closed` | Fora do expediente, dia sem expediente ou cruza meia-noite |
| 400 | `invalid_contact` / `invalid_message` | Contato obrigatório/longo demais; mensagem inválida/longa |
| 400 | `invalid_reason` | Motivo do bloqueio inválido ou acima de 200 caracteres |
| 400 | `invalid_status` | Status desconhecido |
| 401 | `not_authenticated` | Sem sessão |
| 401 | `invalid_credentials` | E-mail ou senha incorretos |
| 403 | `forbidden` | Usuário comum em rota da equipe |
| 403 | `staff_cannot_book` | Usuário da equipe em `POST /api/bookings` (a equipe usa bloqueios) |
| 403 | `csrf_failed` | Cabeçalho `X-CSRFToken` ausente ou inválido |
| 404 | `not_found` | Recurso inexistente, ou pedido de outro usuário |
| 405 | `method_not_allowed` | Método não suportado na rota |
| 409 | `email_taken` | E-mail já cadastrado |
| 409 | `duplicate` | Mesmo usuário já tem pedido sobreposto |
| 409 | `slot_taken` | Horário já tem reserva aprovada (`fields.conflicts` = ids) |
| 409 | `blocked` | Horário bloqueado |
| 409 | `invalid_transition` | Mudança de estado não permitida |
| 409 | `too_late` | Cliente tentou cancelar após o início |
| 429 | `too_many_attempts` | Limite de login/cadastro por IP excedido |

Estados de pedido: `pendente`, `aprovado`, `recusado`, `cancelado`. Transições: `pendente` para `aprovado|recusado|cancelado`; `aprovado` para `cancelado`; `recusado` e `cancelado` são finais.
