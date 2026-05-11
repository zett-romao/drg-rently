# DRG-Rently — Prompt do Projeto

**Última atualização:** 2026-05-11
**Versão atual:** 0.1.0
**Estado:** Fase 1 completa em produção · próxima entrega: Fase 2 (Balancete)

> Documento serve como ponto de partida pra qualquer pessoa (ou IA) que vai
> retomar o projeto. Cole no início de uma conversa nova ou leia antes de
> mexer no código.

---

## 1. O que é

Sistema **SaaS B2B multi-tenant** pra **gestão de locações de imóveis residenciais
e comerciais**. Atende imobiliárias que administram imóveis de terceiros (locadores)
e os disponibilizam para inquilinos (locatários), com garantia (fiador / caução /
seguro fiança) e contrato vigente.

### Modelo de negócio

Mesmo codebase atende três modos:

- **A — Operação própria:** o dono opera como imobiliária; D.R. Global Imóveis
  é um tenant dentro do SaaS principal.
- **B — SaaS multi-cliente:** outras imobiliárias assinam plano; cada uma vira
  um tenant isolado. Cobrança hoje é manual (super-admin suspende/ativa pelo
  painel); Stripe/MP fica pra fase posterior.
- **C — Self-hosted (pen drive):** mesmo código distribuído pra cliente que
  prefere rodar no Firebase próprio. `firebase-config.template.js` está pronto
  pra esse caso.

### Fluxo operacional (negócio)

1. Locador assina autorização de administração → vira `locador` do tenant
2. Imobiliária capta locatário, examina ficha sócio-econômica → status `aprovado`
3. Define garantia: fiador / caução / seguro fiança
4. Contrato vincula os três + imóvel, prazo 6/12/24/36 meses
5. Multa rescisória padrão = 3× valor do aluguel (editável)
6. Taxa de administração padrão = 10% (editável por contrato)
7. Flag "1º aluguel para o escritório" quando a captação foi da imobiliária
8. Mensalmente: balancete por imóvel → PDF + envio ao locador *(Fase 2)*
9. Repasse do líquido via Pix *(Fase 4)*

---

## 2. Stack e infraestrutura

- **Frontend:** HTML/CSS/JS puro (sem framework). Paleta teal `#00897B` pra
  diferenciar visualmente do DRG-Kronos azul.
- **Firebase 10.7.1 compat:** Auth (e-mail/senha), Firestore, Storage. Plano
  Blaze com limite R$10/mês configurado.
- **Hosting em produção:** GitHub Pages em
  **`https://zett-romao.github.io/drg-rently/`**
- **Repo:** `github.com/zett-romao/drg-rently` (público desde 2026-05-11)
- **Pasta local:** `G:\Meu Drive\DRG-Rently\` (Google Drive sincronizado —
  pausar Sync antes de rename/move)

### Regiões

- Firestore: `southamerica-east1` (São Paulo)
- Storage: `US-EAST1` (sem custos; latência cross-region tolerável)

### Hardening aplicado em 2026-05-11

- Repo público com chave Firebase web (pública por design)
- HTTP Referrer restriction na Browser Key (Google Cloud Credentials):
  `https://zett-romao.github.io/*`, `http://localhost/*`, `http://127.0.0.1/*`
- Authorized domains no Firebase Auth incluem `zett-romao.github.io`
- GitHub Secret Protection + Push Protection habilitados
- Dependabot alerts/malware/security/grouped habilitados (sem efeito hoje
  porque não há `package.json`; preventivo para futuro)
- Private vulnerability reporting habilitado

---

## 3. Modelo de dados (Firestore)

### Top-level

- **`tenants/{tenantId}`** — imobiliárias cadastradas
  - Campos: `nome`, `cnpj`, `creci`, `plano` ('trial' | 'basic' | 'pro'),
    `ativo` (bool), `criadoEm`, `criadoPor`
- **`users/{uid}`** — usuários (uid = Firebase Auth uid)
  - Campos: `nome`, `email`, `tenantId` (ausente se super_admin),
    `role` ('admin' | 'operador' | 'super_admin'), `criadoEm`

### Subcoleções por tenant

- `tenants/{tenantId}/locadores/{id}` — proprietários, com:
  - PF/PJ, documento (canônico só dígitos), endereço estruturado,
    chave Pix, banco, observações
- `tenants/{tenantId}/locatarios/{id}` — inquilinos, com:
  - Ficha sócio-econômica (renda, empresa, cargo, admissão, dependentes,
    outros imóveis), status (`pendente_analise` | `aprovado` | `reprovado`)
- `tenants/{tenantId}/garantias/{id}` — campo `tipo`:
  - `fiador`: subobjeto `fiador` com nome, CPF, endereço, renda, bens,
    cônjuge (se casado)
  - `caucao`: subobjeto `caucao` com modalidade (dinheiro/imóvel/título),
    valor, banco, descrição do bem
  - `seguro_fianca`: subobjeto `seguro` com seguradora, apólice, vigência,
    cobertura, prêmio
- `tenants/{tenantId}/imoveis/{id}` — unidades sob administração, com:
  - Apelido, tipo (residencial/comercial), subtipo, vínculo `locadorId`,
    endereço, características (área, quartos, banheiros, vagas, mobiliado),
    matrícula, IPTU, valorMercado, aluguelSugerido, status
    (`disponivel` | `alugado` | `em_reforma` | `indisponivel`)
- `tenants/{tenantId}/contratos/{id}` — vínculo locador+locatário+imóvel+garantia, com:
  - Prazo (meses), datas, aluguel, dia vencimento, taxa adm %, multa rescisória,
    reajuste (índice + periodicidade), flag `primeiroAluguelEscritorio`,
    cláusulas, status (`rascunho` | `vigente` | `encerrado` | `rescindido`),
    motivoStatus

### Storage layout

```
/tenants/{tenantId}/locadores/{id}/{file}
/tenants/{tenantId}/locatarios/{id}/{file}
/tenants/{tenantId}/garantias/{id}/{file}
/tenants/{tenantId}/imoveis/{id}/{file}
/tenants/{tenantId}/contratos/{id}/{file}
```

### Regras Firestore (resumo)

- `users/{uid}`: leitura/escrita só pelo próprio uid (ou super_admin)
- `tenants/{tenantId}`: leitura pelo membro do tenant (ou super_admin);
  criação por qualquer signed in; update por admin do tenant
- `tenants/{tenantId}/{collection}/{doc}`: leitura/escrita pelo membro do
  tenant (ou super_admin)
- `userExists()` check antes de `userDoc()` para evitar quebra durante o
  signup (race condition resolvida)

Regras completas no `CLAUDE.md`.

---

## 4. Estado de entrega

### ✅ Fase 0 — Fundação multi-tenant
- Firebase Auth (e-mail/senha)
- Signup de tenant + admin (atômico via batch)
- Painel principal (sidebar + topbar + 8 módulos)
- Painel Super Admin com tabela de tenants e suspender/reativar
- Regras Firestore + Storage com isolamento por `tenantId`
- Bootstrap manual do super-admin

### ✅ Fase 1 — Cadastros (cinco módulos)

**1.1 — Locadores**
- CRUD PF/PJ, máscaras CPF/CNPJ/telefone/CEP com cursor preservado
- Validador algorítmico de CPF/CNPJ (real-time ✓/✗)
- ViaCEP autopreenche endereço
- BrasilAPI busca dados da Receita ao completar CNPJ válido
- Asterisco vermelho em obrigatórios
- Upload/listagem/exclusão de docs no Storage

**1.2 — Locatários**
- Mesma estrutura do Locador + ficha sócio-econômica:
  empresa, cargo, admissão, renda, dependentes, outros imóveis
- Status de aprovação (pendente/aprovado/reprovado) com badges
- Motivo da reprovação

**1.3 — Garantias**
- Tipo `fiador`: dados pessoais + endereço + análise financeira +
  cônjuge condicional (se casado/união estável)
- Tipo `caucao`: modalidade dinheiro/imóvel/título com campos específicos
- Tipo `seguro_fianca`: seguradora, apólice, vigência, cobertura, prêmio
- Status ativa/encerrada com badges
- Cadastro independente: mesma garantia pode ser reaproveitada em múltiplos contratos

**1.4 — Imóveis**
- Vínculo obrigatório ao Locador (select populado da subcoleção)
- 4 status com badges (disponível/alugado/em reforma/indisponível)
- Características: área, quartos, banheiros, vagas, mobiliado, andar
- Registros legais: matrícula RI, inscrição IPTU
- Valor mercado + aluguel sugerido
- Cache de locadores em memória, invalidado em save/delete

**1.5 — Contratos** (amarração final da Fase 1)
- 4 selects: imóvel, locador, locatário, garantia (opcional)
- Selecionar imóvel auto-preenche locador + aluguel sugerido + multa 3×
- Data fim calculada automaticamente a partir de início + prazo
- 4 status com badges (rascunho/vigente/encerrado/rescindido)
- Efeito colateral: status vigente → imóvel alugado; rescindido → imóvel disponível
- Excluir contrato vigente libera o imóvel
- Cláusulas extras, observações internas, motivo de rescisão

### 🔜 Próximas fases

**Fase 2 — Balancete mensal**
- Lançamentos do mês por imóvel: receitas extras (locador), despesas locador,
  despesas locatário
- Upload de comprovantes
- Fechamento → PDF do balancete + anexos
- Envio automático por e-mail ao locador (Cloud Function + Resend ou SendGrid)
- Cálculo: aluguel + receitas extras − despesas locador − taxa adm = líquido

**Fase 3 — Leitura automática do boleto do condomínio**
- Upload de PDF/imagem do boleto
- Cloudflare Worker novo (separado do `drg-gemini-proxy` do DRG-Kronos)
- Extrai valor, vencimento, beneficiário, linha digitável via Gemini Vision
- Operador confirma antes de gravar

**Fase 4 — Pix**
- Integração com PSP (a definir: Banco do Brasil, Itaú, Sicredi, Asaas, Efí, Cora)
- Transferência do líquido ao locador
- Fallback: copiar chave Pix + valor pra pagamento manual

**Pós-Fase 4 — Cobrança de assinatura**
- Stripe ou Mercado Pago
- Por enquanto, super-admin suspende/ativa manualmente pelo painel

---

## 5. Decisões importantes tomadas

- **Multi-tenant desde o início** — todo dado vive em `tenants/{tenantId}/...`,
  isolado por regras Firestore. Mesmo código atende A/B/C.
- **Repo público** — chave Firebase web é pública por design; proteção real
  vem das regras + HTTP referrer. Padrão idêntico ao DRG-Kronos.
- **Persistência canônica** — documento, telefone, CEP salvos só com dígitos;
  máscara reaplicada na exibição. Facilita futuras buscas/validações.
- **Cadastro de garantia independente** — fiador pode garantir múltiplos
  contratos. Contrato apenas referencia uma garantia existente.
- **Status do imóvel atualiza automaticamente** quando contrato muda de estado.
- **Super-admin sem `tenantId` atua no primeiro tenant ativo** (fallback simples).
  Suporte multi-tenant real (seletor "Atuar como") fica como TODO.
- **Cobrança manual no início** — Stripe/MP fica pra quando houver volume real.
- **Pix adiado pra Fase 4** — exige integração PSP com mTLS, conta jurídica;
  decisão de qual PSP usar fica pra avaliação da API por parte do usuário.

---

## 6. Credenciais e referências

- **Firebase Project ID:** `drg-rently`
- **Auth user super-admin:** `donizete@drglobal.com.br` (role `super_admin`,
  sem `tenantId`)
- **Tenant operacional:** "D.R. Global Imóveis" (CNPJ 49.698.112/000-157)
- **Conta GitHub:** `zett-romao`
- **E-mail técnico:** `zett.romao@gmail.com`

---

## 7. Estilo de comunicação que o usuário prefere

(Herdado do DRG-Kronos.)

- Português direto, sem rodeios
- Diagnósticos curtos antes de propor solução
- Passo a passo numerado quando há trabalho de UI
- Honestidade sobre risco e trade-offs ("isso pode quebrar X", "essa
  abordagem é hacky mas resolve")
- Confirmar antes de ações destrutivas (delete, force push, etc.)
- Não rodar comandos sem necessidade — terminal é caro de contexto
- Commits estilo conventional commits com escopo: `feat(modulo):`,
  `fix(modulo):`, `chore:`, `docs:` etc.
- Co-Authored-By no rodapé do commit

---

## 8. Como retomar em uma nova sessão

Use este prompt no início de uma conversa nova:

> Estou retomando o projeto **DRG-Rently** em `G:\Meu Drive\DRG-Rently\`.
> O `PROMPT_DO_PROJETO.md` na raiz tem o snapshot completo. O `CLAUDE.md`
> tem o detalhe técnico de manutenção. Leia ambos antes de fazer mudanças.
> Próxima entrega: Fase 2 (balancete mensal).

E o agente vai ter contexto suficiente pra continuar de onde parou.

---

## 9. Comandos úteis

```bash
# Verificar estado
git -C "G:/Meu Drive/DRG-Rently" status
git -C "G:/Meu Drive/DRG-Rently" log --oneline -10

# Padrão de commit (HEREDOC pra preservar formatação)
git -C "G:/Meu Drive/DRG-Rently" add <arquivos>
git -C "G:/Meu Drive/DRG-Rently" commit -m "$(cat <<'EOF'
feat(escopo): título curto

Corpo com bullets do que mudou.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git -C "G:/Meu Drive/DRG-Rently" push

# Bump de cache buster (?v=...) — necessário quando muda assets em produção
# Atualizar em index.html as queries strings dos <script> e <link>
```

---

## 10. Histórico de commits da Fase 0 + Fase 1

| Commit | Entrega |
|---|---|
| `c185c3d` | Estrutura inicial (Fase 0 — multi-tenant + auth) |
| `10abf5e` | Credenciais Firebase aplicadas |
| `e1da556` | Fix race condition signup + regras Firestore short-circuit-safe |
| `3b7542f` | Fase 1.1 — Locadores (validações, ViaCEP, BrasilAPI, máscaras) |
| `9cb661d` | Fase 1.2 — Locatários (ficha sócio-econômica + status aprovação) |
| `35cab63` | Fase 1.3 — Garantias (fiador, caução, seguro fiança) |
| `5127f2a` | Fase 1.4 — Imóveis (vínculo com Locador + 4 status) |
| `e3e8bc8` | Fase 1.5 — Contratos (amarra tudo + side-effects no imóvel) |
