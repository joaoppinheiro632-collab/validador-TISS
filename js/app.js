import { EditorManager } from './editor.js';
import { UIManager } from './ui.js';
import { parseAndValidateXML } from './parser.js';
import { loadZipFile, loadXmlFile } from './zip.js';
import { exportCSV, exportZIP, exportXML } from './exports.js';
import { getSguConfig, saveSguConfig, clearSguConfig, openSguUploadScreen, formatRelativeSavedAt } from './sgu.js';
import { registrarTransmissao, getHistorico, marcarStatus, removerRegistro, limparHistorico } from './history.js';
import { resetChangelog, registrarAlteracoes, getChangelog } from './changelog.js';

class App {
    constructor() {
        this.originalXmlFilename = "LoteTISS.xml";
        this.originalFormat = "zip";
        this.validationResults = null;
        this.debounceTimer = null;
        this.lastKnownText = '';

        this.initDOM();
        this.initManagers();
        this.bindEvents();
        this.refreshTransmissoes();
        this.refreshChangelog();
    }

    initDOM() {
        this.textarea = document.getElementById('code-textarea');
        this.lineNumDiv = document.getElementById('line-numbers');
        this.zipInput = document.getElementById('zip-input');
        this.sidebar = document.getElementById('sidebar');
        this.bottomPanel = document.getElementById('bottom-panel');
        this.resizer = document.getElementById('panel-resizer');
    }

    initManagers() {
        this.editor = new EditorManager(
            this.textarea,
            this.lineNumDiv,
            document.getElementById('sb-lines'),
            document.getElementById('sb-size'),
            document.getElementById('sb-status')
        );
        this.ui = new UIManager(this.editor);
    }

    bindEvents() {
        // Importação: clique é resolvido pelo <label for="zip-input"> no
        // próprio HTML (sem JS); aqui só tratamos o arrastar-e-soltar,
        // reaproveitando o mesmo processImportedFile() do input de arquivo.
        this.zipInput.onchange = (e) => this.handleFileSelect(e);
        this.bindDropzone();
        document.getElementById('btn-export-csv').onclick = () => exportCSV(this.validationResults);
        document.getElementById('btn-export-zip').onclick = () => this.handleExportLote();

        // Integração SGU
        document.getElementById('btn-sgu-transmit').onclick = () => this.handleSguTransmit();
        document.getElementById('btn-sgu-settings').onclick = () => this.openSguModal();
        document.getElementById('sgu-modal-close').onclick = () => this.closeSguModal();
        document.getElementById('sgu-modal-overlay').onclick = (e) => {
            if (e.target.id === 'sgu-modal-overlay') this.closeSguModal();
        };
        document.getElementById('sgu-save-btn').onclick = () => this.handleSguSave();
        document.getElementById('sgu-clear-btn').onclick = () => this.handleSguClear();

        // Histórico de Transmissões
        document.getElementById('btn-limpar-historico').onclick = () => this.handleLimparHistorico();

        // Log de Alterações
        document.getElementById('btn-limpar-changelog').onclick = () => this.handleLimparChangelog();

        // Sidebar
        document.getElementById('toggle-sidebar-btn').onclick = () => this.toggleSidebar();

        // Filtro Guias
        document.getElementById('chk-only-errors').onchange = (e) => {
            if (this.validationResults) {
                this.ui.renderGuiasTable(this.validationResults, e.target.checked);
            }
        };

        // Editor input debounce
        this.textarea.addEventListener('input', () => {
            this.editor.updateLineNumbers();
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.processCurrentXML(false);
                registrarAlteracoes(this.lastKnownText, this.editor.getText());
                this.lastKnownText = this.editor.getText();
                this.refreshChangelog();
            }, 500);
        });

        // Busca
        const searchInput = document.getElementById('search-input');
        const searchCount = document.getElementById('search-count');

        searchInput.oninput = () => this.editor.performSearch(searchInput.value, searchCount);
        searchInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.editor.navigateSearch(e.shiftKey ? -1 : 1, searchInput.value, searchCount);
            }
        };

        document.getElementById('btn-search-prev').onclick = () => this.editor.navigateSearch(-1, searchInput.value, searchCount);
        document.getElementById('btn-search-next').onclick = () => this.editor.navigateSearch(1, searchInput.value, searchCount);

        // Go to line
        const gotoInput = document.getElementById('goto-line-input');
        gotoInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                // Sem isso, o Enter continua sendo processado depois que o
                // foco muda pro textarea (dentro de goToLine), e como a
                // linha fica selecionada, o Enter "digita" ali e apaga o
                // conteúdo da linha inteira.
                e.preventDefault();
                this.editor.goToLine(gotoInput.value);
            }
        };

        // Resizer Bottom Panel
        this.initResizer();

        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.onclick = (e) => this.switchTab(e);
        });

        document.getElementById('btn-toggle-panel').onclick = () => this.toggleBottomPanel();
    }

    bindDropzone() {
        const dropzone = document.getElementById('dropzone');

        ['dragenter', 'dragover'].forEach(evt => {
            dropzone.addEventListener(evt, (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });
        });

        ['dragleave', 'dragend'].forEach(evt => {
            dropzone.addEventListener(evt, (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
            });
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) this.processImportedFile(file);
        });
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        await this.processImportedFile(file);
        // Permite selecionar o mesmo arquivo de novo em seguida (senão o
        // navegador não dispara "change" se o valor não mudar).
        event.target.value = '';
    }

    async processImportedFile(file) {
        const isZip = file.name.toLowerCase().endsWith('.zip');
        const isXml = file.name.toLowerCase().endsWith('.xml');

        if (!isZip && !isXml) {
            alert('Selecione um arquivo .xml ou .zip válido contendo o lote TISS.');
            return;
        }

        document.getElementById('file-name').textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;

        try {
            // Independente de vir .xml solto ou .zip contendo o .xml, o
            // resultado da leitura é sempre o mesmo texto de XML — o resto do
            // fluxo (editor, regras, validação) não precisa saber a origem.
            // Só guardamos o formato para exportar de volta no mesmo formato
            // em que o arquivo entrou.
            const { xmlFileName, xmlRawText, encoding } = isZip
                ? await loadZipFile(file)
                : await loadXmlFile(file);

            this.originalXmlFilename = xmlFileName;
            this.originalFormat = isZip ? 'zip' : 'xml';

            const btnExport = document.getElementById('btn-export-zip');
            btnExport.textContent = isZip ? 'Baixar Lote (.zip)' : 'Baixar XML (.xml)';

            const encodingLabel = document.getElementById('sb-encoding');
            if (encodingLabel) {
                encodingLabel.textContent = encoding === 'utf-8' ? 'UTF-8' : 'ISO-8859-1';
            }

            this.editor.setText(xmlRawText);
            this.processCurrentXML(true);

            resetChangelog();
            this.lastKnownText = xmlRawText;
            this.refreshChangelog();
        } catch (err) {
            alert(`Erro ao ler ${isZip ? 'ZIP' : 'XML'}: ` + err.message);
        }
    }

    async handleExportLote() {
        if (!this.editor.getText()) {
            alert('Nenhum lote carregado para exportação.');
            return;
        }

        // Exporta sempre no mesmo formato em que o arquivo foi importado:
        // entrou .xml, sai .xml; entrou .zip, sai .zip.
        if (this.originalFormat === 'xml') {
            exportXML(this.originalXmlFilename, this.editor.getText());
            this.registrarTransmissaoAtual('download_xml');
        } else {
            await exportZIP(
                this.originalXmlFilename,
                this.editor.getText(),
                this.validationResults?.resumoLote?.lote
            );
            this.registrarTransmissaoAtual('download_zip');
        }

        // Abre a tela de importação do SGU automaticamente, se configurado.
        // Não substitui o download acima — é um passo a mais que economiza o
        // usuário ter que procurar a tela no SGU manualmente depois.
        const { autoOpen } = getSguConfig();
        if (autoOpen) {
            const opened = openSguUploadScreen();
            if (!opened) {
                alert('Não foi possível abrir a tela de transmissão SGU: nenhum link configurado. Configure em ⚙️ Integração SGU.');
            }
        }
    }

    handleSguTransmit() {
        const opened = openSguUploadScreen();
        if (!opened) {
            alert('Não foi possível abrir a tela de transmissão.\n\nAtualize o link SGU nas configurações (⚙️).');
            this.openSguModal();
            return;
        }
        this.registrarTransmissaoAtual('importacao');
    }

    // Grava no histórico local os dados do lote atualmente carregado. Isso
    // NÃO confirma que o SGU recebeu o arquivo — só que o usuário baixou o
    // .zip ou abriu a tela de importação a partir deste lote. Sem lote
    // carregado (resumoLote vazio), não há o que registrar.
    registrarTransmissaoAtual(origem) {
        const r = this.validationResults?.resumoLote;
        if (!r || !r.lote) return;

        registrarTransmissao({
            lote: r.lote,
            guias: this.validationResults.guias.length,
            valor: r.valorTotalLoteDeclarado,
            erros: this.validationResults.erros.length,
            alertas: this.validationResults.alertas.length,
            origem
        });
        this.refreshTransmissoes();
    }

    refreshTransmissoes() {
        this.ui.renderTransmissoes(getHistorico(), {
            onToggleStatus: (id) => this.handleToggleStatusTransmissao(id),
            onRemove: (id) => this.handleRemoverTransmissao(id)
        });
    }

    handleToggleStatusTransmissao(id) {
        const registro = getHistorico().find(r => r.id === id);
        if (!registro) return;
        marcarStatus(id, registro.status === 'confirmado' ? 'pendente' : 'confirmado');
        this.refreshTransmissoes();
    }

    handleRemoverTransmissao(id) {
        removerRegistro(id);
        this.refreshTransmissoes();
    }

    handleLimparHistorico() {
        if (!getHistorico().length) return;
        if (!confirm('Deseja remover todos os registros do histórico de transmissões desta sessão?')) return;
        limparHistorico();
        this.refreshTransmissoes();
    }

    refreshChangelog() {
        this.ui.renderChangelog(getChangelog(), (linha, campo) => this.editor.goToLine(linha, campo));
    }

    handleLimparChangelog() {
        if (!getChangelog().length) return;
        if (!confirm('Deseja limpar o log de alterações do lote atual? Isso não desfaz as edições, só apaga o registro.')) return;
        resetChangelog();
        this.refreshChangelog();
    }

    openSguModal() {
        const { url, savedAt, autoOpen } = getSguConfig();
        document.getElementById('sgu-url-input').value = url;
        document.getElementById('sgu-auto-open-chk').checked = autoOpen;
        this.renderSguSavedInfo(savedAt, url);
        document.getElementById('sgu-modal-overlay').classList.remove('hidden');
        document.getElementById('sgu-url-input').focus();
    }

    closeSguModal() {
        document.getElementById('sgu-modal-overlay').classList.add('hidden');
    }

    handleSguSave() {
        const url = document.getElementById('sgu-url-input').value.trim();
        const autoOpen = document.getElementById('sgu-auto-open-chk').checked;

        try {
            saveSguConfig({ url, autoOpen });
            const { savedAt } = getSguConfig();
            this.renderSguSavedInfo(savedAt, url, 'Link salvo com sucesso.');
        } catch (err) {
            const infoEl = document.getElementById('sgu-saved-info');
            infoEl.textContent = err.message;
            infoEl.className = 'modal-saved-info error';
        }
    }

    handleSguClear() {
        clearSguConfig();
        document.getElementById('sgu-url-input').value = '';
        document.getElementById('sgu-auto-open-chk').checked = false;
        this.renderSguSavedInfo(null, '', 'Link removido.');
    }

    renderSguSavedInfo(savedAt, url, extraMessage = '') {
        const infoEl = document.getElementById('sgu-saved-info');
        const relative = formatRelativeSavedAt(savedAt);

        let text;
        if (extraMessage) {
            text = url && relative ? `${extraMessage} (${relative})` : extraMessage;
        } else if (url && relative) {
            text = `Link atual: ${relative}.`;
        } else {
            text = 'Nenhum link configurado ainda.';
        }

        infoEl.textContent = text;
        infoEl.className = /sucesso|removido/.test(extraMessage) ? 'modal-saved-info ok' : 'modal-saved-info';
    }

    processCurrentXML(refreshStatus = true) {
        const rawText = this.editor.getText();
        const { validationResults } = parseAndValidateXML(rawText);
        this.validationResults = validationResults;

        if (refreshStatus) {
            this.editor.updateStatusbar(rawText, validationResults.erros.length > 0 ? "Possui Erros" : "XML Válido");
        }

        this.ui.renderSummary(validationResults);
        this.ui.renderGuiasTable(validationResults, document.getElementById('chk-only-errors').checked);
        this.ui.renderErrosTable(validationResults);
        this.ui.renderAuditoriaTable(validationResults);
    }

    toggleSidebar() {
        this.sidebar.classList.toggle('collapsed');
        document.getElementById('toggle-sidebar-btn').textContent = this.sidebar.classList.contains('collapsed') ? '>' : '<';
    }

    switchTab(event) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        const targetTabId = event.currentTarget.getAttribute('data-tab');
        event.currentTarget.classList.add('active');
        document.getElementById(targetTabId).classList.add('active');
    }

    toggleBottomPanel() {
        const btn = document.getElementById('btn-toggle-panel');
        if (this.bottomPanel.classList.contains('minimized')) {
            this.bottomPanel.classList.remove('minimized');
            this.bottomPanel.style.height = '240px';
            btn.textContent = '▼';
        } else {
            this.bottomPanel.classList.add('minimized');
            btn.textContent = '▲';
        }
    }

    initResizer() {
        let isResizing = false;

        this.resizer.addEventListener('mousedown', () => {
            isResizing = true;
            this.resizer.classList.add('resizing');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newHeight = window.innerHeight - e.clientY;
            if (newHeight >= 35 && newHeight <= window.innerHeight * 0.8) {
                this.bottomPanel.style.height = `${newHeight}px`;
                this.bottomPanel.classList.remove('minimized');
                document.getElementById('btn-toggle-panel').textContent = '▼';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                this.resizer.classList.remove('resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }
}

// Inicializa a aplicação ao carregar a página.
// Deliberadamente não exposta em window: reduz a superfície de ataque de
// qualquer XSS futuro (nada de acesso direto a window.app.validationResults,
// editor, etc. a partir de um script injetado).
window.addEventListener('DOMContentLoaded', () => {
    new App();
});