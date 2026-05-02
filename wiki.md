📐 ARCHITECTURE DECISION RECORD (ADR)
Ecossistema CRV/LAS — Estado Consolidado em 02/05/2026
🏛️ PARTE 1: ARQUITETURA ATUAL (snapshot)
🔷 Visão geral do ecossistema
Copy┌─────────────────────────────────────────────────────────────┐
│                     GOD MODE (Central)                      │
│  • Painel de observabilidade multi-tenant                   │
│  • Apps Script: AKfycbzqjZty...NYPx                        │
│  • Sheets: 7 abas (LOGS_ERROS, EVENTOS_AUTH, SESSOES, etc.) │
│  • API_KEY: ee91297b-685b-4ae4-b131-8434841c882e            │
│  • URL: https://albubueno-eng.github.io/DEVLOG/             │
└────────────────────┬────────────────────────────────────────┘
                     │
       ┌─────────────┴─────────────┐
       │ recebe telemetria de:     │
       ▼                           ▼
┌──────────────────┐       ┌──────────────────┐
│  PONTO DIGITAL   │       │  ESTOQUE DIGITAL │
│  • Apps Script:  │       │  • Apps Script:  │
│    AKfycbzw_DCKo │       │    (a confirmar) │
│  • URL: github.io│       │  • URL: github.io│
│    /comerciavza- │       │    /comerciavza- │
│    lef/ponto/    │       │    lef/estoque/  │
│  • Tracker: ✅   │       │  • Tracker: ⏳   │
└──────────────────┘       └──────────────────┘
🔷 Stack técnico
Camada	Tecnologia	Status
Frontend	HTML + Vanilla JS (ES6+) + CSS	✅ Padrão
PWA	Service Worker + Manifest	✅ Funcionando
Backend	Google Apps Script	✅ Funcionando
Banco	Google Sheets	🟡 Limite ~50 clientes
Hosting	GitHub Pages	✅ Gratuito
Auth (Ponto)	SHA-256 hash em código	🟡 Hardcoded
Auth (God Mode)	❌ Não tem	🔴 Bloqueador
Telemetria	tracker.js → Apps Script Central	✅ Funcionando
Watchdog	Web Worker com proteção visibility	✅ Funcionando
🔷 Decisões arquiteturais já tomadas
ID	Decisão	Justificativa	Status
ADR-001	Multi-tenant via idCliente em todas as abas	Simples, escala até ~50 clientes	✅ Vigente
ADR-002	API Key única por app (não por cliente)	Reduz complexidade, identifica origem por aplicativo	✅ Vigente
ADR-003	Tracker independente do app (arquivo separado)	Reusabilidade entre apps	✅ Vigente
ADR-004	Watchdog via Web Worker	Detecta trava real da main thread	✅ Vigente
ADR-005	Pause em visibilitychange	Evita falso positivo de throttling	✅ Vigente
ADR-006	SessionId persistido em localStorage	Sobrevive a reload	✅ Vigente
ADR-007	Heartbeat 30s + idle 5min	Equilíbrio entre granularidade e custo	✅ Vigente
ADR-008	Knowledge Base de 40 padrões	Diagnóstico instantâneo client-side	✅ Vigente
ADR-009	Sheets como banco temporário (Fase A)	Validação de mercado antes de migrar	✅ Vigente
ADR-010	Migração para Firebase apenas pós-MRR	ROI negativo de migração antecipada	✅ Vigente

🧠 PARTE 2: GOD MODE — O QUE FALTA
Status atual: 70% pronto. É observabilidade funcional, mas não é produto.

🔴 BLOQUEADORES (precisam ser feitos antes de qualquer outra coisa)
[GM-01] Limpeza do dev.js — código fora da IIFE

Problema: Bloco PWA + cortina + pause-on-hidden estão fora do })();
Risco: Variáveis vazam pro escopo global, comportamento imprevisível
Esforço: 10 min
Prioridade: 🔴 CRÍTICA — bloqueia testes confiáveis
[GM-02] Pause-on-hidden está no app errado

Problema: Foi colado no God Mode, deveria estar no Ponto
Risco: Lógica morta no God Mode + Ponto sem proteção
Esforço: 5 min (remover daqui, colar lá)
Prioridade: 🔴 CRÍTICA
[GM-03] Sistema de Login

Problema: God Mode é totalmente público; qualquer um com a URL acessa
Risco: Vazamento de logs de todos os clientes — gravíssimo em LGPD
Esforço: 2-3h
Decisão pendente: Multi-usuário? Níveis? OAuth ou senha?
Prioridade: 🔴 CRÍTICA
🟡 ALTAS PRIORIDADES
[GM-04] Sistema de Resolução de Erros

Problema: Logs ficam acumulando como ruído; impossível saber o que já foi resolvido
Solução: Status (Aberto/Reconhecido/Resolvido/Ignorado) + drawer de resolução + KB própria
Estrutura já desenhada: colunas H, I, J, K já adicionadas na planilha (status, resolvidoPor, resolucao, historico)
Esforço: 3-4h (backend + frontend + CSS)
Prioridade: 🟡 ALTA — impede uso real do God Mode
[GM-05] Action logEvent rejeitada pelo backend

Problema: Tracker manda action: 'logEvent', backend só aceita 'log'
Solução: Adicionar case 'logevent' no switch do doPost (Opção B)
Esforço: 5 min + redeploy
Status: ✅ Foi corrigido na sessão atual (você confirmou "deu certo")
[GM-06] KPI MTTR (Mean Time To Resolution)

Problema: Sem métrica de tempo médio de resolução, gestor não sabe performance
Solução: Calcular (timestamp_resolucao - timestamp_abertura) médio
Depende de: GM-04
Esforço: 30 min
Prioridade: 🟡 MÉDIA
🟢 NICE-TO-HAVE (depois)
[GM-07] Notificação push quando erro crítico chega

Web Push API + service worker
Esforço: 4-5h
Prioridade: 🟢 BAIXA (Fase B)
[GM-08] Filtro temporal (últimas 24h, 7d, 30d, custom)

UI de date range picker
Esforço: 2h
Prioridade: 🟢 BAIXA
[GM-09] Exportação de relatório PDF

jsPDF + template
Esforço: 3h
Prioridade: 🟢 BAIXA
[GM-10] Dashboard de saúde por cliente

Página dedicada por idCliente com gráficos
Esforço: 6-8h
Prioridade: 🟢 BAIXA
[GM-11] Bug do Unexpected token 'export'

Problema: Console mostra erro persistente
Origem: Confirmado que vem de extensão Chrome, não do código
Ação: Apenas documentar; é falso positivo
Prioridade: ⚫ IGNORAR
⏱️ PARTE 3: PONTO DIGITAL — O QUE FALTA
Status atual: 80% pronto funcionalmente, 20% pronto legalmente. NÃO PODE SER VENDIDO HOJE.

🔴 BLOQUEADORES LEGAIS (Portaria 671 do MTE)
[PT-01] Geração de AFD (Arquivo Fonte de Dados)

O que é: Arquivo texto fixo no formato exigido pela Portaria 671/2021
Sem isso: ILEGAL vender ponto eletrônico no Brasil
Esforço: 2-3 dias
Prioridade: 🔴 CRÍTICA — bloqueador de venda
[PT-02] Espelho de Ponto em PDF

O que é: Relatório mensal por funcionário, padrão MTE, com totalizadores
Sem isso: Funcionário não pode contestar/aprovar registros
Tecnologia: jsPDF
Esforço: 2 dias
Prioridade: 🔴 CRÍTICA
[PT-03] Assinatura eletrônica do espelho

O que é: Funcionário assina canvas no fim do mês, fica anexado ao PDF
Esforço: 1 dia
Prioridade: 🔴 CRÍTICA
[PT-04] Termo LGPD na primeira tela

O que é: Consentimento explícito antes de coletar selfie/GPS
Esforço: 4h
Prioridade: 🔴 CRÍTICA
🟡 BUGS/PENDÊNCIAS TÉCNICAS
[PT-05] App dispara ações com app fechado

Status: Em diagnóstico — você precisa identificar o que dispara (precisa observar God Mode com Ponto fechado por 15 min)
Hipótese: setInterval(syncDados, 5min) continua rodando em background
Solução: Pause-on-hidden + ajuste de _syncIntervalId
Esforço: 30 min após confirmação
Prioridade: 🟡 ALTA
[PT-06] Loop infinito esporádico no painel do gestor

Status: Causa raiz identificada (bug no Code.gs já corrigido)
Ação: Monitorar God Mode por 7 dias pra confirmar resolução
Prioridade: 🟡 MONITORAR
[PT-07] Frontend sem timeout em fetch

Problema: Se Apps Script trava, frontend fica spinner eterno
Solução: AbortController com 30s + alerta no God Mode
Esforço: 1h
Prioridade: 🟡 ALTA
🟢 DIFERENCIAIS COMPETITIVOS (depois de vender)
[PT-08] Geofencing dinâmico (polígono)

Gestor desenha área no mapa, não hardcoded
Tecnologia: Leaflet.js + algoritmo point-in-polygon
Esforço: 3-4 dias
Prioridade: 🟢 PÓS-VENDA
[PT-09] Liveness Detection (anti-foto)

Pede pra piscar/sorrir, evita fraude
Tecnologia: face-api.js
Esforço: 4-5 dias
Prioridade: 🟢 PÓS-VENDA
[PT-10] Banco de horas customizável

Regras por CNPJ (sábado 50%, banco 6 meses, etc.)
Esforço: 1 semana
Prioridade: 🟢 PÓS-VENDA
[PT-11] Notificação de atraso para gestor

Push web quando funcionário não bate ponto até X horário
Esforço: 2 dias
Prioridade: 🟢 PÓS-VENDA
📦 PARTE 4: ESTOQUE DIGITAL — O QUE FALTA
Status atual: Não auditado nesta sessão. Estimativa baseada no que conversamos.

🔴 BLOQUEADORES
[ES-01] Tracker.js não foi instalado

Status: Pendente da próxima sessão
Esforço: 30 min (copiar do Ponto, ajustar aplicativo: 'Estoque Digital')
Prioridade: 🔴 CRÍTICA — sem isso, não sabemos se Estoque tem bugs
[ES-02] Auditoria geral do código

Status: Você ainda não me mandou app.js do Estoque
Ação: Quando chegar a vez, fazer review completo
Prioridade: 🔴 ANTES DE MEXER NO RESTO
[ES-03] Termo LGPD

Mesmo que não colete selfie, coleta dados de operadores
Esforço: 2h
Prioridade: 🔴 CRÍTICA
🟡 FUNCIONALIDADES CORE
[ES-04] Importação de NFe via XML upload

Cliente arrasta XML, app extrai 50 itens
Esforço: 2-3 dias
Prioridade: 🟡 ALTA — vendável
[ES-05] Leitura contínua (modo caixa)

Câmera fica aberta, bipa em sequência
Tecnologia: BarcodeDetector API ou html5-qrcode
Esforço: 3 dias
Prioridade: 🟡 ALTA — diferencial
[ES-06] FIFO + controle de validade

Campos lote e dataValidade, alerta vencimento 30d
Esforço: 2-3 dias
Prioridade: 🟡 ALTA
[ES-07] Frontend sem timeout em fetch

Mesmo problema do Ponto (PT-07)
Esforço: 1h
Prioridade: 🟡 ALTA
🟢 DIFERENCIAIS
[ES-08] Algoritmo de ruptura preditiva

"Cabo Coaxial vai zerar amanhã, gerar pedido?"
Algoritmo simples: média móvel + desvio padrão
Esforço: 3-4 dias
Prioridade: 🟢 PÓS-VENDA
[ES-09] Bipa-confirma híbrido com NFe

Bipa código de barras da DANFE → pede XML
Esforço: 2 dias
Prioridade: 🟢 PÓS-VENDA
[ES-10] Email único de captura de XML

estoque-cliente@seuapp.com.br recebe XML automaticamente
Esforço: 1 semana (Fase B com Firebase)
Prioridade: 🟢 PÓS-VENDA
🌐 PARTE 5: TRANSVERSAIS (todos os apps)
[TR-01] Design System unificado
Tokens CSS compartilhados (cores, espaçamento, tipografia)
Componentes consistentes (botões, inputs, cards)
Esforço: 1 semana
Prioridade: 🟡 ALTA antes de vender
[TR-02] White-label
Cliente paga premium, troca cores e logo
CSS variables + tabela BRANDING por cliente
Esforço: 2-3 dias
Prioridade: 🟡 PÓS-VENDA
[TR-03] Onboarding self-service
Cliente novo se cadastra sozinho, recebe acesso por email
Esforço: 1 semana
Prioridade: 🟡 PRÉ-VENDA
[TR-04] Email transacional
SendGrid/MailerSend para recuperação de senha, alertas
Esforço: 1 dia
Prioridade: 🟡 PRÉ-VENDA
[TR-05] Documentação técnica (ARCHITECTURE.md)
README do repositório explicando arquitetura
Esforço: 4h
Prioridade: 🟢 IMPORTANTE — débito de manutenção
[TR-06] Versionamento de schema das planilhas
Tabela _SCHEMA_VERSION em cada Sheets
Migrations versionadas
Esforço: 2 dias
Prioridade: 🟢 IMPORTANTE pré-Firebase
📊 PARTE 6: RESUMO EXECUTIVO
Distribuição de esforço
App	Bloqueadores	Total estimado
God Mode	3 críticos + 3 altos	~10h
Ponto	4 legais + 3 técnicos	~3 semanas
Estoque	3 críticos + 4 altos	~3 semanas
Transversais	6 itens	~2 semanas
Caminho crítico (CPM)
Copy[GM-01,02] Limpeza dev.js  ──► [GM-03] Login  ──► [GM-04] Resolução
                                                          │
                                                          ▼
                                          [PT-04] LGPD ──► [PT-01,02,03] Compliance
                                                                │
                                                                ▼
                                          [ES-03] LGPD ──► [ES-04,05,06] Core Estoque
                                                                │
                                                                ▼
                                                      [TR-03,04] Pré-venda
                                                                │
                                                                ▼
                                                          🚀 LANÇAMENTO
Estimativa total até produto vendável
Otimista (você focado, sem distração): 6 semanas
Realista (vida acontecendo): 10 semanas
Pessimista (com refactor inesperado): 14 semanas
🎯 PARTE 7: ROADMAP SUGERIDO (ordem de execução)
🏁 SPRINT 0 — God Mode finalizado (1 sessão = 4-5h)
GM-01 (limpar dev.js) → 10 min
GM-02 (mover pause-on-hidden) → 5 min
GM-03 (login) → 2-3h
GM-04 (resolução de erros) → 2-3h
GM-06 (KPI MTTR) → 30 min
✅ Marco: God Mode é um produto vendável

🏁 SPRINT 1 — Ponto Compliance (1 semana)
ES-01 (instalar tracker no Estoque) → paralelo
PT-04 (LGPD)
PT-01 (AFD)
PT-02 (Espelho PDF)
PT-03 (Assinatura)
PT-05 (pause-on-hidden corrigido)
PT-07 (timeout em fetch)
✅ Marco: Ponto pode ser vendido legalmente

🏁 SPRINT 2 — Estoque Core (1 semana)
ES-02 (auditoria)
ES-03 (LGPD)
ES-04 (importar XML)
ES-05 (leitura contínua)
ES-06 (FIFO + validade)
ES-07 (timeout em fetch)
✅ Marco: Estoque pode ser vendido

🏁 SPRINT 3 — Transversais & Comercial (1 semana)
TR-01 (Design System)
TR-03 (Onboarding)
TR-04 (Email transacional)
TR-05 (Documentação)
Landing page
Asaas (pagamento)
Termo de uso + contrato
✅ Marco: 🚀 PRONTO PARA VENDER

🏁 SPRINT 4+ (PÓS-PRIMEIRA VENDA)
Diferenciais (Liveness, Geofencing, NFe inteligente)
White-label (TR-02)
Notificações push
Migração Firebase (quando dor aparecer)
