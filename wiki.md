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
