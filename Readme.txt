Instruções para Configuração e Uso do Bot 

Visão Geral das Melhorias

O bot foi atualizado com as seguintes funcionalidades:

1.
Delay para TPs e Stop Loss: Aguarda um tempo configurável após a abertura da ordem antes de colocar os TPs e SL.

2.
Delay para Trailing Stop: Aguarda um tempo configurável após a execução do TP1 antes de iniciar o trailing stop.

3.
Segunda Entrada: Coloca automaticamente uma segunda ordem após a primeira entrada, usando o segundo preço do sinal ou calculando um preço intermediário.


Explicação das Configurações

•
DELAY_BEFORE_SL_TP: Tempo de espera (em ms) após a abertura da ordem antes de colocar SL e TPs.

•
DELAY_BEFORE_TRAILING: Tempo de espera (em ms) após a execução do TP1 antes de iniciar o trailing stop.

•
DELAY_BEFORE_SECOND_ENTRY: Tempo de espera (em ms) após a primeira entrada antes de colocar a segunda entrada.

•
SECOND_ENTRY_ENABLED: Define se a funcionalidade de segunda entrada está ativada (true) ou desativada (false).

•
SECOND_ENTRY_SIZE_PERCENT: Tamanho da segunda entrada como porcentagem da primeira entrada (ex: 50 = 50%).

Como Funciona

Fluxo de Execução

1.
Recebimento do Sinal: O bot recebe o sinal do Telegram e o processa.

2.
Primeira Entrada: Cria uma ordem de mercado para a primeira entrada.

3.
Delay para SL/TP: Aguarda o tempo configurado (DELAY_BEFORE_SL_TP).

4.
Colocação de SL/TP: Coloca o stop loss para toda a posição e o TP1 para 50% da posição.

5.
Segunda Entrada (Opcional): Se habilitado, aguarda o tempo configurado (DELAY_BEFORE_SECOND_ENTRY) e coloca uma ordem limite para a segunda entrada.

6.
Execução do TP1: Quando o TP1 é executado, o bot notifica e aguarda o tempo configurado (DELAY_BEFORE_TRAILING).

7.
Trailing Stop: Inicia o trailing stop para os 50% restantes da posição.

Segunda Entrada

•
Se o sinal tiver múltiplos preços de entrada (ex: Entrys: 0.11477 - 0.11458), o bot usará o segundo preço.

•
Se o sinal tiver apenas um preço de entrada, o bot calculará um preço intermediário entre a primeira entrada e o stop loss.

•
O tamanho da segunda entrada é configurável através de SECOND_ENTRY_SIZE_PERCENT.

Comandos do Bot

Os comandos existentes continuam funcionando, e as mensagens foram atualizadas para incluir informações sobre os delays e a segunda entrada:

•
/test: Testa se o bot está funcionando.

•
/status: Mostra o status das ordens ativas.

•
/balance: Mostra o saldo da conta.

•
/stats: Mostra estatísticas resumidas.

•
/report: Gera um relatório detalhado.

•
/help: Mostra a ajuda com todas as configurações atuais.

•
/start: Inicia o monitoramento.

•
/stop: Para o monitoramento.

•
/stoptrailing: Para todos os trailing stops.

Instalação

•
Os delays são configuráveis e podem ser ajustados conforme sua preferência.

Solução de Problemas

Se encontrar algum problema:

1.
Verifique os logs para mensagens de erro.

2.
Certifique-se de que todas as configurações no .env estão corretas.

3.
Reinicie o bot se necessário.

4.
Use o comando /test para verificar se o bot está funcionando corretamente.

