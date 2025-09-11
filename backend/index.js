const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', { titulo: 'Página Inicial' });
});

router.get('/magic', (req, res) => {
    res.render('magic');
});

router.get('/yugioh', (req, res) => {
    res.render('yugioh');
});

router.get('/pokemon', (req, res) => {
    res.render('pokemon');
});

module.exports = router;