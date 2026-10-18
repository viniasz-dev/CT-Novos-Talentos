# Resultados e2e: 2026-10-18

Primeira execução do sistema num navegador real. Ferramenta: agent-browser 0.39.1
(Chrome headless), sessões separadas `e2e-cliente` (Maria, conta criada no teste),
`e2e-cliente2`, `e2e-equipe`, `e2e-anon`. Servidor `runserver 8765` com `e2e.sqlite3`
descartável e `seed_demo`. Data real: domingo 18/10/2026; reservas em seg 19 a qui 22/10.
Comandos em [run_e2e.md](run_e2e.md), roteiro em [e2e-checklist.md](e2e-checklist.md).

**Resultado final: 39 de 39 verificações passaram** (7 falharam na primeira rodada; todas
corrigidas na origem e repetidas). Desktop 1280x800 e mobile 390x844.

## Bugs encontrados e corrigidos

| # | Bug | Gravidade | Commit | Teste de regressão |
|---|-----|-----------|--------|--------------------|
| 1 | `/reservar/` quebrava ao abrir: `dayButtons()` devolvia `NodeList` e o código chamava `.filter`. Nenhum campo, dia ou horário ficava clicável: reservar era impossível. Os testes passavam porque o DOM falso devolvia `Array`. | Crítica | `ebe32df` | `fake-dom.mjs` agora devolve um `NodeList` sem `filter/map` (20 testes falham sem a correção) |
| 2 | Cadastro/entrar: depois de um erro inline, corrigir o campo e clicar no botão não enviava nada. O `focusout` escondia a mensagem de erro, o botão subia e o clique caía fora dele. | Alta | `c614e7f` | `shouldValidateOnBlur` em `auth.test.mjs` |
| 3 | Vídeo do hero sem arquivo: botão "Pausar vídeo" visível para um vídeo que não toca. | Baixa | `45e2eef` | 3 testes `initHeroVideo` em `home.test.mjs` |
| 4 | Busca rápida da home sugeria hoje mesmo num domingo (fechado). Agora sugere o próximo dia útil. | Baixa (UX) | `45e2eef` | `nextOpenDate` em `home.test.mjs` |
| 5 | E-mail de redefinição de senha usava o texto padrão do Django ("Caso você tenha esquecido, você é: ...", "Equipe 127.0.0.1:8765"): o template `.txt` do projeto era ignorado porque o Django procura `.html`. | Média | `5b465e6` | `test_email_uses_project_template_in_portuguese` |
| 6 | Botão "Reservar horário" do rodapé herdava a cor dos links: texto claro sobre verde (violação axe `color-contrast` em todas as páginas) e verde sobre verde no hover (texto sumia). | Média | `d7d470c` | axe: 0 violações depois |
| 7 | Grade de horários deixava um bloco cinza vazio após o último horário (desktop: 5 horários e espaço sobrando; mobile: 4 + 1 e meia linha vazia). | Baixa (visual) | `d7d470c` | verificado em screenshot (CSS) |

## Resultado por passo

| Passo | Desktop | Mobile | Observação |
|-------|---------|--------|------------|
| 1 Home: cards, CTAs, busca rápida `/reservar/?date=` | Passou | Passou | Bugs 3, 4 corrigidos. Vídeo: pôster aparece, sem erro de JS |
| 2 Cadastro: senha fraca, senha comum, válido loga, nav muda | Passou | (login testado) | Bug 2 corrigido. Erro do servidor: "Esta senha é muito comum. Esta senha é inteiramente numérica." |
| 3 Reservar: campo, dia, 2 horários, resumo R$ 300,00, pendente | Passou | Passou | Bug 1 corrigido (falhava na 1ª rodada). Barra fixa "Revisar pedido" no mobile foca o contato |
| 3 Horário ocupado não seleciona | Passou | - | Clique em "19:00, ocupado" não muda a seleção (`disabled`) |
| 4 Minhas reservas: lista, cancelar inline, reservar de novo | Passou | Passou | Confirmação inline "Sim, cancelar / Manter pedido", sem `confirm()` |
| 5 cliente2 no mesmo horário: pendente coexiste; logout | - | Passou | `/api/auth/me` → `{"user": null}` após sair |
| 6 Painel: aprovar 1º; aprovar 2º → conflito | Passou | Passou (layout) | Toast "Este horário já está reservado." e o pedido #3 segue Pendente (API 409) |
| 6 Ver contato + Ocultar; auditoria | Passou | - | `AuditEvent booking.decrypted` (actor equipe, objeto 3) no shell |
| 6 Bloqueio com motivo; agenda do dia | Passou | Passou | Agenda 19/10: 19h e 20h "Reservado #2"; 20/10: 18h e 19h "Bloqueado: Manutenção da grama" |
| 7 Aprovado/bloqueado indisponível; 409 visível | Passou | - | "Este horário está bloqueado. (Quadra Society, quinta-feira, 22 de outubro, 21:00 às 22:00) A grade foi atualizada..." e a grade recarrega |
| 8 Cliente em `/painel/`: acesso negado sem dados | - | Passou | Nenhuma chamada `/api/admin/*`; `fetch('/api/admin/bookings')` → 403 |
| 8 Anônimo em `/painel/` e `/minhas-reservas/` | Passou | Passou | Painel: "Entre com uma conta da equipe"; minhas-reservas → `/entrar/?next=%2Fminhas-reservas%2F` e volta após login |
| 9 Sem rolagem horizontal (390px) | - | Passou | `scrollWidth == innerWidth` em todas as 10 páginas |
| 9 Tab e teclado | Passou | - | Ordem: pular conteúdo, nav, campo, próximo mês, dia, 5 horários, contato, mensagem, enviar. Foco visível (outline 3px). Enter/Espaço selecionam horários |
| 9 Console sem erros | Passou | Passou | home, sobre, servicos, contato, entrar, cadastro, reservar, minhas-reservas, painel, senha/reset |
| 9 axe wcag2a/aa | Passou | - | Bug 6 corrigido; restam só itens "incomplete" (texto sobre foto/gradiente, revisão manual) |
| 10 Reset de senha | Passou | - | Bug 5 corrigido; link do console → "Nova senha" → "Senha alterada" → login com a senha nova |
| 11 Sobre, Serviços, Contato | Passou | Passou | CTAs "Reservar ..." → `/reservar/`; "Consultar torneio"/"Fale com a gente" → `/contato/`; WhatsApp/Instagram em nova aba; mapa carrega (lazy) |

E-mails no console: "Pedido de reserva recebido" para o cliente, sem contato nem mensagem
(conferido: nenhum trecho do contato/mensagem aparece no log do servidor).

## Problemas conhecidos (não corrigidos)

- **Cache de estáticos em dev**: `runserver` serve `/static/` sem hash e o Chrome reaproveita
  CSS/JS antigos depois de editar. Em dev: recarregar sem cache. Em produção o settings usa
  `CompressedStaticFilesStorage` do WhiteNoise (sem manifest/hash no nome), com `max-age`
  curto (~60 s por padrão): logo após um deploy o navegador pode misturar JS/CSS antigos e
  novos por cerca de 1 minuto. Antes de trocar para `CompressedManifestStaticFilesStorage`,
  verificar que ele resolve os módulos ES (imports relativos em `static/js/`) e as URLs do CSS.
- **Django Admin para a equipe** (corrigido): `seed_demo` agora cria o grupo "Equipe" com
  permissões de modelo e o anexa a `equipe@exemplo.test`; o `User` está registrado no admin.
- **"Reservar mensal"** leva ao fluxo de reserva avulsa; não existe reserva recorrente.
  Sugestão: apontar para `/contato/` ou explicar na página de reserva.
- **Painel**: datas de bloqueio e agenda começam em hoje mesmo num dia fechado (mostra
  "Fechado neste dia"; basta clicar "Próximo dia").
- **Conflito ao aprovar** só aparece como toast; não fica marcado no cartão do pedido.
- **Agenda** mostra "Reserva #2" sem o nome do cliente.
- **Mensagem do 409** tem pontuação estranha: "...bloqueado. (detalhes) A grade...".
- **Vídeo do hero**: `static/video/fut.mp4` é ponteiro Git LFS (133 bytes); a página degrada
  para o pôster. Precisa do arquivo real no deploy.
- `manage.py test` mostra os avisos `security.W005`/`W021` (HSTS subdomínios/preload),
  escopo da Task 12.

## Observações visuais

Desktop: identidade forte (verde #7ac400, Bebas Neue, fundo escuro), cards de preço e de
campo bem acabados, resumo "Seu pedido" estilo ingresso. Mobile: menu hambúrguer limpo,
barra fixa com total e "Revisar pedido" muito boa, cartões de pedido legíveis com badge.
Corrigidos: grade de horários com bloco vazio (7), botão do rodapé sem contraste (6), botão
de vídeo inútil (3). Pequenos pontos que ficaram: título do calendário lido como
"Outubro De 2026" por leitor de tela (capitalização via CSS); no screenshot de página inteira
o cabeçalho fixo aparece no meio (artefato da captura, não do site).

## Evidências (`docs/qa/evidence/`, ~1,6 MB, JPEG 800px)

`d` = desktop 1280x800, `m` = mobile 390x844.

- Home: `d01-home.jpg`, `d01-home-full.jpg`, `m01-home.jpg`, `m00-menu.jpg`
- Cadastro/entrar: `d02-cadastro-senha-fraca.jpg`, `d02-cadastro-comum.jpg` (bug 2: clique perdido),
  `d02-cadastro-senha-comum.jpg`, `d02-cadastro-logado.jpg`, `m02-entrar.jpg`
- Reservar: `d03-reservar-anon.jpg` (bug 1: tudo desativado), `d03-reservar-grade.jpg`,
  `d03-reservar-topo.jpg`, `d03-reservar-selecao.jpg`, `d03-reservar-pendente.jpg`,
  `m03-reservar-selecao.jpg`, `m03-reservar-pendente.jpg`
- Minhas reservas: `d04-minhas.jpg`, `d04-cancelar-confirmacao.jpg`, `d04-cancelado.jpg`,
  `m04-minhas.jpg`, `m04-minhas-aprovado.jpg`, `m04-cancelar-inline.jpg`
- Institucionais: `d05-sobre.jpg`, `d05-servicos.jpg`, `d05-contato.jpg`
- Painel: `d06-painel-pedidos.jpg`, `d06-aprovado.jpg`, `d06-conflito.jpg`, `d06-contato.jpg`,
  `d06-bloqueio.jpg`, `d06-agenda-19.jpg`, `m06-pedidos.jpg`, `m06-bloqueios.jpg`, `m06-agenda.jpg`
- Cliente volta: `d07-ocupado.jpg`, `d07-bloqueado.jpg`, `d07-409.jpg`
- Acesso negado: `m08-painel-negado.jpg`
- Teclado: `d09-teclado-foco.jpg`
- Senha: `d10-senha-reset.jpg`, `d10-senha-enviado.jpg`, `d10-senha-nova.jpg`

## Testes depois das correções

- `manage.py test`: 297 testes, OK (1 skipped).
- `node --test static/js/tests`: 117 testes, 117 passaram.

## Kanban e bloqueio (2026-10-18, segunda rodada)

Servidor descartável (`DEBUG=true DATABASE_URL=sqlite:///kanban-e2e.sqlite3`, `migrate`,
`seed_demo`, porta 8767; arquivo apagado no fim), agent-browser com sessões separadas para
`cliente@`, `cliente2@` e `equipe@exemplo.test`. Pedidos criados pelos clientes (um pela
tela de reserva, os outros por `fetch` na sessão do cliente). Desktop 1280x800 e mobile 390x844.

| # | Verificação | Resultado |
|---|---|---|
| 1 | `/painel/` abre no Kanban; 5 pedidos pendentes dos clientes na coluna Pendente, contagens 5/0/0/0 | ok |
| 2 | Arrastar #1 para Aprovado: POST de status, quadro atualizado, foco no "Mover para…" do card, aviso no aria-live | ok |
| 3 | Soltar #1 (aprovado) em Pendente: recusado sem chamar a API, mensagem no card e no aria-live | ok |
| 4 | Aprovar #4 (mesmo horário de #1) por "Mover para…": 409 no card ("Já aprovado no mesmo horário: pedido #1"), card fica em Pendente | ok |
| 5 | Mesmo conflito por arrastar (#7 sobre #8 aprovado) | ok |
| 6 | Recusar #2: confirmação inline "Recusar o pedido #2?", depois coluna Recusado; card final sem arraste nem botão | ok |
| 7 | Só teclado: Tab até "Mover para…" de #5, Enter, seta, Enter, Shift+Tab, Enter: cancelado; #3 aprovado com Enter, Enter | ok |
| 8 | Filtros: busca "CLIENTE2" (local), período 21/10 a 21/10 (API `date_from`/`date_to`), período invertido mostra erro sem requisição, campo | ok |
| 9 | "Ver contato e mensagem" num card (auditado) e "Ocultar" volta ao mascarado | ok |
| 10 | `POST /api/bookings` como equipe: 403 `staff_cannot_book` | ok |
| 11 | Equipe: cabeçalho "Bloquear horário", menu sem "Minhas reservas", `/reservar/` em modo bloqueio | ok |
| 12 | Bloquear 21h-23h de 20/10 com a sugestão "Manutenção": grade recarrega com os horários bloqueados clicáveis | ok |
| 13 | Cliente em `/reservar/` vê 21h e 22h "bloqueado" e desativados; só chama `/api/availability` | ok |
| 14 | 409 ao bloquear horário aprovado no meio do caminho: "Pedido aprovado: #6", link "Abrir o Kanban" | ok |
| 15 | Abrir o bloqueio (motivo, 21:00 às 23:00), "Liberar horário" com confirmação inline: grade livre de novo, também para o cliente | ok |
| 16 | 390px: `/painel/`, `/reservar/`, `/minhas-reservas/`, `/` sem rolagem lateral da página (o Kanban rola dentro do próprio contêiner) | ok |
| 17 | Mobile: cancelar #1 pelo "Mover para…" com confirmação inline | ok |
| 18 | Console e erros de página nas três sessões: vazios; servidor sem 500 | ok |

Nota da ferramenta: um `drag` com o card fora da tela não fez nada (o ponteiro sintético não
alcança o card); depois de `scrollintoview` funcionou. Não é bug do site.

Evidências: `k-01-kanban-desktop.jpg`, `k-02-kanban-conflito.jpg`, `k-03-bloqueio-liberar.jpg`,
`k-04-kanban-mobile.jpg`, `k-05-bloquear-mobile.jpg`, `k-06-cliente-ve-bloqueado.jpg` (~360 KB).

Testes: `manage.py test` 332 OK (1 skipped); `node --test static/js/tests` 150/150.
