# Publicar Mahuwa Dragon na conta secundária

Use o projeto completo com **Workers, Static Assets e D1**. As rotas `/api/*` executam o Worker; os demais arquivos são servidos como assets. Não é necessário contratar R2, servidores ou banco externo para esta versão.

## 1. Preparar o repositório

Extraia o ZIP, entre na pasta `mahuwa-dragon` e instale Node.js 24 LTS. No terminal:

```sh
npm ci
npm run check
npm test
npm run build
```

O último comando valida o empacotamento do Wrangler sem publicar. Crie um repositório GitHub e envie os arquivos desta pasta. O `package.json` deve ficar na raiz do repositório. O `.gitignore` exclui `node_modules`, `.wrangler`, `.local`, `.dev.vars` e arquivos `.env`.

## 2. Selecionar a conta secundária

Entre com a conta desejada:

```sh
npx wrangler login
npx wrangler whoami
```

Confira o nome e o ID da **conta secundária** na saída de `whoami`. Defina esse ID explicitamente na sessão de terminal para evitar selecionar outra conta.

PowerShell:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = 'ID_REAL_DA_CONTA_SECUNDARIA'
```

Linux/macOS:

```sh
export CLOUDFLARE_ACCOUNT_ID='ID_REAL_DA_CONTA_SECUNDARIA'
```

O projeto entregue não contém `account_id`. Você também pode configurar o seu `account_id` no `wrangler.toml`; ele é um identificador, não uma chave secreta.

## 3. Criar o banco nessa conta

```sh
npx wrangler d1 create mahuwa-dragon-db
```

Copie o `database_id` devolvido pelo comando para o bloco abaixo no `wrangler.toml`, substituindo o UUID de zeros. Preserve o binding `DB`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mahuwa-dragon-db"
database_id = "ID_REAL_DEVOLVIDO_PELO_COMANDO"
```

Então aplique o schema:

```sh
npm run db:remote
```

O schema é idempotente. O servidor também inicializa tabelas necessárias na primeira utilização. Sem um binding D1 válido, contas e sincronização ficam indisponíveis.

## 4. Habilitar IA, se desejar

A tradução básica usa OCR no navegador e o serviço experimental de texto. Para habilitar Gemini, guarde sua chave como **secret** do Worker:

```sh
npx wrangler secret put GEMINI_API_KEY
```

Cole a chave apenas no prompt do Wrangler. Nunca coloque a chave em JavaScript, `wrangler.toml`, GitHub ou `.dev.vars.example`.

`GEMINI_MODEL` e as cotas ficam no `[vars]` de `wrangler.toml`. Os padrões são 20 chamadas de visão e 100 de texto por usuário/dia, com 500 de visão e 2.000 de texto para o site inteiro. Uma página longa pode exigir mais de uma chamada de visão. A chave pertence à sua conta do provedor; a hospedagem gratuita não torna o Gemini ilimitado ou necessariamente gratuito.

O segredo de autenticação é gerado e persistido automaticamente no D1. Se preferir administrar um segredo fixo, configure `AUTH_SECRET` com `npx wrangler secret put AUTH_SECRET` antes de começar a usar as contas e mantenha o valor estável.

## 5. Publicar

```sh
npm run deploy
```

O Wrangler retorna a URL pública `https://mahuwa-dragon.SEUSUBDOMINIO.workers.dev`. Abra essa URL e confira:

1. O catálogo e as capas carregam.
2. Cadastro, login e favoritos persistem após recarregar.
3. **A Biblioteca do Dragão** abre e traduz uma página para português.
4. Sua foto e seu perfil são salvos.
5. O modo IA aparece disponível se você configurou a chave.

No painel Cloudflare, confira as métricas de erros e CPU do Worker e o uso do D1. A validação local não substitui essa conferência no runtime e na conta de destino.

## Publicações pelo GitHub

O workflow `.github/workflows/ci.yml` testa o projeto nos pushes e pull requests. O workflow `deploy.yml` só publica quando você aciona **Actions → Publish to secondary Cloudflare account → Run workflow**.

No repositório, crie o environment `cloudflare-secondary` e os secrets:

- `CLOUDFLARE_ACCOUNT_ID`: ID da conta secundária.
- `CLOUDFLARE_API_TOKEN`: token Cloudflare restringido à conta secundária, com permissões para publicar Workers e executar D1. Use o modelo de token Workers e inclua D1 quando necessário.

Antes do primeiro workflow, configure o ID real do banco no repositório e aplique o schema, conforme os passos anteriores. A chave Gemini é guardada no Worker pelo Wrangler; não precisa entrar no workflow.

Também é possível conectar esse repositório diretamente ao **Workers Builds** no painel da conta secundária. Use `npm ci && npm run check && npm test` para build e `npx wrangler deploy` para deploy, com binding e banco já configurados.

## Plano Free

Os assets estáticos têm requisições gratuitas. As APIs executadas no Worker consomem sua cota; o plano Free tem limite diário de 100.000 requisições e 10 ms de CPU por requisição. D1 também tem cotas de consultas, escrita e armazenamento. O OCR e a composição dos balões são executados no navegador para reduzir o trabalho do servidor. Um capítulo contém várias imagens, e cada acesso ao proxy pode consumir uma requisição do Worker.

Esses limites são da plataforma, não uma promessa de tráfego ilimitado. A operação de um site público movimentado precisa ser dimensionada pelas métricas reais.

Fotos e GIFs mantêm o arquivo original, com até 20 MiB por envio. O site reserva até 256 MiB do D1 para avatares, divididos em blocos de até 1 MiB para respeitar o limite de cada linha. Ao atingir a capacidade, novos envios são recusados com uma mensagem; os avatares padrão continuam disponíveis. Essa configuração evita exigir R2 ou ativar outro serviço com faturamento para esta entrega.

Referências oficiais consultadas: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/) e [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/).
