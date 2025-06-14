/**
 * Parser de sinais de trading
 * Extrai informações de sinais no formato:
 * 🟢 LONG (AERGOUSDT)
 * Entrys: 0.11477 - 0.11458
 * Leverage: 5X
 * Tps: 0.11547 - 0.11593 - 0.1164
 * Stop Loss: 0.1143
 */

class SignalParser {
    static parseSignal(signalText) {
        try {
            const lines = signalText.trim().split("\n");

            // Extrair direção e símbolo
            const firstLine = lines[0];
            const direction = firstLine.includes("LONG") ? "BUY" : "SELL";
            const symbolMatch = firstLine.match(/\(([A-Z]+)\)/);
            if (!symbolMatch) throw new Error("Símbolo não encontrado");
            const symbol = symbolMatch[1];

            // Função auxiliar para encontrar a linha e extrair valores
            const findAndExtract = (regex, errorMessage) => {
                const line = lines.find(l => regex.test(l));
                if (!line) throw new Error(errorMessage);
                const match = line.match(regex);
                return match[1].trim();
            };

            // Extrair entradas
            const entryString = findAndExtract(/Entrys\s*:\s*(.*)/, "Entradas não encontradas");
            const entryPrices = entryString.split(/\s*-\s*|\s+/).filter(Boolean).map(p => parseFloat(p.trim()));
            if (entryPrices.some(isNaN) || entryPrices.length === 0) throw new Error("Formato de Entrys inválido");

            // Extrair leverage
            const leverageString = findAndExtract(/Leverage\s*:\s*(\d+X)/, "Leverage não encontrado");
            const leverage = parseInt(leverageString.replace("X", ""));
            if (isNaN(leverage) || leverage <= 0) throw new Error("Formato de Leverage inválido");

            // Extrair take profits (PEGAR APENAS O PRIMEIRO, pois BingX só permite 1 TP)
            const tpString = findAndExtract(/Tps\s*:\s*(.*)/, "Take profits não encontrados");
            const takeProfits = [parseFloat(tpString.split(/\s*-\s*|\s+/).filter(Boolean)[0])];
            if (takeProfits.some(isNaN) || takeProfits.length === 0) throw new Error("Formato de Tps inválido");

            // Extrair stop loss
            const slString = findAndExtract(/Stop Loss\s*:\s*(.*)/, "Stop Loss não encontrado");
            const stopLoss = parseFloat(slString);
            if (isNaN(stopLoss) || stopLoss <= 0) throw new Error("Formato de Stop Loss inválido");

            return {
                symbol,
                direction,
                entryPrices,
                leverage,
                takeProfits,
                stopLoss,
                isValid: true
            };
        } catch (error) {
            console.error("Erro ao processar sinal:", error.message);
            return { isValid: false, error: error.message };
        }
    }

    static validateSignal(signal) {
        if (!signal.isValid) return false;

        // Validações básicas
        if (!signal.symbol || signal.symbol.length < 3) return false;
        if (!["BUY", "SELL"].includes(signal.direction)) return false;
        if (!signal.entryPrices || signal.entryPrices.length === 0) return false;
        if (!signal.takeProfits || signal.takeProfits.length === 0) return false;
        if (!signal.stopLoss || signal.stopLoss <= 0) return false;
        if (!signal.leverage || signal.leverage <= 0) return false;

        // Validar se os preços fazem sentido
        const avgEntry = signal.entryPrices.reduce((a, b) => a + b, 0) / signal.entryPrices.length;

        if (signal.direction === "BUY") {
            // Para LONG: TP deve ser maior que entrada, SL menor que entrada
            if (signal.takeProfits.some(tp => tp <= avgEntry)) return false;
            if (signal.stopLoss >= avgEntry) return false;
        } else {
            // Para SHORT: TP deve ser menor que entrada, SL maior que entrada
            if (signal.takeProfits.some(tp => tp >= avgEntry)) return false;
            if (signal.stopLoss <= avgEntry) return false;
        }

        return true;
    }
}

module.exports = SignalParser;