# CT Novos Talentos: aluguel de campos society

Sistema web (projeto de equipe UNIP) para reservar horários de campo society no CT Novos Talentos. O cliente cria conta, escolhe campo, dia e horário e envia um pedido. A equipe aprova, recusa ou cancela no Kanban do painel e tira horários da agenda com "Bloquear horário". Dados de contato são cifrados no banco, e e-mails de aviso saem a cada mudança.

- **Stack:** Python 3.12, Django 5.2 LTS (sem Django REST Framework), HTML/CSS/JS sem framework. SQLite em desenvolvimento, PostgreSQL em produção. Gunicorn e WhiteNoise.
- **Arquitetura:** monólito Django. As páginas são templates; o navegador chama uma API JSON (`/api/...`) com sessão e CSRF. As regras de reserva ficam em `bookings/services.py`.

Documentos: [API](docs/API.md) | [Deploy](docs/DEPLOY.md) | [Checklist de segurança](docs/SECURITY-CHECKLIST.md) | [Criptografia](docs/ENCRYPTION.md) | [Spec](docs/superpowers/specs/2026-10-18-aluguel-campos-design.md)

## Requisitos

- Python 3.12
- Node.js (qualquer versão atual com `node --test`), só para os testes do JavaScript
- Git (e Git LFS se for usar o vídeo da home; ver "Vídeo da home" abaixo)

## Instalação local (do zero)

Exemplo em Windows com Git Bash. No Linux/macOS troque `.venv/Scripts/python` por `.venv/bin/python`.

```bash
# 1. Ambiente virtual e dependências
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt

# 2. Configuração
cp .env.example .env          # o .env nunca vai para o Git
# Em desenvolvimento DEBUG=true já basta: chaves de desenvolvimento são usadas automaticamente.

# 3. Banco e dados de demonstração
.venv/Scripts/python manage.py migrate
.venv/Scripts/python manage.py seed_demo   # só funciona com DEBUG=true

# 4. Servidor
.venv/Scripts/python manage.py runserver
```

Abra http://127.0.0.1:8000/. Os e-mails de aviso aparecem no terminal (backend de console).

### Contas de teste (não reais)

Criadas **apenas** por `manage.py seed_demo`, que se recusa a rodar com `DEBUG` falso. Senha de todas: `Demo-12345-Senha`.

| E-mail | Perfil |
|---|---|
| `cliente@exemplo.test` | cliente |
| `cliente2@exemplo.test` | cliente (para testar isolamento entre usuários) |
| `equipe@exemplo.test` | equipe (acessa `/painel/` e, pelo grupo "Equipe", consulta pedidos, campos, bloqueios, auditoria e notificações em `/django-admin/`) |

O `seed_demo` também cria o campo "Quadra Society" (R$ 150,00 por hora). Horário padrão: segunda a sexta, 18h às 23h.

### Vídeo da home

Neste checkout `static/video/fut.mp4` é um ponteiro Git LFS de 133 bytes. O vídeo real (cerca de 47 MB) vem com `git lfs install && git lfs pull`, ou copiando o arquivo original. Sem isso a home abre, mas sem vídeo. Obrigatório antes do deploy.

## Como a equipe usa

Entre com uma conta da equipe (`is_staff`; no demo, `equipe@exemplo.test`).

**Kanban (`/painel/`, primeira aba).** Quatro colunas: Pendente, Aprovado, Recusado e Cancelado, cada uma com a contagem. Cada card mostra campo, dia, horário e duração, cliente (nome e e-mail), quando o pedido foi feito, o status e o contato mascarado ("Ver contato" é auditado e some sozinho em 30 s ou em "Ocultar").

- Para decidir um pedido, arraste o card para a coluna nova, ou use o botão "Mover para…" do card (funciona no celular e só com teclado: Tab até o botão, Enter, setas, Enter).
- Só valem as mudanças permitidas: Pendente vai para Aprovado, Recusado ou Cancelado; Aprovado só para Cancelado. Recusado e Cancelado são finais (o card não arrasta nem tem botão). Durante o arraste, as colunas que aceitam o card acendem e as outras apagam.
- Aprovar é direto. Recusar e cancelar pedem confirmação no próprio card.
- Se o horário já tiver outra reserva aprovada, o card fica onde está e mostra o motivo e o número do pedido que ocupa o horário.
- Filtros: campo, período (padrão: hoje até daqui a 30 dias) e busca por nome ou e-mail do cliente. "Atualizar" busca de novo; o quadro também se atualiza depois de cada mudança.
- As abas Pedidos, Bloqueios e Agenda do dia continuam disponíveis.

**Bloquear horário (`/reservar/` para a equipe).** A equipe não faz reservas: o botão do cabeçalho vira "Bloquear horário", o menu não mostra "Minhas reservas" e a API recusa o pedido (403 `staff_cannot_book`). Na mesma tela de reserva, escolha campo, dia e de 1 a 4 horas seguidas, escreva o motivo (até 200 caracteres; "Manutenção", "Evento do CT" e "Horário da escolinha" são sugestões que preenchem o campo) e toque em "Bloquear horário". Os clientes passam a ver o horário como bloqueado. Toque num horário bloqueado para ver o motivo e o intervalo e "Liberar horário" (remove o bloqueio inteiro, depois de confirmar). Se já houver reserva aprovada no intervalo, a tela mostra os números dos pedidos e o link para cancelá-los no Kanban. Horários reservados aparecem como "Reservado" e não podem ser escolhidos.

Os outros botões "Reservar" do site (preços, serviços, sobre) continuam apontando para `/reservar/`, que para a equipe já abre o modo de bloqueio.

## Variáveis de ambiente

Lidas do ambiente ou do `.env`. Em produção (`DEBUG` falso) o app falha ao iniciar sem `SECRET_KEY` e `FIELD_ENCRYPTION_KEYS` válidas.

| Variável | Padrão | Descrição |
|---|---|---|
| `DEBUG` | `false` | `true` só em desenvolvimento. Com `false` ativa HTTPS, HSTS e cookies seguros |
| `SECRET_KEY` | - | Obrigatória fora do modo dev. Mínimo 50 caracteres; valores de exemplo são recusados |
| `FIELD_ENCRYPTION_KEYS` | - | Chaves Fernet separadas por vírgula (a primeira cifra). Obrigatória fora do modo dev. Ver `docs/ENCRYPTION.md` |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,testserver` em dev; vazio em produção | Hosts aceitos, separados por vírgula |
| `CSRF_TRUSTED_ORIGINS` | vazio | Origens HTTPS confiáveis (`https://dominio`) |
| `DATABASE_URL` | `sqlite:///db.sqlite3` | URL do banco (`postgres://...` em produção) |
| `STAFF_NOTIFY_EMAIL` | vazio | E-mail da equipe que recebe aviso de novo pedido |
| `DEFAULT_FROM_EMAIL` | `CT Novos Talentos <nao-responda@localhost>` | Remetente |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` | `localhost`, `587`, vazio, vazio, `true` | SMTP (usado fora do modo dev) |
| `LOGIN_MAX_ATTEMPTS_PER_IP`, `PASSWORD_RESET_MAX_PER_HOUR` | `30`, `10` | Limites por IP: falhas de login na janela de 15 min (qualquer e-mail) e pedidos de reset de senha por hora |
| `EMAIL_TIMEOUT` | `10` | Segundos de espera máxima pelo SMTP (evita travar a requisição) |
| `WHATSAPP_ENABLED` | `false` | Reservado; a integração não está implementada (ver `docs/DEPLOY.md`) |
| `DISABLE_DOTENV` | vazio | `1` impede a leitura do `.env`. **Só para testes** (os subprocessos de `test_settings_prod` usam); não use em produção |
| `TRUSTED_PROXY_COUNT` | `0` | Quantos proxies acrescentam ao `X-Forwarded-For`; define o IP do rate limit |
| `SECURE_HSTS_SECONDS` | `3600` | HSTS em produção; subir aos poucos |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS` | `false` | Só com todos os subdomínios em HTTPS |
| `SECURE_HSTS_PRELOAD` | `false` | Só ao submeter à lista de preload |

## Comandos úteis

```bash
.venv/Scripts/python manage.py test                       # suíte Python (roda em modo dev; os testes de settings de produção ignoram o seu .env)
node --test static/js/tests                               # testes do JavaScript puro
.venv/Scripts/python manage.py check --deploy             # checagem de produção (com env de produção)
.venv/Scripts/python manage.py createsuperuser            # usuário administrador
.venv/Scripts/python manage.py rotate_encryption --dry-run  # rotação de chave de criptografia
.venv/Scripts/python manage.py collectstatic --noinput
```

`common.tests.test_concurrency` tem testes que só rodam em PostgreSQL; ver `docs/DEPLOY.md`.

## Estrutura de pastas

```
config/          settings, urls, wsgi
accounts/        usuário (e-mail como login), API de autenticação, rate limit
bookings/        campos, pedidos, bloqueios, auditoria; services.py (regras), API pública e da equipe, seed_demo
notifications/   e-mails de aviso por evento (e adaptador WhatsApp desligado)
common/          http (erros/JSON), crypto (Fernet), comando rotate_encryption, testes de segurança
site_pages/      views das páginas
templates/       base, páginas, e-mails de reset de senha
static/          css, js (ES modules + testes node), imagens, vídeo
docs/            API, deploy, segurança, criptografia, spec e plano
```

## Regras de negócio

- Estados do pedido: `pendente`, `aprovado`, `recusado`, `cancelado`. De `pendente` vai para qualquer um dos três outros; `aprovado` só para `cancelado`; `recusado` e `cancelado` são finais.
- Horário em horas cheias, de 1 a 4 horas por pedido, no futuro, dentro do expediente e no mesmo dia (fuso `America/Sao_Paulo`).
- Só pedido **aprovado** ou **bloqueio** da equipe ocupam o horário. Pedidos pendentes não bloqueiam; ao aprovar, o sistema confere conflito de novo.
- O mesmo usuário não pode ter dois pedidos pendentes/aprovados sobrepostos no mesmo campo.
- Cliente cancela só o próprio pedido (pendente ou aprovado) antes do início. Pedido de outro usuário responde 404.
- Equipe vê contato mascarado; revelar contato/mensagem é ação auditada.
- Equipe não cria pedidos (403 `staff_cannot_book`); tira horários da agenda com bloqueios.
- Falha ao enviar e-mail nunca desfaz a reserva.

Telefone (`User.phone_enc`): coletado no cadastro e guardado cifrado, mas hoje não é exibido nem usado (reservado para pré-preenchimento/contato futuro). LGPD: remova o campo ou passe a usá-lo antes de ir para produção, se não for necessário.

## Segurança em resumo

Senhas com hash do Django; contato, mensagem e telefone cifrados com Fernet; CSRF sempre ativo; rate limit de login e cadastro; em produção HTTPS, HSTS, cookies `Secure`/`HttpOnly`/`SameSite=Lax`. Lista completa em [docs/SECURITY-CHECKLIST.md](docs/SECURITY-CHECKLIST.md).

## Limitações conhecidas

Teste de corrida só roda em PostgreSQL, estáticos sem CSP, listas sem paginação, corrida no bloqueio criado pelo `/django-admin/` pode dar erro 500, motivo do bloqueio sem auditoria, dependências transitivas sem pin. Rate limit por processo (cache local; `/senha/reset/` limitado por IP), WhatsApp não implementado, vídeo dependente de Git LFS. Lista completa em [docs/DEPLOY.md](docs/DEPLOY.md#10-riscos-e-limitacoes-conhecidos).
