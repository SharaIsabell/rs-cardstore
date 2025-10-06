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
      desconto_percentual DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
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

  const colunasEnderecoUsers = [
    { nome: 'cep', tipo: 'VARCHAR(9) NULL' }, { nome: 'logradouro', tipo: 'VARCHAR(255) NULL' },
    { nome: 'numero', tipo: 'VARCHAR(20) NULL' }, { nome: 'complemento', tipo: 'VARCHAR(100) NULL' },
    { nome: 'bairro', tipo: 'VARCHAR(100) NULL' }, { nome: 'cidade', tipo: 'VARCHAR(100) NULL' },
    { nome: 'estado', tipo: 'VARCHAR(2) NULL' }
  ];
  for (const coluna of colunasEnderecoUsers) {
    try {
      await connection.query(`ALTER TABLE users ADD COLUMN ${coluna.nome} ${coluna.tipo};`);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') console.warn(`Aviso em 'users':`, error.message);
    }
  }

  const colunasEnderecoPedidos = [
    { nome: 'endereco_cep', tipo: 'VARCHAR(9) NULL' }, { nome: 'endereco_rua', tipo: 'VARCHAR(255) NULL' },
    { nome: 'endereco_numero', tipo: 'VARCHAR(50) NULL' }, { nome: 'endereco_complemento', tipo: 'VARCHAR(100) NULL' },
    { nome: 'endereco_bairro', tipo: 'VARCHAR(100) NULL' }, { nome: 'endereco_cidade', tipo: 'VARCHAR(100) NULL' },
    { nome: 'endereco_estado', tipo: 'VARCHAR(2) NULL' }
  ];
  for (const coluna of colunasEnderecoPedidos) {
    try {
      await connection.query(`ALTER TABLE pedidos ADD COLUMN ${coluna.nome} ${coluna.tipo};`);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') console.warn(`Aviso em 'pedidos':`, error.message);
    }
  }
  
  try {
    await connection.query("ALTER TABLE users DROP COLUMN endereco;");
    console.log("Coluna 'endereco' removida de 'users' com sucesso.");
  } catch (error) {
    if (error.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
      console.warn("Aviso ao tentar remover a coluna 'endereco':", error.message);
    }
  }

  // --- ALTERAÇÕES NA TABELA PAGAMENTOS ---
  try {
      await connection.query("ALTER TABLE pagamentos MODIFY COLUMN status ENUM('aprovado', 'recusado', 'pendente');");
      await connection.query("ALTER TABLE pagamentos ADD COLUMN mp_payment_id VARCHAR(255);");
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME' && error.code !== 'ER_DUP_COLUMN_NAME') {
        console.warn("Aviso ao rodar ALTER TABLE:", error.message);
      }
  }

  console.log("Banco de dados e tabelas criados com sucesso!");
  await connection.end();
}

main().catch(err => console.error("Erro ao criar tabelas:", err));