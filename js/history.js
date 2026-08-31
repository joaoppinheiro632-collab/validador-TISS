const STORAGE_KEY_HISTORICO = 'pinware_transmissoes_historico';
const MAX_REGISTROS = 200; // evita que o localStorage cresça indefinidamente

// Registra que o usuário GEROU/ABRIU uma transmissão para um lote — não é
// confirmação de que o SGU recebeu ou processou o arquivo. O app não tem
// como saber isso: o botão "IMPORTAÇÃO" só abre uma aba do SGU (CSP bloqueia
// qualquer chamada de rede própria), e o upload em si acontece manualmente
// dentro do SGU. Por isso o status inicial é sempre "Aguardando confirmação"
// e fica a cargo do usuário marcar como conferido depois.
export function registrarTransmissao({ lote, guias, valor, erros, alertas, origem }) {
    const historico = getHistorico();

    const registro = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        dataHora: Date.now(),
        lote: lote || 'SEM_LOTE',
        guias: Number(guias) || 0,
        valor: Number(valor) || 0,
        erros: Number(erros) || 0,
        alertas: Number(alertas) || 0,
        origem: origem || 'manual', // 'importacao' | 'download_zip' | 'manual'
        status: 'pendente' // 'pendente' | 'confirmado'
    };

    historico.unshift(registro);
    if (historico.length > MAX_REGISTROS) {
        historico.length = MAX_REGISTROS;
    }

    salvarHistorico(historico);
    return registro;
}

export function getHistorico() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_HISTORICO);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // localStorage corrompido/adulterado não pode derrubar o app inteiro
        return [];
    }
}

export function marcarStatus(id, status) {
    const historico = getHistorico();
    const item = historico.find(r => r.id === id);
    if (!item) return false;
    item.status = status;
    salvarHistorico(historico);
    return true;
}

export function removerRegistro(id) {
    const historico = getHistorico().filter(r => r.id !== id);
    salvarHistorico(historico);
}

export function limparHistorico() {
    localStorage.removeItem(STORAGE_KEY_HISTORICO);
}

function salvarHistorico(historico) {
    localStorage.setItem(STORAGE_KEY_HISTORICO, JSON.stringify(historico));
}
