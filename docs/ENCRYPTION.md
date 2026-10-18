# Criptografia de dados pessoais

Contato e mensagem dos pedidos (`BookingRequest.contact_enc`, `message_enc`) e o telefone do usuário (`User.phone_enc`) são cifrados com Fernet (AES-128-CBC + HMAC) antes de ir ao banco. As chaves ficam só na variável de ambiente `FIELD_ENCRYPTION_KEYS`, nunca no Git.

## Gerar uma chave

```
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

`FIELD_ENCRYPTION_KEYS` é uma lista separada por vírgula. A **primeira** chave cifra; todas decifram.

```
FIELD_ENCRYPTION_KEYS=chave_nova,chave_antiga
```

Com `DEBUG=false`, o app não inicia se a variável estiver vazia ou tiver chave inválida.

## Onde guardar

- Em um cofre de segredos (gerenciador de senhas da equipe ou secret manager do provedor) e na configuração de ambiente do servidor.
- O backup da chave fica em local **separado** do backup do banco. Quem tem os dois consegue ler todos os dados; quem tem só um, nada.

## Rotação

1. Gere uma chave nova.
2. Coloque-a **na frente** da lista: `FIELD_ENCRYPTION_KEYS=nova,antiga`. Reinicie o app.
3. Simule: `python manage.py rotate_encryption --dry-run`.
4. Execute: `python manage.py rotate_encryption`. É idempotente: rodar de novo não altera nada.
5. Confirme que a contagem final de pendentes é zero (nova execução imprime `recifrados: 0`).
6. Remova a chave antiga da lista e reinicie. Guarde a antiga no cofre por um tempo, caso exista backup de banco antigo.

## Perder a chave

Sem a chave, contato, mensagem e telefone cifrados são **irrecuperáveis**. Não existe porta dos fundos. Os pedidos continuam existindo (campo, horário, status), mas os dados pessoais precisariam ser pedidos de novo aos clientes. Por isso: backup da chave em cofre separado, antes do primeiro uso em produção.

## Acesso ao conteúdo

Só equipe (`is_staff`) vê contato e mensagem em claro, e cada revelação grava um `AuditEvent` `booking.decrypted` (quem, qual pedido, quando; nunca o conteúdo).
