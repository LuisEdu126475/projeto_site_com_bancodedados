# Maison Café · Site para cafeterias em duas versões

Site white-label para cafeterias de cafés especiais, feito para **levar o visitante a pedir e a visitar**:
botões e atalhos para **iFood, WhatsApp, Instagram e a loja** (endereço, horário e "Como chegar") em todas as telas,
cardápio com pedido montado no WhatsApp e reserva de mesa.

O mesmo projeto gera as **duas versões** que você vende:

| | **Sem banco** (mais barata) | **Com banco** (mais completa) |
| :--- | :--- | :--- |
| Hospedagem | Qualquer uma: Hostinger, Netlify, Cloudflare Pages (até grátis) | Servidor Node.js com disco (VPS, Render, Railway, Fly.io) |
| Canais iFood, WhatsApp, Instagram e loja | Sim | Sim |
| "Aberto agora" e horário de hoje em destaque | Sim (calculado no navegador) | Sim |
| Cardápio com pedido pelo WhatsApp | Sim | Sim |
| Reserva de mesa | Pelo WhatsApp, sem controle de vagas, com comprovante e lembrete na agenda | Com **controle real de vagas** por horário |
| Cliente consulta ou cancela a reserva pelo código | Não | Sim |
| Painel `/admin` (reservas, cardápio, auditoria, senha) | Não: mudanças passam por você | Sim: a equipe da cafeteria faz sozinha |
| Aviso de reserva nova no painel (som e destaque) | Não | Sim |
| Bloquear feriados e eventos pelo painel | Não (só no arquivo de configuração) | Sim |
| Gerado com | `npm run build:static` | `npm start` |

---

## Sumário

1. [Configurar uma cafeteria](#1-configurar-uma-cafeteria)
2. [Versão sem banco (estática)](#2-versão-sem-banco-estática)
3. [Versão com banco (servidor)](#3-versão-com-banco-servidor)
4. [Segurança](#4-segurança)
5. [Comandos](#5-comandos)
6. [Estrutura de pastas](#6-estrutura-de-pastas)
7. [Checklist antes de publicar](#7-checklist-antes-de-publicar)
8. [Roteiro comercial](#8-roteiro-comercial)

Pré-requisito: **Node.js 22.13 ou superior** (recomendado Node 24 LTS). Depois de baixar: `npm install`.

---

## 1. Configurar uma cafeteria

Tudo que muda de uma cafeteria para outra fica em **dois arquivos** (validados ao iniciar; se algo estiver errado, o sistema para e diz exatamente qual campo corrigir):

**[`config/site.config.js`](./config/site.config.js)**
- `brand`: nome, subtítulo, razão social, CNPJ, ano de fundação.
- `theme.preset`: `'noir'` (espresso escuro), `'terra'` (marrom e cobre) ou `'creme'` (claro). Cores exatas da marca em `theme.overrides`.
- `contact`: WhatsApp (só números, com 55), telefone, e-mail, endereço, link do Google Maps e os canais:
  - `ifood`: link da loja no iFood. **Apague a linha se a cafeteria não estiver no iFood**: os botões somem e o WhatsApp vira o botão principal.
  - `instagram`: link do perfil (o `@` aparece sozinho no site). Sem ele, a seção vira "O ambiente".
  - `onlineStore`: loja virtual de grãos/kits (opcional; aparece como mais uma opção na seção de canais).
- `hours`: horário de cada dia (`null` = fechado).
- `reservations`: vagas por horário, intervalo, maior grupo, experiências, datas fechadas. `enabled: false` tira a reserva do site.
- `content`: textos da abertura, faixa de destaques, "A casa", processo, fotos da galeria, título da seção de canais e depoimentos (**os que vêm no projeto são exemplos: troque ou apague**).

**[`config/cardapio.config.js`](./config/cardapio.config.js)**: categorias e itens, com preço em reais (`price: 24.5` = R$ 24,50).

Fotos: troque os arquivos em `public/images/` mantendo os nomes (ou ajuste os caminhos no `site.config.js`). Prefira JPG com até ~1400 px de largura.

---

## 2. Versão sem banco (estática)

```bash
npm run build:static -- --url=https://www.cafeteriadocliente.com.br
```

Cria a pasta `dist/` pronta para publicar: `index.html`, `privacidade.html`, CSS, JS, fontes, imagens, `robots.txt`, `sitemap.xml` e os arquivos de segurança.

- **Publicar:** envie todo o conteúdo de `dist/`, inclusive os ocultos `.htaccess` (Hostinger, Locaweb, HostGator, cPanel) e `_headers` (Netlify, Cloudflare Pages). Eles aplicam a mesma proteção do servidor (CSP, anti-clickjacking, HSTS).
- **Ver no computador:** dois cliques em `dist/index.html` (as fontes da marca funcionam também assim).
- **`--url`** é o endereço final do site: sem ele, a prévia do link no WhatsApp/Instagram e o Google ficam sem a imagem e o endereço certos (o gerador avisa).
- **Cardápio:** vem do `config/cardapio.config.js`. Para usar o cardápio editado no `/admin`, adicione `--db` (ou `--db=caminho/do/banco.db`); o banco original nunca é alterado.
- **Proteção contra perder trabalho:** se alguém editou arquivos de `dist/` à mão, o gerador para e lista o que mudou, sem apagar nada (`--force` substitui só essa pasta). Uma pasta com arquivos que não foram criados pelo gerador nunca é apagada, e as pastas do projeto (`public`, `src`, `config`, `data`...) são recusadas como saída. Se o build falhar no meio, o site anterior continua intacto. `--out=outra-pasta` gera em outro lugar (ex.: `--out=clientes/cafe-aurora`).
- **Amostra de vendas:** `--demo` mantém o painel "Personalizar demonstração" (nome, cidade, tema e modelos de cardápio ao vivo).

---

## 3. Versão com banco (servidor)

```bash
npm run setup   # cria .env, banco, cardápio inicial e o admin de demonstração
npm start       # http://localhost:3000  ·  painel em /admin
```

O `setup` cria o acesso `admin@croma.cafe` e mostra a senha no terminal (só para testes no seu computador). Para o cliente:

```bash
npm run admin:create -- --email=dono@cafeteria.com.br --password="SenhaForteDaCasa2026!" --name="Nome do Dono"
```

O que a equipe da cafeteria ganha no `/admin`:
- **Reservas** com filtros, confirmação em 1 clique, mensagem pronta no WhatsApp e exportação CSV. O painel **confere sozinho a cada 30 segundos**: reserva nova toca um aviso sonoro (pode desligar), aparece destacada e o título da aba mostra "(1) Nova reserva".
- **Datas fechadas:** bloquear feriados, eventos ou reformas; nesses dias o site deixa de oferecer horários. Se já houver reservas no dia, o painel avisa quantas.
- **Cardápio:** criar, editar, pausar e excluir itens e categorias. (O `cardapio.config.js` só preenche o banco na primeira vez; categorias excluídas no painel não voltam sozinhas.)
- **Auditoria** (só proprietário) e **troca de senha**.

O cliente final consulta ou cancela a própria reserva no site com **código + WhatsApp** usados na reserva (os dois precisam bater).

### Publicar no servidor

1. Variáveis (veja [`.env.example`](./.env.example)):
   - `NODE_ENV=production`
   - `PUBLIC_URL=https://www.seudominio.com.br`
   - `TRUST_PROXY=1` **sempre que houver Cloudflare, Nginx, Render ou Railway na frente** (com 0, todos os visitantes parecem ter o mesmo IP e os limites anti-abuso bloqueiam clientes de verdade; o servidor avisa no log)
   - `FORCE_HTTPS=true` (exige `PUBLIC_URL`: o redirecionamento sempre vai para esse domínio)
   - `DEMO_MODE=false`
   - `IP_HASH_SECRET=<segredo aleatório de 48+ caracteres>`
   - `DATABASE_PATH=/var/data/cafe.db` (volume persistente)
2. `npm ci --omit=dev && npm run db:migrate && npm run admin:create -- --email=... --password=...`
3. Inicie com `node src/server.js` (systemd, PM2 ou container).
4. Agende: backup diário (`npm run db:backup`) e retenção LGPD semanal (`npm run lgpd:purge`).

**Nunca envie a pasta `data/` do seu computador para o servidor do cliente.** Ela tem a senha de demonstração; por segurança, em produção o servidor se recusa a subir se algum admin ainda usar essa senha.

---

## 4. Segurança

- Consultas 100% parametrizadas; tabelas `STRICT` com `CHECK`; reserva e checagem de vaga na mesma transação `BEGIN IMMEDIATE` (sem overbooking).
- Senhas com `scrypt` (N = 2^17) em **fila de no máximo 2 cálculos simultâneos** (uma rajada de logins não derruba uma VPS pequena; excesso recebe "servidor ocupado").
- **Bloqueio de login em camadas:** 5 erros em 15 min travam só aquela conexão por 15 min; 30 erros em 1 h na conta (somando todas as conexões) restringem o login por 30 min aos **aparelhos que já entraram antes**. Um ataque espalhado em muitos IPs é contido e, mesmo assim, o dono continua entrando do aparelho de sempre. A tentativa é contada antes de conferir a senha (requisições simultâneas não furam o limite) e e-mails inexistentes se comportam igual (não revela quais contas existem).
- Sessão em cookie `HttpOnly`/`SameSite=Strict` (`__Host-` em produção), guardada só como hash; CSRF em duas camadas (origem + token).
- Redefinir senha pelo terminal (`admin:create`) **derruba as sessões abertas**, esquece os aparelhos conhecidos, limpa bloqueios e fica registrado na auditoria.
- `audit_log` não pode ser editado **nem apagado** (triggers no SQLite).
- CSP estrita sem scripts/estilos inline nem CDNs; os mesmos cabeçalhos vão em `_headers`/`.htaccess` na versão estática.
- LGPD: consentimento com versão da política, IP só como HMAC, anonimização automática após o prazo, e política de privacidade com texto próprio para cada versão.

---

## 5. Comandos

| Comando | O que faz |
| :--- | :--- |
| `npm run build:static` | Gera o site sem banco em `dist/` (`--url`, `--out`, `--db`, `--demo`, `--force`) |
| `npm run setup` | Prepara o ambiente de testes (`.env`, banco, cardápio, reservas e admin de demonstração) |
| `npm start` / `npm run dev` | Inicia o servidor (o `dev` reinicia ao editar `src/` ou `config/`) |
| `npm run admin:create` | Cria um administrador ou redefine a senha (encerra as sessões abertas) |
| `npm run db:migrate` | Aplica migrações pendentes |
| `npm run db:seed` | Cardápio e reservas de demonstração em banco vazio |
| `npm run db:backup` | Backup consistente do banco em `backups/` |
| `npm run lgpd:purge` | Anonimiza reservas antigas (prazo em `legal.retentionDays`) |
| `npm test` / `npm run check` | Testes automatizados / lint + testes |

---

## 6. Estrutura de pastas

```text
config/
  site.config.js        identidade, canais (iFood, Instagram, loja), horários, textos
  cardapio.config.js    cardápio (fonte da versão estática e carga inicial do banco)
public/                 CSS, JS, fontes e imagens
scripts/                setup, build-static, create-admin, backup, migrate, seed, lgpd
src/
  config/               validação do .env, do site.config.js e do cardápio
  db/migrations/        001 esquema · 002 segurança (auditoria, bloqueio de login) · 003 datas fechadas
  routes/               páginas, API pública e API do painel
  services/             disponibilidade, reservas (inclui consulta/cancelamento) e autenticação
  utils/                canais, datas no fuso da loja, criptografia, tema
  views/                páginas EJS e partes (cabeçalho, rodapé, ícones)
tests/                  api, security, features e storefront (node:test)
```

---

## 7. Checklist antes de publicar

- [ ] Nome, CNPJ, endereço, WhatsApp e link do Maps da cafeteria em `site.config.js`
- [ ] Link do iFood e do Instagram (ou linhas apagadas se não tiver)
- [ ] Fotos reais em `public/images/` e depoimentos reais (ou `testimonials: []`)
- [ ] Cardápio e preços em `cardapio.config.js` (ou no `/admin`)
- [ ] Estática: gerada com `--url=` do domínio final e enviada com `.htaccess`/`_headers`
- [ ] Com banco: `NODE_ENV=production`, `PUBLIC_URL`, `TRUST_PROXY`, `DEMO_MODE=false`, admin com senha própria, sem copiar `data/`

---

## 8. Roteiro comercial

**Na reunião (5 minutos), no celular do dono:**
1. Mostre a abertura com "Aberto agora" e os botões **Pedir no iFood** e **Pedir pelo WhatsApp**; role até "Como você quer seu café hoje?" e toque em cada canal.
2. Monte um pedido no cardápio e mostre a mensagem pronta chegando no WhatsApp.
3. Mostre a barra fixa do celular (iFood, WhatsApp, Instagram, Como chegar).
4. **Versão com banco:** faça uma reserva, mostre o comprovante, depois abra o `/admin` e mostre o aviso de reserva nova, a confirmação em 1 clique e o bloqueio de um feriado. Para gerar uma amostra estática com o painel de personalização: `npm run build:static -- --demo --out=amostra`.

**Sugestão de preço** (ajuste à sua região):
- **Sem banco:** implantação de R$ 800 a R$ 1.500, mais R$ 49 a R$ 99/mês se você hospedar e fizer as alterações.
- **Com banco:** implantação de R$ 2.000 a R$ 2.800, mais R$ 149 a R$ 249/mês (servidor, backups e suporte).
