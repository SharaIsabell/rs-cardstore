# RS Card Store (E-commerce TCG)

Bem-vindo ao **RS Card Store**, um sistema completo de comércio eletrônico focado em Trading Card Games (Magic, Yu-Gi-Oh, Pokémon).

Este projeto foi desenvolvido com foco em **portabilidade e facilidade de execução**. Ele está totalmente containerizado (Docker), garantindo que funcione em qualquer máquina sem a necessidade de configurações complexas de ambiente. Porém, também oferecemos suporte completo para instalação manual para desenvolvedores.

---

## Tecnologias Utilizadas

O projeto foi construído utilizando uma arquitetura robusta baseada em **Node.js** e **MySQL**. Abaixo, detalhamos as ferramentas e bibliotecas principais:

### Core & Backend
* **Node.js (v18+)**: Ambiente de execução JavaScript.
* **Express.js**: Framework web para gerenciamento de rotas e servidor.
* **MySQL 8**: Banco de dados relacional para persistência de dados (usuários, produtos, pedidos).
* **EJS (Embedded JavaScript)**: Motor de visualização para renderizar o HTML no servidor (Server-Side Rendering).

### Bibliotecas e Dependências (NPM)
* **Autenticação & Segurança:**
    * `bcryptjs`: Criptografia de senhas.
    * `express-session`: Gerenciamento de sessões de login.
    * `uuid`: Geração de identificadores únicos.
* **Banco de Dados:**
    * `mysql2`: Driver moderno e compatível com Promises para conexão com MySQL.
* **Integrações & Funcionalidades:**
    * `mercadopago`: SDK oficial para processamento de pagamentos.
    * `axios`: Cliente HTTP para requisições externas (APIs de frete, etc).
    * `nodemailer`: Envio de e-mails transacionais (recuperação de senha, confirmação de compra).
    * `puppeteer`: Geração de PDFs (para etiquetas ou relatórios).
    * `json2csv`: Exportação de dados para planilhas.
* **Utililitários:**
    * `dotenv`: Gerenciamento de variáveis de ambiente.
    * `body-parser`: Processamento de dados de formulários.
* **DevOps:**
    * **Docker & Docker Compose**: Para containerização e orquestração de serviços.

---

## Instalação Rápida (Via Docker) - **Recomendado**

Esta é a forma mais simples de rodar o projeto. Você **não precisa** ter Node.js ou MySQL instalados na sua máquina, apenas o Docker.

### Pré-requisitos
* **Docker Desktop** instalado e em execução.

### Passo a Passo

1.  Acesse [https://docs.docker.com/desktop/](https://docs.docker.com/desktop/) e instale o Docker desktop de acordo com seu sistema operacional.
2.  **CERTIFIQUE-SE** que seu Docker foi instalado.
3.  Abra o Docker Desktop (faça as operações necessárias para ir até a página Inicial).
4.  Volta para o explorador de arquivos (ou aplicativo de arquivos do seu Sistema operacional).
5.  **Descompacte** a pasta do projeto.
6.  Abra o terminal na pasta raiz do projeto (Você pode abrir a pasta e apertar com o botão direito em algum espaço vazio para acessar o Terminal).
7.  Execute o comando:
    ```bash
    docker-compose up --build
    ```
8.  **Aguarde a inicialização.**
    * *Nota:* Na primeira vez, o Docker baixará as imagens e instalará as dependências, o que pode levar alguns minutos.
    * O script `db.js` rodará automaticamente para criar o banco e inserir os produtos.
9.  Quando aparecer `Server running on port 3000`, acesse:
    * **Loja:** [http://localhost:3000](http://localhost:3000)

---

## Instalação Manual (Para Desenvolvedores)

Caso você queira rodar o projeto diretamente na sua máquina (sem Docker) para fins de desenvolvimento ou debug, siga rigorosamente os passos abaixo.

### Pré-requisitos
* **Node.js** (Versão 16 ou superior).
* **MySQL Server** rodando localmente.
* **Git** (opcional, caso vá clonar).

### Passo a Passo Detalhado

#### 1. Instalar Dependências
Abra o terminal na pasta do projeto e execute:
```bash
npm install
```

#### 2. Configurar Variáveis de Ambiente
O projeto precisa saber a senha do seu banco de dados.
1. Crie um arquivo chamado `.env` na raiz do projeto (baseie-se no `.env.example`).

2. Preencha com suas configurações locais:
```bash
# Arquivo .env
DB_HOST=localhost
DB_USER=root
DB_PASS=SUA_SENHA_DO_MYSQL  <-- Coloque a senha do seu MySQL aqui
DB_NAME=loja_tcg
PORT=3000
```
#### 3. Configurar o Banco de Dados
Não é necessário criar as tabelas manualmente. Temos um script que faz isso. Execute:
```bash
npm run setup
```
Se o comando acima não funcionar (dependendo do seu terminal), use:
```bash
node db.js
```
*Isso criará o banco loja_tcg, todas as tabelas e inserirá os produtos de exemplo.*

#### 4. Iniciar o Servidor
Agora, inicie a aplicação:
```bash
npm start
```
*Para modo de desenvolvimento (com reinicialização automática):*
```bash
npm run dev
```

## Credenciais de Acesso (Admin)
O sistema verifica se é a primeira execução e cria um administrador padrão automaticamente.

URL do Admin: [http://localhost:3000/admin/login](http://localhost:3000/admin/login)

E-mail: admin@rscardstore.com

Senha: adminrs123

PIN de Segurança: Será exibido no terminal na hora do login (simulação de 2FA).

## Como Parar a Execução
No Terminal: Pressione `Ctrl + C`.

Se estiver usando Docker: Para remover os containers e limpar a memória, execute:
```bash
docker-compose down
```
