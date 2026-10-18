# Deploy

Este guia **prepara** o deploy; nada foi publicado. Arquitetura: Django atrás de um proxy HTTPS, Gunicorn como servidor de aplicação, WhiteNoise servindo os estáticos, PostgreSQL como banco.

## 1. Antes de começar

- Python 3.12 e um PostgreSQL acessível.
- **Vídeo da home (Git LFS).** Neste checkout, `static/video/fut.mp4` é um *ponteiro* Git LFS de 133 bytes, não o vídeo. O arquivo real (cerca de 47 MB) precisa ser restaurado **antes** do `collectstatic`, senão o vídeo da home quebra em produção:
  ```
  git lfs install
  git lfs pull
  ls -l static/video/fut.mp4   # deve ter ~47 MB
  ```
  Se o repositório não tiver acesso ao LFS, copie o arquivo original para `static/video/fut.mp4`. Se o servidor de build não tem `git lfs`, faça isso na máquina de build.
- Gere os segredos (nunca no Git):
  ```
  python -c "from django.core.management.utils import get_random_secret_key as g; print(g())"
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```
  O primeiro vira `SECRET_KEY` (mínimo 50 caracteres; o app recusa valores de exemplo). O segundo vira `FIELD_ENCRYPTION_KEYS`. **Faça backup dessa chave em cofre separado antes do primeiro uso** (ver `docs/ENCRYPTION.md`).

## 2. Variáveis de ambiente

Configure no painel do provedor (ou em um `.env` fora do Git no servidor). Obrigatórias em produção: `SECRET_KEY`, `FIELD_ENCRYPTION_KEYS`, `ALLOWED_HOSTS`, `DATABASE_URL`. `DEBUG` deve ficar ausente ou `false`.

```
DEBUG=false
SECRET_KEY=<gerada acima>
FIELD_ENCRYPTION_KEYS=<chave Fernet gerada acima>
ALLOWED_HOSTS=reservas.seudominio.com.br
CSRF_TRUSTED_ORIGINS=https://reservas.seudominio.com.br
DATABASE_URL=postgres://usuario:senha@host:5432/ct_novos_talentos
STAFF_NOTIFY_EMAIL=equipe@seudominio.com.br
DEFAULT_FROM_EMAIL=CT Novos Talentos <nao-responda@seudominio.com.br>
EMAIL_HOST=smtp.seuprovedor.com
EMAIL_PORT=587
EMAIL_HOST_USER=...
EMAIL_HOST_PASSWORD=...
EMAIL_USE_TLS=true
EMAIL_TIMEOUT=10
TRUSTED_PROXY_COUNT=1
SECURE_HSTS_SECONDS=3600
```

A tabela completa está no `README.md`. `DISABLE_DOTENV=1` existe só para os testes de settings e não deve ser definido em produção. Com `DEBUG` falso o app **falha ao iniciar** se `SECRET_KEY` faltar, for um valor de exemplo/curto, ou se `FIELD_ENCRYPTION_KEYS` faltar ou tiver chave Fernet inválida.

## 3. Passos de deploy

```
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser        # e-mail e senha forte; esse usuário acessa /painel/ e /django-admin/ (superusuário gerencia usuários)
gunicorn config.wsgi                    # o Procfile já traz: web: gunicorn config.wsgi
```

Notas:

- **Não rode `seed_demo` em produção.** Ele recusa quando `DEBUG` é falso, e as contas de teste têm senha pública.
- O primeiro campo (quadra) é cadastrado em `/django-admin/` (modelo "Campo"): nome, descrição, preço por hora, ativo.
- Contas da equipe (não superusuários): marque `is_staff` no usuário em `/django-admin/` e adicione ao grupo **Equipe**. O grupo é criado por `seed_demo` (só dev); em produção crie-o em Grupos com permissões de ver/alterar Campo, Pedido de reserva e Bloqueio (adicionar/excluir para Campo e Bloqueio), e só ver Evento de auditoria e Notificação. Gerenciar usuários exige permissões de Usuário (ou superusuário). Telefone cifrado, contato e mensagem nunca aparecem no admin.
- WhiteNoise serve `staticfiles/` direto do Gunicorn; não precisa de Nginx para estáticos.
- Gunicorn: comece com `--workers 3` (regra: 2 x núcleos + 1). Configure `--bind` conforme a plataforma.

## 4. HTTPS, domínio e proxy

- O TLS termina no **proxy** (Nginx, Caddy, balanceador da plataforma). O proxy deve repassar `X-Forwarded-Proto: https`; o app o confia (`SECURE_PROXY_SSL_HEADER`) e redireciona HTTP para HTTPS (`SECURE_SSL_REDIRECT`). Se o proxy **não** definir esse cabeçalho, ocorre loop de redirecionamento.
- Aponte o DNS do domínio para o proxy e inclua o domínio em `ALLOWED_HOSTS` e `https://dominio` em `CSRF_TRUSTED_ORIGINS`.
- Cookies de sessão e CSRF saem `Secure`; sessão `HttpOnly`; `SameSite=Lax`. Não há CORS (mesma origem).
- **IP do cliente e rate limit:** atrás de proxy, todo pedido chega com o IP do proxy. Defina `TRUSTED_PROXY_COUNT` com o número de proxies que acrescentam ao `X-Forwarded-For` (1 para um proxy). Com `0` (padrão) o cabeçalho é ignorado, porque ele é falsificável, e o limite usa só `REMOTE_ADDR`. Valor maior que o real permite a um atacante forjar o IP; menor faz clientes diferentes dividirem o mesmo contador. Confirme olhando o que seu proxy realmente envia.

### Rampa do HSTS

O padrão é conservador: `SECURE_HSTS_SECONDS=3600` (1 hora), sem subdomínios e sem preload. HSTS é lembrado pelo navegador; um erro de HTTPS com HSTS longo trava o acesso. Suba por etapas, só depois de confirmar que o site funciona em HTTPS:

1. `3600` (1 h): primeira semana.
2. `86400` (1 dia), depois `2592000` (30 dias).
3. `31536000` (1 ano). Só então, **se todos os subdomínios também forem HTTPS**, `SECURE_HSTS_INCLUDE_SUBDOMAINS=true`.
4. `SECURE_HSTS_PRELOAD=true` apenas se for submeter o domínio à lista de preload (difícil de desfazer).

`manage.py check --deploy` avisa W005/W021 enquanto subdomínios/preload estão desligados; é esperado na rampa.

## 5. Rate limit: cache por processo

O limite de login/cadastro usa o cache do Django, e o padrão (`LocMemCache`) é **por processo**. Com 3 workers do Gunicorn, o limite efetivo é até 3 vezes maior (5 tentativas viram até 15), e ele zera a cada reinício. Para produção séria, configure um cache compartilhado (Redis ou Memcached, ou `django.core.cache.backends.db.DatabaseCache`) em `CACHES`. A mudança não existe hoje em `config/settings.py`; faça-a se o risco de força bruta importar.

Ressalva: `/senha/reset/` tem throttle por IP (`PASSWORD_RESET_MAX_PER_HOUR`, padrão 10/h, cache local por processo). Ao exceder, a página responde como sucesso sem enviar e-mail. Para limite global, complemente no proxy.

## 6. Banco: backup e restauração

Backup diário (exemplo):

```
pg_dump --format=custom --file=ct_$(date +%F).dump "$DATABASE_URL"
```

Restauração (em um banco vazio):

```
createdb ct_restore
pg_restore --dbname=ct_restore --no-owner ct_2026-10-18.dump
```

**Teste a restauração** antes de depender dela: restaure em um banco temporário, aponte um `DATABASE_URL` para ele e rode `python manage.py check` e uma consulta de pedidos. Um backup que nunca foi restaurado não é backup.

### Chave de criptografia

- O dump do banco contém contato, mensagem e telefone **cifrados**. Sem `FIELD_ENCRYPTION_KEYS` eles são irrecuperáveis.
- Guarde a chave em cofre **separado** do backup do banco, e todas as chaves antigas enquanto existirem backups cifrados com elas.
- Restaurar o banco exige a **mesma** chave (ou a antiga, na lista) no ambiente de destino.
- **Rotação de chaves:** procedimento em `docs/ENCRYPTION.md` (`manage.py rotate_encryption`, com `--dry-run`).

## 7. Notificações por e-mail e plano para WhatsApp

E-mail: SMTP configurado por variáveis (`EMAIL_*`); `EMAIL_TIMEOUT` (padrão 10 s) limita a espera, pois o envio roda dentro da requisição. Falha de envio **nunca** derruba a reserva: fica registrada em `Notification` com status `falhou` e o tipo da exceção. Consulte no `/django-admin/`.

WhatsApp: **não está em produção**. `WhatsAppChannel` é só um adaptador. Hoje:

- Com `WHATSAPP_ENABLED=false` (padrão) ele registra `ignorado`.
- Com `WHATSAPP_ENABLED=true` ele levanta `NotImplementedError`, que o serviço captura e grava como `falhou`. A reserva segue normal.
- O canal **não está ligado ao envio padrão** (`notify_booking_event` usa só e-mail, a menos que se passe `channels=[...]`). Ligá-lo exige uma pequena mudança de código.

O que falta para a Cloud API da Meta:

1. Conta WhatsApp Business (Meta Business) verificada.
2. Número de telefone dedicado, registrado na Cloud API.
3. Templates de mensagem aprovados pela Meta (reserva criada, aprovada, recusada, cancelada). Mensagens fora da janela de 24 h só podem usar templates.
4. Token de acesso permanente (usuário do sistema) e o ID do número, guardados em variáveis de ambiente.
5. Implementar a chamada HTTP em `notifications/channels.py` e registrar o canal no envio, mantendo a regra de nunca enviar contato nem mensagem do cliente.
6. Consentimento do cliente para receber mensagens (LGPD).

## 8. Teste de concorrência que só roda em PostgreSQL

`common/tests/test_concurrency.py` tem uma classe que dispara pedidos simultâneos e depende de `select_for_update()` real. Ela é **ignorada** em SQLite. Para rodar:

```
# crie um banco de teste vazio e use um usuário com permissão de criar bancos
export DATABASE_URL=postgres://usuario:senha@localhost:5432/ct_test
python manage.py test common.tests.test_concurrency
```

O Django cria e apaga `test_<nome>`. Rode isso uma vez antes de publicar, e a suíte inteira também contra PostgreSQL se possível.

## 9. Verificação pós-deploy

```
python manage.py check --deploy
```

Com as variáveis de produção, só deve restar avisos de HSTS enquanto subir a rampa. Depois abra o site por HTTPS, crie uma reserva, aprove no `/painel/` e confira o e-mail.

## 10. Riscos e limitações conhecidos

- Rate limit por processo (item 5) e `/senha/reset/` com throttle só por processo.
- `TRUSTED_PROXY_COUNT` mal configurado enfraquece o rate limit.
- Vídeo da home depende do `git lfs pull` (item 1).
- WhatsApp não implementado; pagamento online, recorrência e vários donos de CT estão fora de escopo.
- Dados pessoais cifrados dependem de uma única chave: perder a chave é perder contato, mensagem e telefone.
- O teste de concorrência só valida o bloqueio de linha em PostgreSQL.
- O `logout` aceita chamada sem sessão (204); o spec previa 401.
- Fuso e expediente (`BUSINESS_HOURS`, padrão seg-sex 18h-23h) ficam em `config/settings.py`; mudar exige novo deploy.
- Não há política de retenção/exclusão de dados pessoais automatizada (LGPD): defina uma.
