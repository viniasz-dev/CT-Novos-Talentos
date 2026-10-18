# Checklist de segurança para produção

Marque cada item antes de publicar. Detalhes em `docs/DEPLOY.md` e `docs/ENCRYPTION.md`.

## Configuração

- [ ] `DEBUG` ausente ou `false` (o app falha fechado: sem `SECRET_KEY`/`FIELD_ENCRYPTION_KEYS` válidas ele não inicia).
- [ ] `SECRET_KEY` aleatória, com 50 caracteres ou mais, diferente do `.env.example` e do desenvolvimento.
- [ ] `ALLOWED_HOSTS` com somente o(s) domínio(s) real(is).
- [ ] `CSRF_TRUSTED_ORIGINS` com `https://dominio`.
- [ ] `python manage.py check --deploy` sem erros e sem avisos além dos de HSTS da rampa.

## Transporte e cookies

- [ ] HTTPS no proxy, com `X-Forwarded-Proto` repassado e sem loop de redirecionamento.
- [ ] `SECURE_SSL_REDIRECT` ativo (automático fora de dev).
- [ ] HSTS começando em 3600 s e subindo conforme `docs/DEPLOY.md`.
- [ ] Cookies de sessão e CSRF `Secure`; sessão `HttpOnly`; `SameSite=Lax` (automático fora de dev).
- [ ] CSRF ativo em toda a API (não há `csrf_exempt`).
- [ ] CORS ausente (mesma origem); nenhum `django-cors-headers` instalado.

## Segredos e dados

- [ ] Nenhum segredo no Git (`.env` está no `.gitignore`; `.env.example` sem valores reais).
- [ ] `FIELD_ENCRYPTION_KEYS` só no ambiente do servidor.
- [ ] Backup da chave Fernet em cofre **separado** do backup do banco.
- [ ] Procedimento de rotação conhecido pela equipe (`docs/ENCRYPTION.md`).
- [ ] Senha do banco e do SMTP só em variáveis de ambiente.
- [ ] Logs sem segredo, senha, contato ou mensagem (o app só registra o tipo da exceção).
- [ ] `seed_demo` **não** executado em produção; contas `*@exemplo.test` inexistentes.

## Acesso

- [ ] Superusuário criado com `createsuperuser` e senha forte; sem contas padrão.
- [ ] Apenas a equipe com `is_staff` (verifique em `/django-admin/`, Usuários) e no grupo "Equipe" (permissões mínimas; sem permissão sobre Usuários).
- [ ] `/django-admin/` acessível só a quem precisa (considere restringir por IP no proxy).
- [ ] Contato e mensagem só são revelados por ação auditada (`booking.decrypted`).

## Abuso

- [ ] Rate limit de login/cadastro funcionando; `TRUSTED_PROXY_COUNT` igual ao número real de proxies.
- [ ] Cache compartilhado configurado, ou o risco do `LocMemCache` por processo foi aceito.
- [ ] `/senha/reset/` protegido no proxy (a rota não tem throttle).

## Operação

- [ ] Backup do banco agendado (`pg_dump`) e **restauração testada**.
- [ ] `git lfs pull` feito: `static/video/fut.mp4` com ~47 MB, não 133 bytes.
- [ ] Teste de concorrência (`common.tests.test_concurrency`) rodado contra PostgreSQL.
- [ ] Suíte completa verde (`python manage.py test`, `node --test static/js/tests`).
- [ ] Envio de e-mail testado ponta a ponta (reserva criada e aprovada).
- [ ] Política de retenção de dados pessoais (LGPD) definida.
