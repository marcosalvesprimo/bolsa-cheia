# Bolsa Cheia

App de finanças da família baseado em *O Homem Mais Rico da Babilônia*. Funciona no navegador, pode ser instalado no celular, abre sem internet e sincroniza os dois aparelhos por um arquivo no Google Drive.

Este guia tem três partes:

1. [Criar as chaves no Google Cloud](#1-google-cloud) (uns 20 minutos, uma vez só)
2. [Publicar o app no GitHub Pages](#2-github-pages) (uns 10 minutos, uma vez só)
3. [Começar a usar nos dois celulares](#3-usando-nos-dois-celulares)

No fim há uma seção de [problemas comuns](#problemas-comuns).

> **Dá para usar sem nada disso?** Dá. Sem as chaves, o app funciona só no aparelho, sem sincronizar. As partes 1 e 2 servem para os dois celulares enxergarem os mesmos dados.

---

## 1. Google Cloud

O app precisa de três informações do Google: um **ID do cliente OAuth** (para o login), uma **chave de API** (para o seletor de arquivos do Drive) e o **número do projeto**. Tudo é gratuito.

Faça tudo com **a sua conta Google** (a mesma que vai guardar o arquivo da família). O painel pode estar em português ou inglês. Os nomes em inglês estão entre parênteses.

### 1.1 Criar o projeto

1. Abra <https://console.cloud.google.com> e aceite os termos, se for o primeiro acesso.
2. No topo, clique no seletor de projetos e depois em **Novo projeto** (*New project*).
3. Nome: `Bolsa Cheia`. Clique em **Criar**.
4. Confira no topo da tela se o projeto **Bolsa Cheia** está selecionado.
5. Anote o **Número do projeto** (*Project number*, só dígitos). Ele aparece no cartão "Informações do projeto" da página inicial do console, ou em **IAM e administrador > Configurações** (*IAM & Admin > Settings*). É o `appId`.

### 1.2 Ativar as duas APIs

1. Menu ☰ > **APIs e serviços > Biblioteca** (*APIs & Services > Library*).
2. Procure **Google Drive API**, abra e clique em **Ativar** (*Enable*).
3. Volte à Biblioteca, procure **Google Picker API** e clique em **Ativar**.

### 1.3 Tela de consentimento (o que aparece no login)

1. Menu ☰ > **Plataforma de autenticação do Google** (*Google Auth Platform*). Se aparecer, clique em **Começar** (*Get started*).
2. **Informações do app:** nome `Bolsa Cheia` e o seu e-mail como e-mail de suporte.
3. **Público-alvo** (*Audience*): escolha **Externo** (*External*).
4. **Informações de contato:** o seu e-mail.
5. Aceite a política de dados de usuário e clique em **Criar**.
6. Vá em **Público-alvo** (*Audience*). Em **Usuários de teste** (*Test users*), clique em **Adicionar usuários** e inclua **o seu Gmail e o do seu cônjuge**.
7. Vá em **Acesso a dados** (*Data Access*) > **Adicionar ou remover escopos** e marque `.../auth/drive.file` ("Ver, editar, criar e excluir apenas os arquivos específicos do Google Drive que você usa com este app"). Salve.

Esse escopo é o mais restrito que o Google oferece para o Drive: **o app só enxerga o arquivo que ele mesmo criou ou que vocês escolherem no seletor**. O resto do Drive fica inacessível para ele.

> **Modo de teste:** enquanto o app estiver "Em teste", o Google mostra um aviso de "app não verificado" no login (clique em **Continuar**, o app é de vocês) e a autorização vence a cada 7 dias (basta entrar de novo). Depois que tudo estiver funcionando, dá para tirar esse aviso em **Público-alvo > Publicar app** (*Publish app*). Como o `drive.file` não é um escopo sensível, em geral não é exigida verificação. Se o Google pedir, é só continuar no modo de teste.

### 1.4 ID do cliente OAuth

Você vai precisar do endereço do app no GitHub, que é `https://SEU-USUARIO.github.io` (veja a parte 2). Se ainda não tiver conta no GitHub, escolha o nome de usuário agora e volte aqui depois para completar.

1. Em **Plataforma de autenticação do Google > Clientes** (*Clients*), clique em **Criar cliente** (*Create client*).
2. Tipo de aplicativo: **Aplicativo da Web** (*Web application*). Nome: `Bolsa Cheia web`.
3. Em **Origens JavaScript autorizadas** (*Authorized JavaScript origins*), adicione:
   - `https://SEU-USUARIO.github.io` (sem barra no fim e sem o `/bolsa-cheia`)
   - `http://localhost:8080` (para testar no computador)
4. **URIs de redirecionamento** (*Redirect URIs*): deixe vazio.
5. Clique em **Criar** e copie o **ID do cliente** (termina em `.apps.googleusercontent.com`). É o `clientId`.

As mudanças nas origens podem levar alguns minutos para valer.

### 1.5 Chave de API

1. Menu ☰ > **APIs e serviços > Credenciais** (*Credentials*) > **Criar credenciais > Chave de API** (*API key*).
2. Copie a chave. É o `apiKey`.
3. Clique em **Editar chave de API** (ou no nome da chave) para restringi-la:
   - **Restrições do aplicativo:** **Sites** (*Websites / HTTP referrers*). Adicione:
     - `https://SEU-USUARIO.github.io/*`
     - `http://localhost:8080/*`
     - `https://docs.google.com/*` (o seletor do Drive roda nesse endereço)
   - **Restrições de API:** **Restringir chave** e marque **Google Picker API** e **Google Drive API**.
4. Salve.

### 1.6 Colocar as chaves no app

Abra o arquivo `config.js` e preencha:

```js
export default {
  clientId: '123456789-abc...apps.googleusercontent.com',
  apiKey: 'AIza...',
  appId: '123456789012',
};
```

Esses três valores não são senhas. Eles ficam visíveis no código de qualquer site que usa login do Google. A proteção vem das restrições feitas acima: só os endereços autorizados podem usá-los. Mesmo assim, não use essas chaves em outros projetos.

> Alternativa: em vez de editar o arquivo, cole os três valores no app em **Ajustes > Google Drive > Chaves do Google Cloud**. Isso vale só para o aparelho onde você colou.

---

## 2. GitHub Pages

O GitHub Pages hospeda o app de graça, com HTTPS (obrigatório para instalar no celular e para o login do Google).

**O repositório fica público, mas só com o código.** Os dados da família nunca vão para o GitHub. Eles ficam no aparelho e no arquivo do seu Google Drive.

### 2.1 Criar o repositório

1. Crie uma conta em <https://github.com> (se ainda não tiver). O nome de usuário vira o endereço: `https://SEU-USUARIO.github.io`.
2. Clique em **+ > New repository**.
3. Nome: `bolsa-cheia`. Visibilidade: **Public**. Clique em **Create repository**.

### 2.2 Enviar os arquivos

1. Na página do repositório, clique em **uploading an existing file** (ou **Add file > Upload files**).
2. Arraste **estes arquivos e a pasta `icons`**:

   ```
   index.html   styles.css   app.js   store.js   drive.js   importar.js
   config.js    lessons.js   sw.js    manifest.webmanifest
   icons/       (a pasta inteira, com os 5 ícones)
   ```

   Não precisa enviar `PROGRESSO.md`, `LEIAME.md` nem a pasta `.claude` (mas não faz mal se enviar).
3. Clique em **Commit changes**.

### 2.3 Ligar o site

1. No repositório: **Settings > Pages**.
2. Em **Build and deployment > Source**, escolha **Deploy from a branch**.
3. Branch: **main**, pasta **/ (root)**. Clique em **Save**.
4. Espere 1 a 2 minutos e recarregue a página. Aparece o endereço: `https://SEU-USUARIO.github.io/bolsa-cheia/`.

### 2.4 Atualizar o app depois

Quando algum arquivo mudar, envie de novo só os arquivos alterados (**Add file > Upload files**, que substitui os antigos). Com internet, os celulares pegam a versão nova sozinhos na próxima vez que o app abrir.

---

## 3. Usando nos dois celulares

### Primeiro celular (quem cria o arquivo)

1. Abra `https://SEU-USUARIO.github.io/bolsa-cheia/` no **Chrome** (Android) ou no **Safari** (iPhone).
2. Toque em **Começar agora**, informe os nomes e o percentual para guardar.
3. Vá em **Ajustes > Google Drive > Criar arquivo da família** e entre com a sua conta Google. O app cria `bolsa-cheia-familia.json` no seu Drive.
4. Ainda em Ajustes, em **Compartilhar com o cônjuge**, digite o Gmail do cônjuge e toque em **Compartilhar**. A pessoa recebe um e-mail do Google.
5. Instale o app: **Ajustes > Instalar no celular** (no Android aparece um botão; no iPhone, siga as instruções que aparecem ali).

### Segundo celular (quem recebeu o compartilhamento)

1. Abra o mesmo endereço.
2. Toque em **Entrar na conta da família** e depois em **Entrar com o Google e escolher o arquivo**.
3. No seletor do Drive, escolha `bolsa-cheia-familia.json` (fica na aba dos arquivos compartilhados com você).
4. Escolha quem você é na lista de nomes.
5. Instale o app, como no primeiro celular.

### Como a sincronia funciona

- Tudo o que vocês lançam fica salvo **primeiro no aparelho**. Funciona sem internet.
- Com internet e login ativo, o app junta os dados com o arquivo do Drive poucos segundos depois de cada mudança e sempre que é aberto.
- O login do Google dura cerca de **1 hora**. Depois disso, o botão no topo muda para **Entrar no Google**: toque nele para sincronizar de novo. Nada se perde nesse meio-tempo.
- Se os dois mexerem no mesmo lançamento, vale a alteração mais recente. Lançamentos diferentes feitos ao mesmo tempo nunca se sobrescrevem.

### Importar extratos e faturas (sem custo)

Na aba **Importar**, há dois caminhos. Os dois terminam numa tela de revisão, e **nada entra no app antes de você tocar em "Lançar"**.

1. **Extrato em OFX, CSV ou planilha (Excel):** o app lê na hora, no próprio aparelho, e nada sai dele. No internet banking, procure "exportar extrato" e escolha OFX (ou CSV/Excel). Do Asaas, use a planilha do extrato. A categoria é sugerida por palavras-chave (ex.: "ATACADÃO" → Mercado).
2. **Fatura em PDF ou print:** use o Claude da sua assinatura.
   - Toque em **Copiar instruções**.
   - No app do Claude, anexe o PDF ou print, cole as instruções e envie.
   - Copie a resposta do Claude e cole no campo do Bolsa Cheia. Depois toque em **Ler resposta**.

   Dica: crie um **Projeto** no Claude com essas instruções. Aí basta anexar e enviar. Não tem custo extra, mas usa o limite da assinatura.

Outras regras:
- **O app aprende:** quando você troca a classificação de um item na revisão, a mesma descrição já vem classificada assim nas próximas importações. Isso vale para os dois aparelhos, porque sincroniza pelo Drive.
- **Extrato e fatura juntos:** o pagamento da fatura que aparece no extrato fica de fora, para as compras do cartão não contarem duas vezes. Transferências entre contas de vocês (inclusive saques do Asaas para a sua conta) também ficam de fora. Aplicações viram "guardar" na caixinha de reserva.
- O app avisa quando um item parece já ter sido lançado (mesmo tipo e valor, até 3 dias de diferença) e quando o mesmo arquivo já foi importado antes.
- PDF com senha (comum em fatura do Banco do Brasil): se o Claude não conseguir abrir, abra no aparelho, use **Imprimir > Salvar como PDF** e envie a cópia sem senha, ou mande um print da fatura.
- Estornos entram como despesa com valor negativo e abatem o gasto da categoria.

### Cópia de segurança

Em **Ajustes > Cópia de segurança > Exportar**, o app baixa um arquivo com todos os dados. Vale fazer de vez em quando. **Importar** junta um backup com os dados atuais, sem apagar nada.

---

## Testar no computador

Não é preciso instalar nada. Na pasta do projeto, rode no PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\serve.ps1
```

E abra <http://localhost:8080>. Para o login do Google funcionar aqui, `http://localhost:8080` precisa estar nas origens do cliente OAuth e nos sites da chave de API (itens 1.4 e 1.5).

---

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| `Erro 400: origin_mismatch` ou `redirect_uri_mismatch` no login | O endereço do app não está nas **Origens JavaScript autorizadas** (item 1.4). Confira `https://SEU-USUARIO.github.io` sem barra no fim. Depois de salvar, espere alguns minutos. |
| `Erro 403: access_denied` ou "o app está em teste" | O e-mail não está nos **Usuários de teste** (item 1.3, passo 6). |
| "O Google não verificou este app" | Normal no modo de teste. Toque em **Avançado/Continuar**. Para tirar o aviso, veja a nota do item 1.3. |
| O seletor do Drive abre em branco ou dá erro de chave | Confira na chave de API (item 1.5) os três sites, incluindo `https://docs.google.com/*`, e se as duas APIs estão marcadas e ativadas (item 1.2). |
| O seletor não mostra o arquivo compartilhado | Confira se o compartilhamento foi feito para o mesmo Gmail que entrou no app. O arquivo fica na aba de arquivos compartilhados do seletor. |
| Nada acontece ao tocar em "Entrar no Google" | O navegador bloqueou a janela de login. Permita pop-ups para o endereço do app. |
| No iPhone, o login não volta para o app instalado | O iOS limita janelas de login em apps instalados na tela de início. Faça a sincronia abrindo o endereço direto no Safari; os dados são os mesmos. |
| "Arquivo não encontrado no Drive" | O arquivo foi apagado ou o compartilhamento foi removido. Em **Ajustes > Google Drive**, desconecte e conecte de novo (criar um novo ou abrir o compartilhado). Os dados do aparelho continuam lá. |
| O app instalado não atualizou | Feche e abra o app com internet. Se continuar igual, espere alguns minutos: o GitHub Pages pode demorar para publicar. |

---

As lições do app são um resumo com nossas palavras de *O Homem Mais Rico da Babilônia*, de George S. Clason.
