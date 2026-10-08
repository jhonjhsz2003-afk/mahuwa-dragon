# Validação da entrega

Executada localmente em 5 de outubro de 2026. As evidências abaixo separam testes com respostas simuladas de acessos reais à internet.

## Backend e integração

As suítes em `tests/` verificam contas, sessões, banco, biblioteca, progresso, privacidade, avatares, comentários, catálogo, imagens, tradução, interface e integração do Worker. Usam SQLite e WebCrypto reais. Respostas de MangaDex, Jikan e Gemini nos testes automatizados são simuladas e identificadas como tal.

Verificações de segurança incluem: cookie HttpOnly, hashes de senha/sessão, proteção de origem, isolamento entre usuários, perfil privado sem vazamento de e-mail, limites atômicos de biblioteca e cotas de IA, validação de URLs e rejeição de proxy arbitrário. Os testes do adaptador local cobrem binds imutáveis, `RETURNING` e transações concorrentes.

Os testes de imagem verificam os pixels da limpeza das letras, a preservação de bordas próximas, áreas escuras, pontuação, agrupamento de blocos e manutenção da máscara original ao mover uma fala. Isso valida o algoritmo em casos controlados; não significa OCR perfeito em qualquer arte.

## Revisão de tradução em 7 de outubro de 2026

Esta revisão examinou o código sincronizado da entrega mais recente. Os registros de navegador e serviços reais abaixo pertencem à validação anterior; não demonstram disponibilidade atual ou qualidade do novo modelo de tradução.

Foi reproduzida e corrigida uma diferença entre os testes de segurança e limpeza: um fundo parcialmente uniforme era aceito para escrever a tradução, mas recusado na etapa que apagava os glifos. [render-safety.test.js](../tests/render-safety.test.js) falhou antes da correção e passou depois. Os casos verificam matrizes RGBA reais, preservação integral de áreas recusadas, nenhuma limpeza parcial de um balão, remoção dos pixels originais em fundo plano e manutenção da fonte original para restauração. A pintura da fonte é simulada; o teste não avalia a aparência tipográfica no navegador.

A mesma suíte verifica um balão elíptico fechado contra fundo aberto, contorno aberto, painel retangular e numeração. Também verifica que a extração local exclui um título flutuante antes de devolver blocos ao tradutor. As transcrições OCR nesse teste são simuladas; a decisão de contorno lê os pixels do caso controlado. Os testes anteriores de agrupamento, máscaras, resolução e integração do motor continuaram passando após essa correção.

Uma conferência dos arquivos confirmou os 13 pacotes de idioma referenciados pelo OCR. A tentativa automática sem dica usa sete deles; japonês vertical e os pacotes latinos dedicados exigem seleção adequada. O planejamento real de faixas retorna quatro chamadas para uma imagem de 720 × 5.800 pixels, sete para 720 × 10.000 e vinte para 720 × 30.000. Isso explica por que a cota padrão de 20 chamadas pode terminar num único webtoon longo.

Os novos casos também verificam expansão da caixa de escrita somente sobre fundo vazio dentro do balão e pré-validação do tamanho da fonte. Uma tradução que exige fonte abaixo de sete pixels ou que ultrapassa a caixa deixa todos os pixels originais intactos.

[render-real-balloon.test.js](../tests/render-real-balloon.test.js) verifica 12 casos com os pixels PNG nativos das três páginas de exemplo da entrega, incluindo falas com duas linhas e caixas de uma única linha. Isso cobre balões grandes que uma busca proporcional apenas à altura dos glifos cortava e recusava. A busca agora cresce quando o contorno chega à janela de análise, com até 1,8 milhão de pixels por tentativa; somente uma região que termina fechada pode ser aceita. As caixas dos glifos são medidas a partir das letras impressas, sem executar OCR ou provedor. Linhas vizinhas fora da máscara continuam preservadas.

As alterações de fila, cotas, restituição de reservas, cache de faixas e recuperação de limites são verificadas separadamente nas suítes de tradução do servidor e leitor, com respostas de provedores simuladas. Esses testes não provam tradução universal, serviço ilimitado, preservação perfeita de toda arte ou equivalência entre o ambiente local e uma execução remota.

Na conferência de produção anterior à publicação desta revisão, o agente responsável acessou [Mahuwa Dragon](https://mahuwa-dragon.jhszjhon.workers.dev): a configuração informou Gemini indisponível e uma solicitação básica retornou HTTP 429 do serviço público do Google. Portanto, o problema relatado não depende somente da cota de vinte chamadas de Gemini. O novo binding Workers AI e o modelo **@cf/qwen/qwen3-30b-a3b-fp8** precisam da publicação e de uma nova conferência remota; esta constatação não afirma que já foram testados ao vivo.

## Navegador e serviços reais

- A página inicial carregou capas reais, cinco destaques, 36 obras populares, 24 atualizações, 24 títulos bem avaliados, 18 manhwas e 18 manhuas.
- Uma consulta real abriu um capítulo de Solo Leveling com dez páginas. O proxy entregou sua primeira imagem com HTTP 200 e formato JPEG. [Registro da consulta](evidence/live-catalog.json).
- Jikan falhou na rede desta sessão. A página manteve as outras fontes funcionando e exibiu o estado de catálogo parcial. A integração de novels com essa fonte foi testada com respostas simuladas.
- OCR e tradução básica realmente traduziram os balões de **A Biblioteca do Dragão**. O editor exibiu o original em inglês e a tradução em português. A imagem final mostra as novas letras dentro do balão, com o original limpo. [Evidência do leitor](evidence/reader.jpg).
- Cadastro, favorito e personalização do perfil funcionaram no navegador com uma conta fictícia local. Avatar, bio, cor e título persistiram após recarregar. [Evidência do perfil](evidence/profile.jpg).
- EPUB de teste e CBZ com três páginas foram importados e recuperados após recarregar, usando IndexedDB real. O texto da novel foi traduzido para português. O texto de um elemento `script` do EPUB foi excluído da leitura. [Evidência da novel](evidence/novel.jpg).
- A leitura contínua foi conferida com distância de **zero pixels** entre as páginas e sem botões/faixas inseridos nas imagens. O controle da barra superior liga e desliga a rolagem e ajusta sua velocidade. Os testes cobrem pausa, velocidade, fim e cancelamento. [Leitor contínuo](evidence/autoread.jpg).
- Os botões de voltar preservam os filtros da navegação interna. Barras de leitura/tradução usam progresso calculado; a interface usa indicadores indeterminados para carregamentos sem percentual.
- Um GIF original de **8.901.772 bytes**, 720 × 720 e 24 quadros foi salvo e recuperado por HTTP real. A comparação byte a byte e SHA-256 confirmou que a imagem permaneceu idêntica ao original. A interface também confirmou envio e persistência de GIF pelo navegador. [Registro do avatar](evidence/animated-avatar.json).
- A composição exporta PNG na resolução original. Testes verificam identidade RGBA dos pixels fora das áreas editadas e rejeitam páginas acima do limite de canvas, em vez de reduzi-las silenciosamente.

As histórias de teste pertencem ao estúdio do projeto. O banco local de QA, seus usuários e o segredo de instalação não são distribuídos no ZIP.

## Empacotamento e Cloudflare

O parser JavaScript verificou os módulos do projeto e o grafo de imports do Worker. O esbuild compilou o Worker para ESM. Os assets individuais estão abaixo do limite de 25 MiB da hospedagem estática.

O ambiente desta sessão bloqueia a criação de subprocessos usada pelo Wrangler/workerd. Por isso, o dry-run oficial e a execução dentro do runtime Cloudflare não foram concluídos aqui. O teste local executa os módulos reais do Worker por HTTP, com um adaptador D1 em SQLite.

O registro inicial de 5 de outubro não incluiu deploy, acesso à conta Cloudflare ou push ao GitHub. Desde então existe a instância de produção citada na revisão de 7 de outubro. A conferência acima registra seu comportamento antes da atualização; validações locais não substituem a conferência final de uma nova publicação remota.
