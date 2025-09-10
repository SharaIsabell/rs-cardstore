const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', { titulo: 'Página Inicial' });
});

module.exports = router;