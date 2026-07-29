# Sport Insights Hub

Crie um MVP funcional e visualmente premium de uma plataforma SaaS de inteligência esportiva chamada provisoriamente Scoutly AI.

1. Visão do produto

A Scoutly AI transforma perguntas feitas em linguagem natural em análises esportivas estruturadas, confiáveis e fáceis de visualizar.

O produto não deve parecer apenas um chatbot genérico. Ele deve funcionar como um motor de pesquisa e análise esportiva, permitindo que usuários encontrem em segundos informações que normalmente exigiriam abrir dezenas de partidas, somar números manualmente e comparar diferentes telas.

Exemplos de perguntas:

“Qual foi a média de escanteios do Corinthians nos últimos 20 jogos?”

“Quantos aces Alexander Zverev teve, em média, nos últimos 30 jogos?”

“Compare Nico Williams e Lamine Yamal em faltas recebidas nos últimos 10 jogos.”

“Quais jogadores do Real Madrid tiveram mais finalizações no alvo nos últimos cinco jogos?”

“Mostre o desempenho do Flamengo em jogos fora de casa.”

“Compare o desempenho recente de duas equipes.”

“Em quantos dos últimos 15 jogos do Liverpool ambas as equipes marcaram?”

O foco é análise esportiva, pesquisa, jornalismo, criação de conteúdo e acompanhamento de desempenho. Não apresente a plataforma como ferramenta de apostas e não inclua chamadas para apostar.

2. Proposta de valor

A principal promessa do produto é:

“Pergunte qualquer coisa sobre esportes. Encontre em segundos o que levaria horas para pesquisar.”

Benefícios principais:

reduzir o tempo gasto procurando estatísticas;

permitir consultas sem conhecimento técnico;

transformar dados brutos em informações compreensíveis;

gerar tabelas e gráficos automaticamente;

permitir comparações entre equipes, jogadores, competições e períodos;

manter histórico de análises;

permitir salvar pesquisas importantes;

reaproveitar análises anteriormente calculadas.

3. Público principal do MVP

Desenvolva a experiência principalmente para:

criadores de conteúdo esportivo;

jornalistas esportivos;

analistas independentes;

produtores de vídeos e páginas esportivas;

profissionais de mídia;

torcedores interessados em estatísticas;

scouts e equipes esportivas de menor porte.

O produto deve transmitir precisão, velocidade e profissionalismo.

4. Direção visual

Crie um design premium, moderno e minimalista, inspirado em produtos SaaS de inteligência de dados.

Características visuais:

modo escuro como padrão;

opção de modo claro;

fundo escuro levemente azulado;

cards com contraste sutil;

tipografia moderna e muito legível;

bastante espaço em branco;

bordas arredondadas;

sombras discretas;

animações suaves;

ícones minimalistas;

gráficos limpos;

aparência profissional;

evitar excesso de cores;

usar uma cor de destaque entre azul elétrico, verde-limão ou roxo;

responsivo para desktop, tablet e celular.

O aplicativo não deve copiar visualmente ChatGPT, Sofascore ou qualquer outro produto. Ele deve ter identidade própria.

5. Estrutura de navegação

Crie uma sidebar recolhível com:

Início

Explorar

Jogos

Jogadores

Equipes

Análises salvas

Workspaces

Histórico

Planos

Configurações

Na parte inferior da sidebar, mostrar:

avatar do usuário;

nome;

plano atual;

quantidade de análises utilizadas no mês.

6. Tela inicial

A tela inicial deve ter uma grande área de pesquisa central.

Título:

O que você quer descobrir hoje?

Subtítulo:

Faça perguntas sobre jogadores, equipes, partidas e competições.

Placeholder da pesquisa:

Ex.: Qual foi a média de escanteios do Corinthians nos últimos 20 jogos?

Permitir:

digitação;

envio pelo botão;

botão visual para entrada por voz;

seleção rápida de esporte;

seleção opcional de período;

seleção opcional de competição.

Logo abaixo, mostrar sugestões clicáveis:

Comparar dois jogadores

Analisar últimos jogos

Encontrar líderes de uma estatística

Comparar casa e fora

Analisar uma equipe

Explorar uma competição

Criar também a seção Análises em destaque, com pesquisas públicas ou demonstrativas já calculadas.

Exemplos:

Média de aces de Alexander Zverev

Escanteios do Corinthians nos últimos 20 jogos

Jogadores que mais receberam faltas em La Liga

Desempenho do Flamengo fora de casa

Finalizações no alvo dos principais atacantes da Premier League

7. Fluxo de consulta

Quando o usuário enviar uma pergunta, mostrar um estado de processamento elegante com estas etapas:

Entendendo sua pergunta

Identificando jogadores, equipes e competição

Consultando dados disponíveis

Calculando estatísticas

Preparando a análise

Não use uma barra de carregamento falsa excessivamente demorada. O processamento deve parecer rápido.

Depois, abrir uma página de resultado dedicada.

8. Página de resultado

A página de resultado deve ser muito mais rica que uma simples mensagem de chat.

Estrutura:

Cabeçalho da análise

Mostrar:

pergunta original;

esporte;

competição;

período analisado;

horário da consulta;

status dos dados;

botão para salvar;

botão para compartilhar;

botão para exportar;

botão para atualizar.

Resposta principal

Mostrar uma resposta curta e direta.

Exemplo:

O Corinthians teve média de 5,8 escanteios por partida nos últimos 20 jogos analisados.

Abaixo, mostrar uma explicação complementar curta.

Números principais

Cards com:

média;

mediana;

total;

maior valor;

menor valor;

jogos analisados;

tendência recente.

Gráfico principal

Permitir gráficos de:

linha;

barras;

comparação;

distribuição;

evolução partida por partida.

Adicionar tooltip ao passar o mouse.

Tabela detalhada

Mostrar:

data;

adversário;

competição;

casa ou fora;

resultado;

estatística analisada;

fonte do dado.

Permitir:

ordenação;

filtros;

busca;

paginação;

exportação em CSV.

Insights automáticos

Criar uma seção chamada O que os dados mostram.

Exemplos:

“A média aumentou nos últimos cinco jogos.”

“O desempenho foi superior em partidas como mandante.”

“Sete dos últimos dez jogos ficaram acima da média do período.”

“A maior marca ocorreu contra determinado adversário.”

Esses insights devem ser apresentados como observações estatísticas, nunca como certezas sobre eventos futuros.

Perguntas relacionadas

Mostrar sugestões como:

Ver apenas jogos em casa

Comparar com outra equipe

Alterar para últimos 10 jogos

Ver desempenho por competição

Mostrar tendência dos últimos cinco jogos

Comparar com a média da liga

Ao clicar, executar uma nova análise relacionada.

9. Tela Explorar

Criar uma página para descoberta de informações sem precisar formular uma pergunta.

Filtros:

esporte;

país;

competição;

temporada;

equipe;

jogador;

período;

tipo de estatística.

Categorias:

Em alta

Comparações populares

Desempenho recente

Líderes estatísticos

Tendências

Análises da comunidade

10. Página de jogos

Criar uma página com jogos recentes e próximos.

Cada card de jogo deve mostrar:

equipes ou jogadores;

logos ou fotos;

competição;

data e horário;

status;

placar, quando disponível;

botão “Analisar este jogo”.

Ao selecionar uma partida, abrir uma página com:

retrospecto;

forma recente;

comparação entre participantes;

estatísticas recentes;

escalações demonstrativas;

principais jogadores;

perguntas sugeridas.

Não incluir recomendações de apostas.

11. Página de jogadores

Criar uma busca de jogadores.

Cada perfil deve mostrar:

foto;

nome;

equipe;

posição;

nacionalidade;

competições;

últimos jogos;

médias recentes;

gráficos de desempenho;

botão para iniciar uma pergunta sobre o jogador.

Permitir comparação entre dois jogadores.

Exemplo de comparação:

Nico Williams versus Lamine Yamal

Métricas:

jogos;

minutos;

gols;

assistências;

finalizações;

finalizações no alvo;

passes importantes;

faltas recebidas;

dribles;

cartões.

12. Página de equipes

Cada equipe deve ter:

escudo;

nome;

país;

competição;

forma recente;

últimos jogos;

desempenho em casa;

desempenho fora;

gols marcados;

gols sofridos;

escanteios;

cartões;

finalizações;

jogadores em destaque;

análises salvas relacionadas.

13. Workspaces

Criar um sistema de espaços de trabalho.

Exemplos:

Workspace Corinthians

Workspace Champions League

Workspace Conteúdo semanal

Workspace Análise de atacantes

Dentro de cada workspace, permitir:

salvar análises;

criar coleções;

adicionar notas;

fixar jogadores;

fixar equipes;

acompanhar métricas;

organizar pesquisas por tema;

visualizar análises atualizadas.

Esse recurso deve ser tratado como um diferencial importante do produto.

14. Sistema de confiança nos dados

Toda análise deve mostrar claramente:

quantidade de jogos analisados;

período;

filtros utilizados;

última atualização;

fonte dos dados;

eventuais dados ausentes.

Adicionar uma mensagem discreta:

Métricas esportivas podem variar conforme a metodologia adotada pelo fornecedor de dados.

Nunca inventar números.

Quando não houver dados suficientes, mostrar:

Não encontramos dados suficientes para responder essa pergunta com confiança. Tente alterar o período, a competição ou a estatística.

Não gerar uma resposta fictícia para preencher a tela.

15. Comportamento da inteligência artificial

A IA não deve realizar cálculos livres nem inventar informações.

Ela deve ser tratada como uma camada de interpretação e apresentação.

Fluxo esperado:

usuário envia a pergunta;

IA identifica intenção e parâmetros;

backend valida os parâmetros;

backend consulta o banco de dados;

backend realiza os cálculos;

backend devolve um objeto estruturado;

IA transforma o objeto em uma explicação clara;

interface gera cards, gráficos e tabelas.

Crie uma estrutura simulada de intenção como:

{
  "sport": "football",
  "entity_type": "team",
  "entity_name": "Corinthians",
  "metric": "corners",
  "aggregation": "average",
  "match_count": 20,
  "competition": null,
  "venue": "all"
}


O frontend deve estar preparado para receber respostas estruturadas.

Exemplo:

{
  "answer": {
    "value": 5.8,
    "unit": "escanteios por partida",
    "summary": "O Corinthians teve média de 5,8 escanteios nos últimos 20 jogos."
  },
  "statistics": {
    "average": 5.8,
    "median": 6,
    "total": 116,
    "maximum": 11,
    "minimum": 2,
    "sample_size": 20
  },
  "chart_data": [],
  "matches": [],
  "insights": [],
  "source": {
    "provider": "Provedor demonstrativo",
    "updated_at": "2026-07-29T00:00:00"
  }
}


16. Banco de dados

Utilize Supabase como estrutura de backend.

Crie tabelas iniciais para:

users;

profiles;

subscriptions;

searches;

saved_analyses;

workspaces;

workspace_items;

sports;

competitions;

teams;

players;

matches;

team_match_statistics;

player_match_statistics;

data_sources;

cached_queries;

usage_events.

Cada dado esportivo deve possuir:

identificador;

provedor;

identificador externo;

data de atualização;

competição;

temporada;

entidade relacionada;

status de validade.

17. Cache inteligente

Crie a estrutura visual e lógica para cachear análises.

O sistema não deve apenas salvar a frase da pergunta. Ele deve salvar:

intenção interpretada;

parâmetros;

resultado calculado;

data dos dados;

versão da consulta;

fonte;

momento de expiração.

Perguntas equivalentes devem poder utilizar o mesmo resultado.

Exemplo:

“Média de escanteios do Corinthians nos últimos 20 jogos”

“Quantos escanteios, em média, o Corinthians teve nas últimas 20 partidas?”

As duas perguntas devem gerar a mesma chave de consulta normalizada.

18. Dados do MVP

Inicialmente, use dados simulados realistas para demonstrar a experiência.

Inclua claramente o selo:

Dados demonstrativos

Não faça parecer que os dados são reais ou atualizados quando ainda forem simulados.

Crie exemplos demonstrativos para:

Corinthians;

Flamengo;

Real Madrid;

Barcelona;

Liverpool;

Manchester City;

Alexander Zverev;

Jannik Sinner;

Carlos Alcaraz;

Nico Williams;

Lamine Yamal.

19. Planos

Criar uma página de preços em reais.

Gratuito

R$ 0

10 análises por mês;

dados demonstrativos;

histórico limitado;

um workspace.

Essencial

R$ 39,90 por mês

150 análises por mês;

análises completas;

cinco workspaces;

exportação;

histórico ampliado.

Profissional

R$ 89,90 por mês

600 análises por mês;

análises avançadas;

comparações;

exportação em CSV;

workspaces ilimitados;

prioridade de processamento.

Equipes

Preço personalizado

múltiplos usuários;

espaços compartilhados;

relatórios;

integrações;

suporte;

controle administrativo.

Deixar claro que os preços são provisórios para o MVP.

20. Autenticação e onboarding

Implementar:

cadastro;

login;

recuperação de senha;

autenticação com Google;

perfil do usuário.

No onboarding, perguntar:

esporte de maior interesse;

equipes favoritas;

competições favoritas;

principal finalidade de uso;

frequência esperada.

Usar essas respostas para personalizar a tela inicial.

21. Landing page

Criar também uma landing page pública.

Estrutura:

Hero

Título:

Dados esportivos sem horas de pesquisa.

Subtítulo:

Faça perguntas em linguagem natural e transforme estatísticas esportivas em respostas, gráficos e insights.

Botões:

Começar gratuitamente

Ver demonstração

Demonstração visual

Mostrar uma pergunta sendo transformada em:

resposta;

números;

gráfico;

tabela;

insights.

Problema

Mostrar que hoje o usuário precisa:

abrir várias partidas;

copiar dados;

realizar cálculos;

montar planilhas;

criar gráficos;

revisar tudo manualmente.

Solução

Mostrar que a plataforma centraliza o processo.

Casos de uso

produção de conteúdo;

jornalismo;

análise esportiva;

acompanhamento de equipes;

pesquisa de jogadores;

comparação de desempenho.

Segurança e confiança

Destacar:

dados estruturados;

fontes identificadas;

cálculos realizados no backend;

transparência sobre período e amostra;

nenhuma estatística inventada.

Planos

Mostrar os planos do produto.

Chamada final

Pare de procurar jogo por jogo. Comece a perguntar.

22. Componentes reutilizáveis

Criar componentes para:

barra de pesquisa inteligente;

card de métrica;

card de análise;

tabela de partidas;

gráfico de desempenho;

seletor de período;

seletor de competição;

comparação de jogadores;

comparação de equipes;

selo da fonte;

indicador de atualização;

estado de dados insuficientes;

carregamento;

favoritos;

workspaces;

modal de compartilhamento.

23. Requisitos técnicos

usar TypeScript;

usar componentes organizados e reutilizáveis;

criar layout totalmente responsivo;

separar dados, regras de negócio e apresentação;

evitar código duplicado;

preparar integração com Supabase;

criar estados de loading, erro e vazio;

garantir acessibilidade;

criar navegação funcional;

usar dados simulados centralizados em arquivos próprios;

não espalhar valores mockados diretamente nos componentes;

preparar funções para futura integração com API esportiva;

preparar funções para futura integração com um modelo de IA;

não expor chaves de API no frontend;

criar variáveis de ambiente;

usar funções server-side para integrações externas.

24. Prioridade de construção

Construa primeiro as seguintes partes com alto nível de acabamento:

landing page;

dashboard inicial;

barra de pesquisa;

processamento da pergunta;

página de resultado;

gráfico;

tabela de partidas;

análises salvas;

workspace;

página de preços.

As outras páginas podem ser criadas como estruturas funcionais mais simples.

25. Resultado esperado

O resultado deve parecer um produto SaaS real, pronto para ser apresentado a potenciais clientes e investidores.

Não entregue apenas telas estáticas.

Crie:

navegação funcional;

perguntas demonstrativas clicáveis;

resultados simulados;

gráficos funcionais;

salvamento de análises no Supabase;

workspaces;

autenticação;

sistema de limites por plano;

experiência responsiva;

estados de erro;

estados sem dados;

feedback visual durante as consultas.

Ao final, mostre claramente quais partes estão usando dados simulados e quais pontos precisam ser conectados posteriormente a uma API esportiva real e a um modelo de inteligência artificial.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://sport-query-genius.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7ef0701a-701f-495e-a189-7b95e32d276f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
