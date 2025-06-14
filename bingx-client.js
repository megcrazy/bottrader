const axios = require("axios");
const crypto = require("crypto-js");

class BingXClient {
    constructor(apiKey, secretKey, baseUrl = "https://open-api-vst.bingx.com")  {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.baseUrl = baseUrl;
    }

    generateSignature(queryString) {
        return crypto.HmacSHA256(queryString, this.secretKey).toString();
    }

    formatSymbol(symbol) {
        if (symbol.endsWith("USDT")) return symbol.replace("USDT", "-USDT");
        if (symbol.endsWith("USDC")) return symbol.replace("USDC", "-USDC");
        return symbol;
    }

    async makeAuthenticatedRequest(method, endpoint, params = {}) {
        const timestamp = Date.now();
        const recvWindow = 5000;
        const queryParams = {
            ...params,
            timestamp,
            recvWindow,
            demoTrade: 'on'
        };
        const queryString = new URLSearchParams(queryParams).toString();
        const signature = this.generateSignature(queryString);
        const finalQueryString = `${queryString}&signature=${signature}`;
        let config = {
            method,
            headers: {
                "X-BX-APIKEY": this.apiKey,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        };

        if (method === "GET") {
            config.url = `${this.baseUrl}${endpoint}?${finalQueryString}`;
        } else {
            config.url = `${this.baseUrl}${endpoint}`;
            config.data = finalQueryString;
        }

        try {
            const response = await axios(config);
            return response.data;
        } catch (error) {
            console.error("Erro na requisição BingX:", error.response?.data || error.message);
            throw error;
        }
    }

    async getAccountInfo() {
        const timestamp = Date.now();
        const recvWindow = 5000;
        const queryString = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
        const signature = this.generateSignature(queryString);
        const url = `${this.baseUrl}/openApi/swap/v2/user/balance?${queryString}&signature=${signature}`;
        const config = {
            method: "GET",
            url: url,
            headers: {
                "X-BX-APIKEY": this.apiKey,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        };
        try {
            const response = await axios(config);
            const accountData = response.data;

            let balances = [];
            if (accountData && accountData.data && accountData.data.balance) {
                if (Array.isArray(accountData.data.balance)) {
                    balances = accountData.data.balance;
                } else {
                    balances = [accountData.data.balance];
                }
            }

            if (!balances.length) {
                throw new Error("Nenhum saldo encontrado na resposta da conta");
            }

            const assets = balances.map(bal => ({
                asset: bal.asset,
                availableBalance: bal.availableMargin || bal.balance,
                equity: bal.equity,
                crossUnPnl: bal.unrealizedProfit
            }));

            return { assets };
        } catch (error) {
            console.error("❌ Erro ao obter informações da conta:", error.message);
            throw error;
        }
    }

    async getCurrentPrice(symbol) {
        const formattedSymbol = this.formatSymbol(symbol);
        try {
            const response = await axios.get(`${this.baseUrl}/openApi/swap/v1/ticker/price?symbol=${formattedSymbol}`);
            return parseFloat(response.data.price);
        } catch (error) {
            console.error("Erro ao obter preço atual:", error.message);
            throw error;
        }
    }

    async setLeverage(symbol, leverage) {
        const formattedSymbol = this.formatSymbol(symbol);
        const params = { symbol: formattedSymbol, leverage };
        return await this.makeAuthenticatedRequest("POST", "/openApi/swap/v1/trade/leverage", params);
    }

    async createMarketOrder(symbol, side, quantity, stopPrice = null, takeProfitPrice = null) {
        const formattedSymbol = this.formatSymbol(symbol);

        // Determina positionSide com base no lado da ordem
        const positionSide = side === "BUY" ? "LONG" : "SHORT";

        const params = {
            symbol: formattedSymbol,
            side,
            positionSide,
            type: "MARKET",
            quantity: Number(quantity)
        };

        if (stopPrice !== null && stopPrice !== undefined) {
            params.stopLoss = JSON.stringify({
                type: "STOP_MARKET",
                quantity: Number(quantity),
                stopPrice: Number(stopPrice),
                workingType: "MARK_PRICE"
            });
        }

        if (takeProfitPrice !== null && takeProfitPrice !== undefined) {
            params.takeProfit = JSON.stringify({
                type: "TAKE_PROFIT_MARKET",
                quantity: Number(quantity),
                stopPrice: Number(takeProfitPrice),
                workingType: "MARK_PRICE"
            });
        }

        const result = await this.makeAuthenticatedRequest("POST", "/openApi/swap/v2/trade/order", params);
        console.log("DEBUG - Resposta criação de ordem (Market):", result);

        const orderId = result?.data?.order?.orderId ||
                        result?.data?.orderID ||
                        result?.data?.id ||
                        "ID_NÃO_ENCONTRADO";

        return {
            orderId,
            data: result.data || {},
            success: result.code === 0
        };
    }

    async calculateQuantity(symbol, entryPrice, riskPercentage = 1) {
        try {
            const accountInfo = await this.getAccountInfo();
            const usdtBalance = accountInfo.assets.find(b => b.asset === "USDT" || b.asset === "VST");
            if (!usdtBalance) {
                throw new Error("Saldo em USDT/VST não encontrado");
            }
            const availableBalance = parseFloat(usdtBalance.availableBalance);
            const riskAmount = availableBalance * (riskPercentage / 100);
            let quantity = riskAmount / entryPrice;
            return parseFloat(quantity.toFixed(3));
        } catch (error) {
            console.error("Erro ao calcular quantidade:", error.message);
            throw error;
        }
    }

    async executeSignal(signal, riskPercentage = 1) {
        try {
            console.log("Executando sinal:", signal);
            const { symbol, direction, entryPrices, takeProfits, stopLoss, leverage } = signal;
            const entryPrice = entryPrices[0];

            await this.setLeverage(symbol, leverage);
            console.log(`Alavancagem definida para ${leverage}X para ${symbol}`);

            const quantity = await this.calculateQuantity(symbol, entryPrice, riskPercentage);
            console.log(`Quantidade calculada: ${quantity}`);

            const singleTakeProfit = takeProfits[0];
            const entryOrder = await this.createMarketOrder(
                symbol,
                direction,
                quantity,
                stopLoss,
                singleTakeProfit
            );

            console.log("Ordem de entrada criada:", entryOrder.orderId);

            return {
                success: true,
                entryOrder,
                stopOrder: {},
                tpOrders: [],
                quantity,
                symbol
            };
        } catch (error) {
            console.error("Erro ao executar sinal:", error.message);
            throw error;
        }
    }

    async getOpenOrders(symbol = null) {
        const params = symbol ? { symbol: this.formatSymbol(symbol) } : {};
        const result = await this.makeAuthenticatedRequest("GET", "/openApi/swap/v2/trade/openOrders", params);
        console.log("DEBUG - Resposta getOpenOrders:", result);

        if (result && result.data && Array.isArray(result.data.orders)) {
            return result.data.orders;
        }
        return [];
    }

    async getOrderHistory(symbol, limit = 10) {
        const formattedSymbol = this.formatSymbol(symbol);
        const result = await this.makeAuthenticatedRequest("GET", "/openApi/swap/v2/trade/historyOrders", {
            symbol: formattedSymbol,
            limit
        });
        console.log("DEBUG - Resposta getOrderHistory:", result);

        if (!result || result.code === 100404 || !result.data || !result.data.orders) {
            console.warn("⚠️ Endpoint /historyOrders não disponível ou sem dados.");
            return [];
        }
        return result.data.orders.filter(o => o.status === "FILLED");
    }

    async getTicker(symbol) {
        const formattedSymbol = this.formatSymbol(symbol);
        try {
            const response = await axios.get(`${this.baseUrl}/openApi/swap/v1/market/tickers?symbol=${formattedSymbol}`);
            const ticker = response.data.data.find(t => t.symbol === formattedSymbol);
            if (ticker) {
                return { lastPrice: parseFloat(ticker.lastPrice) };
            }
            throw new Error("Ticker não encontrado.");
        } catch (error) {
            console.error("Erro ao obter preço atual:", error.message);
            throw error;
        }
    }

    async cancelOrder(symbol, orderId) {
        const formattedSymbol = this.formatSymbol(symbol);
        const params = {
            symbol: formattedSymbol,
            orderId
        };
        const result = await this.makeAuthenticatedRequest("POST", "/openApi/swap/v1/trade/cancelOrder", params);
        return result;
    }

    async getOpenPositions(symbol = null) {
        const params = symbol ? { symbol: this.formatSymbol(symbol) } : {};
        const result = await this.makeAuthenticatedRequest("GET", "/openApi/swap/v2/user/positions", params);
        console.log("DEBUG - Resposta getOpenPositions:", result);

        if (result && result.data && Array.isArray(result.data.positions)) {
            return result.data.positions;
        }
        return [];
    }
}

module.exports = { BingXClient };


