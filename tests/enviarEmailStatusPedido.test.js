const nodemailer = require('nodemailer');
const { enviarEmailStatusPedido } = require('../frontend/js/enviarEmail');

// O que tá testando? Resposta: Envio de e-mails de atualização de status (pago, enviado, cancelado) , 
// e queremos como resultado final: E-mails simulados enviados corretamente, sem falhas ou erros

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  console.error.mockRestore();
  console.log.mockRestore();
});

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue(true)
  }))
}));

describe('enviarEmailStatusPedido', () => {
  let transporter;

  beforeEach(() => {
    transporter = { sendMail: jest.fn().mockResolvedValue(true) };
    nodemailer.createTransport.mockReturnValue(transporter);
  });

  const pedido = { id: 1 };
  const cliente = { email: 'cliente@teste.com', nome: 'Luiz Duarte' };

  it('envia e-mail quando o pedido é marcado como pago', async () => {
    await enviarEmailStatusPedido(pedido, cliente, 'pago');

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: cliente.email,
        subject: expect.stringContaining('Pagamento Confirmado'),
        html: expect.stringContaining('pagamento foi confirmado')
      })
    );
  });

  it('envia e-mail com código de rastreio quando o pedido é enviado', async () => {
    await enviarEmailStatusPedido(pedido, cliente, 'enviado', 'BR123456789');

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Enviado'),
        html: expect.stringContaining('BR123456789')
      })
    );
  });

  it('envia e-mail de cancelamento corretamente', async () => {
    await enviarEmailStatusPedido(pedido, cliente, 'cancelado');

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Cancelado'),
        html: expect.stringContaining('pedido foi cancelado')
      })
    );
  });

  it('lida com erro de envio sem quebrar o sistema', async () => {
    transporter.sendMail.mockRejectedValue(new Error('Falha SMTP'));
    await expect(enviarEmailStatusPedido(pedido, cliente, 'pago')).resolves.not.toThrow();
  });
});