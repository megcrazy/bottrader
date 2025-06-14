const fs = require("fs").promises;
const path = require("path");

class OrderManager {
    constructor(bingxClient) {
        this.bingxClient = bingxClient;
        this.activeOrders = new Map(); // Map<orderId, { signal, quantity, trailingStop: { isActive, currentStopPrice } }>
        this.ordersFilePath = path.join(__dirname, 'activeOrders.json');
        this.loadActiveOrders();
    }

    async loadActiveOrders() {
        try {
            const data = await fs.readFile(this.ordersFilePath, 'utf8');
            const ordersArray = JSON.parse(data);
            this.activeOrders = new Map(ordersArray.map(order => [order.orderId, order.data]));
            console.log("Ordens ativas carregadas:", this.activeOrders.size);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log("Arquivo de ordens ativas não encontrado. Iniciando com lista vazia.");
            } else {
                console.error("Erro ao carregar ordens ativas:", error);
            }
        }
    }

    async saveActiveOrders() {
        try {
            const ordersArray = Array.from(this.activeOrders.entries()).map(([orderId, data]) => ({ orderId, data }));
            await fs.writeFile(this.ordersFilePath, JSON.stringify(ordersArray, null, 2), 'utf8');
            console.log("Ordens ativas salvas.");
        } catch (error) {
            console.error("Erro ao salvar ordens ativas:", error);
        }
    }

    async addOrder(orderId, signal, quantity, clientOrderId = null) {
        this.activeOrders.set(orderId, { signal, quantity, clientOrderId, trailingStop: { isActive: false, currentStopPrice: 0 } });
        await this.saveActiveOrders();
    }

    async removeOrder(orderId) {
        this.activeOrders.delete(orderId);
        await this.saveActiveOrders();
    }

    async handleOrderClosed(orderId, orderData) {
        console.log(`Ordem ${orderId} para ${orderData.signal.symbol} foi oficialmente fechada e removida.`);
        await this.removeOrder(orderId);
    }

    async startTrailingStop(orderId, symbol, direction, entryPrice, tp1Price, stopLossPrice, quantity) {
        console.log(`Iniciando Trailing Stop para ${symbol}, ordem ${orderId}`);
        const currentPrice = await this.bingxClient.getCurrentPrice(symbol);

        // Cancelar o SL original
        try {
            // Nota: A BingX API não retorna o orderId do SL/TP setado na ordem de mercado inicial.
            // Precisamos de uma forma de identificar e cancelar o SL. Isso pode ser um desafio.
            // Por enquanto, vamos logar que o SL original foi cancelado, mas a implementação real
            // de cancelamento de SL/TP de uma ordem de mercado pode exigir um endpoint específico
            // ou a criação de uma nova ordem de SL/TP para substituir a anterior.
            // Se a BingX não permite cancelar SL/TP de ordens de mercado, teremos que gerenciar o SL via bot.
            console.log(`🛑 SL original para ${symbol} (ordem ${orderId}) deve ser cancelado manualmente ou via API específica.`);
            // Exemplo hipotético se houvesse um orderId para o SL original:
            // await this.bingxClient.cancelOrder(symbol, stopLossOrderId);
        } catch (error) {
            console.warn(`Não foi possível cancelar SL original para ${symbol}: ${error.message}`);
        }

        // Calcular o preço inicial do trailing stop
        let initialTrailingStopPrice;
        if (direction === "BUY") {
            initialTrailingStopPrice = currentPrice - (currentPrice * 0.005); // Exemplo: 0.5% abaixo do preço atual
        } else {
            initialTrailingStopPrice = currentPrice + (currentPrice * 0.005); // Exemplo: 0.5% acima do preço atual
        }

        const orderData = this.activeOrders.get(orderId);
        if (orderData) {
            orderData.trailingStop.isActive = true;
            orderData.trailingStop.currentStopPrice = initialTrailingStopPrice;
            await this.saveActiveOrders();
            console.log(`📉 Trailing Stop ativado para ${symbol} com preço inicial: ${initialTrailingStopPrice}`);
        } else {
            console.error(`Erro: Ordem ${orderId} não encontrada para iniciar Trailing Stop.`);
        }
    }

    async updateTrailingStop(orderId, symbol, direction, quantity) {
        const orderData = this.activeOrders.get(orderId);
        if (!orderData || !orderData.trailingStop.isActive) return;

        const currentPrice = await this.bingxClient.getCurrentPrice(symbol);
        let newStopPrice = orderData.trailingStop.currentStopPrice;

        if (direction === "BUY") {
            // Para LONG, o stop deve subir com o preço
            const potentialNewStop = currentPrice - (currentPrice * 0.005); // Exemplo: 0.5% abaixo do preço atual
            if (potentialNewStop > newStopPrice) {
                newStopPrice = potentialNewStop;
            }
        } else {
            // Para SHORT, o stop deve descer com o preço
            const potentialNewStop = currentPrice + (currentPrice * 0.005); // Exemplo: 0.5% acima do preço atual
            if (potentialNewStop < newStopPrice) {
                newStopPrice = potentialNewStop;
            }
        }

        if (newStopPrice !== orderData.trailingStop.currentStopPrice) {
            orderData.trailingStop.currentStopPrice = newStopPrice;
            await this.saveActiveOrders();
            console.log(`📈 Trailing Stop atualizado para ${symbol}: ${newStopPrice}`);

            // Aqui você precisaria de um método para atualizar o SL na BingX
            // Isso geralmente envolve cancelar o SL antigo e criar um novo SL
            // Preciso pesquisar o metodo ainda .Exemplo hipotético:
            // await this.bingxClient.updateStopLoss(symbol, newStopPrice, quantity, direction);
            console.log(`⚠️ SL na BingX para ${symbol} precisa ser atualizado para ${newStopPrice}.`);
        }

        // Verificar se o preço atual atingiu o trailing stop
        if ((direction === "BUY" && currentPrice <= newStopPrice) ||
            (direction === "SHORT" && currentPrice >= newStopPrice)) {
            console.log(`🛑 Trailing Stop atingido para ${symbol}. Fechando posição.`);
            // Aqui você precisaria de um método para fechar a posição na BingX
            // await this.bingxClient.closePosition(symbol, direction, quantity);
            await this.handleOrderClosed(orderId, orderData);
        }
    }

    async checkOrders() {
        try {
            const openPositions = await this.bingxClient.getOpenPositions();
            const activeSymbols = new Set(openPositions.map(p => p.symbol));

            for (const [orderId, orderData] of this.activeOrders.entries()) {
                // Verifica se a posição para o símbolo da ordem ainda está aberta
                if (!activeSymbols.has(orderData.signal.symbol)) {
                    console.log(`Posição para ${orderData.signal.symbol} (Ordem ${orderId}) foi fechada. Verificando motivo...`);

                    // Busca no histórico de ordens para determinar o motivo do fechamento
                    // Pode ser necessário ajustar a busca se o orderId da ordem de entrada não for o que fecha a posição
                    const orderHistory = await this.bingxClient.getOrderHistory(orderData.signal.symbol, 50);
                    const closedOrder = orderHistory.find(o => o.orderId?.toString() === orderId.toString() || o.clientOrderId?.toString() === orderData.clientOrderId?.toString());

                    if (closedOrder) {
                        // Se a ordem foi fechada por TP1 (ou se não há trailing stop ativo e não foi um SL)
                        if (closedOrder.type.includes("TAKE_PROFIT") || (!orderData.trailingStop?.isActive && !closedOrder.type.includes("STOP"))) {
                            console.log(`🎯 TP1 parece ter sido executado para a posição de ${orderData.signal.symbol} (Ordem ${orderId}). Iniciando Trailing Stop.`);
                            await this.startTrailingStop(
                                orderId,
                                orderData.signal.symbol,
                                orderData.signal.direction,
                                orderData.signal.entryPrices[0],
                                orderData.signal.takeProfits[0],
                                orderData.signal.stopLoss,
                                orderData.quantity
                            );
                        } else {
                            // Posição fechada por outro motivo (SL ou manual)
                            console.log(`⚠️ Posição para ${orderData.signal.symbol} (Ordem ${orderId}) fechada por outro motivo.`);
                            await this.handleOrderClosed(orderId, orderData);
                        }
                    } else {
                        // Posição não encontrada no histórico, pode ser um erro ou fechamento manual não rastreado
                        console.log(`⚠️ Posição para ${orderData.signal.symbol} (Ordem ${orderId}) não encontrada no histórico após fechamento. Assumindo fechamento.`);
                        await this.handleOrderClosed(orderId, orderData);
                    }
                } else if (orderData.trailingStop?.isActive) {
                    // Se a posição ainda está aberta e o trailing stop está ativo, atualizá-lo
                    await this.updateTrailingStop(orderId, orderData.signal.symbol, orderData.signal.direction, orderData.quantity);
                }
            }
        } catch (error) {
            console.error("Erro ao verificar ordens:", error.message);
        }
    }

    async getDetailedReport() {
        let report = "📊 *Relatório Detalhado de Ordens Ativas e Posições Abertas* 📊\n\n";

        // Relatório de Ordens Ativas (as que o bot está gerenciando)
        if (this.activeOrders.size > 0) {
            report += "--- *Ordens Ativas (Gerenciadas pelo Bot)* ---\n";
            for (const [orderId, orderData] of this.activeOrders.entries()) {
                report += `*ID da Ordem:* \`${orderId}\`\n`;
                report += `  *Símbolo:* \`${orderData.signal.symbol}\`\n`;
                report += `  *Direção:* \`${orderData.signal.direction}\`\n`;
                report += `  *Entrada:* \`${orderData.signal.entryPrices[0]}\`\n`;
                report += `  *TP1:* \`${orderData.signal.takeProfits[0]}\`\n`;
                report += `  *SL:* \`${orderData.signal.stopLoss}\`\n`;
                report += `  *Quantidade:* \`${orderData.quantity}\`\n`;
                report += `  *Trailing Stop Ativo:* \`${orderData.trailingStop?.isActive ? "Sim" : "Não"}\`\n`;
                if (orderData.trailingStop?.isActive) {
                    report += `  *Preço Trailing Stop:* \`${orderData.trailingStop.currentStopPrice}\`\n`;
                }
                report += "\n";
            }
        } else {
            report += "--- *Nenhuma Ordem Ativa sendo gerenciada pelo bot.* ---\n\n";
        }

        // Relatório de Posições Abertas na BingX (via API)
        try {
            const openPositions = await this.bingxClient.getOpenPositions();
            if (openPositions.length > 0) {
                report += "--- *Posições Abertas na BingX (API)* ---\n";
                for (const position of openPositions) {
                    report += `*Símbolo:* \`${position.symbol}\`\n`;
                    report += `  *Posição:* \`${position.positionSide}\`\n`;
                    report += `  *Quantidade:* \`${position.positionAmt}\`\n`;
                    report += `  *Preço de Entrada:* \`${position.avgPrice}\`\n`;
                    report += `  *Preço de Liquidação:* \`${position.liquidationPrice}\`\n`;
                    report += `  *PNL Não Realizado:* \`${position.unrealizedProfit}\`\n`;
                    report += `  *Margem:* \`${position.isolatedMargin}\`\n`;
                    report += "\n";
                }
            } else {
                report += "--- *Nenhuma Posição Aberta encontrada na BingX.* ---\n\n";
            }
        } catch (error) {
            report += `--- *Erro ao obter Posições Abertas da BingX:* ${error.message} ---\n\n`;
            console.error("Erro ao obter posições abertas para relatório:", error);
        }

        return report;
    }
}

module.exports = { OrderManager };


