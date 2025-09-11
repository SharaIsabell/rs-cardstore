require('dotenv').config({ path: __dirname + './../.env' }); 
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    multipleStatements: true
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
  await connection.query(`USE \`${process.env.DB_NAME}\``);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL UNIQUE,
      telefone VARCHAR(20),
      endereco TEXT,
      senha_hash VARCHAR(255) NOT NULL,
      tipo ENUM('cliente', 'admin') DEFAULT 'cliente',
      email_verificado BOOLEAN DEFAULT FALSE,
      token_verificacao VARCHAR(255),
      token_verificacao_expira DATETIME,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS produtos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      descricao TEXT,
      preco DECIMAL(10, 2) NOT NULL,
      imagem_url VARCHAR(255),
      categoria ENUM('Magic', 'Yu-Gi-Oh', 'Pokemon', 'Acessorios') NOT NULL,
      estado ENUM('novo', 'usado') DEFAULT 'novo',
      promocao BOOLEAN DEFAULT FALSE,
      novo BOOLEAN DEFAULT FALSE,
      estoque INT DEFAULT 0,
      peso DECIMAL(10, 2) NOT NULL DEFAULT 0.1,
      largura INT NOT NULL DEFAULT 11,
      altura INT NOT NULL DEFAULT 2,
      comprimento INT NOT NULL DEFAULT 16
    );

    CREATE TABLE IF NOT EXISTS carrinhos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS carrinho_itens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      carrinho_id INT,
      produto_id INT,
      quantidade INT DEFAULT 1,
      FOREIGN KEY (carrinho_id) REFERENCES carrinhos(id) ON DELETE CASCADE,
      FOREIGN KEY (produto_id) REFERENCES produtos(id)
    );

    CREATE TABLE IF NOT EXISTS pedidos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      status ENUM('pendente', 'pago', 'enviado', 'entregue', 'cancelado') DEFAULT 'pendente',
      frete DECIMAL(10,2),
      total DECIMAL(10,2),
      codigo_rastreamento VARCHAR(100),
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pedido_itens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pedido_id INT,
      produto_id INT,
      quantidade INT,
      preco_unitario DECIMAL(10,2),
      FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
      FOREIGN KEY (produto_id) REFERENCES produtos(id)
    );

    CREATE TABLE IF NOT EXISTS pagamentos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pedido_id INT,
      metodo ENUM('credito', 'debito', 'pix'),
      status ENUM('aprovado', 'recusado'),
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fidelidade (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      compras_concluidas INT DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notas_fiscais (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pedido_id INT,
      link_arquivo VARCHAR(255),
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
    );
  `);

  console.log("Banco de dados e tabelas criados com sucesso!");
  await connection.end();
}

main().catch(err => console.error("Erro ao criar tabelas:", err));