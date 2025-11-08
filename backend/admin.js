const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/pooldb');
const { enviarEmailStatusPedido } = require('../frontend/js/enviarEmail');
const { produtosAdminRouter } = require('./produtos-admin');
const { Parser } = require('json2csv');
const puppeteer = require('puppeteer');

function requireAdminLogin(req, res, next) {
  if (!(req.session && req.session.isAdmin)) {
    return res.redirect('/admin/login');
  }
  next();
}

function requireAdminPin(req, res, next) {
  if (!(req.session && req.session.isAdmin)) {
    return res.redirect('/admin/login');
  }
  if (!req.session.pinValidated) {
    return res.redirect('/admin/pin');
  }
  next();
}

// ======================================================
// ROTAS: RELATÓRIOS (US Implementada) ---
// ======================================================

/**
 * Helper para gerar os filtros de data para as queries de relatório
 * @param {string} periodoQuery - O valor de req.query.periodo (ex: 'hoje', 'semana', 'mes')
 * @returns {object} { sql: string, params: Array }
 */
function getReportDateFilter(periodoQuery) {
    let whereClause = "WHERE p.status IN ('pago', 'enviado', 'entregue') ";
    const params = [];

    const hoje = new Date().toISOString().split('T')[0];

    switch (periodoQuery) {
        case 'hoje':
            whereClause += "AND DATE(p.criado_em) = ? ";
            params.push(hoje);
            break;
        case 'semana':
            // Pega os últimos 7 dias
            whereClause += "AND p.criado_em >= CURDATE() - INTERVAL 7 DAY ";
            break;
        case 'mes':
            // Pega os últimos 30 dias
            whereClause += "AND p.criado_em >= CURDATE() - INTERVAL 30 DAY ";
            break;
        case 'mes_atual':
            // Pega o mês corrente (ex: 1 a 30 de Novembro)
            whereClause += "AND YEAR(p.criado_em) = YEAR(CURDATE()) AND MONTH(p.criado_em) = MONTH(CURDATE()) ";
            break;
        default:
            // Padrão: Mês atual
            whereClause += "AND YEAR(p.criado_em) = YEAR(CURDATE()) AND MONTH(p.criado_em) = MONTH(CURDATE()) ";
            break;
    }
    return { whereClause, params };
}

// Rota principal para EXIBIR os relatórios (AC1, AC2, AC3)
router.get('/relatorios', requireAdminPin, async (req, res) => {
    try {
        const periodo = req.query.periodo || 'mes_atual'; // Padrão
        const { whereClause, params } = getReportDateFilter(periodo);

        // 1. Receita Total (AC2)
        const [[receitaData]] = await db.query(
            `SELECT 
                SUM(p.total) as receitaTotal, 
                COUNT(p.id) as numPedidos
             FROM pedidos p
             ${whereClause}`,
            params
        );

        // 2. Produtos mais vendidos (Quantidade) (AC3)
        const [maisVendidosQtd] = await db.query(
            `SELECT 
                prod.nome,
                SUM(pi.quantidade) as totalQuantidade
             FROM pedido_itens pi
             JOIN pedidos p ON pi.pedido_id = p.id
             JOIN produtos prod ON pi.produto_id = prod.id
             ${whereClause}
             GROUP BY prod.id, prod.nome
             ORDER BY totalQuantidade DESC
             LIMIT 10`,
            params
        );

        // 3. Produtos mais vendidos (Valor) (AC3)
        const [maisVendidosValor] = await db.query(
            `SELECT 
                prod.nome,
                SUM(pi.quantidade * pi.preco_unitario) as totalValor
             FROM pedido_itens pi
             JOIN pedidos p ON pi.pedido_id = p.id
             JOIN produtos prod ON pi.produto_id = prod.id
             ${whereClause}
             GROUP BY prod.id, prod.nome
             ORDER BY totalValor DESC
             LIMIT 10`,
            params
        );
        
        res.render('admin/relatorios', {
            adminEmail: req.session.adminEmail,
            receitaData,
            maisVendidosQtd,
            maisVendidosValor,
            periodoSelecionado: periodo
        });

    } catch (error) {
        console.error("Erro ao gerar relatórios:", error);
        res.redirect('/admin?error=relatorios');
    }
});

// Rota para EXPORTAR o relatório (PDF)
router.get('/relatorios/exportar/pdf', requireAdminPin, async (req, res) => {
    try {
        const periodo = req.query.periodo || 'mes_atual';
        const { whereClause, params } = getReportDateFilter(periodo);

        // 1. Busca os dados
        const [[receitaData]] = await db.query(
            `SELECT SUM(p.total) as receitaTotal, COUNT(p.id) as numPedidos FROM pedidos p ${whereClause}`,
            params
        );
        const [maisVendidosQtd] = await db.query(
            `SELECT prod.nome, SUM(pi.quantidade) as totalQuantidade FROM pedido_itens pi JOIN pedidos p ON pi.pedido_id = p.id JOIN produtos prod ON pi.produto_id = prod.id ${whereClause} GROUP BY prod.id, prod.nome ORDER BY totalQuantidade DESC LIMIT 10`,
            params
        );
        const [maisVendidosValor] = await db.query(
            `SELECT prod.nome, SUM(pi.quantidade * pi.preco_unitario) as totalValor FROM pedido_itens pi JOIN pedidos p ON pi.pedido_id = p.id JOIN produtos prod ON pi.produto_id = prod.id ${whereClause} GROUP BY prod.id, prod.nome ORDER BY totalValor DESC LIMIT 10`,
            params
        );

        // 2. Renderiza o template EJS específico para PDF
        const data = {
            receitaData,
            maisVendidosQtd,
            maisVendidosValor,
            periodoSelecionado: periodo
        };

        res.render('admin/relatorio-pdf', data, async (err, html) => {
            if (err) {
                console.error("Erro ao renderizar template PDF:", err);
                return res.redirect('/admin/relatorios?error=pdf-render');
            }

            let browser;
            try {
                // 3. Inicia o Puppeteer
                browser = await puppeteer.launch({
                    headless: 'new', 
                    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
                });
                
                const page = await browser.newPage();
                
                // 4. Define o conteúdo da página
                await page.setContent(html, { waitUntil: 'networkidle0' });
                
                // 5. Gera o PDF
                const pdfBuffer = await page.pdf({
                    format: 'A4',
                    printBackground: true, 
                    margin: {
                        top: '20px',
                        right: '20px',
                        bottom: '20px',
                        left: '20px'
                    }
                });
                
                await browser.close();

                // 6. Envia o PDF como resposta
                const fileName = `relatorio-vendas-${periodo}-${new Date().toISOString().split('T')[0]}.pdf`;
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
                res.send(pdfBuffer);

            } catch (pdfError) {
                console.error("Erro ao gerar PDF com Puppeteer:", pdfError);
                if (browser) await browser.close();
                res.redirect('/admin/relatorios?error=pdf-generate');
            }
        });

    } catch (error) {
        console.error("Erro ao buscar dados para PDF:", error);
        res.redirect('/admin/relatorios?error=pdf-data');
    }
});

// Rota para EXPORTAR o relatório (AC4)
router.get('/relatorios/exportar/csv', requireAdminPin, async (req, res) => {
    try {
        const periodo = req.query.periodo || 'mes_atual';
        const { whereClause, params } = getReportDateFilter(periodo);

        // 1. Busca os dados
        const [[receitaData]] = await db.query(`SELECT SUM(p.total) as receitaTotal, COUNT(p.id) as numPedidos FROM pedidos p ${whereClause}`, params);
        const [maisVendidosQtd] = await db.query(`SELECT prod.nome, SUM(pi.quantidade) as totalQuantidade FROM pedido_itens pi JOIN pedidos p ON pi.pedido_id = p.id JOIN produtos prod ON pi.produto_id = prod.id ${whereClause} GROUP BY prod.id, prod.nome ORDER BY totalQuantidade DESC LIMIT 10`, params);
        const [maisVendidosValor] = await db.query(`SELECT prod.nome, SUM(pi.quantidade * pi.preco_unitario) as totalValor FROM pedido_itens pi JOIN pedidos p ON pi.pedido_id = p.id JOIN produtos prod ON pi.produto_id = prod.id ${whereClause} GROUP BY prod.id, prod.nome ORDER BY totalValor DESC LIMIT 10`, params);

        // 2. Formata os dados para o CSV
        const dataParaCsv = [];

        // Prepara os arrays de dados formatados
        const resumoArray = [
            { chave: 'Receita Total', valor: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(receitaData.receitaTotal || 0) },
            { chave: 'Total de Pedidos', valor: receitaData.numPedidos || 0 }
        ];

        const maisVendidosValorFormatado = maisVendidosValor.map(item => ({
            nome: item.nome,
            totalValor: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.totalValor || 0)
        }));

        // Define os nomes das colunas
        const headers = {
            resumoChave: 'Resumo (Chave)',
            resumoValor: 'Resumo (Valor)',
            spacer1: ' ', // Coluna vazia
            topQtdNome: 'Top 10 (Quantidade)',
            topQtdValor: 'Qtd.',
            spacer2: '  ', // Coluna vazia (com 2 espaços para ser única)
            topValorNome: 'Top 10 (Valor)',
            topValorValor: 'Receita (R$)'
        };

        const numRows = Math.max(resumoArray.length, maisVendidosQtd.length, maisVendidosValorFormatado.length, 10);

        // 3. Mescla os dados em um único array 
        for (let i = 0; i < numRows; i++) {
            const row = {};

            row[headers.resumoChave] = resumoArray[i] ? resumoArray[i].chave : '';
            row[headers.resumoValor] = resumoArray[i] ? resumoArray[i].valor : '';

            row[headers.spacer1] = '';

            row[headers.topQtdNome] = maisVendidosQtd[i] ? maisVendidosQtd[i].nome : '';
            row[headers.topQtdValor] = maisVendidosQtd[i] ? maisVendidosQtd[i].totalQuantidade : '';

            row[headers.spacer2] = '';
            
            row[headers.topValorNome] = maisVendidosValorFormatado[i] ? maisVendidosValorFormatado[i].nome : '';
            row[headers.topValorValor] = maisVendidosValorFormatado[i] ? maisVendidosValorFormatado[i].totalValor : '';

            dataParaCsv.push(row);
        }

        // 4. Define os campos para o Parser na ordem correta
        const fields = [
            headers.resumoChave,
            headers.resumoValor,
            headers.spacer1,
            headers.topQtdNome,
            headers.topQtdValor,
            headers.spacer2,
            headers.topValorNome,
            headers.topValorValor
        ];

        const parser = new Parser({ fields });
        const csv = parser.parse(dataParaCsv);

        res.header('Content-Type', 'text/csv; charset=utf-8');
        res.attachment(`relatorio-vendas-${periodo}-${new Date().toISOString().split('T')[0]}.csv`);
        // Adiciona um BOM para o Excel entender UTF-8 corretamente
        res.send('\ufeff' + csv);

    } catch (error) {
        console.error("Erro ao exportar CSV:", error);
        res.redirect('/admin/relatorios?error=export');
    }
});

/* Utilitário de PIN */
const PIN_LEN = parseInt(process.env.ADMIN_PIN_LENGTH || '6', 10);
function generatePin(len = PIN_LEN) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
}

// Tela de login 
router.get('/login', (req, res) => {
  res.render('login', { message: null, errorMessage: null });
});

// Autenticação do admin
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    // Busca admin no BD (MySQL)
    const [rows] = await db.query(
      'SELECT id, email, senha_hash FROM admins WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      return res
        .status(401)
        .render('login', { message: null, errorMessage: 'E-mail ou senha inválidos.' });
    }

    const admin = rows[0];
    const ok = await bcrypt.compare(senha, admin.senha_hash);
    if (!ok) {
      return res
        .status(401)
        .render('login', { message: null, errorMessage: 'E-mail ou senha inválidos.' });
    }

    // Seta sessão de admin e força fluxo do PIN
    req.session.isAdmin = true;
    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    req.session.pinValidated = false;
    req.session.adminPin = generatePin();

    return res.redirect('/admin/pin');
  } catch (e) {
    console.error('[admin] login error:', e);
    return res
      .status(500)
      .render('login', { message: null, errorMessage: 'Erro ao autenticar.' });
  }
});

// Tela do PIN
router.get('/pin', requireAdminLogin, (req, res) => {
  const pin = req.session.adminPin || generatePin();
  req.session.adminPin = pin; // garante que existe
  return res.render('admin/pin', {
    adminEmail: req.session.adminEmail,
    pin,
    pinLen: String(pin).length,
    errorMessage: null
  });
});

// Valida o PIN
router.post('/pin', requireAdminLogin, (req, res) => {
  const { pin } = req.body;

  if (!pin || pin !== String(req.session.adminPin)) {
    return res.status(400).render('admin/pin', {
      adminEmail: req.session.adminEmail,
      pin: req.session.adminPin,
      pinLen: String(req.session.adminPin || '').length,
      errorMessage: 'PIN inválido.'
    });

  }

  req.session.pinValidated = true;
  return res.redirect('/admin');
});

// Dashboard (somente admin com PIN validado)
router.get('/', requireAdminPin, async (req, res) => {
  try {
    // Busca produtos com 5 ou menos unidades em estoque para exibir no painel
    const [notificacoesEstoque] = await db.query(
      `SELECT id, nome, estoque 
         FROM produtos 
        WHERE estoque <= 5 
     ORDER BY estoque ASC, nome ASC`
    );

    return res.render('admin/dashboard', { 
      adminEmail: req.session.adminEmail,
      notificacoesEstoque: notificacoesEstoque // Passa a lista de produtos para o template
    });

  } catch (error) {
    console.error("Erro ao carregar o dashboard do admin:", error);
    // Em caso de erro, renderiza o dashboard sem as notificações para não quebrar a página
    return res.render('admin/dashboard', { 
      adminEmail: req.session.adminEmail,
      notificacoesEstoque: [] 
    });
  }
});

// Rota para LISTAR todos os pedidos
router.get('/pedidos', requireAdminPin, async (req, res) => {
    try {
        const [pedidos] = await db.query(
            `SELECT 
                p.id, p.status, p.total, 
                DATE_FORMAT(p.criado_em, '%d/%m/%Y %H:%i') as data_formatada,
                u.nome as user_nome, u.email as user_email
             FROM pedidos p
             JOIN users u ON p.user_id = u.id
             ORDER BY p.criado_em DESC`
        );
        
        // Mapeia os status para exibição
        const statusMap = {
            'pendente': 'Pendente',
            'pago': 'Pago',
            'enviado': 'Enviado',
            'entregue': 'Entregue',
            'cancelado': 'Cancelado'
        };

        res.render('admin/pedidos', { 
            pedidos, 
            statusMap,
            message: req.query.message,
            adminEmail: req.session.adminEmail 
        });
    } catch (error) {
        console.error("Erro ao carregar lista de pedidos:", error);
        res.redirect('/admin?error=pedidos');
    }
});

// Rota para ver/editar UM pedido
router.get('/pedidos/:id', requireAdminPin, async (req, res) => {
    try {
        const pedidoId = req.params.id;
        const [[pedido]] = await db.query(
            `SELECT 
                p.*, 
                DATE_FORMAT(p.criado_em, '%d/%m/%Y %H:%i') as data_formatada,
                u.nome as user_nome, u.email as user_email
             FROM pedidos p
             JOIN users u ON p.user_id = u.id
             WHERE p.id = ?`,
            [pedidoId]
        );

        if (!pedido) {
            return res.status(404).redirect('/admin/pedidos');
        }

        const [itens] = await db.query(
            `SELECT pi.*, prod.nome 
             FROM pedido_itens pi
             JOIN produtos prod ON pi.produto_id = prod.id
             WHERE pi.pedido_id = ?`,
            [pedidoId]
        );

        const allStatus = ['pendente', 'pago', 'enviado', 'entregue', 'cancelado'];

        res.render('admin/pedido-detalhe', {
            pedido,
            itens,
            allStatus,
            adminEmail: req.session.adminEmail
        });
    } catch (error) {
        console.error(`Erro ao carregar pedido ${req.params.id}:`, error);
        res.redirect('/admin/pedidos');
    }
});

// Rota para ATUALIZAR o pedido
router.post('/pedidos/:id', requireAdminPin, async (req, res) => {
     const pedidoId = req.params.id;
     const { status: novoStatus, codigo_rastreamento } = req.body;
     const connection = await db.getConnection(); // Usar conexão para garantir consistência
 
     try {
         await connection.beginTransaction();
 
         // 1. Busca o status ATUAL e os dados do cliente ANTES de atualizar
         const [[pedidoAtual]] = await connection.query(
             `SELECT p.status, u.email, u.nome
              FROM pedidos p
              JOIN users u ON p.user_id = u.id
              WHERE p.id = ? FOR UPDATE`, // Lock para evitar condição de corrida
             [pedidoId]
         );
 
         if (!pedidoAtual) {
             await connection.rollback();
             return res.redirect('/admin/pedidos?message=Erro: Pedido não encontrado.');
         }
 
         // Se o status não for 'enviado', limpa o código de rastreio
         const codigoFinal = (novoStatus === 'enviado') ? codigo_rastreamento : null;
 
         // 2. Atualiza o pedido no banco
         await connection.query(
             `UPDATE pedidos
              SET status = ?, codigo_rastreamento = ?
              WHERE id = ?`,
             [novoStatus, codigoFinal, pedidoId]
         );
 
         await connection.commit(); // Confirma a atualização no banco
 
         // 3. Envia o e-mail APÓS confirmar a atualização, SE o status mudou
         if (pedidoAtual.status !== novoStatus) {
             // Chama a função de envio de e-mail
             await enviarEmailStatusPedido(
                 { id: pedidoId }, // Objeto pedido (só precisamos do id aqui)
                 { email: pedidoAtual.email, nome: pedidoAtual.nome }, // Objeto cliente
                 novoStatus, // O novo status que foi definido
                 codigoFinal // O código de rastreio (pode ser null)
             );
         } else {
             console.log(`[INFO] Status do pedido ${pedidoId} não alterado. E-mail não enviado.`);
         }
 
         res.redirect('/admin/pedidos?message=Pedido atualizado com sucesso!');
 
     } catch (error) {
         await connection.rollback(); // Desfaz a transação em caso de erro
         console.error(`Erro ao atualizar pedido ${pedidoId}:`, error);
         // Redireciona de volta para a página de detalhes com uma mensagem de erro
         res.redirect(`/admin/pedidos/${pedidoId}?error=true&message=Erro ao atualizar pedido.`);
     } finally {
         if (connection) connection.release(); // Libera a conexão
     }
 });

// Logout do admin
router.get('/logout', (req, res) => {
  if (req.session) {
    req.session.isAdmin = false;
    req.session.pinValidated = false;
    delete req.session.adminId;
    delete req.session.adminEmail;
    delete req.session.adminPin;
  }
  return res.redirect('/login');
});

// Rota pra quando for preciso o admin repor o estoque ou algo do tipo
router.post('/produtos/:id/repor', requireAdminPin, async (req, res) => {
  try {
    const produtoId = parseInt(req.params.id, 10);
    const qtd = parseInt(req.body.quantidade, 10);
    const LOW = 5;

    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      return res.status(400).send('Produto inválido.');
    }
    if (!Number.isInteger(qtd) || qtd <= 0) {
      return res.status(400).send('Quantidade inválida.');
    }

    // Transação para calcular novo estoque e ajustar flags
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [[cur]] = await conn.query(
        'SELECT estoque FROM produtos WHERE id = ? FOR UPDATE',
        [produtoId]
      );
      if (!cur) {
        await conn.rollback();
        return res.status(404).send('Produto não encontrado.');
      }

      const novoEstoque = Math.max(0, Number(cur.estoque) + qtd);

      await conn.query(
        `UPDATE produtos
            SET estoque = ?,
                -- se voltou a ter estoque, zera OUT
                out_of_stock_notified = CASE WHEN ? > 0 THEN 0 ELSE out_of_stock_notified END,
                -- se ultrapassou o LOW, zera LOW; se ficou entre 1..LOW, zera LOW p/ permitir novo alerta se cair/oscilar
                low_stock_notified = 0
          WHERE id = ?`,
        [novoEstoque, novoEstoque, produtoId]
      );

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    return res.redirect('/admin');
  } catch (e) {
    console.error('[admin] falha ao repor estoque:', e);
    return res.status(500).send('Erro ao repor estoque.');
  }
});

// Use o roteador de produtos sob o prefixo /admin/produtos
router.use('/produtos', produtosAdminRouter);

module.exports = { adminRouter: router };