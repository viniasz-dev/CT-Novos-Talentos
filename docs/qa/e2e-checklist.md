# Checklist e2e: aluguel de campos

Roteiro ponta a ponta no navegador real (agent-browser, Chrome headless). Rodar em
**desktop 1280x800** e **mobile 390x844**. Dados: `seed_demo` (campo "Quadra Society",
R$ 150/h; `cliente@exemplo.test`, `cliente2@exemplo.test`, `equipe@exemplo.test` staff;
senha `Demo-12345-Senha`). Expediente: segunda a sexta, 18h às 23h (America/Sao_Paulo):
use dias úteis futuros.

Em toda página: `errors` e `console` sem erro; `document.documentElement.scrollWidth <= innerWidth`.

## 1. Home
- [ ] Cards de campo carregam com foto, nome e preço por hora.
- [ ] "Reservar horário" leva a `/reservar/`; "Ver horários" leva a `/reservar/?field=<id>`.
- [ ] Busca rápida: data padrão é um dia de expediente; "Ver horários livres" leva a `/reservar/?date=AAAA-MM-DD`.
- [ ] Vídeo do hero ausente/quebrado: pôster aparece, botão de pausar some, layout intacto, sem erro de JS.

## 2. Cadastro
- [ ] Senha curta mostra erro inline (cliente).
- [ ] Corrigir a senha e clicar em "Criar conta" envia de verdade (um clique só).
- [ ] Senha comum/numérica mostra o erro do servidor em pt-BR.
- [ ] Cadastro válido loga e volta para a home; o nav troca "Entrar/Criar conta" por "Olá, Nome / Minhas reservas / Sair".

## 3. Reservar
- [ ] Campo, mês e dias carregam; dias passados e fechados ficam desativados.
- [ ] Escolher dia mostra 5 horários (18h a 23h); selecionar 2 seguidos.
- [ ] Horário ocupado/bloqueado está desativado e não seleciona.
- [ ] Resumo: campo, dia, "19:00 às 21:00", "2 horas", total "R$ 300,00".
- [ ] Enviar mostra "Pedido enviado" com status "Pendente"; e-mail de confirmação no console sem contato/mensagem.

## 4. Minhas reservas
- [ ] Lista o pedido com badge de status e filtro com contagem.
- [ ] "Cancelar pedido" abre confirmação inline (sem `confirm()`); "Sim, cancelar" muda para Cancelado.
- [ ] "Novo pedido" e reservar de novo o mesmo horário funciona.

## 5. Segundo cliente
- [ ] cliente2 reserva o mesmo horário: aceito como pendente (pendentes coexistem).
- [ ] Logout funciona (`/api/auth/me` volta `null`).

## 6. Painel da equipe
- [ ] Equipe entra com `next=/painel/` e vê pedidos pendentes.
- [ ] Aprovar o primeiro pedido.
- [ ] Aprovar o segundo (mesmo horário) mostra erro de conflito e o pedido segue pendente.
- [ ] "Ver contato" revela o contato, avisa que é auditado; "Ocultar" mascara de novo.
- [ ] `AuditEvent` `booking.decrypted` existe (shell ou Django Admin).
- [ ] Criar bloqueio com motivo; lista de bloqueios mostra.
- [ ] Agenda do dia mostra reservado e bloqueado nos horários certos.

## 7. Cliente volta
- [ ] Horário aprovado aparece "Ocupado" e o bloqueado "Bloqueado", ambos desativados.
- [ ] 409 forçado (horário bloqueado depois de selecionado): mensagem visível no formulário e grade recarregada.

## 8. Acesso
- [ ] Cliente comum em `/painel/`: "Acesso restrito", nenhuma chamada a `/api/admin/*`; `/api/admin/bookings` responde 403.
- [ ] Anônimo em `/painel/`: "Acesso restrito" com link para entrar; `/minhas-reservas/` redireciona para `/entrar/?next=...`.

## 9. Qualidade
- [ ] Sem rolagem horizontal em 390px em todas as páginas.
- [ ] Tab passa por: pular conteúdo, nav, campo, mês, dia, horários, contato, mensagem, enviar; foco visível.
- [ ] Enter/Espaço selecionam horários pelo teclado.
- [ ] Console sem erros em home, sobre, servicos, contato, entrar, cadastro, reservar, minhas-reservas, painel, senha.
- [ ] axe (wcag2a/aa) sem violações.

## 10. Senha
- [ ] `/senha/reset/` renderiza; enviar e-mail mostra "Verifique seu e-mail".
- [ ] E-mail aparece no console do servidor com o texto do CT (pt-BR) e o link.
- [ ] Link abre "Nova senha"; salvar leva a "Senha alterada"; login com a nova senha funciona.

## 11. Páginas institucionais
- [ ] Sobre, Serviços, Contato renderizam; CTAs "Reservar ..." apontam para `/reservar/`.
- [ ] WhatsApp e Instagram abrem em nova aba; mapa do contato carrega.
