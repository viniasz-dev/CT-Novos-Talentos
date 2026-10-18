# Relatório: Kanban do painel, equipe sem reservas e "Bloquear horário"

Branch `feature/aluguel-campos`, a partir de `a53b5f6`. Data: 2026-10-18.

## Commits

| SHA | Assunto |
|---|---|
| `2876464` | feat(api): staff cannot book; admin bookings date range; agenda block range |
| `8461e8e` | feat(painel): Kanban tab (default) with drag-and-drop and "Mover para…" |
| `ca1cfd5` | feat(ui): staff navigation without booking |
| `416c929` | feat(reservar): "Bloquear horário" mode for staff |
| `8fcd61b` | docs: Kanban and block mode (API, README, spec, e2e evidence) |

(mais o commit deste relatório)

## O que mudou, por requisito

### 1. Kanban no painel

- Aba "Kanban" é a primeira e abre por padrão (`initPanel` ativa a primeira aba do HTML); Pedidos, Bloqueios e Agenda continuam.
- Colunas Pendente, Aprovado, Recusado, Cancelado, com contagem em dígito de placar e faixa na cor do status.
- Card: campo, `#id`, selo de status, horário e duração, dia por extenso, nome e e-mail do cliente, contato mascarado com "Ver contato"/"Ocultar" (a mesma função do Pedidos, agora `contactBox()` em `panel.js`: rota auditada, some em 30 s, some ao trocar de aba, ao esconder a página e ao recriar o quadro, resposta atrasada descartada), "Pedido em…".
- Mover: arrastar e soltar HTML5 (colunas válidas com linha tracejada, inválidas apagadas; soltura inválida recusada sem chamar a API, com aviso) e botão "Mover para…" (disclosure com botões, setas, Esc devolve o foco). Recusado/Cancelado são finais: sem `draggable` e sem botão.
- Recusar/cancelar pedem confirmação inline (`inlineConfirm`); aprovar chama a API direto. 409: mensagem do servidor e ids em conflito no próprio card, card no lugar, aviso no `aria-live`. 401/403 viram "acesso negado". O card só muda de coluna depois que o servidor confirma: o quadro recarrega da API depois de cada mudança e o foco volta ao card movido.
- Filtros: campo, De/Até (padrão hoje a +30 dias pelo `todayISO` de São Paulo), busca local por nome/e-mail (sem acento/maiúscula), "Atualizar". Estados vazio por coluna, carregando, erro com "Tentar de novo". Mobile: colunas com scroll-snap horizontal dentro do contêiner.
- Backend: `GET /api/admin/bookings` aceita `date_from`/`date_to` (inclusivos, dia local; `parse_date`; 400 `invalid_date` com `fields`, 400 `invalid_range` se invertido).
- Arquivos: `static/js/kanban.js` (puro), `static/js/kanban-board.js` (DOM), `static/js/panel.js`, `templates/pages/painel.html`, `static/css/pages.css`, `bookings/api_admin.py`.

### 2. Equipe não reserva

- `services.create_booking` levanta `Forbidden("staff_cannot_book", 'A equipe não faz reservas; use "Bloquear horário".')` para `is_staff`, antes de qualquer validação. `POST /api/bookings` responde 403.
- Navegação: equipe não vê "Minhas reservas" (template e `navItems`); CTA do cabeçalho vira "Bloquear horário" (template e `headerCta()` aplicado por `initAuthNav`); rodapé e os dois CTAs principais da home também. `/minhas-reservas/` mostra para a equipe um aviso com links para o painel e para "Bloquear horário" e não carrega `account.js`.
- Escolha documentada (README): os demais links "Reservar" (preços, serviços, sobre) continuam em `/reservar/`, que para a equipe já é o modo de bloqueio. Menos mudanças em páginas institucionais, mesmo destino.
- Testes que criavam pedidos com usuário staff passaram a usar um segundo cliente.

### 3. Modo "Bloquear horário"

- `reservar.html` renderiza para staff `data-mode="block"`, título/intro/etapas/legendas próprios e um resumo "Bloqueio" sem preço nem contato: campo "Motivo" obrigatório (até 200, contador, sugestões "Manutenção", "Evento do CT", "Horário da escolinha" que só preenchem o campo) e botão "Bloquear horário".
- Mesmo fluxo e componentes (`booking.js`): no modo bloqueio o dia vem de `GET /api/admin/agenda` (mesmo formato + `booking`/`block`), dias lotados ficam clicáveis (é onde estão os bloqueios), reservado aparece "Reservado" e continua desativado.
- Horário bloqueado é botão: abre no resumo o bloqueio inteiro (motivo, intervalo), marca todos os horários dele, "Liberar horário" com confirmação inline que diz que o bloqueio inteiro sai, `DELETE /api/admin/blocks/<id>`, foco volta ao horário liberado. "Fechar" ou escolher um horário livre fecha.
- Envio: `POST /api/admin/blocks {field,start,end,reason}`; sucesso recarrega grade e mês e mostra "Bloqueado: …". 409 `slot_taken` mostra os pedidos aprovados e o link "Abrir o Kanban". 401 vai ao login.
- Backend: os itens `block` da agenda agora trazem `start` e `end`.
- Cliente: comportamento igual ao anterior (teste de regressão em node e de template).
- Arquivos: `static/js/block-mode.js`, `static/js/booking.js`, `templates/pages/reservar.html`, `static/css/pages.css`.

### 4. Design e acessibilidade

Skill `frontend-design` usada antes do CSS. Mantida a identidade (noite/gramado/giz, verde #7ac400, Bebas Neue + Barlow). Kanban como placar; modo bloqueio com a borda do ingresso em amarelo refletor (`--c-flood`). Teclado em tudo (disclosure com setas/Esc, confirmação com foco em "Voltar"), foco gerenciado após mover/liberar, `aria-live` no quadro, foco visível global, animações só com `prefers-reduced-motion: no-preference`, cores dos tokens com contraste já calculado (AA). Sem dependências novas, sem `localStorage`, sem `innerHTML` com dados.

### 5. Documentação

`docs/API.md` (403 `staff_cannot_book`, `date_from`/`date_to`, `invalid_range`, bloco da agenda com intervalo; saídas reais do servidor descartável), `README.md` ("Como a equipe usa"), spec §8 (um parágrafo), `docs/qa/e2e-results.md` (seção "Kanban e bloqueio").

## Testes adicionados

Python:
- `bookings.tests.test_services.StaffCannotBookTests`: `test_staff_create_booking_forbidden`, `test_staff_check_runs_before_validation`, `test_client_still_books`
- `bookings.tests.test_api_public.CreateBookingTests.test_staff_cannot_book_403`
- `bookings.tests.test_api_admin.ListTests`: `test_filter_date_range_inclusive_local_days`, `test_bad_date_range_400`
- `bookings.tests.test_api_admin.AgendaTests.test_agenda` (agora confere `block.id/start/end`)
- `site_pages.tests.test_pages.StaffPagesTests`: `test_reservar_block_mode_for_staff`, `test_reservar_unchanged_for_clients_and_anonymous`, `test_staff_nav_and_ctas`, `test_client_nav_keeps_reservar`, `test_minhas_reservas_staff_notice`
- `site_pages.tests.test_pages.PagesTests.test_painel_has_tabs_and_no_data_in_html` (4 abas, Kanban primeira)

Node (`static/js/tests/kanban.test.mjs`, 19 na primeira rodada; ver correções abaixo): colunas; transições/canDrag/canMove; groupByStatus; filtro sem acento; durationLabel/rangeError/conflictText; aba padrão e período hoje+30; conteúdo do card sem HTML; só pendente/aprovado com arraste e botão; coluna vazia; "Mover para…" por teclado + foco após mover; confirmação de recusa/cancelamento; 409 inline; destaque de colunas no arraste e soltura válida; soltura inválida recusada; filtros (busca local, período, intervalo inválido); Atualizar e erro com retry; contato revelado/oculto/limpo ao recarregar; 403 ao mover.

Node (`static/js/tests/block-mode.test.mjs`, 12): validateReason; blockConflictText; sugestões; agenda da equipe e "Reservado"; dia lotado clicável; chips + contador; resumo sem preço; motivo obrigatório + POST + recarga; 409 com ids e link; abrir e liberar bloqueio inteiro com foco; Fechar; modo cliente inalterado. `auth.test.mjs`: navItems da equipe e `headerCta`.

## Comandos e saída

```
.venv/Scripts/python.exe manage.py test          -> Ran 332 tests in 11.6s, OK (skipped=1)
node --test static/js/tests                      -> tests 150, pass 150, fail 0
.venv/Scripts/python.exe manage.py check         -> System check identified no issues (0 silenced).
.venv/Scripts/python.exe manage.py makemigrations --check --dry-run -> No changes detected
```

(Antes: 321 Python, 118 node.)

## Verificação no navegador

agent-browser, servidor descartável na porta 8767 (`DEBUG=true DATABASE_URL=sqlite:///kanban-e2e.sqlite3`, `migrate`, `seed_demo`), depois parado e o arquivo apagado. `db.sqlite3` e `.env` não foram tocados. 18 verificações, 18 ok, 0 falhas (tabela em `docs/qa/e2e-results.md`): Kanban com pedidos dos clientes; aprovar arrastando e pelo "Mover para…"; soltura inválida recusada sem POST; conflito inline (menu e arraste); recusar e cancelar com confirmação inline; caminho só teclado; filtros; contato revelar/ocultar; 403 `staff_cannot_book`; UI da equipe em modo bloqueio; criar bloqueio; cliente vê bloqueado e desativado; 409 ao bloquear horário aprovado; liberar e cliente vê livre; 390px sem rolagem lateral da página; mover no mobile; console e erros vazios, servidor sem 500. Evidências `docs/qa/evidence/k-*.jpg` (6 arquivos, ~360 KB).

Nenhum bug do site encontrado na rodada. Observação de ferramenta: `drag` com o card fora da tela não age; com `scrollintoview` antes funciona.

## Limitações conhecidas

- A busca por cliente filtra só o período carregado (no navegador); não há paginação: um período muito longo traz todos os pedidos dele.
- Arrastar e soltar HTML5 não funciona em telas de toque na maioria dos navegadores; no celular o caminho é "Mover para…".
- O modo bloqueio segue as regras da grade: 1 a 4 horas seguidas, futuro, dentro do expediente. Bloqueios maiores ou fora disso continuam pela aba Bloqueios do painel (ou `/django-admin/`).
- A API de bloqueios continua aceitando bloqueios sobrepostos (comportamento anterior); a tela não deixa escolher horário já bloqueado.
- Os textos de staff são decididos no servidor (template); se a permissão mudar com a página aberta, a API responde 403 e a tela mostra a mensagem.
- Em 390px `document.documentElement.scrollWidth` relata a largura das colunas do Kanban e das abas, mas o `body` usa `overflow-x: clip` e a página não rola de lado (`scrollX` fica 0).

## Rodada de correções (revisão), commit `e6c90ea`

### O que mudou

1. **Erro de movimento não se perde** (`kanban-board.js`): quando a chamada de status falha, o aviso vai para o card que está na tela (`cardOf(id)`), mesmo se o quadro foi recriado durante a chamada. Enquanto um movimento está em andamento, os filtros e "Atualizar" ficam `disabled` + `aria-disabled="true"` (formulário com `aria-busy`) e `load()` não roda, para o quadro ficar estável.
2. **Aviso de soltura honesto**: todas as colunas aceitam `dragover`; só um `drop` numa coluna inválida mostra "Não dá para mover…". Soltar fora do quadro ou cancelar o arraste só limpa o estado, sem mensagem. O estado de "passando por cima" sai em `dragleave`/`dragend` (o antigo `drag.over` foi removido).
3. **Um movimento por vez, com aviso**: um segundo movimento (menu, soltura ou "Sim, recusar/cancelar" de uma confirmação aberta antes) mostra no card e anuncia "Aguarde o pedido anterior terminar.". `requestMove` confere antes de abrir a confirmação inline.
4. Menores: `applyMove` e o campo `verb` de `MOVE_COPY` removidos (não tinham uso: o quadro recarrega da API depois de cada mudança, sem UI otimista); card `<li>` com `role="group"` e o `aria-label`; espaço em `contact = _clean_text(` em `bookings/services.py`; `GET /api/admin/bookings` limita `date_from..date_to` a 366 dias (400 `invalid_range`, "O período pode ter no máximo 366 dias."), com o mesmo limite no `rangeError` do cliente e nota no `docs/API.md`; o texto deste relatório não fala mais em desfazer.

### Testes novos ou alterados

- Python: `ListTests.test_bad_date_range_400` (366 dias passa, 367 dá 400 `invalid_range`).
- Node `kanban.test.mjs`: "drop on an invalid column shows the rejection and calls no API"; "releasing outside the board (after hovering an invalid column) shows nothing"; "drop on a valid column moves the card"; "a refresh during a slow move keeps the 409 visible on the live card; filters are locked meanwhile"; "a second move while one is in flight says to wait (no silent no-op, no confirmation opened)"; "a confirmation opened before another move started also says to wait on Sim"; "a failed move (500)…" e "a failed move (network error) keeps the card in its column and restores \"Mover para…\""; "cards are named groups"; `rangeError` com o teto de 366 dias. Removido o teste de `applyMove`; o antigo "invalid drop" (que dependia de `dragend`) foi substituído.
- Node `block-mode.test.mjs`: "a 2-hour block marks both slots with the same id and one DELETE releases both".

### Comandos e saída

```
node --test static/js/tests 2>&1 | tail -12
  ℹ tests 158
  ℹ suites 0
  ℹ pass 158
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
.venv/Scripts/python.exe manage.py test            -> Ran 332 tests, OK (skipped=1)
.venv/Scripts/python.exe manage.py check           -> System check identified no issues (0 silenced).
.venv/Scripts/python.exe manage.py makemigrations --check --dry-run -> No changes detected
```

`db.sqlite3` e `.env` não foram tocados. Não houve nova rodada no navegador nesta correção; o comportamento ficou coberto pelos testes acima.
