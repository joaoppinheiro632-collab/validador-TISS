import { formatMoneyBR } from './utils/format.js';

// Escapa qualquer valor antes de interpolar em innerHTML. Todo dado exibido nas
// tabelas (guiaPrestador, mensagem, descricao, codigo, item, etc.) vem do XML
// carregado pelo usuário — sem isso, um lote malicioso com algo como
// <img src=x onerror="..."> em numeroGuiaPrestador executaria script arbitrário
// no navegador de quem abre o lote (XSS armazenado).
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class UIManager {
    constructor(editorManager) {
        this.editor = editorManager;
    }

    renderSummary(validationResults) {
        const r = validationResults.resumoLote;
        document.getElementById('res-tiss-ver').textContent = r.versao || 'N/A';
        document.getElementById('res-lote-num').textContent = r.lote || 'N/A';
        document.getElementById('res-prestador').textContent = r.prestador || 'N/A';
        document.getElementById('res-operadora').textContent = r.operadora || 'N/A';
        document.getElementById('res-qtd-guias').textContent = validationResults.guias.length;
        document.getElementById('res-total-erros').textContent = validationResults.erros.length;
        document.getElementById('res-total-alertas').textContent = validationResults.alertas.length;
        
        document.getElementById('mini-qtd-guias').textContent = validationResults.guias.length;
        document.getElementById('mini-erros').textContent = validationResults.erros.length;
        document.getElementById('mini-alertas').textContent = validationResults.alertas.length;

        const totalFormatado = formatMoneyBR(r.valorTotalLoteDeclarado);
        const valorTotalEl = document.getElementById('res-valor-total');
        valorTotalEl.textContent = totalFormatado;
        // Se o XML não trouxer uma tag de valor total do lote, o número exibido
        // é a soma calculada das guias, não um valor "declarado" real — o
        // tooltip deixa isso explícito em vez de dar a entender que foi conferido.
        valorTotalEl.title = r.valorTotalLoteInformado
            ? 'Valor declarado no XML do lote'
            : 'XML não informa valor total do lote — exibindo soma calculada das guias';

        const totalErrosAlertas = validationResults.erros.length + validationResults.alertas.length;
        document.getElementById('count-erros-alertas').textContent = totalErrosAlertas;

        document.getElementById('cat-fin').textContent = validationResults.categorias.fin;
        document.getElementById('cat-datas').textContent = validationResults.categorias.datas;
        document.getElementById('cat-estrut').textContent = validationResults.categorias.estrut;

        document.getElementById('sum-tot').textContent = validationResults.guias.length;
        document.getElementById('sum-err').textContent = validationResults.guias.filter(g => g.erros > 0).length;
        document.getElementById('sum-alt').textContent = validationResults.guias.filter(g => g.erros === 0 && g.alertas > 0).length;
        document.getElementById('sum-ok').textContent = validationResults.guias.filter(g => g.erros === 0 && g.alertas === 0).length;
    }

    renderGuiasTable(validationResults, onlyErrors = false) {
        const tbodyGuias = document.getElementById('tbody-guias');
        tbodyGuias.innerHTML = '';

        const guiasFiltradas = validationResults.guias.filter(g => onlyErrors ? (g.erros > 0 || g.alertas > 0) : true);

        if (guiasFiltradas.length === 0) {
            tbodyGuias.innerHTML = `<tr><td colspan="4">
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 11a6 6 0 1 0 0-12 6 6 0 0 0 0 12z" transform="translate(0 5)"/><path d="M21 21l-4.35-4.35"/></svg>
                    <div class="empty-title">Nenhuma guia atende ao filtro</div>
                    <div class="empty-hint">Desmarque "mostrar apenas com inconsistência" para ver todas</div>
                </div>
            </td></tr>`;
            return;
        }

        guiasFiltradas.forEach(g => {
            const tr = document.createElement('tr');
            tr.onclick = () => {
                this.highlightRow(tr, 'tbody-guias');
                this.editor.goToLine(g.linha, g.guiaPrestador);
            };

            tr.innerHTML = `
                <td><b>${escapeHtml(g.guiaPrestador)}</b></td>
                <td style="color: ${g.erros > 0 ? 'var(--accent-red)' : 'inherit'}; font-weight: bold;">${g.erros}</td>
                <td style="color: ${g.alertas > 0 ? 'var(--accent-yellow)' : 'inherit'}; font-weight: bold;">${g.alertas}</td>
                <td>${formatMoneyBR(g.valorTotal)}</td>
            `;
            tbodyGuias.appendChild(tr);
        });
    }

    renderErrosTable(validationResults) {
        const tbody = document.getElementById('tbody-erros-alertas');
        tbody.innerHTML = '';
        
        const todosApontamentos = [
            ...validationResults.erros,
            ...validationResults.alertas
        ].sort((a, b) => a.linha - b.linha);

        if (todosApontamentos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7">
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" style="opacity:0.6"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
                    <div class="empty-title" style="color: var(--accent-primary-hover);">Nenhuma inconsistência encontrada</div>
                    <div class="empty-hint">Todas as guias do lote passaram na validação</div>
                </div>
            </td></tr>`;
            return;
        }

        todosApontamentos.forEach(item => {
            const tr = document.createElement('tr');
            tr.onclick = () => {
                this.highlightRow(tr, 'tbody-erros-alertas');
                this.editor.goToLine(item.linha, item.targetTag || item.codigo);
            };

            tr.innerHTML = `
                <td><b>${escapeHtml(item.guia)}</b></td>
                <td><span class="badge ${item.tipo === 'Erro' ? 'badge-error' : 'badge-warn'}">${escapeHtml(item.tipo)}</span></td>
                <td>${escapeHtml(item.item)}</td>
                <td><b>${escapeHtml(item.codigo)}</b></td>
                <td title="${escapeHtml(item.descricao)}">${escapeHtml(item.descricao)}</td>
                <td>Linha ${Number(item.linha) || 0}</td>
                <td>${escapeHtml(item.mensagem)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    renderAuditoriaTable(validationResults) {
        const tbody = document.getElementById('tbody-auditoria');
        tbody.innerHTML = '';
        validationResults.guias.forEach(g => {
            const tr = document.createElement('tr');
            tr.onclick = () => {
                this.highlightRow(tr, 'tbody-auditoria');
                this.editor.goToLine(g.linha, g.guiaPrestador);
            };
            const v = g.detalhesValores;
            const match = Math.abs(g.valorTotal - g.valorCalculado) < 0.01;

            tr.innerHTML = `
                <td><b>${escapeHtml(g.guiaPrestador)}</b></td>
                <td>${formatMoneyBR(v.proc.calc)}</td>
                <td>${formatMoneyBR(v.dia.calc)}</td>
                <td>${formatMoneyBR(v.tax.calc)}</td>
                <td>${formatMoneyBR(v.mat.calc)}</td>
                <td>${formatMoneyBR(v.med.calc)}</td>
                <td>${formatMoneyBR(v.opme.calc)}</td>
                <td>${formatMoneyBR(v.gas.calc)}</td>
                <td>${formatMoneyBR(g.valorTotal)}</td>
                <td>${formatMoneyBR(g.valorCalculado)}</td>
                <td style="color: ${match ? 'var(--accent-primary-hover)' : 'var(--accent-red)'}; font-weight: bold;">
                    ${match ? 'CORRETO' : 'DIVERGENTE'}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    highlightRow(tr, parentId) {
        document.querySelectorAll(`#${parentId} tr`).forEach(r => r.classList.remove('selected-row'));
        tr.classList.add('selected-row');
    }

    // Renderiza a tabela de histórico de transmissões. Os cliques em "status"
    // e "remover" não são resolvidos aqui — apenas emitem os IDs via callback,
    // pra quem chamou (app.js) decidir o que fazer e persistir a mudança.
    renderTransmissoes(historico, { onToggleStatus, onRemove } = {}) {
        const tbody = document.getElementById('tbody-transmissoes');
        tbody.innerHTML = '';

        document.getElementById('count-transmissoes').textContent = historico.length;
        document.getElementById('transm-total').textContent = historico.length;
        document.getElementById('transm-ultimo-lote').textContent = historico.length ? historico[0].lote : '-';
        document.getElementById('transm-ultima-data').textContent = historico.length
            ? this.formatDataHora(historico[0].dataHora)
            : '-';

        if (historico.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9">
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
                    <div class="empty-title">Nenhuma transmissão registrada</div>
                    <div class="empty-hint">Registros aparecem ao clicar em Importação ou Baixar Lote</div>
                </div>
            </td></tr>`;
            return;
        }

        const origemLabel = {
            importacao: 'Importação SGU',
            download_zip: 'Download .zip',
            download_xml: 'Download .xml',
            manual: 'Manual'
        };

        historico.forEach(reg => {
            const tr = document.createElement('tr');
            const valorFormatado = formatMoneyBR(reg.valor);

            tr.innerHTML = `
                <td>${escapeHtml(this.formatDataHora(reg.dataHora))}</td>
                <td><b>${escapeHtml(reg.lote)}</b></td>
                <td>${reg.guias}</td>
                <td>${escapeHtml(valorFormatado)}</td>
                <td style="color: ${reg.erros > 0 ? 'var(--accent-red)' : 'inherit'};">${reg.erros}</td>
                <td style="color: ${reg.alertas > 0 ? 'var(--accent-yellow)' : 'inherit'};">${reg.alertas}</td>
                <td>${escapeHtml(origemLabel[reg.origem] || 'Manual')}</td>
                <td>
                    <span class="status-pill ${reg.status}" data-action="toggle-status" data-id="${escapeHtml(reg.id)}" title="Clique para alternar o status">
                        ${reg.status === 'confirmado' ? 'Confirmado' : 'Pendente'}
                    </span>
                </td>
                <td>
                    <button class="btn-remove-row" data-action="remove" data-id="${escapeHtml(reg.id)}" title="Remover este registro">✕</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Delegação: um único listener no tbody em vez de um por linha, já que
        // a tabela inteira é recriada a cada renderização.
        tbody.onclick = (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const id = target.getAttribute('data-id');
            if (target.dataset.action === 'toggle-status' && onToggleStatus) onToggleStatus(id);
            if (target.dataset.action === 'remove' && onRemove) onRemove(id);
        };
    }

    // Renderiza o log de alterações. onRowClick(linha, campo) é chamado ao
    // clicar numa linha, pra pular pro trecho editado no editor.
    renderChangelog(entries, onRowClick) {
        const tbody = document.getElementById('tbody-changelog');
        tbody.innerHTML = '';

        document.getElementById('count-changelog').textContent = entries.length;
        document.getElementById('count-changelog-resumo').textContent = entries.length;

        if (entries.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5">
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                    <div class="empty-title">Nenhuma alteração registrada</div>
                    <div class="empty-hint">Edições feitas direto no XML aparecem aqui nesta sessão</div>
                </div>
            </td></tr>`;
            return;
        }

        entries.forEach(entry => {
            const tr = document.createElement('tr');
            tr.onclick = () => {
                this.highlightRow(tr, 'tbody-changelog');
                if (onRowClick) onRowClick(entry.linha, entry.campo);
            };

            tr.innerHTML = `
                <td>${escapeHtml(this.formatDataHora(entry.dataHora))}</td>
                <td>Linha ${Number(entry.linha) || 0}</td>
                <td><b>${escapeHtml(entry.campo)}</b></td>
                <td title="${escapeHtml(entry.antes)}">${escapeHtml(entry.antes)}</td>
                <td title="${escapeHtml(entry.depois)}">${escapeHtml(entry.depois)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    formatDataHora(timestamp) {
        return new Date(timestamp).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    }
}