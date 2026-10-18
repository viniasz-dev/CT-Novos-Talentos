# Como rodar o e2e

Comandos usados na rodada de 2026-10-18 (Windows, Git Bash). Ajuste as datas para
dias úteis futuros.

## 1. Servidor com banco descartável

```bash
export DEBUG=true DATABASE_URL=sqlite:///e2e.sqlite3   # e2e.sqlite3 é ignorado pelo Git (*.sqlite3)
rm -f e2e.sqlite3
.venv/Scripts/python.exe manage.py migrate -v0
.venv/Scripts/python.exe manage.py seed_demo
# em segundo plano; PYTHONIOENCODING deixa os e-mails do console legíveis
PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 \
  .venv/Scripts/python.exe manage.py runserver 8765 --noreload > "$TEMP/e2e-server.log" 2>&1 &
curl -s -o /dev/null -w "%{http_code}\n" --retry 8 --retry-connrefused http://127.0.0.1:8765/
```

`--noreload`: mudanças em Python (urls, views) pedem reiniciar o servidor.

## 2. agent-browser

```bash
npm i -g agent-browser                       # ou npx --yes agent-browser
agent-browser skills get core --full         # guia oficial
agent-browser skills get dogfood             # roteiro de QA exploratório
```

Uma sessão por usuário (cookies separados):

```bash
export AGENT_BROWSER_SESSION=e2e-cliente     # e2e-cliente2, e2e-equipe, e2e-anon
agent-browser set viewport 1280 800          # ou 390 844
agent-browser open http://127.0.0.1:8765/
agent-browser snapshot -i -c                 # refs @eN
agent-browser find label "E-mail" fill "cliente2@exemplo.test"
agent-browser fill "input[type=password]" "Demo-12345-Senha"
agent-browser find role button click --name "Entrar" --exact
agent-browser wait --url "http://127.0.0.1:8765/"
```

Checagens usadas em cada página:

```bash
agent-browser errors
agent-browser console
agent-browser eval "JSON.stringify({sw:document.documentElement.scrollWidth, iw:innerWidth})"
agent-browser a11y --tags wcag2a,wcag2aa
```

Fluxo de reserva:

```bash
agent-browser open "http://127.0.0.1:8765/reservar/?date=2026-10-19"
agent-browser wait --fn "document.querySelectorAll('button.slot').length>0"
agent-browser find role button click --name "19:00 às 20:00, livre"
agent-browser find role button click --name "20:00 às 21:00, livre"
agent-browser find label "Telefone ou WhatsApp" fill "(19) 98888-7777"
agent-browser find role button click --name "Enviar pedido"
agent-browser wait --text "Pedido enviado"
```

`<input type="date">` não aceita `fill` com locale pt-BR; defina por JS:

```bash
agent-browser eval "(()=>{const i=document.querySelector('#busca-data');i.value='2026-10-19';i.dispatchEvent(new Event('change',{bubbles:true}))})()"
```

409 forçado: com o horário já selecionado na sessão do cliente, a equipe cria o
bloqueio pela API na sessão `e2e-equipe`, e o cliente envia:

```bash
AGENT_BROWSER_SESSION=e2e-equipe agent-browser eval "(async()=>{const t=document.cookie.match(/csrftoken=([^;]+)/)[1];return (await fetch('/api/admin/blocks',{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':t},body:JSON.stringify({field:1,start:'2026-10-22T21:00:00-03:00',end:'2026-10-22T22:00:00-03:00',reason:'Evento interno'})})).status})()"
```

Auditoria:

```bash
DEBUG=true DATABASE_URL=sqlite:///e2e.sqlite3 .venv/Scripts/python.exe manage.py shell -c \
  "from bookings.models import AuditEvent; print(list(AuditEvent.objects.values_list('actor','action','object_id')))"
```

Link de redefinição de senha (do console do servidor):

```bash
grep -o "http://127.0.0.1:8765/senha/reset/[^ ]*/" "$TEMP/e2e-server.log" | tail -1
```

Cache: o runserver serve `/static/` sem hash, e o Chrome guarda CSS/JS. Depois de editar
um arquivo estático, rode `agent-browser close` ou force:
`agent-browser eval "fetch('/static/js/booking.js',{cache:'reload'})"` e `agent-browser reload`.

Evidências: `agent-browser screenshot <png>` e conversão para JPEG 800px (PowerShell
`System.Drawing`) em `docs/qa/evidence/` (prefixo `d` = desktop, `m` = mobile).

## 3. Encerrar

```bash
agent-browser close --all
# Windows: encerra o processo ouvindo na 8765
powershell -NoProfile -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort 8765 -State Listen).OwningProcess -Force"
.venv/Scripts/python.exe manage.py test
node --test static/js/tests
```
