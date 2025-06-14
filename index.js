require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { BingXClient } = require("./bingx-client");
const SignalParser = require("./signal-parser");
const { OrderManager } = require("./order-manager");

class BingxTelegramBot {
    constructor() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
        this.bingxClient = new BingXClient(
            process.env.BINGX_API_KEY,
            process.env.BINGX_SECRET_KEY,
            process.env.BINGX_BASE_URL
        );
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.riskPercentage = parseFloat(process.env.RISK_PERCENTAGE) || 1;

        // Inicializar gerenciador de ordens
        this.orderManager = new OrderManager(this.bingxClient, this.bot, this.chatId);

        this.setupBot();
    }

    setupBot() {
        console.log("Bot iniciado...");

        // Escutar mensagens do chat específico
        this.bot.on("message", (msg) => {
            if (msg.chat.id.toString() === this.chatId) {
                this.processSignal(msg.text);
            }
        });

        // Comando para testar o bot
        this.bot.onText(/\/test/, (msg) => {
            this.bot.sendMessage(msg.chat.id, "Bot funcionando! ✅");
        });

        // Comando para status das ordens
        this.bot.onText(/\/status/, (msg) => {
            this.sendOrderStatus(msg.chat.id);
        });

        // Comando para saldo da conta
        this.bot.onText(/\/balance/, async (msg) => {
            await this.sendAccountBalance(msg.chat.id);
        });

        // Comando para estatísticas
        this.bot.onText(/\/stats/, (msg) => {
            this.sendStatistics(msg.chat.id);
        });

        // Comando para relatório detalhado
        this.bot.onText(/\/report/, async (msg) => {
            await this.sendDetailedReport(msg.chat.id);
        });

        // Comando para ajuda
        this.bot.onText(/\/help/, (msg) => {
            this.sendHelp(msg.chat.id);
        });

        // Comando para parar monitoramento
        this.bot.onText(/\/stop/, (msg) => {
            this.orderManager.stopMonitoring();
            this.bot.sendMessage(msg.chat.id, "⏹️ Monitoramento parado");
        });

        // Comando para iniciar monitoramento
        this.bot.onText(/\/start/, (msg) => {
            this.orderManager.startMonitoring();
            this.bot.sendMessage(msg.chat.id, "▶️ Monitoramento iniciado");
        });
    }

    async processSignal(signalText) {
        console.log("Processando sinal:", signalText);

        // Regex mais flexível para aceitar espaços após os dois pontos
        const signalRegex = /^(🟢 LONG|🔴 SHORT) \(([A-Z]+)\)\nEntrys\s*:.*\nLeverage\s*:.*\nTps\s*:.*\nStop Loss\s*:.*$/;

        if (!signalRegex.test(signalText)) {
            console.log("Mensagem não é um sinal válido, ignorando:", signalText);
            // this.bot.sendMessage(this.chatId, '❌ Formato de sinal inválido. Por favor, use o formato especificado no /help.');
            return;
        }

        const signal = SignalParser.parseSignal(signalText);

        if (!signal.isValid) {
            console.log("Sinal inválido:", signal.error);
            this.bot.sendMessage(this.chatId, `❌ Erro ao processar sinal: ${signal.error}`);
            return;
        }

        if (!SignalParser.validateSignal(signal)) {
            console.log("Sinal não passou na validação");
            this.bot.sendMessage(this.chatId, "❌ Sinal inválido: preços não fazem sentido para a direção especificada");
            return;
        }

        try {
            // Executar a ordem
            // Utilize executeSignal ou o método avançado, dependendo do seu BingXClient
            const result = await this.bingxClient.executeSignal(signal, this.riskPercentage);

            // Adicionar ao gerenciador de ordens
            this.orderManager.addOrder(result.entryOrder.orderId, {
                signal,
                result,
                entryOrderId: result.entryOrder.orderId,
                stopOrderId: result.stopOrder.orderId,
                tpOrderIds: result.tpOrders.map(tp => tp.orderId)
            });

            // Enviar confirmação
            this.bot.sendMessage(this.chatId,
                `✅ Ordem executada com sucesso!\n\n` +
                `📊 Detalhes:\n` +
                `• Símbolo: ${signal.symbol}\n` +
                `• Direção: ${signal.direction}\n` +
                `• Quantidade: ${result.quantity}\n` +
                `• Leverage: ${signal.leverage}X\n\n` +
                `🆔 IDs das ordens:\n` +
                `• Ordem nº: ${result.entryOrder.orderId}\n` +
                `• Stop Loss: ${result.stopOrder.orderId}\n` +
                `• Take Profits: TP1 (Trailing Stop será ativado após atingir)\n\n` +
                `🔄 Monitoramento automático ativo`
            );
        } catch (error) {
            console.error("Erro ao executar ordem:", error);
            this.bot.sendMessage(this.chatId, `❌ Erro ao executar ordem: ${error.message}`);
        }
    }

    async sendOrderStatus(chatId) {
        try {
            const openOrders = await this.bingxClient.getOpenOrders();

            if (!Array.isArray(openOrders) || openOrders.length === 0) {
                this.bot.sendMessage(chatId, "📊 Nenhuma ordem ativa no momento");
                return;
            }

            let statusMessage = `📊 Ordens ativas (${openOrders.length}):\n\n`;

            openOrders.forEach(order => {
                statusMessage += `🔸 ${order.symbol} - ${order.side} ${order.type}\n`;
                statusMessage += `   ID: ${order.orderId}\n`;
                statusMessage += `   Quantidade: ${order.origQty || order.quantity}\n`;
                if (order.price && order.price !== "0.00000000") {
                    statusMessage += `   Preço: ${order.price}\n`;
                }
                statusMessage += `   Status: ${order.status}\n\n`;
            });

            this.bot.sendMessage(chatId, statusMessage);
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Erro ao obter status: ${error.message}`);
        }
    }

    async sendAccountBalance(chatId) {
        try {
            const accountInfo = await this.bingxClient.getAccountInfo();
            console.log("Resposta bruta da API de saldo:", accountInfo);

            const balances = accountInfo.assets.filter(b => parseFloat(b.availableBalance) > 0 || parseFloat(b.crossUnPnl) > 0);

            let balanceMessage = "💰 Saldo da conta:\n\n";

            balances.forEach(balance => {
                const free = parseFloat(balance.availableBalance);
                const pnl = parseFloat(balance.crossUnPnl);
                const total = free + pnl;

                if (total > 0) {
                    balanceMessage += `🔸 ${balance.asset}\n`;
                    balanceMessage += `   Livre: ${free.toFixed(4)}\n`;
                    if (pnl !== 0) {
                        balanceMessage += `   PNL Não Realizado: ${pnl.toFixed(4)}\n`;
                    }
                    balanceMessage += `   Total: ${total.toFixed(4)}\n\n`;
                }
            });

            this.bot.sendMessage(chatId, balanceMessage);
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Erro ao obter saldo: ${error.message}`);
        }
    }

    sendStatistics(chatId) {
        const stats = this.orderManager.getStatistics();

        const statsMessage = `📈 ESTATÍSTICAS\n\n` +
            `• Total de ordens: ${stats.totalOrders}\n` +
            `• Ordens lucrativas: ${stats.profitableOrders}\n` +
            `• Taxa de acerto: ${stats.winRate}%\n` +
            `• Lucro total: ${stats.totalProfit} USDT\n` +
            `• Ordens ativas: ${stats.activeOrders}`;

        this.bot.sendMessage(chatId, statsMessage);
    }

    async sendDetailedReport(chatId) {
        try {
            const report = await this.orderManager.getDetailedReport();
            this.bot.sendMessage(chatId, report);
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Erro ao gerar relatório: ${error.message}`);
        }
    }

    sendHelp(chatId) {
        const helpMessage = `🤖 COMANDOS DISPONÍVEIS\n\n` +
            `📊 /status - Status das ordens ativas\n` +
            `💰 /balance - Saldo da conta\n` +
            `📈 /stats - Estatísticas resumidas\n` +
            `📋 /report - Relatório detalhado\n` +
            `▶️ /start - Iniciar monitoramento\n` +
            `⏹️ /stop - Parar monitoramento\n` +
            `🧪 /test - Testar bot\n` +
            `❓ /help - Mostrar esta ajuda\n\n` +
            `📝 Para usar o bot, envie sinais no formato:\n` +
            `🟢 LONG (SYMBOL)\n` +
            `Entrys: preço1 - preço2\n` +
            `Leverage: 5X\n` +
            `Tps: tp1 - tp2 - tp3\n` +
            `Stop Loss: preço`;

        this.bot.sendMessage(chatId, helpMessage);
    }
}

// Inicializar o bot apenas se executado diretamente
if (require.main === module) {
    const bot = new BingxTelegramBot();

    process.on("SIGINT", () => {
        console.log("Parando bot...");
        if (bot.orderManager) {
            bot.orderManager.stopMonitoring();
        }
        process.exit(0);
    });
}

module.exports = BingxTelegramBot;