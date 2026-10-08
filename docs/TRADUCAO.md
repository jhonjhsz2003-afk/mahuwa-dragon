# Tradução integrada do Mahuwa Dragon

O leitor traduz imagens e texto de arquivos autorizados. A preferência inicial é **IA**, quando Gemini está configurado; uma escolha salva de **Básico** é respeitada. Quando a IA está indisponível, o leitor pode continuar pelo reconhecimento local e tradução de texto. Capítulos identificados como portugueses ficam no original; o botão **Traduzir** continua disponível para tradução manual. A tradução automática aguarda a página entrar na área de leitura e processa as páginas em sequência.

## Básico: OCR local e tradução de texto

O reconhecimento usa Tesseract.js 6 e WebAssembly, distribuídos com o próprio site. A imagem é analisada no dispositivo. Apenas os trechos reconhecidos seguem para o serviço de tradução. O primeiro uso baixa o motor e os pacotes de idiomas; os usos seguintes podem aproveitar o cache do navegador.

Com o binding **AI** configurado no Worker, o tradutor básico usa Workers AI da Cloudflare para traduzir somente o texto reconhecido, sem enviar as imagens. O modelo configurado nesta revisão é **@cf/qwen/qwen3-30b-a3b-fp8**; ele recebe orientação para português brasileiro natural, preservando sentido, personalidade, nomes e termos do glossário, sem acrescentar falas ou detalhes. Essa orientação não garante uma tradução perfeita.

A franquia gratuita de Workers AI é de **10.000 neurônios por dia**, renovada às **00:00 UTC**, conforme a [documentação de preços da Cloudflare](https://developers.cloudflare.com/workers-ai/platform/pricing/). Neurônios são unidades de uso do modelo; não correspondem a 10.000 falas, páginas ou capítulos. Esta entrega usa a franquia gratuita, sem pedir upgrade pago. O serviço pode interromper novas traduções quando essa franquia termina.

Sem esse binding, ou quando a integração responde como indisponível/inválida, existe uma alternativa pelo endpoint público experimental do Google. Esse endpoint não exige chave do visitante, mas pode limitar solicitações, mudar ou ficar indisponível; não oferece garantia de serviço. Uma cota diária ou limitação explícita da Cloudflare é exibida como pausa, em vez de ser tratada como serviço ilimitado. Falhas aparecem no leitor; o site não substitui uma falha por falas inventadas.

Em **Idioma original → Detectar automaticamente**, o leitor usa o idioma informado pelo capítulo como dica. Sem uma dica reconhecida, tenta vários alfabetos instalados e permite que o tradutor identifique a origem. Se os dados do capítulo estiverem errados, escolha o idioma original e clique **Tentar novamente**; esse comando ignora o cache de tradução daquela tentativa.

Os 13 pacotes instalados cobrem inglês, português, espanhol, francês, alemão, italiano, russo, árabe, japonês, japonês vertical, coreano e chinês simplificado/tradicional. Sem uma dica de idioma, a tentativa automática usa inglês, japonês, coreano, chinês simplificado/tradicional, russo e árabe; não carrega todos os pacotes simultaneamente. Selecionar português, espanhol, francês, alemão ou italiano usa seu pacote dedicado. Japonês e chinês compartilham caracteres: selecionar explicitamente o idioma pode melhorar a leitura. Para colunas japonesas, selecione **Japonês vertical**; uma dica genérica de japonês não ativa esse modo. O modo local não reconhece todos os alfabetos do mundo. Fontes muito estilizadas, texto pequeno, inclinação e desenhos misturados às letras podem exigir revisão ou IA.

## IA preferencial e alternativa básica

O modo **IA** usa Gemini para ler e traduzir a imagem. Ele aparece como disponível somente quando o administrador configura `GEMINI_API_KEY`. A chave fica no Worker; não é enviada ao navegador. É necessário entrar em uma conta real para usar esse modo. `GEMINI_MODEL` permite selecionar o modelo; o padrão é `gemini-2.5-flash`.

As cotas iniciais são:

| Operação | Por conta/dia | Site inteiro/dia |
|---|---:|---:|
| Leitura de imagens por IA | 20 solicitações | 500 solicitações |
| Tradução de texto por IA | 100 lotes | 2.000 lotes |

Cotas deste site usam o dia UTC. Uma imagem alta é dividida em faixas de até 1.700 pixels com sobreposição de 180 pixels; cada faixa enviada à IA usa uma solicitação. Por exemplo, uma imagem de 720 × 5.800 pixels exige quatro chamadas, e uma de 720 × 30.000 exige vinte. A cota de 20 não significa vinte capítulos ou vinte imagens longas. Um lote de texto comporta até 12 trechos; textos extensos podem gerar mais lotes.

A reserva ocorre antes do envio ao provedor. Nesta revisão, falhas de transporte, cancelamento antes da resposta aceita e respostas HTTP não bem-sucedidas liberam a reserva por conta e por site. Uma resposta HTTP 200 já consumiu uma chamada de IA, mesmo que seu conteúdo seja inválido ou não permita compor nenhuma fala; essa chamada continua contabilizada. As reservas por conta e por site são feitas juntas no D1; exceder uma delas impede outro envio.

O administrador pode ajustar `GEMINI_VISION_USER_DAILY`, `GEMINI_VISION_GLOBAL_DAILY`, `GEMINI_TEXT_USER_DAILY` e `GEMINI_TEXT_GLOBAL_DAILY`. A infraestrutura gratuita da Cloudflare não torna o serviço Gemini gratuito: os limites e a cobrança do provedor continuam aplicáveis.

## Revisão dos limites em 7 de outubro de 2026

Limite do site, limite do provedor e excesso de solicitações são situações diferentes. A API retorna **code**, **provider**, **retryAfter**, **resetAt** e, quando disponível, **quotaScope**; respostas com tempo de espera também incluem **Retry-After**. **GEMINI_QUOTA_EXCEEDED** identifica a cota local por conta ou global, renovada à meia-noite UTC. **GEMINI_DAILY_LIMIT** identifica uma cota diária informada pelo provedor, com renovação calculada no fuso **America/Los_Angeles**. **GEMINI_RATE_LIMIT**, **BASIC_RATE_LIMIT**, **CF_RATE_LIMIT** e **REQUEST_RATE_LIMIT** indicam pausas temporárias; **CF_QUOTA_EXCEEDED** informa a cota diária da Cloudflare. O leitor mostra o tempo de espera ou a renovação prevista e evita repetir automaticamente uma solicitação durante a pausa.

Ao atingir um limite de Gemini ou faltar autenticação/configuração, a página pode continuar pelo OCR local e tradução básica. O resultado informa **usedEngine** e, quando ocorreu uma alternativa automática, **fallbackCode**, além de avisos para revisão. Isso não amplia os idiomas instalados nem torna um provedor ilimitado. Se o reconhecimento básico ou seu serviço de tradução também falhar, a página original permanece disponível.

Com o cache habilitado, cada análise bem-sucedida de uma faixa de imagem é guardada separadamente; uma falha posterior não exige descartar essas análises. Blocos já traduzidos por IA podem ser reaproveitados quando o restante continua pelo OCR. A reutilização depende dos limites e da disponibilidade do cache local. Mudar idioma, glossário ou parâmetros relevantes produz outra chave. **Tentar novamente** pode ignorar o cache, conforme a ação solicitada; repetições forçadas podem consumir novas chamadas.

A tradução básica usa filas com intervalo entre chamadas, cache temporário limitado e deduplicação de solicitações iguais. Essas medidas reduzem repetições; elas não garantem ausência de limites, porque há outras instâncias do servidor, usuários e cotas do serviço remoto.

## Apagar o original e compor a tradução

A imagem traduzida é composta em canvas. A tradução automática de quadrinhos procura somente falas em balões; títulos, créditos, numeração, textos flutuantes sobre personagens, efeitos sonoros e caixas de narração não são o alvo dessa leitura. O OCR local verifica no original uma região de fundo plano fechada e curva antes de enviar seu texto ao tradutor. Fundo uniforme sozinho não basta: um painel aberto ou uma caixa retangular é recusado. Contornos incompletos, formatos muito estilizados e balões sem limite claro podem ficar no original.

Primeiro o leitor limpa somente as máscaras dos glifos originais; depois escreve a tradução numa caixa interior. Em fundos planos, ele usa a cor ao redor das letras e procura pontuação próxima que o OCR possa ter omitido. Componentes contínuos que cruzam a área de busca são preservados para reduzir o risco de apagar bordas do balão. No modo **smart**, todas as máscaras precisam passar pelo mesmo teste de fundo plano usado pela limpeza; se alguma falhar, o bloco inteiro fica intacto e não recebe texto traduzido sobre a fala original.

A limpeza automática não gera nem reconstrói texturas de personagens ou cenários. Áreas inseguras são ignoradas, com aviso. O modo sólido, quando aplicado explicitamente numa revisão, pode apagar detalhes de um fundo não uniforme e exige cuidado. A detecção de contorno é uma heurística visual: não distingue infalivelmente uma fala de uma estampa que imite um balão e não garante resultado perfeito em qualquer arte.

A composição aproveita uma caixa maior de fundo vazio verificado dentro do balão, sem ampliar a máscara dos caracteres apagados. Ajusta linhas e tamanho da fonte e suporta caracteres CJK e direção de texto árabe. Antes de apagar o original, verifica se a tradução cabe sem corte e com fonte de pelo menos sete pixels; quando não cabe, mantém a fala original e pede revisão. As fontes dependem das fontes instaladas no dispositivo, com alternativas do sistema; não há download de fontes externas.

## Comparar e revisar

- **Original** alterna entre a página original e o resultado.
- **Comparar** exibe os dois lado a lado.
- **Revisar** permite corrigir o texto reconhecido, a tradução e as coordenadas do bloco.
- **Desenhar novo balão** permite selecionar uma fala que não foi detectada. Informe o texto original, use **Traduzir este bloco** e aplique a revisão.
- Mover a caixa de tradução mantém a máscara da fala original. Remover um bloco restaura essa região a partir da imagem original na próxima composição.

Fonte e tamanho das falas são usados ao traduzir ou aplicar uma revisão. Ao mudar o idioma de destino ou o glossário, clique **Traduzir** para refazer a página atual. O controle de efeitos sonoros orienta a IA; no OCR local, textos decorativos podem ser reconhecidos junto das falas.

## Novels e arquivos de texto

Páginas que possuem texto, incluindo importações TXT e EPUB, são exibidas como texto seguro, sem executar HTML do livro. Os parágrafos seguem diretamente para o tradutor; não passam pelo OCR. Trechos compridos são divididos sem omitir o conteúdo. Há comparação com o original, revisão dos parágrafos e ajustes de fonte e largura de leitura.

Metadados de um novel não significam que seu texto esteja disponível. O leitor usa apenas conteúdo realmente fornecido pelo capítulo ou importado pelo usuário; não gera capítulos ausentes.

## Privacidade, cache e dispositivos

No modo básico, Cloudflare Workers AI ou a alternativa experimental do Google recebe o texto reconhecido ou os trechos do novel. No modo IA de imagens, Gemini recebe a imagem enviada para leitura. Esses provedores possuem políticas próprias de processamento. O site não grava as imagens de tradução no D1.

Quando **Guardar traduções neste navegador** está ativo, resultados de imagens podem ficar no IndexedDB local, limitado a 20 registros e aproximadamente 32 MiB. Preferências locais também ficam neste navegador. Use **Limpar traduções guardadas** para apagar esse cache. O servidor mantém um cache temporário limitado de traduções básicas para evitar envios repetidos; ele não é uma biblioteca de capítulos.

OCR e desenho podem usar bastante memória. A composição preserva a resolução nativa; páginas acima de 24 milhões de pixels ou 30.000 pixels por lado exigem divisão em páginas menores. Imagens altas são analisadas em partes. Arquivos muito grandes, dispositivos com pouca memória ou navegadores antigos podem não completar o processamento. O leitor mostra os erros e oferece original, seleção do idioma, tentativa novamente e revisão manual.

O motor e seus modelos mantêm as licenças distribuídas em `web/translation/vendor/`. `web/translation/vendor-lock.json` registra os endereços de origem e os hashes SHA-256 dos arquivos de terceiros. Os testes verificam agrupamento, limpeza de pixels, preservação de bordas, cancelamento, limites, autenticação e cotas. Testes com respostas simuladas de provedores não constituem validação de disponibilidade ou qualidade de um serviço remoto real.

Referências técnicas: [Tesseract.js](https://github.com/naptha/tesseract.js), [Gemini GenerateContent](https://ai.google.dev/api/generate-content), [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/limits/).

A leitura automática começa desligada em cada capítulo. O controle na barra superior liga e para a rolagem do próprio leitor; a velocidade vai de 8 a 70 pixels por segundo, com padrão de 24. Ao ativá-la no modo Página, o leitor muda para Rolagem. Ela aguarda a imagem ou a tradução visível, pausa durante a revisão e enquanto a aba está oculta, e para no fim sem abrir outro capítulo. Só a velocidade fica salva nas preferências.

A barra de cada página acompanha os estágios reais informados pelo motor de tradução. A barra do capítulo acompanha a posição da rolagem; no modo Página, combina a página atual com sua rolagem interna. Para páginas que cabem inteiras na tela, use Concluir capítulo ao terminar a última página.
As imagens dos capítulos aparecem em sequência, sem faixas de página ou botões entre elas. O status e a barra da tradução da página atual ficam na barra de ferramentas; o progresso do capítulo fica no rodapé.
Qualidade da imagem: a composição usa a resolução nativa e é exportada em PNG, sem recompressão JPEG. Os pixels fora das áreas de limpeza e texto não recebem filtro ou redimensionamento. A análise de IA pode usar uma cópia menor, mantendo a página final original. Páginas acima de 24 milhões de pixels ou 30.000 pixels por lado são recusadas com orientação para dividir a imagem, sem redução silenciosa de resolução.
