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
      
      senha_hash VARCHAR(255) NOT NULL,
      tipo ENUM('cliente', 'admin') DEFAULT 'cliente',
      email_verificado BOOLEAN DEFAULT FALSE,
      token_verificacao VARCHAR(255),
      token_verificacao_expira DATETIME,
      token_redefinicao_senha VARCHAR(255),
      token_redefinicao_expira DATETIME,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_verification_sent_at DATETIME NULL
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
      status ENUM('aprovado', 'recusado', 'pendente'), -- Modificado
      mp_payment_id VARCHAR(255), -- Adicionado
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

    /* --- ENDEREÇOS DO USUÁRIO --- */
    CREATE TABLE IF NOT EXISTS user_enderecos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      is_principal BOOLEAN DEFAULT FALSE,
      apelido VARCHAR(100) NOT NULL, /* Ex: 'Casa', 'Trabalho' */
      cep VARCHAR(9) NOT NULL,
      logradouro VARCHAR(255) NOT NULL,
      numero VARCHAR(20) NOT NULL,
      complemento VARCHAR(100) NULL,
      bairro VARCHAR(100) NOT NULL,
      cidade VARCHAR(100) NOT NULL,
      estado VARCHAR(2) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    /* --- FAVORITOS DO USUÁRIO --- */
    CREATE TABLE IF NOT EXISTS user_favoritos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      produto_id INT NOT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
      /* Garante que um usuário só possa favoritar um produto uma vez */
      UNIQUE KEY uk_user_produto (user_id, produto_id) 
    );
  `);

  // 1. Adiciona as colunas de endereço em 'pedidos' para guardar o histórico
  const colunasEnderecoPedidos = [
    { nome: 'endereco_cep', tipo: 'VARCHAR(9) NULL' }, { nome: 'endereco_rua', tipo: 'VARCHAR(255) NULL' },
    { nome: 'endereco_numero', tipo: 'VARCHAR(50) NULL' }, { nome: 'endereco_complemento', tipo: 'VARCHAR(100) NULL' },
    { nome: 'endereco_bairro', tipo: 'VARCHAR(100) NULL' }, { nome: 'endereco_cidade', tipo: 'VARCHAR(100) NULL' },
    { nome: 'endereco_estado', tipo: 'VARCHAR(2) NULL' },
    { nome: 'frete_metodo', tipo: 'VARCHAR(100) NULL' },
    { nome: 'prazo_entrega_dias', tipo: 'INT NULL' }
  ];
  for (const coluna of colunasEnderecoPedidos) {
    try {
      await connection.query(`ALTER TABLE pedidos ADD COLUMN ${coluna.nome} ${coluna.tipo};`);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') console.warn(`Aviso em 'pedidos':`, error.message);
    }
  }

  // 2. Remove a coluna antiga 'endereco' de 'users'
  try {
    await connection.query("ALTER TABLE users DROP COLUMN endereco;");
    console.log("Coluna 'endereco' removida de 'users' com sucesso.");
  } catch (error) {
    if (error.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
      console.warn("Aviso ao tentar remover a coluna 'endereco':", error.message);
    }
  }

  // 3. TENTA REMOVER as colunas de endereço estruturado de 'users' (agora estão em 'user_enderecos')
  const colunasEnderecoUsersAntigas = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado'];
  for (const colunaNome of colunasEnderecoUsersAntigas) {
    try {
      await connection.query(`ALTER TABLE users DROP COLUMN ${colunaNome};`);
      console.log(`Coluna '${colunaNome}' removida de 'users'.`);
    } catch (error) {
      if (error.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
         console.warn(`Aviso ao tentar remover '${colunaNome}' de 'users':`, error.message);
      }
    }
  }
  
  // 4. Garante que 'last_verification_sent_at' existe em 'users'
  try {
    await connection.query(
      "ALTER TABLE users ADD COLUMN last_verification_sent_at DATETIME NULL;"
    );
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') console.warn('[users] last_verification_sent_at:', e.message);
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

  console.log("Banco de dados e tabelas verificados/criados com sucesso!");
  await connection.end();
}

main().catch(err => console.error("Erro ao criar tabelas:", err));