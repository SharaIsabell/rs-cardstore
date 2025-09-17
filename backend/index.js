const express = require('express');
const router = express.Router();
const db = require('../database/pooldb');

const bcrypt = require('bcryptjs'); // Importa a biblioteca para hashing de senha
const bodyParser = require('body-parser');

const crypto = require('crypto');
const { enviarEmailVerificacao } = require('../frontend/js/enviarEmail');
const session = require('express-session'); // Importe o express-session !!!

// Configura o body-parser para ler dados de formulários
router.use(bodyParser.urlencoded({ extended: true }));

router.use(session({
  secret: 'seu-segredo-super-secreto-aqui',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } 
}));

router.use((req, res, next) => {
  res.locals.session = req.session;
  next();

});

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

// Rota GET para a página de login
router.get('/login', (req, res) => {
    let message = '';
    if (req.query.status === 'verificado') {
        message = 'E-mail verificado com sucesso! Você já pode fazer o login.';
    }
    res.render('login', { message }); 
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

    const token_verificacao = crypto.randomBytes(32).toString('hex');
    const token_verificacao_expira = new Date(Date.now() + 5 * 60 * 1000);

    const [result] = await db.query(
      'INSERT INTO users (nome, email, telefone, endereco, senha_hash, token_verificacao, token_verificacao_expira) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nome, email, telefone, endereco, senha_hash, token_verificacao, token_verificacao_expira]
    );

    await enviarEmailVerificacao(email, token_verificacao);

    res.status(201).send('Cadastro realizado com sucesso! Por favor, verifique seu e-mail.');

  } catch (error) {
    console.error('ERRO DETALHADO AO CADASTRAR:', error); 
    res.status(500).send('Ocorreu um erro no servidor ao tentar realizar o cadastro.');
  }
});

router.get('/verificar-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send('Token de verificação não fornecido.');
    }

    const [users] = await db.query(
      'SELECT * FROM users WHERE token_verificacao = ? AND token_verificacao_expira > NOW()',
      [token]
    );

    if (users.length === 0) {
      return res.status(400).send('Token de verificação inválido ou expirado.');
    }

    const user = users[0];

    await db.query(
      'UPDATE users SET email_verificado = TRUE, token_verificacao = NULL, token_verificacao_expira = NULL WHERE id = ?',
      [user.id]
    );

    res.redirect('/login?status=verificado');

  } catch (error) {
    console.error('ERRO AO VERIFICAR E-MAIL:', error);
    res.status(500).send('Ocorreu um erro no servidor ao tentar verificar o e-mail.');
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

    if (!user.email_verificado) {
        return res.status(403).send('Por favor, verifique seu e-mail antes de fazer o login. Um novo link foi enviado.');
    }

    if (!senhaCorreta) {
      return res.status(401).send('E-mail ou senha inválidos.');
    }
    
    req.session.userId = user.id;
    req.session.userName = user.nome;

    res.redirect('/');

  } catch (error) {
    console.error('ERRO DETALHADO AO FAZER LOGIN:', error);
    res.status(500).send('Ocorreu um erro no servidor ao tentar fazer login.');
  }
});

router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Não foi possível fazer logout.');
        }
        res.redirect('/');
    });
});

const checarVerificado = async (req, res, next) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).send('Você precisa estar logado para finalizar uma compra.');
  }

  try {
    const [users] = await db.query('SELECT email_verificado FROM users WHERE id = ?', [userId]);

    if (users.length === 0 || !users[0].email_verificado) {
      return res.status(403).send('Você precisa verificar seu e-mail antes de finalizar uma compra.');
    }

    next();
  } catch (error) {
    console.error('ERRO AO CHECAR VERIFICAÇÃO:', error);
    res.status(500).send('Ocorreu um erro no servidor.');
  }
};

module.exports = router;