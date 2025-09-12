const express = require('express');
const router = express.Router();
const db = require('../database/pooldb');

router.get('/', async (req, res) => {
  try {
    // 1. Busca os 2 produtos mais recentes marcados como "novo"
    const [novosProdutos] = await db.query(
      `SELECT id, nome, preco, desconto_percentual, imagem_url, novo, promocao
         FROM produtos
        WHERE novo = TRUE
     ORDER BY id DESC
        LIMIT 2`
    );

    // Pega os IDs dos produtos novos para não repeti-los na busca de promoções
    const idsIgnorados = novosProdutos.length > 0 ? novosProdutos.map(p => p.id) : [0];

    // 2. Busca os 2 produtos com o maior percentual de desconto (que não sejam os novos já selecionados)
    const [produtosEmPromocao] = await db.query(
      `SELECT id, nome, preco, desconto_percentual, imagem_url, novo, promocao
         FROM produtos
        WHERE desconto_percentual > 0 AND id NOT IN (?)
     ORDER BY desconto_percentual DESC
        LIMIT 2`,
      [idsIgnorados]
    );

    // 3. Junta os resultados das duas buscas em um único array
    const destaques = [...novosProdutos, ...produtosEmPromocao];

    // 4. Renderiza a página principal, enviando a lista de destaques
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

module.exports = router;