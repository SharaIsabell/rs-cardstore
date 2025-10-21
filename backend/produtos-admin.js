const express = require('express');
const router = express.Router();
const db = require('../database/pooldb'); 

// Middleware para garantir que o usuário é um admin com PIN validado
function requireAdminPin(req, res, next) {
  if (req.session && req.session.isAdmin && req.session.pinValidated) {
    return next();
  }
  return res.redirect('/admin/login');
}

router.use(requireAdminPin);

// Rota para listar todos os produtos
router.get('/', async (req, res) => {
  try {
    const [produtos] = await db.query('SELECT * FROM produtos ORDER BY id DESC');
    res.render('admin/produtos', { 
        produtos: produtos,
        adminEmail: req.session.adminEmail,
        message: req.query.message 
    });
  } catch (error) {
    console.error('Erro ao listar produtos:', error);
    res.status(500).send('Erro ao carregar a lista de produtos.');
  }
});

// Rota para exibir o formulário de adição 
router.get('/novo', (req, res) => {
  res.render('admin/produto-form', {
    adminEmail: req.session.adminEmail,
    produto: null,
    action: '/admin/produtos/novo',
    pageTitle: 'Cadastrar Novo Produto'
  });
});

// Rota para processar a adição de um novo produto
router.post('/novo', async (req, res) => {
  try {
    const { nome, descricao, preco, desconto_percentual, imagem_url, categoria, estoque, promocao, novo } = req.body;
    await db.query(
      `INSERT INTO produtos (nome, descricao, preco, desconto_percentual, imagem_url, categoria, estoque, promocao, novo) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nome, descricao, preco, desconto_percentual || 0, imagem_url, categoria, estoque, promocao === 'on', novo === 'on']
    );
    res.redirect('/admin/produtos?message=Produto criado com sucesso!');
  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).send('Erro ao salvar o novo produto.');
  }
});

// Rota para exibir o formulário de edição 
router.get('/editar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM produtos WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).send('Produto não encontrado.');
    }
    res.render('admin/produto-form', {
      adminEmail: req.session.adminEmail,
      produto: rows[0],
      action: `/admin/produtos/editar/${id}`,
      pageTitle: `Editando: ${rows[0].nome}`
    });
  } catch (error) {
    console.error('Erro ao buscar produto para edição:', error);
    res.status(500).send('Erro ao carregar o formulário de edição.');
  }
});

// Rota para processar a atualização de um produto 
router.post('/editar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, descricao, preco, desconto_percentual, imagem_url, categoria, estoque, promocao, novo } = req.body;
    await db.query(
      `UPDATE produtos 
       SET nome = ?, descricao = ?, preco = ?, desconto_percentual = ?, imagem_url = ?, 
           categoria = ?, estoque = ?, promocao = ?, novo = ? 
       WHERE id = ?`,
      [nome, descricao, preco, desconto_percentual || 0, imagem_url, categoria, estoque, promocao === 'on', novo === 'on', id]
    );
    res.redirect('/admin/produtos?message=Produto atualizado com sucesso!');
  } catch (error) {
    console.error('Erro ao atualizar produto:', error);
    res.status(500).send('Erro ao salvar as alterações do produto.');
  }
});

// Rota para remover um produto 
router.post('/remover/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM produtos WHERE id = ?', [id]);
    res.redirect('/admin/produtos?message=Produto removido com sucesso!');
  } catch (error) {
    console.error('Erro ao remover produto:', error);
    res.status(500).send('Erro ao remover o produto.');
  }
});

module.exports = { produtosAdminRouter: router };