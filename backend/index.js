const express = require('express');
const router = express.Router();
const db = require('../database/pooldb');

const bcrypt = require('bcryptjs'); // Importa a biblioteca para hashing de senha
const bodyParser = require('body-parser');

// Configura o body-parser para ler dados de formulários
router.use(bodyParser.urlencoded({ extended: true }));

router.get('/', (req, res) => {
  res.render('index', { titulo: 'Página Inicial' });
});

router.get('/', async (req, res) => {
  try {
    // Busca os 2 produtos mais recentes marcados como "novo"
    const [novosProdutos] = await db.query(
      `SELECT id, nome, preco, desconto_percentual, imagem_url, novo, promocao
         FROM produtos
        WHERE novo = TRUE
     ORDER BY id DESC
        LIMIT 2`
    );

    // Pega os IDs dos produtos novos para não repeti-los na busca de promoções
    const idsIgnorados = novosProdutos.length > 0 ? novosProdutos.map(p => p.id) : [0];

    // Busca os 2 produtos com o maior percentual de desconto (que não sejam os novos já selecionados)
    const [produtosEmPromocao] = await db.query(
      `SELECT id, nome, preco, desconto_percentual, imagem_url, novo, promocao
         FROM produtos
        WHERE desconto_percentual > 0 AND id NOT IN (?)
     ORDER BY desconto_percentual DESC
        LIMIT 2`,
      [idsIgnorados]
    );

    // Junta os resultados das duas buscas em um único array
    const destaques = [...novosProdutos, ...produtosEmPromocao];

    // Renderiza a página principal, enviando a lista de destaques
    res.render('index', { destaques: destaques });

  } catch (err) {
    console.error("Erro ao carregar destaques da página inicial:", err);
    // Em caso de erro, renderiza a página sem os destaques para não quebrar o site
    res.render('index', { destaques: [] });
  }
});

router.get('/magic', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo 
         FROM produtos 
        WHERE categoria = ? 
     ORDER BY id DESC`,
      ['Magic']
    );

    res.render('magic', { produtos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao carregar produtos de Magic.');
  }
});

router.get('/yugioh', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo 
         FROM produtos
        WHERE categoria = ?
     ORDER BY id DESC`,
      ['Yu-Gi-Oh'] // atenção ao ENUM: exatamente "Yu-Gi-Oh"
    );

    res.render('yugioh', { produtos: rows });
  } catch (err) {
    console.error('Erro ao consultar produtos Yu-Gi-Oh:', err);
    res.status(500).send('Erro ao carregar produtos de Yu-Gi-Oh.');
  }
});

router.get('/pokemon', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo 
         FROM produtos
        WHERE categoria = ?
     ORDER BY id DESC`,
      ['Pokemon']
    );

    res.render('pokemon', { produtos: rows });
  } catch (err) {
    console.error('Erro ao consultar produtos Pokémon:', err);
    res.status(500).send('Erro ao carregar produtos de Pokémon.');
  }
});

router.get('/produto/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, imagem_url, categoria, estoque 
         FROM produtos 
        WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).send('Produto não encontrado.');
    }

    res.render('produto', { produto: rows[0] });
  } catch (err) {
    console.error('Erro ao carregar o produto:', err);
    res.status(500).send('Erro ao carregar a página do produto.');
  }
});


router.get('/acessorios', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo 
         FROM produtos 
        WHERE categoria = ? 
     ORDER BY id DESC`,
      ['Acessorios'] 
    );

    res.render('acessorios', { produtos: rows }); 
  } catch (err) {
    console.error('Erro ao carregar produtos de Acessórios:', err);
    res.status(500).send('Erro ao carregar a página de acessórios.');
  }
});

router.get('/promocoes', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nome, descricao, preco, desconto_percentual, imagem_url, promocao, novo 
         FROM produtos 
        WHERE promocao = ? 
     ORDER BY id DESC`,
      [true]
    );

    res.render('promocoes', { produtos: rows });
  } catch (err) {
    console.error('Erro ao carregar produtos em promoção:', err);
    res.status(500).send('Erro ao carregar a página de promoções.');
  }
});

router.get('/login', (req, res) => {
    res.render('login');
});

// Rota POST para registrar um novo usuário
router.post('/register', async (req, res) => {
  const { nome, email, telefone, endereco, senha, confirmSenha } = req.body;

  if (senha !== confirmSenha) {
    return res.status(400).send('As senhas não coincidem.');
  }

  if (senha.length < 8 || !/\d/.test(senha) || !/[a-zA-Z]/.test(senha)) {
      return res.status(400).send('A senha deve ter no mínimo 8 caracteres, incluindo letras e números.');
  }

  try {
    const [existingUser] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
        return res.status(409).send('Este e-mail já está cadastrado.');
    }

    const salt = await bcrypt.genSalt(10);
    const senha_hash = await bcrypt.hash(senha, salt);

    await db.query(
      'INSERT INTO users (nome, email, telefone, endereco, senha_hash) VALUES (?, ?, ?, ?, ?)',
      [nome, email, telefone, endereco, senha_hash]
    );

    res.status(201).send('Cadastro realizado com sucesso! Por favor, verifique seu e-mail.');

  } catch (error) {
    console.error('ERRO DETALHADO AO CADASTRAR:', error); 
    res.status(500).send('Ocorreu um erro no servidor ao tentar realizar o cadastro.');
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    if (users.length === 0) {
      return res.status(401).send('E-mail ou senha inválidos.');
    }

    const user = users[0];

    const senhaCorreta = await bcrypt.compare(senha, user.senha_hash);

    if (!senhaCorreta) {
      return res.status(401).send('E-mail ou senha inválidos.');
    }
    
    res.status(200).send(`Login bem-sucedido! Bem-vindo, ${user.nome}.`);

  } catch (error) {
    console.error('ERRO DETALHADO AO FAZER LOGIN:', error);
    res.status(500).send('Ocorreu um erro no servidor ao tentar fazer login.');
  }
});

module.exports = router;