# Fontes do catálogo

## MangaDex

O servidor consulta a API oficial para títulos, descrições, autores, gêneros, capas, estatísticas, capítulos e servidores de páginas. A página inicial deriva os destaques de popularidade, avaliação, origem e atualização do catálogo. Japonês é classificado como mangá; coreano como manhwa; chinês como manhua.

As consultas usam cache, deduplicação de requisições em andamento e espaçamento de chamadas por instância. O `User-Agent` identifica Mahuwa Dragon. Erros 429 são exibidos para o leitor, sem repetição automática em loop. A limitação por instância não representa uma garantia de limite global em vários Workers simultâneos.

Capas e páginas passam por endpoints fixos do servidor. Não existe proxy aberto para URLs arbitrárias. As imagens vêm de hosts HTTPS autorizados MangaDex, com validação de UUID, nome de arquivo, tipo e redirecionamento. A atribuição à fonte e ao grupo aparece no leitor. Não há download em massa ou cópia de capítulos para o banco do site.

A disponibilidade depende do catálogo e dos publicadores. Um capítulo removido, ausente ou externo não é preenchido com páginas inventadas. Entradas explícitas/pornográficas não são incluídas; o catálogo consulta as classificações `safe` e `suggestive` da fonte.

Documentação: [API oficial](https://api.mangadex.org/docs/static/api.yaml), [limites e regras de uso](https://api.mangadex.org/docs/2-limitations/).

## Jikan / MyAnimeList

Jikan é uma fonte de metadados para light novels: títulos, capas, sinopses, autores e avaliações. Seus números de capítulos são informações editoriais; **não significam capítulos disponíveis no leitor**. A interface informa essa diferença. Para ler novels sem uma fonte de páginas autorizada, o usuário pode importar sua edição TXT ou EPUB.

As consultas ficam em cache por 24 horas. Se Jikan falhar, as demais seções continuam funcionando. A validação desta entrega confirmou o catálogo MangaDex ao vivo; o acesso ao Jikan falhou na rede de teste. Sua integração foi validada com respostas de teste, sem apresentar isso como sucesso ao vivo.

Documentação: [Jikan API](https://docs.api.jikan.moe/) e [schema do projeto](https://raw.githubusercontent.com/jikan-me/jikan-rest/master/storage/api-docs/api-docs.json).

## Histórias próprias e arquivos locais

O projeto inclui duas histórias originais curtas: o quadrinho **A Biblioteca do Dragão** e a novel **Crônicas da Pequena Chama**. Elas são identificadas separadamente na seção do estúdio e fornecem páginas próprias para testar o leitor. Não são apresentadas como lançamentos de editoras externas.

Imagens, pastas, ZIP/CBZ e TXT/EPUB importados são armazenados no IndexedDB do navegador. Eles não são enviados ao D1 ou compartilhados com outros leitores. Os dados podem ser perdidos se o usuário limpar o armazenamento do navegador. Ao usar tradução, o texto reconhecido pode ser enviado ao tradutor; no modo Gemini, a imagem é enviada ao provedor.

## Dependências e assets

OCR: Tesseract.js 6 e Tesseract.js-core 6, com arquivos de licença incluídos junto aos vendors e dados de idiomas. Importação ZIP/EPUB: fflate 0.8.2, licença incluída. Wrangler e Linkedom são ferramentas de desenvolvimento.

As artes do dragão e avatares foram reaproveitadas do ZIP fornecido pelo usuário. O logo vetorial ScanDragon e as páginas/capas das duas histórias originais foram criados para este projeto. Capas externas continuam sob a titularidade das respectivas obras e fontes.
